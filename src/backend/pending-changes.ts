import {createHash,randomUUID} from 'node:crypto';
import type {Store} from './store';
import type {PendingChange} from '../shared/pending-changes';
import {redact} from './security';
import {SECRET_PLACEHOLDER,parseEnv,isSecretName} from '../shared/defaults';

type Request={method:'team.save'|'executor.save'|'settings.save'|'member.card.save';params:Record<string,any>};
type Job=PendingChange&{request:Request;baseline:string};
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Durable settings queue. Interrupted application is unknown and is never replayed automatically. */
export class PendingChanges{
  busy=false;
  constructor(private store:Store,private changed:()=>void,private apply:(method:string,params:unknown)=>Promise<unknown>){
    for(const job of store.list<Job>('pending_changes'))if(job.state==='applying')store.put('pending_changes',job.id,{...job,state:'unknown',error:'应用时工作台退出，请核对设置后重新提交。',updatedAt:new Date().toISOString()});
  }
  private baseline(request:Request){
    const {method,params}=request;
    return fingerprint((method==='team.save'||method==='member.card.save')?this.store.members().find(m=>m.id===params.member?.id)??null:method==='executor.save'?{executor:this.store.get('executors',params.executor?.id??'')??null,permissions:(this.store.get<any>('settings','main'))?.permissions?.[params.executor?.id]}:this.store.get('settings','main')??null);
  }
  list():PendingChange[]{return this.store.list<Job>('pending_changes').map(({request,baseline,...publicJob})=>publicJob).slice(-100).reverse();}
  get waiting(){return this.store.list<Job>('pending_changes').some(j=>j.state==='waiting');}
  enqueue(value:any){
    if(!['team.save','executor.save','settings.save','member.card.save'].includes(value?.method))throw Error('此操作不支持等待空闲后应用。');
    const request:Request=JSON.parse(JSON.stringify({method:value.method,params:value.params??{}}));
    if(['executor.save','member.card.save'].includes(request.method)&&typeof request.params.executor?.env==='string')request.params.executor.env=parseEnv(request.params.executor.env);
    if(['executor.save','member.card.save'].includes(request.method)){
      const executor=request.params.executor??{},old=this.store.get<{secretKeys?:string[]}>('executors',String(executor.id??''));
      const keys=Object.keys(executor.env??{}).filter(isSecretName).sort();
      if(JSON.stringify(keys)!==JSON.stringify([...(old?.secretKeys??[])].sort()))throw Error('凭据增删请在空闲后通过原有加密保存入口完成。');
    }
    const raw=JSON.stringify(request);if(raw.length>128000)throw Error('排队设置过大。');
    // New credentials must use the existing encrypted main-process route, never this durable queue.
    const safe=(v:any):void=>{if(!v||typeof v!=='object')return;for(const [k,item] of Object.entries(v)){
      if(isSecretName(k)&&!['claudeAuthMode','authentication'].includes(k)&&item&&item!==SECRET_PLACEHOLDER&&!(Array.isArray(item)&&k==='secretKeys'))throw Error('新的密钥不能写入设置队列，请空闲后使用原有加密保存入口。');
      if(typeof item==='string'&&(/\b(?:KEY|TOKEN|SECRET|PASSWORD)\s*=/i.test(item)||/:\/\/[^/\s]+:[^/\s]+@/.test(item)))throw Error('含凭据的设置请在空闲后通过原有加密入口保存。');safe(item);
    }};safe(request.params);
    if(request.method==='executor.save'&&Object.keys(request.params.secrets??{}).length)throw Error('密钥请通过加密入口保存。');
    if(this.store.list<Job>('pending_changes').filter(j=>['waiting','applying'].includes(j.state)).length>=50)throw Error('等待应用的设置已达上限。');
    const stamp=new Date().toISOString(),job:Job={id:randomUUID(),label:String(value.label??({'team.save':'人物卡','executor.save':'执行端连接','settings.save':'工作台设置','member.card.save':'人物卡与执行端'}[request.method])).slice(0,100),state:'waiting',createdAt:stamp,updatedAt:stamp,request,baseline:this.baseline(request)};
    this.store.put('pending_changes',job.id,job);this.changed();return this.list().find(j=>j.id===job.id)!;
  }
  /** Waiting jobs are cancelled; a failed or interrupted one is acknowledged, so it stops asking for attention. */
  cancel(id:string){const job=this.store.get<Job>('pending_changes',id);
    if(job&&['failed','unknown'].includes(job.state)){this.store.put('pending_changes',id,{...job,state:'dismissed',updatedAt:new Date().toISOString()});this.changed();return this.list().find(j=>j.id===id)!;}
    if(!job||job.state!=='waiting')throw Error('只能取消等待中的设置。');this.store.put('pending_changes',id,{...job,state:'cancelled',updatedAt:new Date().toISOString()});this.changed();return {cancelled:true};}
  async drain(idle:()=>boolean){
    if(this.busy||!idle())return;this.busy=true;
    try{for(const job of this.store.list<Job>('pending_changes').filter(j=>j.state==='waiting')){
      if(!idle())break;
      if(this.baseline(job.request)!==job.baseline){this.store.put('pending_changes',job.id,{...job,state:'failed',error:'等待期间设置已被修改，请核对后重新提交。',updatedAt:new Date().toISOString()});this.changed();continue;}
      this.store.put('pending_changes',job.id,{...job,state:'applying',updatedAt:new Date().toISOString()});this.changed();
      try{await this.apply(job.request.method,job.request.params);this.store.put('pending_changes',job.id,{...job,state:'applied',updatedAt:new Date().toISOString()});}
      catch(error){this.store.put('pending_changes',job.id,{...job,state:'failed',error:redact((error as Error).message),updatedAt:new Date().toISOString()});}this.changed();
    }}finally{this.busy=false;}
  }
}

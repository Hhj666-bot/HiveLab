/** Read-only Google account metadata. Never invokes an agent, generates content or enables credits. */
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {fetch,ProxyAgent} from 'undici';
import type {AcpExecutor} from '../../shared/types';

export interface GoogleQuotaRow {id:string;label:string;model:string;usedPercent:number;resetsAt?:number}
export interface GoogleQuota {
  status:'ready'|'unavailable';service:'antigravity';windows:GoogleQuotaRow[];checkedAt:string;
  reason?:string;signedOut?:boolean;
}
const record=(v:any):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const title=(v:any)=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/g,'').slice(0,120):'';
const fraction=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1?v:undefined;
const safeReset=(v:any)=>{const n=typeof v==='string'?Date.parse(v)/1000:NaN;return Number.isFinite(n)&&n>0?n:undefined;};
export function parseGoogleQuota(buckets:unknown,models:unknown,checkedAt=new Date().toISOString()):GoogleQuota {
  const catalog=record(record(models).models),rows:GoogleQuotaRow[]=[];
  const add=(id:string,raw:any,label?:string)=>{
    const value=fraction(raw?.remainingFraction);if(value===undefined||!id||id.length>160)return;
    rows.push({id,label:title(label)||id,model:id,usedPercent:Math.round((1-value)*1000000)/10000,resetsAt:safeReset(raw.resetTime)});
  };
  // Visible named models first; internal tab/chat models are not user-selectable quotas.
  for(const [id,raw] of Object.entries(catalog).slice(0,200)){
    const model=record(raw);if(!model.isInternal&&(title(model.displayName)||/^gemini-/i.test(id)))add(id,model.quotaInfo,model.displayName);
  }
  const namedModels=new Set(rows.map(row=>row.id));
  if(Array.isArray(record(buckets).buckets))for(const bucket of record(buckets).buckets.slice(0,200)){
    const id=title(bucket?.modelId);
    if(catalog[id]?.isInternal||namedModels.size&&!namedModels.has(id)||/^(chat_|tab_|mquery_|web-search|commit-)/i.test(id))continue;
    add(id,bucket,title(catalog[id]?.displayName));
  }
  const unique=new Map<string,GoogleQuotaRow>();
  for(const row of rows){const old=unique.get(row.id);if(!old||row.usedPercent>old.usedPercent)unique.set(row.id,row);}
  const windows=[...unique.values()].sort((a,b)=>Number(!/gemini/i.test(a.model))-Number(!/gemini/i.test(b.model))||a.label.localeCompare(b.label));
  return {status:windows.length?'ready':'unavailable',service:'antigravity',windows,checkedAt,...(!windows.length?{reason:'账号服务未返回可验证的模型配额。'}:{})};
}
/** Resolve the known official ACP launcher without executing or evaluating arbitrary source. */
export function googleQuotaHome(executor:AcpExecutor):string|undefined {
  for(const arg of executor.args??[]){
    if(!path.isAbsolute(arg)||path.basename(arg)!=='launch-official-acp.cjs')continue;
    const root=path.dirname(arg);
    try{
      const source=readFileSync(arg,'utf8');
      if(source.includes("path.join(root,'account')")&&source.includes("'official-acp','agy_acp_server.exe'")&&existsSync(path.join(root,'official-acp','agy_acp_server.exe')))return path.join(root,'account');
    }catch{}
  }
}
export function googleQuotaStamp(executor:AcpExecutor):unknown {
  const home=googleQuotaHome(executor);if(!home)return;
  const file=path.join(home,'.gemini','antigravity-acp','acp_token.json');
  try{const s=statSync(file);return [home,s.mtimeMs,s.size];}catch{return [home,'missing'];}
}
export async function readGoogleQuota(home:string,proxyUrl?:string):Promise<GoogleQuota>{
  const checkedAt=new Date().toISOString(),unavailable=(reason:string,signedOut=false):GoogleQuota=>({status:'unavailable',service:'antigravity',windows:[],checkedAt,reason,...(signedOut?{signedOut:true}:{})});
  if(!path.isAbsolute(home))return unavailable('请选择 Antigravity 官方 ACP 登录主目录。');
  let credentials:any;
  try{const file=path.join(home,'.gemini','antigravity-acp','acp_token.json');if((await stat(file)).size>65536)return unavailable('官方登录文件格式不受支持。');credentials=JSON.parse(await readFile(file,'utf8'));}
  catch{return unavailable('未找到官方 ACP 登录，请先在对应执行端完成登录。',true);}
  if(!['client_id','client_secret','refresh_token','project_id'].every(key=>typeof credentials[key]==='string'&&credentials[key].length&&credentials[key].length<16000)||credentials.token_uri&&credentials.token_uri!=='https://oauth2.googleapis.com/token')return unavailable('官方登录文件格式不受支持。');
  const proxy=proxyUrl?new ProxyAgent(proxyUrl):undefined;
  const post=async(url:string,body:URLSearchParams|string,token?:string)=>{
    const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),dispatcher:proxy,headers:{'Content-Type':token?'application/json':'application/x-www-form-urlencoded','User-Agent':'antigravity',...(token?{Authorization:`Bearer ${token}`}:{})},body});
    if(!response.ok){await response.body?.cancel();return {code:response.status,data:{}};}
    const parts:Uint8Array[]=[];let size=0;
    for await(const chunk of response.body!){size+=chunk.length;if(size>2*1024*1024)throw new Error('bounded response');parts.push(chunk);}
    return {code:response.status,data:JSON.parse(Buffer.concat(parts).toString('utf8'))};
  };
  try{
    const login=await post('https://oauth2.googleapis.com/token',new URLSearchParams({client_id:credentials.client_id,client_secret:credentials.client_secret,refresh_token:credentials.refresh_token,grant_type:'refresh_token'}));
    if(login.code!==200||typeof login.data.access_token!=='string')return unavailable(login.code===400||login.code===401?'官方登录已失效，请重新登录。':'Google 登录服务暂不可用。',login.code===400||login.code===401);
    const body=JSON.stringify({project:credentials.project_id}),token=login.data.access_token;
    const [quota,models]=await Promise.all([post('https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',body,token),post('https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',body,token)]);
    if(quota.code!==200&&models.code!==200)return unavailable(quota.code===403?'账号服务拒绝读取配额，请检查官方执行端账户权限。':quota.code===429?'额度查询过于频繁，请稍后刷新。':'模型配额暂时无法读取，请检查网络或稍后重试。');
    return parseGoogleQuota(quota.data,models.data,checkedAt);
  }catch{return unavailable('额度查询连接失败或超时，请检查当前网络/代理后刷新。');}
  finally{await proxy?.close();}
}

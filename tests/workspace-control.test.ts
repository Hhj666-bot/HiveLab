import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {Store} from '../src/backend/store';
import {PendingChanges} from '../src/backend/pending-changes';
import {AgentControl} from '../src/backend/agent-control';
import {Engine} from '../src/backend/engine';
import {CodexAdapter} from '../src/backend/adapters/codex';
import {messageDelivery} from '../src/shared/delivery';
import {activityEntries} from '../src/shared/run-activity';
import {DEFAULT_SETTINGS,SECRET_PLACEHOLDER} from '../src/shared/defaults';

test('settings queue waits for idle, survives restart, detects conflicts and never retries interrupted application',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'settings-queue-')),store=new Store(root);let idle=false,applied=0;
  const queue=new PendingChanges(store,()=>{},async(method,p:any)=>{applied++;store.put('members',p.member.id,p.member);});
  try{
    store.put('members','sol',{id:'sol',name:'Sol',executor:'codex'});
    const first=queue.enqueue({method:'team.save',params:{member:{id:'sol',name:'Sol 2'}}});await queue.drain(()=>idle);assert.equal(applied,0);assert.equal(queue.list()[0].state,'waiting');
    idle=true;await queue.drain(()=>idle);assert.equal(applied,1);assert.equal(queue.list().find(j=>j.id===first.id)?.state,'applied');
    const conflict=queue.enqueue({method:'team.save',params:{member:{id:'sol',name:'Sol 3'}}});store.put('members','sol',{id:'sol',name:'Newer'});await queue.drain(()=>true);assert.equal(applied,1);assert.equal(queue.list().find(j=>j.id===conflict.id)?.state,'failed');
    const cancelled=queue.enqueue({method:'team.save',params:{member:{id:'sol',name:'Sol 4'}}});queue.cancel(cancelled.id);await queue.drain(()=>true);assert.equal(applied,1);
    const interrupted=queue.enqueue({method:'team.save',params:{member:{id:'sol',name:'Sol 5'}}});const raw:any=store.get('pending_changes',interrupted.id);store.put('pending_changes',raw.id,{...raw,state:'applying'});
    const restart=new PendingChanges(store,()=>{},async()=>{applied++;});await restart.drain(()=>true);assert.equal(restart.list().find(j=>j.id===raw.id)?.state,'unknown');assert.equal(applied,1);
    assert.throws(()=>queue.enqueue({method:'executor.delete',params:{id:'sol'}}),/不支持/);
    store.put('executors','acp-test12345',{id:'acp-test12345',secretKeys:['API_TOKEN']});
    assert.throws(()=>queue.enqueue({method:'executor.save',params:{executor:{id:'acp-test12345',env:{API_TOKEN:'private-example-token'}}}}),/密钥/);
    assert.throws(()=>queue.enqueue({method:'executor.save',params:{executor:{id:'acp-test12345',env:{}}}}),/凭据增删/);
    queue.enqueue({method:'executor.save',params:{executor:{id:'acp-test12345',env:{API_TOKEN:SECRET_PLACEHOLDER}}}});
    queue.enqueue({method:'settings.save',params:{settings:{...DEFAULT_SETTINGS,claudeAuthMode:'subscription'}}});
    assert.doesNotMatch(readFileSync(path.join(root,'hivelab.sqlite')).toString('utf8'),/private-example-token/);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('formal control API is loopback/session scoped, rejects other origins and preserves bounded tool dispatch',async()=>{
  let active=true,calls=0;const server=new AgentControl(id=>active&&id==='session',async(_session,name,args)=>{calls++;return {name,args};});
  try{
    const env=await server.credentials('session'),again=await server.credentials('session');assert.deepEqual(env,again);
    const call=(body:unknown,headers:Record<string,string>={})=>fetch(env.HIVELAB_CONTROL_URL,{method:'POST',headers:{Authorization:'Bearer '+env.HIVELAB_CONTROL_TOKEN,...headers},body:typeof body==='string'?body:JSON.stringify(body)});
    assert.equal((await fetch(env.HIVELAB_CONTROL_URL,{method:'POST',body:'{}'})).status,401);
    assert.equal((await call({name:'status'},{Origin:'https://untrusted.example'})).status,403);
    assert.equal((await call({name:'delete_everything'})).status,400);
    assert.equal((await call('x'.repeat(3*1024*1024+1))).status,413);
    const response=await call({name:'members',arguments:{test:true}});assert.equal(response.status,200);assert.equal(calls,1);assert.deepEqual((await response.json()).result.args,{test:true});
    active=false;assert.equal((await call({name:'status'})).status,401);assert.equal(calls,1);
  }finally{server.close();}
});

test('Codex explicit commentary goes to progress activity and final_answer remains separate',()=>{
  const adapter:any=new CodexAdapter(),events:any[]=[];
  adapter.context={emit:(kind:string,text:string,data:any)=>events.push({id:String(events.length),kind,text,data,at:'2026-10-18',fidelity:'native'})};adapter.delivered=true;adapter.turnId='turn';
  const notify=(method:string,p:any)=>adapter.notification(method,{turnId:'turn',...p});
  notify('item/started',{item:{id:'comment',type:'agentMessage',phase:'commentary'}});
  notify('item/agentMessage/delta',{itemId:'comment',delta:'正在检查配置。'});notify('item/completed',{item:{id:'comment',type:'agentMessage',phase:'commentary',text:'正在检查配置。'}});
  notify('item/started',{item:{id:'final',type:'agentMessage',phase:'final_answer'}});notify('item/agentMessage/delta',{itemId:'final',delta:'配置已修复。'});notify('item/completed',{item:{id:'final',type:'agentMessage',phase:'final_answer',text:'配置已修复。'}});
  assert.deepEqual(events.map(e=>[e.kind,e.text]),[['progress','正在检查配置。'],['delta','配置已修复。']]);assert.equal(adapter.summary,'配置已修复。');assert.equal(activityEntries(events,false)[0].kind,'progress');
});

test('message delivery never equates endpoint receipt with processing and keeps unknown deliveries visible',()=>{
  const message:any={author:'user',deliveryKind:'supplement',deliveryId:'r',runId:'run'},snapshot:any={runs:[],deliveryReceipts:[{id:'r',delivery:'confirmed'}]};
  assert.match(messageDelivery(message,snapshot),/已接收补充/);assert.doesNotMatch(messageDelivery(message,snapshot),/已处理/);
  snapshot.deliveryReceipts[0].delivery='unknown';assert.match(messageDelivery(message,snapshot),/待核对/);
  assert.match(messageDelivery({...message,deliveryKind:'queued'},{runs:[{id:'run',status:'queued'}]} as any),/排队/);
});

test('engine applies queued configuration after a mock running task finishes, without stopping the member',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'queued-engine-'));let started=false,stops=0,context:any,release!:()=>void;const done=new Promise<void>(r=>release=r);
  const engine=new Engine(root,()=>{},()=>{},id=>({async probe(){return {id,name:id,auth:'subscription',available:true,detail:'isolated',capabilities:{steer:true,cancel:'native',streaming:true,write:true,history:true}};},async start(ctx){context=ctx;started=true;ctx.markDelivery('confirmed');await done;ctx.emit('message','完成',{source:'assistant'});return {};},async stop(){stops++;release();}}),{maintenanceOnly:true});
  const until=async(read:()=>boolean)=>{for(let i=0;i<200;i++){if(read())return;await new Promise(r=>setTimeout(r,10));}throw Error('did not settle');};
  try{
    engine.store.put('members','sol',{id:'sol',executor:'codex',name:'Sol',color:'#339966',motto:''});await engine.probe('codex');await engine.invoke('desk.open',{memberId:'sol'});await engine.invoke('desk.topic',{memberId:'sol'});await engine.invoke('room.send',{roomId:'desk:sol',text:'隔离任务'});await until(()=>started);
    engine.store.put('members','astra',{id:'astra',executor:'codex',name:'Astra',color:'#339966',motto:''});
    const control=async(name:string,args:any={})=>{const r=await fetch(context.env.HIVELAB_CONTROL_URL,{method:'POST',headers:{Authorization:'Bearer '+context.env.HIVELAB_CONTROL_TOKEN},body:JSON.stringify({name,arguments:args})});assert.equal(r.status,200);return (await r.json()).result;};
    assert.equal((await control('members')).length,2);await control('create_topic',{memberId:'astra',title:'正式工具创建的话题'});assert.ok(engine.store.list<any>('room_threads').some(t=>t.title==='正式工具创建的话题'));
    const cardJob=await control('update_persona',{memberId:'sol',patch:{voice:'新的口头禅'}});assert.equal(cardJob.state,'waiting');assert.equal(engine.store.members().find(m=>m.id==='sol')?.voice,undefined);
    const refused=async(args:any)=>{const r=await fetch(context.env.HIVELAB_CONTROL_URL,{method:'POST',headers:{Authorization:'Bearer '+context.env.HIVELAB_CONTROL_TOKEN},body:JSON.stringify({name:'update_persona',arguments:args})});assert.notEqual(r.status,200);};
    await refused({memberId:'sol',patch:{persona:'改掉人设'}});await refused({memberId:'astra',patch:{voice:'替别人改'}});
    const previous=engine.settings.maxParallel;const job:any=await engine.invoke('member.change.queue',{method:'settings.save',params:{settings:{maxParallel:4}}});assert.equal(engine.settings.maxParallel,previous);assert.equal(stops,0);
    const connectionJob:any=await engine.invoke('member.change.queue',{method:'member.card.save',params:{member:{...engine.store.members().find(m=>m.id==='astra')},executor:{name:'Mock Gemini',command:'isolated-mock',args:[],env:{},permissions:{commands:'ask',fileScope:'workspace',network:true}}}});assert.equal(connectionJob.state,'waiting');
    release();await until(()=>engine.snapshot().pendingChanges?.find(j=>j.id===job.id)?.state==='applied');await until(()=>engine.snapshot().pendingChanges?.find(j=>j.id===connectionJob.id)?.state==='applied');assert.equal(engine.settings.maxParallel,4);assert.equal(engine.store.members().find(m=>m.id==='sol')?.voice,'新的口头禅');assert.equal(stops,0);assert.ok(engine.store.members().find(m=>m.id==='astra')?.executor.startsWith('acp-'));
  }finally{release();await engine.close();rmSync(root,{recursive:true,force:true});}
});

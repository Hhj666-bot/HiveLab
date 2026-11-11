import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Engine} from '../src/backend/engine';
import {zcodeCanWrite} from '../src/shared/permissions';
import {ACP_DEFAULT_PERMISSIONS} from '../src/shared/defaults';
import type {AdapterContext,AcpExecutor,Run,Session} from '../src/shared/types';

test('ZCode restricted permissions allow a read-only turn and full access enables writing in the existing work copy',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'zcode-readonly-')),directory=path.join(root,'project');mkdirSync(directory);writeFileSync(path.join(directory,'original.txt'),'unchanged');
 const executor:AcpExecutor={id:'acp-zcodereadtest',name:'ZCode fixture',catalogId:'zcode',authentication:'bigmodel',command:'unused',args:[],env:{},permissions:ACP_DEFAULT_PERMISSIONS,createdAt:new Date().toISOString()};
 const turns:{write:boolean;cwd:string}[]=[];
 const engine=new Engine(path.join(root,'data'),()=>{},()=>{},id=>({async probe(){return {id,name:id,available:true,auth:'subscription',detail:'offline fixture',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true}};},async start(ctx:AdapterContext){turns.push({write:ctx.session.writeMode,cwd:ctx.cwd});if(ctx.session.writeMode)writeFileSync(path.join(ctx.cwd,'new.txt'),'copy-only');ctx.markDelivery('confirmed');ctx.emit('message','offline done');return {};},async stop(){}}),{maintenanceOnly:true});
 try{
  engine.store.put('executors',executor.id,executor);engine.store.put('members','m-fox',{id:'m-fox',name:'测试狐娘',executor:executor.id});
  const project=await engine.invoke('project.create',{name:'copy boundary',directory}) as any;
  const session=await engine.invoke('session.create',{projectId:project.id,provider:executor.id,memberId:'m-fox',writeMode:true}) as Session;await engine.probe(executor.id);
  const send=async(text:string)=>{const sent=await engine.invoke('session.send',{sessionId:session.id,text}) as any;for(let i=0;i<300&&!engine.store.get<Run>('runs',sent.runId)?.completedAt;i++)await new Promise(resolve=>setTimeout(resolve,10));const run=engine.store.get<Run>('runs',sent.runId)!;assert.equal(run.status,'ended',run.error??'offline turn should end');return run;};
  const readonly=await send('你好');assert.equal(turns[0].write,false);assert.equal(readonly.diagnosticContext?.writeMode,false);assert.equal(engine.store.get<Session>('sessions',session.id)?.writeMode,true);assert.notEqual(turns[0].cwd,directory);assert.equal(existsSync(path.join(directory,'new.txt')),false);
  await engine.invoke('member.permission',{memberId:'m-fox',mode:'full'});await send('写入副本');assert.equal(turns[1].write,true);assert.equal(turns[1].cwd,turns[0].cwd);assert.equal(readFileSync(path.join(turns[1].cwd,'new.txt'),'utf8'),'copy-only');assert.equal(existsSync(path.join(directory,'new.txt')),false);assert.equal(readFileSync(path.join(directory,'original.txt'),'utf8'),'unchanged');
  for(const permissions of [{commands:'ask',fileScope:'workspace',network:true},{commands:'auto',fileScope:'workspace',network:true},{commands:'auto',fileScope:'any',network:false}] as const)assert.equal(zcodeCanWrite(permissions),false);
  assert.equal(zcodeCanWrite({commands:'auto',fileScope:'any',network:true}),true);
 }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('desk topics start unnamed, take the first message title once and retain later manual names',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'desk-auto-title-'));
 const engine=new Engine(root,()=>{},()=>{},id=>({async probe(){return {id,name:id,available:true,auth:'subscription',detail:'fixture',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true}};},async start(ctx:AdapterContext){ctx.markDelivery('confirmed');ctx.emit('message','offline done');return {};},async stop(){}}),{maintenanceOnly:true});
 try{
  engine.store.put('members','m-one',{id:'m-one',name:'测试甲',executor:'codex'});engine.store.put('members','m-two',{id:'m-two',name:'测试乙',executor:'codex'});await engine.probe('codex');
  for(const memberId of ['m-one','m-two']){
   const topic=await engine.invoke('desk.topic',{memberId}) as any;assert.equal(topic.title,'新话题');assert.equal(topic.autoTitle,true);
   const roomId='desk:'+memberId;await engine.invoke('room.send',{roomId,text:'帮我整理这段代码'});
   for(let i=0;i<300&&engine.snapshot().runs.some(run=>!run.completedAt);i++)await new Promise(resolve=>setTimeout(resolve,10));
   const saved=engine.store.get<any>('room_threads',topic.id);assert.equal(saved.title,'帮我整理这段代码');assert.equal(saved.autoTitle,false);
   const link=engine.store.get<any>('desk_topics',topic.id);assert.equal(engine.store.get<Session>('sessions',link.sessionId)?.title,saved.title);
   await engine.invoke('room.rename',{roomId,threadId:topic.id,title:'我自己起的名字'});await engine.invoke('room.send',{roomId,text:'后续消息不覆盖名字'});
   for(let i=0;i<300&&engine.snapshot().runs.some(run=>!run.completedAt);i++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(engine.store.get<any>('room_threads',topic.id)?.title,'我自己起的名字');assert.equal(engine.store.get<Session>('sessions',link.sessionId)?.title,'我自己起的名字');
  }
 }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('an archived topic stops counting as unread, since it can no longer be marked read',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'desk-archived-unread-'));
 const engine=new Engine(root,()=>{},()=>{},id=>({async probe(){return {id,name:id,available:true,auth:'subscription',detail:'fixture',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true}};},async start(ctx:AdapterContext){ctx.markDelivery('confirmed');ctx.emit('message','offline done');return {};},async stop(){}}),{maintenanceOnly:true});
 try{
  engine.store.put('members','m-one',{id:'m-one',name:'测试甲',executor:'codex'});await engine.probe('codex');
  const topic=await engine.invoke('desk.topic',{memberId:'m-one'}) as any,roomId='desk:m-one';
  await engine.invoke('room.send',{roomId,text:'帮我整理这段代码'});
  for(let i=0;i<300&&engine.snapshot().runs.some(run=>!run.completedAt);i++)await new Promise(resolve=>setTimeout(resolve,10));
  const unread=()=>engine.snapshot().rooms?.find(room=>room.roomId===roomId)?.unread;
  assert.equal(unread(),true);
  await engine.invoke('room.archive',{roomId});
  assert.ok(engine.store.get<any>('room_threads',topic.id).archivedAt);assert.equal(unread(),false);
 }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

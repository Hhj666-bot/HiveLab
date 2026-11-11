import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Extensions} from '../src/backend/extensions';
import {MessageSkills} from '../src/backend/message-skills';
import {withMessageSkills} from '../src/shared/message-skills';
import {Engine} from '../src/backend/engine';
import {runSummary} from '../src/shared/run-summary';
import type {Run,RoomMessage} from '../src/shared/types';
import {HYPERFRAMES_MEMBERS} from '../src/shared/message-skills';
import {Store} from '../src/backend/store';

const until=async(read:()=>boolean)=>{for(let i=0;i<300;i++){if(read())return;await new Promise(r=>setTimeout(r,12));}throw Error('not settled');};
function fixture(root:string){const dir=path.join(root,'extensions','skills','per-message');mkdirSync(dir,{recursive:true});const file=path.join(dir,'SKILL.md');writeFileSync(file,'---\nname: per-message\ndescription: Per message fixture.\n---\nORIGINAL_SKILL_BODY');writeFileSync(path.join(root,'extensions','state.json'),JSON.stringify({apiVersion:1,enabled:{'skill:per-message':true}}));return file;}

test('message skill resolution rejects wrong providers/stale IDs, reads native content and freezes it without enabling global state',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'message-skills-'));fixture(root);const nativeDir=path.join(root,'native');mkdirSync(nativeDir);const file=path.join(nativeDir,'SKILL.md');writeFileSync(file,'Native fixture original.');
 const native={list:async(provider:string)=>({items:[{id:'native-id',name:'native fixture',path:file,description:'Native',enabled:provider==='claude'?false:true}],warnings:[]})};
 try{const service=new MessageSkills(new Extensions(root),native as any);const selected=await service.resolve([{source:'codex',id:'native-id'},{source:'common',id:'per-message'}],['codex']);writeFileSync(file,'Later edit');assert.equal(selected[0].content,'Native fixture original.');assert.match(withMessageSkills('task',selected,'codex'),/ORIGINAL_SKILL_BODY/);assert.doesNotMatch(withMessageSkills('task',selected,'dsh'),/Native fixture original/);assert.equal(withMessageSkills('task',undefined,'codex'),'task');await assert.rejects(service.resolve([{source:'codex',id:'native-id'}],['dsh']),/不兼容/);await assert.rejects(service.resolve([{source:'claude',id:'native-id'}],['claude']),/停用或移除/);await assert.rejects(service.resolve([{source:'common',id:'missing'}],['codex']),/停用或移除/);assert.ok(!(runSummary({input:'task',messageSkills:selected} as Run).messageSkills![0] as any).content);}
 finally{rmSync(root,{recursive:true,force:true});}
});

test('desk selected skills are frozen with queued messages, actually reach the adapter, survive projection, and never leak into the next automatic turn',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'message-skills-engine-')),file=fixture(root),starts:string[]=[];let release!:()=>void;const first=new Promise<void>(r=>release=r);
 const engine=new Engine(root,()=>{},()=>{},id=>({async probe(){return {id,name:id,available:true,auth:'subscription',detail:'mock',capabilities:{steer:true,cancel:'native',streaming:true,write:true,history:true}};},async start(ctx){starts.push(ctx.run.input);ctx.markDelivery('confirmed');if(starts.length===1)await first;ctx.emit('message','完成',{source:'assistant'});return {};},async steer(){throw Error('selected skills must queue, never steer without metadata');},async stop(){release();}}),{maintenanceOnly:true});
 try{engine.store.put('members','person',{id:'person',executor:'codex',name:'Person',color:'#339966',motto:''});await engine.probe('codex');await engine.invoke('desk.open',{memberId:'person'});await engine.invoke('desk.topic',{memberId:'person'});await engine.invoke('room.send',{roomId:'desk:person',text:'first'});await until(()=>starts.length===1);
 const selected=await engine.invoke('room.send',{roomId:'desk:person',text:'second',skills:[{source:'common',id:'per-message'}]}) as {delivery:string;runId:string};assert.equal(selected.delivery,'queued');writeFileSync(file,'---\nname: per-message\ndescription: Changed.\n---\nLATER_CHANGED_BODY');release();await until(()=>starts.length===2&&engine.store.list<Run>('runs').every(r=>r.status==='ended'));assert.match(starts[1],/ORIGINAL_SKILL_BODY/);assert.doesNotMatch(starts[1],/LATER_CHANGED_BODY/);assert.equal(engine.store.get<Run>('runs',selected.runId)!.input,'second');
 const room=await engine.invoke('room.get',{roomId:'desk:person'}) as {messages:RoomMessage[]};assert.equal(room.messages.find(m=>m.text==='second')?.skills?.[0].name,'per-message');
 await engine.invoke('room.send',{roomId:'desk:person',text:'third',messageSkills:[{source:'common',id:'forged',content:'FORGED_CONTENT'}]});await until(()=>starts.length===3);assert.equal(starts[2],'third');assert.doesNotMatch(starts[2],/SKILL_BODY|FORGED_CONTENT/);
 }finally{release();await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('meeting replies receive only the current human message selection; an automatic later message resets it',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'message-skills-meeting-'));fixture(root);const starts:string[]=[];
 const engine=new Engine(root,()=>{},()=>{},id=>({async probe(){return {id,name:id,available:true,auth:'subscription',detail:'mock',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true}};},async start(ctx){starts.push(ctx.run.input);const raw=ctx.run.input.split('HIVELAB_CONTEXT\n').at(-1)!.split(/\n\n(?:> )?\[用户为本条消息指定的 Skills\]/)[0].trim();const c=JSON.parse(raw);ctx.markDelivery('confirmed');ctx.emit('message',JSON.stringify({version:1,turn:c.turn,revision:c.revision,action:'speak',body:'已回答。'}),{source:'assistant'});return {};},async stop(){}}),{maintenanceOnly:true});
 try{engine.store.put('members','person',{id:'person',executor:'codex',name:'Person',color:'#339966',motto:''});await engine.probe('codex');await engine.invoke('room.send',{text:'第一条',mode:'discuss',style:'work',memberIds:['person'],skills:[{source:'common',id:'per-message'}]});await until(()=>starts.length===1&&engine.store.roomState().active===false);assert.match(starts[0],/ORIGINAL_SKILL_BODY/);
 await engine.invoke('room.send',{text:'第二条',mode:'discuss',style:'work',memberIds:['person']});await until(()=>starts.length===2&&engine.store.roomState().active===false);assert.doesNotMatch(starts[1],/ORIGINAL_SKILL_BODY/);assert.equal(engine.store.list<Run>('runs').every(r=>r.status==='ended'),true);
 }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('HyperFrames bundle includes unprefixed workflows, selects all 21, and keeps native namespaces separate',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'skill-groups-'));fixture(root);
 for(const name of HYPERFRAMES_MEMBERS){const dir=path.join(root,'extensions/skills',name);mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'SKILL.md'),`---\nname: ${name}\ndescription: HyperFrames workflow.\n---\nHyperFrames ${name}.`);}
 const enabled=Object.fromEntries(['per-message',...HYPERFRAMES_MEMBERS].map(id=>['skill:'+id,true]));writeFileSync(path.join(root,'extensions/state.json'),JSON.stringify({apiVersion:1,enabled}));
 let reads=0;const native={list:async()=>{reads++;return {items:[{id:'native-parent',name:'suite:suite',path:path.join(root,'extensions/skills/hyperframes/SKILL.md'),enabled:true},{id:'native-child',name:'suite:helper',path:path.join(root,'extensions/skills/hyperframes-core/SKILL.md'),enabled:true}],warnings:[]};}};
 try{const service=new MessageSkills(new Extensions(root),native as any),list=await service.list(['codex']);assert.equal(reads,1);const group=list.items.filter(s=>s.group?.name==='HyperFrames');assert.equal(group.length,21);assert.ok(group.some(s=>s.name==='media-use'));assert.ok(group.some(s=>s.name==='general-video'));assert.equal(list.items.filter(s=>s.group?.id==='codex:package:suite').length,2);assert.equal(list.items.find(s=>s.name==='per-message')?.group,undefined);
  const selected=await service.resolve(group.map(({source,id})=>({source,id})),['codex']);assert.equal(selected.length,21);assert.match(withMessageSkills('task',selected,'codex'),/HyperFrames general-video/);
  writeFileSync(path.join(root,'extensions/skills/figma/SKILL.md'),'---\nname: figma\ndescription: Standalone design tool.\n---\nUnrelated tool.');const after=await service.list([]);assert.equal(after.items.find(s=>s.name==='figma')?.group,undefined,'an unrelated same-named tool is not added to the suite');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('personal descriptions persist across service restart, stay separate by source, and never enter model prompts',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'skill-notes-'));const file=fixture(root);let store=new Store(root);const native={list:async()=>({items:[{id:'per-message',name:'Native copy',path:file,enabled:true}],warnings:[]})};
 try{let service=new MessageSkills(new Extensions(root),native as any,store);await service.note({source:'common',id:'per-message',note:'  我的写作工具  '});await service.note({source:'codex',id:'per-message',note:'原生副本'});store.close();store=new Store(root);service=new MessageSkills(new Extensions(root),native as any,store);const list=await service.list(['codex']);assert.equal(list.items.find(s=>s.source==='common'&&s.id==='per-message')?.note,'我的写作工具');assert.equal(list.items.find(s=>s.source==='codex')?.note,'原生副本');const chosen=await service.resolve([{source:'common',id:'per-message'}],['codex']);assert.doesNotMatch(withMessageSkills('task',chosen,'codex'),/我的写作工具/);await assert.rejects(service.note({source:'common',id:'per-message',note:'x'.repeat(161)}),/160/);await service.note({source:'common',id:'per-message',note:''});assert.equal((await service.list([])).items.find(s=>s.id==='per-message')?.note,'');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

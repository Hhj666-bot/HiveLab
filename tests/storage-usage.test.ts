import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {Engine} from '../src/backend/engine';
import type {StorageUsage} from '../src/shared/storage';

test('storage retains deleted members, all desk topics and files, and can delete their topics',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'storage-history-'));
 const engine=new Engine(root,()=>{},()=>{},undefined,{maintenanceOnly:true});
 try{
  engine.store.put('members','history-test',{id:'history-test',name:'保留历史的人物',executor:'codex'});
  const first=await engine.invoke('desk.topic',{memberId:'history-test'}) as {id:string};
  const second=await engine.invoke('desk.topic',{memberId:'history-test'}) as {id:string};
  const folder=path.join(root,'desks','history-test');
  const file=path.join(folder,'保留.txt');writeFileSync(file,'keep');
  await engine.invoke('team.delete',{id:'history-test'});
  const usage=await engine.invoke('storage.usage',{refresh:true}) as StorageUsage;
  const desk=usage.desks.find(item=>item.memberId==='history-test');
  assert.equal(desk?.name,'保留历史的人物');assert.equal(desk?.removed,true);
  assert.deepEqual(new Set(desk?.topics.map(item=>item.id)),new Set([first.id,second.id]));
  assert.ok(desk!.bytes>=4);
  await engine.invoke('storage.deleteTopic',{memberId:'history-test',threadId:first.id});
  await engine.invoke('storage.deleteTopic',{memberId:'history-test',threadId:second.id});
  const after=await engine.invoke('storage.usage',{refresh:true}) as StorageUsage;
  assert.equal(after.desks.find(item=>item.memberId==='history-test')?.topics.length,0);
  assert.equal(existsSync(file),true);
 }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('storage hides deleted members that left nothing behind and explains each category',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'storage-breakdown-'));
 const engine=new Engine(root,()=>{},()=>{},undefined,{maintenanceOnly:true});
 try{
  engine.store.put('members','empty-removed',{id:'empty-removed',name:'无残留',executor:'codex'});
  engine.store.put('members','topic-removed',{id:'topic-removed',name:'只剩话题',executor:'codex'});
  await engine.invoke('desk.topic',{memberId:'topic-removed'});
  await engine.invoke('team.delete',{id:'empty-removed'});await engine.invoke('team.delete',{id:'topic-removed'});
  for(const dir of ['native/claude','native/acp','backgrounds','startup-media','browsers','process-temp/owned-x'])mkdirSync(path.join(root,dir),{recursive:true});
  writeFileSync(path.join(root,'native','claude','login.json'),'x'.repeat(30));writeFileSync(path.join(root,'backgrounds','a.png'),'x'.repeat(20));writeFileSync(path.join(root,'browsers','b'),'x'.repeat(10));
  const usage=await engine.invoke('storage.usage',{refresh:true}) as StorageUsage;
  const empty=usage.desks.find(item=>item.memberId==='empty-removed'),kept=usage.desks.find(item=>item.memberId==='topic-removed');
  assert.equal(empty,undefined,'a deleted card with no files and no topics is not listed');
  assert.equal(kept?.removed,true);assert.equal(kept?.topics.length,1);
  const native=usage.breakdown.native!;assert.deepEqual(native.map(item=>item.path).sort(),['native/acp','native/claude']);assert.equal(native[0].path,'native/claude');assert.equal(native[0].label,'Claude');
  assert.equal(native.reduce((sum,item)=>sum+item.bytes,0),usage.categories.native);
  assert.deepEqual(usage.breakdown.media!.map(item=>[item.path,item.items]),[['backgrounds',1],['startup-media',0]]);
  assert.ok(usage.breakdown.runtime!.some(item=>item.path==='browsers'&&item.label==='内置浏览器'));
  assert.ok(usage.breakdown.database!.some(item=>item.path==='hivelab.sqlite'&&!item.directory));
  assert.equal(usage.staleTemp,0);
 }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

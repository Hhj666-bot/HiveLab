import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {previewFile} from '../src/main/file-preview';
import {Engine} from '../src/backend/engine';
const until=async(read:()=>boolean)=>{for(let i=0;i<250;i++){if(read())return;await new Promise(r=>setTimeout(r,12));}throw Error('not settled');};
test('preview returns Markdown and HTML data and refuses traversal and binary files',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'preview-')),id='00000000-0000-4000-8000-000000000001',folder=path.join(root,'attachments',id);mkdirSync(folder,{recursive:true});
 try{writeFileSync(path.join(folder,'说明.md'),'# 标题\n\n正文 **加粗**');const value=await previewFile(root,{} as any,{source:'attachment',id,name:'说明.md'});assert.equal(value.kind,'markdown');assert.match(value.content!,/# 标题/);
 writeFileSync(path.join(folder,'demo.html'),'<script>alert(1)</script>');assert.equal((await previewFile(root,{} as any,{source:'attachment',id,name:'demo.html'})).kind,'html');
 await assert.rejects(previewFile(root,{} as any,{source:'attachment',id,name:'../说明.md'}),/标识无效/);writeFileSync(path.join(folder,'binary.txt'),Buffer.from([0,1,2]));assert.equal((await previewFile(root,{} as any,{source:'attachment',id,name:'binary.txt'})).kind,'unsupported');
 const outputs={resolve:async()=>({file:{name:'说明.md'},target:path.join(folder,'说明.md')})};assert.equal((await previewFile(root,outputs as any,{source:'generated',id})).kind,'markdown');
 }finally{rmSync(root,{recursive:true,force:true});}
});
for(const personal of [false,true])test(`manual image generation stays in ${personal?'desk':'tea room'} and publishes native image bytes without another room`,async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'image-room-')),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG3sAAAAASUVORK5CYII=';let starts=0;
 const engine=new Engine(root,()=>{},()=>{},id=>({async probe(){return {id,name:id,available:true,auth:'subscription',detail:'mock',capabilities:{steer:true,cancel:'native',streaming:true,write:true,history:true,images:true,imageGeneration:true}};},async start(ctx){starts++;assert.equal(ctx.run.imageGeneration,true);assert.equal(ctx.session.writeMode,false);ctx.markDelivery('confirmed','img-turn');ctx.emit('image','图片',{nativeItemId:'img',nativeTurnId:'img-turn',result:png});ctx.emit('message','已生成。',{source:'assistant'});return {summary:'已生成。'};},async stop(){}}),{maintenanceOnly:true});
 try{engine.store.put('members','sol',{id:'sol',executor:'codex',name:'Sol',color:'#339966',motto:''});await engine.probe('codex');const roomId=personal?'desk:sol':'global';if(personal){await engine.invoke('desk.open',{memberId:'sol'});await engine.invoke('desk.topic',{memberId:'sol'});}
 const before=(await engine.invoke('room.get',{roomId}) as any).currentThreadId;const accepted:any=await engine.invoke('room.generateImage',{roomId,memberId:'sol',text:'一只小鲸鱼'});assert.equal(accepted.accepted,true);try{await until(()=>engine.store.list<any>('runs').some(r=>r.generatedImages?.length===1));await until(()=>engine.store.list<any>('room_messages').some(m=>m.id===accepted.messageId&&m.status==='done'));
 const message=engine.store.get<any>('room_messages',accepted.messageId);assert.equal(message.threadId,before);assert.equal(engine.store.get<any>('room_threads',message.threadId).roomId??'global',roomId);assert.equal(message.generatedImages.length,1);assert.equal(starts,1);assert.equal(engine.store.list<any>('runs')[0].status,'ended');}catch(error){console.error(JSON.stringify({runs:engine.store.list('runs'),messages:engine.store.list('room_messages')},null,2));throw error;}
 }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

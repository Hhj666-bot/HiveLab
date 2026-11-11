import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../src/backend/store';
import { MemberWorkspaces } from '../src/backend/member-workspaces';
import type { Attachment, MemberProfile, Run, Session } from '../src/shared/types';

for(const provider of ['codex','dsh','acp-future123'] as const)test(`${provider}: an active desk accepts supplements without overwriting the original run input`,async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'desk-')),store=new Store(root);
  const member:MemberProfile={id:'person',name:'测试成员',executor:provider,color:'#00aa66',motto:''};store.put('members',member.id,member);
  let delivery='prepared',runId='first',lastIntent:string|undefined;let stopped=0;
  const workspace=new MemberWorkspaces(store,{
    createSession(projectId,person,title,write){const session:Session={id:'session',projectId,provider:person.executor,memberId:person.id,title,writeMode:write,revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};store.put('sessions',session.id,session);return session;},
    async send(sessionId,text,attachments,intent){
      lastIntent=intent;
      if(delivery!=='current')store.put('runs',runId,{id:runId,sessionId,projectId:store.get<Session>('sessions',sessionId)!.projectId,provider,revision:1,status:delivery==='queued'?'queued':'running',input:text,attachments,delivery:'confirmed',bootId:'test',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()} satisfies Run);
      return {runId,delivery};
    },
    async stop(){stopped++;},async removeSession(){},async resetSession(){},changed(){},track(){},async reply(){throw Error('not used');}
  });
  try{
    await workspace.newTopic('desk:person',{});
    await workspace.send('desk:person',{text:'原始任务'});
    delivery='current';await workspace.send('desk:person',{text:'新增要求'});
    workspace.refresh();
    assert.equal(lastIntent,'supplement');assert.equal(stopped,0);assert.equal(store.get<Run>('runs','first')!.input,'原始任务');
    const messages=workspace.history('desk:person').messages.filter(message=>message.author==='user');
    assert.deepEqual(messages.map(message=>message.text),['原始任务','新增要求']);
    delivery='queued';runId='second';await workspace.send('desk:person',{text:'下一轮要求',attachments:[{id:'image',name:'a.png',kind:'image',mime:'image/png',size:1} as Attachment]});
    assert.equal(lastIntent,'supplement');assert.equal(store.get<Run>('runs','second')!.input,'下一轮要求');assert.equal(stopped,0);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

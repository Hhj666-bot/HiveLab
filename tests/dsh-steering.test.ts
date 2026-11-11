import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { DSH_GUARD_SOURCE } from '../src/backend/adapters/dsh';
import { sendDshSteering } from '../src/backend/adapters/dsh-steering';

test('DSH policy plugin steers the matching live turn with the official immutable user-message helper',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'dsh-steer-')),file=path.join(root,'guard.mjs');writeFileSync(file,DSH_GUARD_SOURCE);
  const pipe=process.platform==='win32'?`\\\\.\\pipe\\test-hivelab-${randomUUID()}`:path.join(root,'steer.sock');
  const handlers=new Map<string,Function[]>(),messages:any[]=[];
  const ctx={tools:{guard(){},schemas(){return[];}},on(name:string,callback:Function){handlers.set(name,[...(handlers.get(name)??[]),callback]);}};
  const emit=(name:string,...args:any[])=>{for(const fn of handlers.get(name)??[])fn(...args);};
  try {
    const plugin=await import(pathToFileURL(file).href);
    await plugin.apply(ctx,{steeringPipe:pipe,steeringMessageModule:pathToFileURL(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-llm')).href,commands:'auto'});
    const session={header:{id:'native-session'}},agent={session,steer(message:unknown){messages.push(message);},ctx:{tools:{restrict(){}}}};
    emit('agent/created',{agent});emit('session/event',session,{type:'turn/start',data:{turn:7}});
    // Listening is asynchronous, so wait for this test-owned pipe to be ready before submitting.
    let accepted=false;
    for(let i=0;i<20&&!accepted;i++){accepted=await sendDshSteering(pipe,'native-session',7,'补充要求');if(!accepted)await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(accepted,true);assert.equal(messages.length,1);assert.equal(messages[0].role,'user');assert.equal(messages[0].content[0].text,'补充要求');assert.equal(Object.isFrozen(messages[0]),true);
    assert.equal(await sendDshSteering(pipe,'wrong-session',7,'错误会话'),false);
    assert.equal(await sendDshSteering(pipe,'native-session',6,'过期轮次'),false);
    emit('session/event',session,{type:'turn/end',data:{turn:7,reason:{kind:'completed'}}});
    assert.equal(await sendDshSteering(pipe,'native-session',7,'太晚的补充'),false);assert.equal(messages.length,1);
  }finally{emit('dispose');rmSync(root,{recursive:true,force:true});}
});

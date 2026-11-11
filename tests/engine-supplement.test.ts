import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Engine} from '../src/backend/engine';
import {Store} from '../src/backend/store';
import type {Adapter,ProviderId,Run} from '../src/shared/types';

async function until(read:()=>boolean){for(let i=0;i<200;i++){if(read())return;await new Promise(resolve=>setTimeout(resolve,15));}throw Error('run did not settle');}
for(const provider of ['codex','dsh','claude'] as const)test(`${provider}: engine routes active supplements and queues without cancel or duplicate dispatch`,async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'engine-steer-')),seed=new Store(root);
  seed.put('members','test-member',{id:'test-member',executor:provider,name:'测试',color:'#339966',motto:''});seed.close();
  const native=provider!=='claude',starts:string[]=[],steers:string[]=[];
  let mode:'current'|'unknown'='current',release!:()=>void,stops=0;
  const first=new Promise<void>(resolve=>release=resolve);
  const factory=(id:ProviderId):Adapter=>({
    async probe(){return {id,name:id,auth:id==='dsh'?'account':'subscription',available:true,detail:'isolated mock',capabilities:{steer:native,cancel:'native',streaming:true,write:true,history:true}};},
    async start(ctx){starts.push(ctx.run.input);ctx.markDelivery('confirmed');if(starts.length===1)await first;ctx.emit('message','测试任务完成',{source:'assistant'});return {};},
    async steer(text){steers.push(text);if(mode==='unknown')throw Error('lost receipt');return true;},
    async stop(){stops++;release();}
  });
  const engine=new Engine(root,()=>{},()=>{},factory,{maintenanceOnly:true});
  try{
    await engine.probe(provider);await engine.invoke('desk.open',{memberId:'test-member'});await engine.invoke('desk.topic',{memberId:'test-member'});
    await engine.invoke('room.send',{roomId:'desk:test-member',text:'原任务'});await until(()=>starts.length===1);
    const supplement=await engine.invoke('room.send',{roomId:'desk:test-member',text:'补充要求'}) as {delivery:string};
    assert.equal(supplement.delivery,native?'current':'queued');assert.equal(stops,0);assert.deepEqual(starts,['原任务']);
    assert.equal(engine.store.list<Run>('runs').length,native?1:2);assert.equal(steers.length,native?1:0);
    if(native){
      mode='unknown';await assert.rejects(engine.invoke('room.send',{roomId:'desk:test-member',text:'回执丢失的补充'}),/lost receipt/);
      assert.equal(engine.store.list<Run>('runs').length,1,'uncertain delivery must not be replayed as a new run');
      assert.equal(engine.store.list<any>('outbox').filter(receipt=>receipt.delivery==='unknown').length,1);
    }
    release();await until(()=>engine.store.list<Run>('runs').every(run=>run.status==='ended'));
    assert.deepEqual(starts,native?['原任务']:['原任务','补充要求']);assert.equal(stops,0);
  }finally{release();await engine.close();rmSync(root,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerLifecycle} from '../src/backend/worker-lifecycle';

test('fatal rejection waits for cleanup before notifying the host or exiting, including concurrent faults',async()=>{
  const events:string[]=[];let finish!:()=>void;
  const lifecycle=createWorkerLifecycle({close:()=>{events.push('close');return new Promise<void>(resolve=>{finish=resolve;});},fatal:error=>events.push('fatal:'+String(error)),exit:code=>events.push('exit:'+code)});
  const first=lifecycle.fail('detached failure');
  await lifecycle.fail('second failure');
  assert.equal(lifecycle.closing,true);assert.deepEqual(events,['close']);
  finish();await first;
  assert.deepEqual(events,['close','fatal:detached failure','exit:1']);
});
test('fatal fault joins an in-progress orderly close instead of skipping cleanup',async()=>{
  const events:string[]=[];let finish!:()=>void;
  const lifecycle=createWorkerLifecycle({close:()=>new Promise<void>(resolve=>{events.push('close');finish=resolve;}),fatal:()=>events.push('fatal'),exit:()=>events.push('exit')});
  const close=lifecycle.close();assert.equal(lifecycle.close(),close);
  const fatal=lifecycle.fail(Error('fault while closing'));assert.deepEqual(events,['close']);
  finish();await Promise.all([close,fatal]);assert.deepEqual(events,['close','fatal','exit']);
});
test('tracked detached work catches rejection and exits once even if cleanup fails',async()=>{
  const errors:unknown[]=[],exits:number[]=[];
  const lifecycle=createWorkerLifecycle({close:async()=>{throw Error('cleanup failed');},fatal:error=>errors.push(error),exit:code=>exits.push(code)});
  lifecycle.track(Promise.reject(Error('probe failed')));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(errors.length,1);assert.match(String(errors[0]),/probe failed.*cleanup failed/);assert.deepEqual(exits,[1]);
});

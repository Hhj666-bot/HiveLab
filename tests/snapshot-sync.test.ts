import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SnapshotPublisher,applySnapshotPatch} from '../src/shared/snapshot-sync';
import type {Snapshot} from '../src/shared/types';

test('row deltas preserve mutations, ordering, deletion and section transitions',()=>{
 const publisher=new SnapshotPublisher('test');
 const row={id:'a',text:'before'};
 const inputs=[{events:[row,{id:'b'}]}, {events:[row,{id:'b'}]}, {events:[{id:'b'},row]}, {events:[row]}, {}, {events:[]}, {events:[{id:'x'},{id:'x'}]}, {events:[{id:'x'}]}];
 let current:Snapshot|undefined;
 for(const [index,input] of inputs.entries()){
  if(index===1)row.text='after';
  const snapshot=input as unknown as Snapshot,packet=publisher.publish(snapshot);
  assert.ok(packet);
  current=packet.type==='snapshot'?structuredClone(packet.snapshot):applySnapshotPatch(current!,packet);
  assert.deepEqual(current,{...snapshot,sync:publisher.current!.sync});
  assert.equal(publisher.publish(structuredClone(snapshot)),undefined);
 }
});

test('large row sections retain one serialized copy per row',()=>{
 const publisher=new SnapshotPublisher('memory');
 publisher.publish({events:Array.from({length:1000},(_,i)=>({id:String(i),text:'x'.repeat(1024)}))} as unknown as Snapshot);
 const cache=publisher as unknown as {fields:Map<string,string|undefined>;rows:Map<string,Map<string,string>>};
 assert.equal(cache.fields.get('events'),undefined);
 assert.equal(cache.rows.get('events')!.size,1000);
});

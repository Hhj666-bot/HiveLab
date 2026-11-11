import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAppStore} from '../src/renderer/app/store';

function memoryStorage(){
  const values=new Map<string,string>(),writes:string[]=[];
  return {values,writes,getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>{values.set(key,value);writes.push(value);},
    removeItem:(key:string)=>{values.delete(key);}};
}

test('App navigation restores without persisting the view, snapshots, approvals or transient dialogs',()=>{
  const storage=memoryStorage(),first=createAppStore(storage),actions=first.getState().actions;
  actions.setProjectId('project-kept');actions.setView('project');
  actions.setDeskMemberId('claude');actions.setReportMemberId('sol');
  actions.setSnapshot(s=>({...s,backendReady:true,dataDirectory:'private-directory'}));
  actions.setModal('settings');actions.setMemberStopping(true);
  const saved=JSON.parse(storage.values.get('hivelab.navigation')!);
  assert.deepEqual(saved,{state:{projectId:'project-kept',deskMemberId:'claude',reportMemberId:'sol'},version:1});
  const next=createAppStore(storage).getState();
  assert.equal(next.view,'work');assert.equal(next.projectId,'project-kept');
  assert.equal(next.deskMemberId,'claude');assert.equal(next.reportMemberId,'sol');
  assert.equal(next.snapshot.backendReady,false);assert.equal(next.snapshot.dataDirectory,'');
  assert.equal(next.modal,null);assert.equal(next.memberStopping,false);
});

test('App actions retain functional updates and state identity; streaming does not rewrite navigation',()=>{
  const storage=memoryStorage(),store=createAppStore(storage),actions=store.getState().actions;
  actions.setProjectId('p');const writes=storage.writes.length,before=store.getState();
  actions.setProjectId(previous=>previous);
  assert.equal(store.getState(),before);
  for(let n=0;n<15;n++)actions.setSnapshot(previous=>({...previous,backendReady:!previous.backendReady}));
  assert.equal(storage.writes.length,writes);
  assert.equal(store.getState().actions,actions);
  actions.setCollapsedProjects(previous=>new Set([...previous,'child']));
  assert.ok(store.getState().collapsedProjects.has('child'));
  assert.equal(before.collapsedProjects.size,0);
  actions.setProjectId('new-project');assert.equal(storage.writes.length,writes+1);
});

test('App stores isolate window state and action callbacks',()=>{
  const a=createAppStore(memoryStorage()),b=createAppStore(memoryStorage());
  a.getState().actions.setToast({id:1,text:'saved'});
  a.getState().actions.setView('desk');
  assert.equal(b.getState().toast,null);assert.equal(b.getState().view,'work');
});

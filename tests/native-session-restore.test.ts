import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CodexAdapter} from '../src/backend/adapters/codex';
import {findCodexRollout,repairCodexThreadIndex} from '../src/backend/adapters/codex-thread-index';
import {DshAdapter} from '../src/backend/adapters/dsh';
import {NativeResponseError} from '../src/backend/adapter-failure';
import {createHash} from 'node:crypto';
import {personaHash,personaRemembered} from '../src/backend/native-context';

const THREAD='01a14dbb-72d8-7442-b645-1ba22d2ef799';
const missing=new NativeResponseError(`no rollout found for thread id ${THREAD}`,-32600);

/** A moved data directory: the rollout is on disk, the index row still names the old root. */
function movedCodexHome(options:{rollout?:boolean,row?:boolean}={}){
  const root=mkdtempSync(path.join(process.env.TEMP!,'codex-index-')),home=path.join(root,'home'),state=path.join(root,'sqlite');
  const directory=path.join(home,'sessions','2026','10','18');mkdirSync(directory,{recursive:true});mkdirSync(state);
  const rollout=path.join(directory,`rollout-2026-10-18T14-38-12-${THREAD}.jsonl`);
  if(options.rollout!==false)writeFileSync(rollout,'{}\n');
  const db=new DatabaseSync(path.join(state,'state_5.sqlite'));db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL)');
  if(options.row!==false)db.prepare('INSERT INTO threads VALUES (?,?)').run(THREAD,`\\\\?\\D:\\Haywood\\native\\codex\\home\\sessions\\2026\\10\\18\\rollout-2026-10-18T14-38-12-${THREAD}.jsonl`);
  db.close();
  const row=()=>{const read=new DatabaseSync(path.join(state,'state_5.sqlite'));try{return (read.prepare('SELECT rollout_path FROM threads WHERE id=?').get(THREAD) as any)?.rollout_path;}finally{read.close();}};
  return {root,rollout,row,env:{HIVELAB_CODEX_HOME:home,HIVELAB_CODEX_STATE_DIR:state} as NodeJS.ProcessEnv};
}
const roomContext=(events:any[],session:any={roomThreadId:'thread'})=>({env:{},session,run:{},freshInput:()=>'rebuilt',emit:(kind:string,text:string,data:any,fidelity:string)=>events.push({kind,text,data,fidelity})}) as any;

test('Codex index repair rewrites only a stale row to the rollout on disk',()=>{
  const moved=movedCodexHome();
  try{
    assert.equal(findCodexRollout(moved.env.HIVELAB_CODEX_HOME!,THREAD),moved.rollout);
    assert.equal(findCodexRollout(moved.env.HIVELAB_CODEX_HOME!,'00000000-0000-0000-0000-000000000000'),undefined);
    assert.equal(repairCodexThreadIndex(moved.env,THREAD),true);assert.equal(moved.row(),moved.rollout);
  }finally{rmSync(moved.root,{recursive:true,force:true});}
  const gone=movedCodexHome({rollout:false});
  try{assert.equal(repairCodexThreadIndex(gone.env,THREAD),false);assert.match(gone.row(),/Haywood/);}finally{rmSync(gone.root,{recursive:true,force:true});}
  const unindexed=movedCodexHome({row:false});
  try{assert.equal(repairCodexThreadIndex(unindexed.env,THREAD),false);}finally{rmSync(unindexed.root,{recursive:true,force:true});}
  assert.equal(repairCodexThreadIndex({},THREAD),false);
});

test('Codex resume repairs a moved rollout, then retries the same thread once',async()=>{
  const moved=movedCodexHome(),adapter=new CodexAdapter() as any,events:any[]=[],calls:any[]=[];
  adapter.rpc={request:async(method:string,params:any)=>{calls.push([method,params.threadId]);if(calls.length===1)throw missing;return {thread:{id:THREAD}};}};
  try{
    const result=await adapter.resumeThread(roomContext(events),moved.env,THREAD,{threadId:THREAD});
    assert.equal(result.thread.id,THREAD);assert.deepEqual(calls,[['thread/resume',THREAD],['thread/resume',THREAD]]);
    assert.equal(moved.row(),moved.rollout);assert.ok(events.some(e=>e.kind==='status'&&/记录位置/.test(e.text)));assert.ok(!events.some(e=>e.data?.restoration));
  }finally{rmSync(moved.root,{recursive:true,force:true});}
});

test('Codex rebuilds a room from HiveLab records but never swaps context silently on a desk',async()=>{
  const gone=movedCodexHome({rollout:false}),adapter=new CodexAdapter() as any,events:any[]=[];adapter.rpc={request:async()=>{throw missing;}};
  try{
    assert.equal(await adapter.resumeThread(roomContext(events),gone.env,THREAD,{threadId:THREAD}),undefined);
    assert.equal(events[0].data.restoration,'rebuilt');assert.equal(events[0].fidelity,'lossy');
    await assert.rejects(adapter.resumeThread(roomContext([],{}),gone.env,THREAD,{threadId:THREAD}),/任务尚未发送/);
    await assert.rejects(adapter.resumeThread({...roomContext([]),run:{flowOperationId:'flow'}},gone.env,THREAD,{threadId:THREAD}),/任务尚未发送/);
  }finally{rmSync(gone.root,{recursive:true,force:true});}
});

test('Codex resume leaves every other native failure untouched',async()=>{
  const adapter=new CodexAdapter() as any,original=new NativeResponseError('thread is busy',-32000);adapter.rpc={request:async()=>{throw original;}};
  await assert.rejects(adapter.resumeThread(roomContext([]),{},THREAD,{threadId:THREAD}),(error:unknown)=>error===original);
});

test('DSH reports a session that cannot reopen and only rebuilds it inside a room',async()=>{
  const adapter=new DshAdapter() as any,events:any[]=[];adapter.rpc={request:async()=>{throw new NativeResponseError('Invalid params: session cwd does not match: D:\\moved',-32602);}};
  assert.equal(await adapter.resumeSession(roomContext(events),'native'),false);
  assert.equal(events[0].data.restoration,'rebuilt');assert.match(events[0].text,/session cwd does not match/);
  await assert.rejects(adapter.resumeSession(roomContext([],{}),'native'),/任务尚未发送.*session cwd does not match/);
  adapter.stopped=true;await assert.rejects(adapter.resumeSession(roomContext([]),'native'),/Invalid params/);adapter.stopped=false;
  const broken={...roomContext([]),env:{HIVELAB_CONTROL_HELPER:'D:/app/helper.mjs',HIVELAB_CONTROL_NODE:'D:/app/HiveLab.exe'}};
  await assert.rejects(adapter.resumeSession(broken,'native'),/临时授权/);
});

test('a resumed native history is reminded of the persona unless it acknowledged this exact one recently',()=>{
  const fresh={turnsSinceRefresh:1,inputCharsSinceRefresh:10};
  const session=(hash:string,state:any=fresh)=>({nativeId:THREAD,nativePersona:{nativeId:THREAD,hash},nativeContext:{nativeId:THREAD,...state}}) as any;
  assert.equal(personaRemembered(session(personaHash('新人设')),THREAD,personaHash('新人设')),true);
  assert.equal(personaRemembered(session(personaHash('旧人设')),THREAD,personaHash('新人设')),false);
  assert.equal(personaRemembered(session(personaHash('新人设')),'other-thread',personaHash('新人设')),false);
  assert.equal(personaRemembered(session(personaHash('新人设'),{turnsSinceRefresh:4,inputCharsSinceRefresh:0}),THREAD,personaHash('新人设')),false);
  // Records saved before the hash was versioned never count as delivered.
  assert.notEqual(personaHash('新人设'),createHash('sha256').update('新人设').digest('hex'));
});

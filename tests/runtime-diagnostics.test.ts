import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {captureRunDiagnosticContext,runtimeDiagnostics} from '../src/backend/runtime-diagnostics';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';
import type {RuntimeDiagnostics} from '../src/shared/runtime-diagnostics';
import type {AdapterContext,Run,Session,TimelineEvent} from '../src/shared/types';
import {Engine} from '../src/backend/engine';
import {RENDERER_METHODS} from '../src/shared/rpc-methods';
import {refreshAfterRpc} from '../src/shared/rpc-refresh';

const row=(report:RuntimeDiagnostics,id:string)=>report.sections.flatMap(s=>s.items).find(i=>i.id===id)!;
const at='2026-10-23T01:00:00.000Z';
const run=():Run=>({id:'run',sessionId:'session',projectId:'project',provider:'codex',status:'ended',delivery:'confirmed',revision:1,
  input:'task',bootId:'test',createdAt:at,updatedAt:'2026-10-23T01:05:00.000Z',completedAt:'2026-10-23T01:05:00.000Z'});
const event=(id:string,kind:TimelineEvent['kind'],text:string,data?:unknown):TimelineEvent=>({id,kind,text,data,runId:'run',sessionId:'session',provider:'codex',at:'2026-10-23T01:01:00.000Z',fidelity:'native'});
function fixture(home:string,nativeId='native-one'){
  mkdirSync(home,{recursive:true});writeFileSync(path.join(home,'config.toml'),'[plugins."stop-that-shit@stop-that-shit"]\nenabled = true\n\n[features]\ncodex_hooks = true\n');
  const key=createHash('sha256').update(nativeId).digest('hex').slice(0,24),root=path.join(home,'plugins/data/stop-that-shit-stop-that-shit');
  mkdirSync(path.join(root,'sessions'),{recursive:true});mkdirSync(path.join(root,'runtime'),{recursive:true});
  const file=path.join(root,'sessions',key+'.json');writeFileSync(file,JSON.stringify({schemaVersion:4,contract:{mode:'review',level:'guard',source:'directive'}}));
  const audit=path.join(root,'runtime',key+'.jsonl');
  writeFileSync(audit,JSON.stringify({schemaVersion:1,eventId:'evt_one',sessionKey:key,occurredAt:'2026-10-23T01:02:00.000Z',controlState:'armed',decision:{policyOutcome:'deny',reasonCode:'READ_ONLY_MODE',responseOutcome:'deny',hostEffect:'unobserved'}})+'\n');
  return {file,audit,key};
}

test('message skills, configured permissions and the exact native session contract remain independent; querying is read-only',()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'runtime-diagnostics-'));
  try{
    const files=fixture(root),before=[readFileSync(files.file,'utf8'),readFileSync(files.audit,'utf8')],value=run();
    value.diagnosticContext={capturedAt:at,cwd:'D:/project',home:root,nativeId:'native-one',permissions:{mode:'full',commands:'auto',fileScope:'any',network:true},writeMode:true,autoApprove:true};
    const report=runtimeDiagnostics({provider:'codex',run:value,settings:DEFAULT_SETTINGS,events:[]});
    assert.equal(report.sections.length,7);assert.equal(row(report,'skills').value,'未选择');
    assert.equal(row(report,'plugin').value,'已启用');assert.equal(row(report,'plugin').state,'configured');
    assert.equal(row(report,'contract').value,'review / guard');assert.equal(row(report,'contract').state,'configured');
    assert.match(row(report,'permissions').value,/完全访问/);assert.equal(row(report,'permissions').state,'configured');
    assert.equal(row(report,'hook-refusal').value,'READ_ONLY_MODE');assert.equal(row(report,'hook-refusal').eventId,'evt_one');
    assert.match(row(report,'hook-refusal').reason,/未观测/);assert.equal(row(report,'hook-trust').state,'unknown');
    assert.ok(report.sections.every(section=>section.items.every(entry=>entry.source&&entry.reason&&entry.state)));
    assert.deepEqual([readFileSync(files.file,'utf8'),readFileSync(files.audit,'utf8')],before);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('historical runs never borrow current native identity, home, working directory or updated permissions',()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'runtime-history-'));
  try{
    fixture(root,'later-native');
    const report=runtimeDiagnostics({provider:'codex',run:run(),session:{id:'session',nativeId:'later-native',workspace:'D:/later'} as Session,
      home:root,settings:DEFAULT_SETTINGS,events:[{...event('foreign','session','another session',{nativeId:'later-native'}),sessionId:'another'}]});
    for(const id of ['native','cwd','home','permissions','contract'])assert.equal(row(report,id)?.state??'unknown','unknown',id);
    assert.equal(report.nativeId,undefined);assert.doesNotMatch(JSON.stringify(report),/later-native|D:\/later/);
    const report2=runtimeDiagnostics({provider:'codex',run:run(),settings:DEFAULT_SETTINGS,events:[event('own','session','connected',{nativeId:'historical-native'})]});
    assert.equal(report2.nativeId,'historical-native');assert.equal(row(report2,'native').eventId,'own');
    const report3=runtimeDiagnostics({provider:'codex',run:{...run(),executorIdentity:{adapterVersion:'test',protocol:'test'}},info:{path:'later-program',version:'later-version'} as any,settings:DEFAULT_SETTINGS,events:[]});
    assert.equal(row(report3,'program').state,'unknown');assert.equal(row(report3,'version').state,'unknown');assert.doesNotMatch(JSON.stringify(report3),/later-program|later-version/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('missing, damaged, unfamiliar or locked contracts stay unknown; another run audit cannot supply a refusal',()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'runtime-unknown-'));
  try{
    const files=fixture(root),value=run();value.diagnosticContext={capturedAt:at,cwd:root,home:root,nativeId:'native-one',writeMode:true,autoApprove:true};
    const query=()=>runtimeDiagnostics({provider:'codex',run:value,settings:DEFAULT_SETTINGS,events:[]});
    for(const content of ['broken json',JSON.stringify({schemaVersion:5,contract:{mode:'change',level:'guard'}}),JSON.stringify({schemaVersion:4,contract:{mode:'invented',level:'guard'}})]){
      writeFileSync(files.file,content);assert.equal(row(query(),'contract').state,'unknown');assert.equal(readFileSync(files.file,'utf8'),content);
    }
    fixture(root);mkdirSync(files.file+'.lock');assert.equal(row(query(),'contract').state,'unknown');rmSync(files.file+'.lock',{recursive:true});
    writeFileSync(files.audit,JSON.stringify({schemaVersion:1,sessionKey:'different-native',occurredAt:'2026-10-23T01:02:00.000Z',decision:{policyOutcome:'deny',reasonCode:'FOREIGN'}})+'\n'+JSON.stringify({schemaVersion:1,sessionKey:files.key,occurredAt:'2026-10-23T02:00:00.000Z',decision:{policyOutcome:'deny',reasonCode:'LATER'}})+'\n');
    assert.equal(row(query(),'hook-refusal'),undefined);assert.equal(row(query(),'hook-event').state,'unknown');
    rmSync(files.file);assert.equal(row(query(),'contract').state,'unknown');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('current configuration, stale connection checks and original run errors preserve provenance and redact credentials',()=>{
  const value=run(),info={id:'codex',name:'Codex',available:true,stale:true,auth:'subscription',checkedAt:at,detail:'old probe'} as any;
  const report=runtimeDiagnostics({provider:'codex',run:value,info,settings:DEFAULT_SETTINGS,events:[event('error','error','Authorization: Bearer example-secret-value'),{...event('foreign','error','FOREIGN'),runId:'other'}]});
  assert.equal(row(report,'connection').state,'stale');assert.equal(row(report,'account').state,'stale');
  assert.equal(row(report,'blocker').eventId,'error');assert.equal(row(report,'blocker').observedAt,'2026-10-23T01:01:00.000Z');
  assert.doesNotMatch(JSON.stringify(report),/example-secret-value|FOREIGN/);
  assert.equal(row(runtimeDiagnostics({provider:'claude',settings:DEFAULT_SETTINGS,events:[]}),'contract').state,'unknown');
});

test('dispatch context freezes effective member settings and never records credentials',()=>{
  const permissions={mode:'request',commands:'ask',fileScope:'workspace',network:false} as const;
  const ctx={run:run(),session:{writeMode:false,autoApprove:false},cwd:'D:/actual-copy',settings:{...DEFAULT_SETTINGS,permissions:{...DEFAULT_SETTINGS.permissions,codex:{...permissions}}},env:{HIVELAB_CODEX_HOME:'D:/isolated-codex',API_KEY:'private-key'}} as unknown as AdapterContext;
  const saved=captureRunDiagnosticContext(ctx);ctx.settings.permissions.codex.network=true;
  assert.equal(saved.cwd,'D:/actual-copy');assert.equal(saved.permissions!.network,false);assert.equal(saved.nativeId,undefined);assert.ok(saved.home);assert.doesNotMatch(JSON.stringify(saved),/private-key|API_KEY/);
  const api=captureRunDiagnosticContext({...ctx,run:{...ctx.run,provider:'deepseek'},env:{HIVELAB_ACP_HOME:'D:/unrelated-acp'}});
  assert.equal(api.home,undefined,'an API executor must not inherit an unrelated native home');assert.equal(api.permissions,undefined);
});

test('diagnostic RPCs are whitelisted reads; unknown targets fail without starting an executor or changing records',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'runtime-rpc-'));let starts=0;
  const engine=new Engine(root,()=>{},()=>{},()=>{starts++;throw Error('must not start executor');},{maintenanceOnly:true});
  try{
    for(const method of ['run.diagnostics','provider.diagnostics']){assert.ok(RENDERER_METHODS.includes(method));assert.equal(refreshAfterRpc(method),false);}
    engine.store.put('runs','run',run());engine.store.appendEvent(event('e','error','Actual run failure'));
    engine.store.appendEvent(event('model-body','message','model content must stay out of diagnostic reads'));
    engine.store.appendEvent(event('native','session','identity',{nativeId:'from-run-event'}));
    assert.deepEqual(engine.store.runDiagnosticEvents('run').map(e=>e.id),['e','native']);
    const before=JSON.stringify(engine.store.get('runs','run'));
    const report=await engine.invoke('run.diagnostics',{runId:'run'}) as RuntimeDiagnostics;assert.equal(row(report,'blocker').value,'Actual run failure');
    await engine.invoke('provider.diagnostics',{provider:'codex'});
    await assert.rejects(engine.invoke('run.diagnostics',{runId:'missing'}));await assert.rejects(engine.invoke('provider.diagnostics',{provider:'missing'}));
    assert.equal(starts,0);assert.equal(JSON.stringify(engine.store.get('runs','run')),before);assert.equal(engine.store.runEvents('run').length,3);
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('real Engine dispatch captures native identity on the run even after the session changes',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'runtime-dispatch-'));
  const engine=new Engine(root,()=>{},()=>{},id=>({async probe(){return {id,name:id,available:true,auth:'subscription',detail:'mock',capabilities:{steer:true,cancel:'native',streaming:true,write:true,history:true}};},async start(ctx){ctx.persistNativeSession('native-dispatched','hivelab');ctx.markDelivery('confirmed');ctx.emit('message','done',{source:'assistant'});return {};},async stop(){}}),{maintenanceOnly:true});
  try{
    engine.store.put('members','person',{id:'person',executor:'codex',name:'Person',color:'#339966',motto:''});await engine.probe('codex');await engine.invoke('desk.open',{memberId:'person'});await engine.invoke('desk.topic',{memberId:'person'});
    const sent=await engine.invoke('room.send',{roomId:'desk:person',text:'test context'}) as {runId:string};
    for(let i=0;i<300&&!engine.store.get<Run>('runs',sent.runId)?.completedAt;i++)await new Promise(resolve=>setTimeout(resolve,12));
    const saved=engine.store.get<Run>('runs',sent.runId)!;assert.ok(saved.completedAt);assert.equal(saved.diagnosticContext?.nativeId,'native-dispatched');assert.ok(saved.diagnosticContext?.cwd);
    const session=engine.store.get<Session>('sessions',saved.sessionId)!;engine.store.put('sessions',session.id,{...session,nativeId:'later-native'});
    const report=await engine.invoke('run.diagnostics',{runId:saved.id}) as RuntimeDiagnostics;assert.equal(report.nativeId,'native-dispatched');
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

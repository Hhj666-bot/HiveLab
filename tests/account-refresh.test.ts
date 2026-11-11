import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import path from 'node:path';
import {Engine} from '../src/backend/engine';
import {accountRefreshTargets} from '../src/shared/quota';
import {formatTokenCount} from '../src/shared/token-activity';

test('account refresh targets deduplicate shared programs and select supported API wallets and Google quotas',()=>{
 const members=['codex','codex','dsh','acp-kimi','acp-glm','acp-google','acp-other','claude'].map(executor=>({executor})) as any;
 const executors=[{id:'acp-kimi',catalogId:'kimi',authentication:'kimi-api-cn',args:[]},{id:'acp-glm',catalogId:'zcode',authentication:'glm-api-cn',args:[]},{id:'acp-google',args:['D:/test/launch-official-acp.cjs']},{id:'acp-other',args:[]}] as any;
 const targets=accountRefreshTargets(members,executors,true);assert.equal(targets.length,5);assert.equal(targets.filter(t=>t.provider==='codex').length,1);assert.equal(targets.filter(t=>t.method==='provider.balance').length,3);assert(!targets.some(t=>t.provider==='claude'||t.provider==='acp-other'));
});
test('backend refresh continues without a UI, shares slow queries, recovers after one provider failure and stops on close',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'account-refresh-')),calls={dsh:0,codex:0,claude:0};let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
 const engine=new Engine(root,()=>{},()=>{},id=>({
  async probe(){return {id,name:id,available:id!=='claude',auth:id==='claude'?'none':id==='codex'?'subscription':'account',detail:'mock',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true}};},
  async accountBalance(){calls.dsh++;if(calls.dsh===1)await held;return {status:'ready',wallets:[{currency:'CNY',balance:'12.34'}],bonusWallets:[],checkedAt:new Date().toISOString()};},
  async accountQuota(){if(id==='claude'){calls.claude++;throw Error('Signed-out providers must not be queried');}calls.codex++;if(calls.codex===1)throw Error('Temporary connection failure');return {payload:{accountRateLimits:{rateLimits:{primary:{usedPercent:20,windowDurationMins:300}}}},checkedAt:new Date().toISOString()};},
  async start(){throw Error('No model work may run');},async stop(){}
 } as any),{maintenanceOnly:true});
 const until=async(read:()=>boolean)=>{for(let i=0;i<100;i++){if(read())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Background account refresh did not settle');};
 try{
  for(const [id,executor] of [['sol','codex'],['astra','codex'],['ds','dsh'],['ds2','dsh'],['claude','claude']])engine.store.put('members',id,{id,name:id,executor,color:'#558877',motto:''});
  await Promise.all(['codex','dsh','claude'].map(id=>engine.probe(id as any)));engine.startAccountRefresh(25);engine.startAccountRefresh(25);
  await until(()=>calls.codex>=3);assert.equal(calls.dsh,1,'Slow shared DSH query must not overlap');assert.equal(calls.claude,0);release();
  await until(()=>engine.snapshot().quotas?.dsh?.balance?.status==='ready');assert.equal(engine.snapshot().quotas?.codex?.windows[0]?.usedPercent,20);await until(()=>calls.dsh>=2);
  await engine.close();const before={...calls};await new Promise(resolve=>setTimeout(resolve,80));assert.deepEqual(calls,before);
 }finally{release();await engine.close();}
});
test('Token values use readable decimal K/M/B/T units without losing an exact underlying value',()=>{
 for(const [input,expected] of [[null,'—'],[0,'0'],[999,'999'],[1000,'1K'],[1234,'1.23K'],[12345,'12.3K'],[123456,'123K'],[999950,'1M'],[1000000,'1M'],[1234567890,'1.23B'],[1000000000000,'1T']] as const)assert.equal(formatTokenCount(input),expected);
});

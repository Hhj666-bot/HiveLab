import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseGlmBalance,readGlmBalance} from '../src/backend/adapters/glm-balance';
import {quotaReport,balanceExhausted} from '../src/shared/quota';
import {DEFAULT_SETTINGS,ACP_DEFAULT_PERMISSIONS} from '../src/shared/defaults';
import type {AcpExecutor} from '../src/shared/types';
const executor:AcpExecutor={id:'acp-catalogzcode',catalogId:'zcode',name:'GLM',command:'zcode',args:[],authentication:'glm-api-cn',env:{GLM_API_KEY:'offline-placeholder-key'},permissions:ACP_DEFAULT_PERMISSIONS,createdAt:new Date(0).toISOString()};
const settings={...DEFAULT_SETTINGS,networkMode:'tun' as const};

test('GLM available/frozen are preserved without adding cumulative gifts or top-ups',()=>{
 for(const balance of ['20.123456','0','-0.01']){
  const parsed=parseGlmBalance({code:200,success:true,data:{availableBalance:balance,frozenBalance:'3.25',giveAmount:999,rechargeAmount:888,totalSpendAmount:100,balance:50}},'cn');
  assert.equal(parsed.status,'ready');assert.equal(parsed.available?.balance,balance);assert.deepEqual(parsed.wallets,[]);assert.deepEqual(parsed.bonusWallets,[]);assert.equal(parsed.frozen?.balance,'3.25');
  const projection=quotaReport(executor.id,{accountBalance:parsed},parsed.checkedAt,'probe')!.balance!;
  assert.equal(projection.kind,'glm-api');assert.equal(projection.available?.balance,balance);assert.equal(projection.frozen?.balance,'3.25');assert.equal(balanceExhausted(projection),Number(balance)<=0);
 }
 for(const value of [{code:200,success:true,data:{balance:999}},{code:1001,success:false,data:{availableBalance:0}},{code:200,success:true,data:{availableBalance:null}},{code:200,success:true,data:{availableBalance:'NaN'}}])assert.equal(parseGlmBalance(value,'cn').status,'unavailable');
 const failure=quotaReport(executor.id,{accountBalance:{status:'unavailable',kind:'glm-api',reason:'offline'}},new Date().toISOString(),'probe')!.balance!;assert.equal(failure.status,'unavailable');assert.equal(failure.available,undefined);assert.equal(failure.kind,'glm-api');
});

test('GLM metadata uses the correct official host/authentication and never retries or calls a model',async()=>{
 for(const global of [false,true]){let calls=0;const request=async(url:string,options:any)=>{calls++;assert.equal(url,global?'https://api.z.ai/api/paas/v4/balance':'https://open.bigmodel.cn/api/biz/account/query-customer-account-report');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,(global?'Bearer ':'')+executor.env.GLM_API_KEY);return new Response(JSON.stringify(global?{code:200,data:{balance:'1.25',currency:'USD'}}:{code:200,success:true,data:{availableBalance:'0'}}));};const result=await readGlmBalance({...executor,authentication:global?'glm-api-global':'glm-api-cn'},settings,request as any);assert.equal(calls,1);assert.equal(result.status,'ready');assert.equal(result.available?.currency,global?'USD':'CNY');}
});

test('GLM unauthorized, rate limits, invalid data and network errors stay unavailable',async()=>{
 for(const response of [()=>new Response('',{status:401}),()=>new Response('',{status:404}),()=>new Response('',{status:429}),()=>new Response(JSON.stringify({code:1003,success:false,msg:'raw account info'})),()=>new Response('invalid'),()=>{throw Error('network private detail');}]){let calls=0;const r=await readGlmBalance(executor,settings,(async()=>{calls++;return response();}) as any);assert.equal(calls,1);assert.equal(r.status,'unavailable');assert.equal(r.available,undefined);assert.ok(!JSON.stringify(r).includes('raw account info'));assert.ok(!JSON.stringify(r).includes(executor.env.GLM_API_KEY));}
 let calls=0;const native=await readGlmBalance({...executor,authentication:'bigmodel'},settings,(async()=>{calls++;throw Error('unexpected');}) as any);assert.equal(native.status,'unavailable');assert.equal(calls,0);
 assert.equal(parseGlmBalance({code:200,data:{balance:'1'}},'global').status,'unavailable');
});

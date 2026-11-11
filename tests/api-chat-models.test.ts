import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {AcpAdapter} from '../src/backend/adapters/acp';
import {GlmApiAdapter} from '../src/backend/adapters/glm-api';
import {isKimiApi,kimiApiModel,readKimiApiModels,KIMI_ENV_MODEL} from '../src/backend/adapters/kimi-api-models';
import {ACP_DEFAULT_PERMISSIONS,DEFAULT_SETTINGS} from '../src/shared/defaults';
import type {AcpExecutor} from '../src/shared/types';
const executor:AcpExecutor={id:'acp-kimiapitest',name:'Kimi API',catalogId:'kimi',authentication:'kimi-api-cn',command:path.resolve('tests/fixtures/kimi-api-model-acp.mjs'),args:[],env:{KIMI_MODEL_API_KEY:'mock-not-a-real-key',KIMI_MODEL_BASE_URL:'https://api.moonshot.cn/v1',KIMI_MODEL_PROVIDER_TYPE:'kimi'},permissions:ACP_DEFAULT_PERMISSIONS,createdAt:new Date(0).toISOString()};

test('Kimi API model metadata uses the selected service, real API IDs and GET only, without a required default',async()=>{
 for(const [authentication,base] of Object.entries({'kimi-api-cn':'https://api.moonshot.cn/v1','kimi-api':'https://api.moonshot.ai/v1','kimi-code-key':'https://api.kimi.com/coding/v1','kimi-code-key-global':'https://api.kimi.ai/coding/v1'})){
  let count=0;const value={...executor,authentication};
  const catalog=await readKimiApiModels(value,DEFAULT_SETTINGS,(async(url:string,options:any)=>{count++;assert.equal(url,base+'/models');assert.equal(options.method,'GET');assert.equal(options.body,undefined);return new Response(JSON.stringify({data:[{id:'kimi-a'},{id:'kimi-b'},{id:'kimi-a'},{id:'invalid model'},{}]}));}) as any);
  assert.deepEqual(catalog.models.map(model=>model.id),['kimi-a','kimi-b']);assert.equal(catalog.reported,true);assert.equal(count,1);assert.equal(kimiApiModel(value,undefined,catalog.models),'kimi-a');assert.ok(isKimiApi(value));
 }
 const unauthorized=await readKimiApiModels(executor,DEFAULT_SETTINGS,(async()=>new Response('',{status:401})) as any);assert.equal(unauthorized.unauthorized,true);assert.equal(unauthorized.reported,false);
 const missing=await readKimiApiModels({...executor,env:{}},DEFAULT_SETTINGS,(async()=>{throw Error('No request is allowed without a key');}) as any);assert.equal(missing.reported,false);assert.equal(missing.models[0].id,'kimi-k3');
 assert.equal(kimiApiModel({...executor,env:{KIMI_MODEL_NAME:'legacy-real-model'}},KIMI_ENV_MODEL),'legacy-real-model');
 assert.equal(kimiApiModel({...executor,env:{KIMI_MODEL_NAME:KIMI_ENV_MODEL},model:KIMI_ENV_MODEL},KIMI_ENV_MODEL),'kimi-k3');
});

test('Kimi conversation choices override the connection default on consecutive native sessions without exposing its internal alias',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'kimi-model-selection-'));
 try{
  const log=path.join(root,'models.jsonl'),native=new AcpAdapter({...executor,env:{...executor.env,KIMI_MODEL_NAME:'old-connection-default'}});
  const session:any={id:'conversation',memberId:'m-kimi',provider:executor.id,writeMode:false};const reports:any[]=[];
  for(const [index,model] of ['kimi-first','kimi-second'].entries()){
   const context:any={cwd:root,env:{...process.env,HIVELAB_MODEL_TEST_LOG:log},settings:{...DEFAULT_SETTINGS,models:{[executor.id]:model},permissions:{...DEFAULT_SETTINGS.permissions,[executor.id]:ACP_DEFAULT_PERMISSIONS}},session,run:{id:'run-'+index,provider:executor.id,requestedConfig:{model,modelSource:'session',effortSource:'default',capturedAt:new Date().toISOString()}},persona:'Offline fixture',emit:()=>{},markDelivery:()=>{},recordConfig:(value:any)=>reports.push(value),persistNativeSession:(id:string)=>{session.nativeId=id;},registerProcess:()=>{},approve:async()=>({choice:'deny'})};
   await native.start(context,'offline test');
  }
  const selected=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(selected.map(row=>row.model),['kimi-first','kimi-second']);assert.equal(selected[0].sessionId,selected[1].sessionId);
  assert.ok(reports.some(report=>report.model==='kimi-first'));assert.ok(reports.some(report=>report.model==='kimi-second'));assert.ok(!JSON.stringify(reports).includes(KIMI_ENV_MODEL));assert.ok(!JSON.stringify(reports).includes('mock-not-a-real-key'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('GLM saves a key without a default and sends each conversation model rather than locking to the connection model',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'glm-model-selection-'));
 try{
  const sent:string[]=[];const adapter=new GlmApiAdapter({...executor,id:'acp-glmapitest',catalogId:'zcode',authentication:'glm-api-cn',env:{GLM_API_KEY:'mock-not-a-real-key'}},root,(async(_url:string,options:any)=>{sent.push(JSON.parse(options.body).model);return new Response('data: '+JSON.stringify({choices:[{delta:{content:'ok'}}]})+'\n\ndata: [DONE]\n\n');}) as any);
  for(const model of ['glm-5.3','glm-5v-turbo']){const context:any={cwd:root,settings:{...DEFAULT_SETTINGS,models:{'acp-glmapitest':model}},session:{id:'same-topic',writeMode:false},run:{id:'run-'+model},emit:()=>{},markDelivery:()=>{},recordConfig:()=>{},approve:async()=>({choice:'deny'})};await adapter.start(context,'offline test');}
  assert.deepEqual(sent,['glm-5.3','glm-5v-turbo']);
 }finally{rmSync(root,{recursive:true,force:true});}
});

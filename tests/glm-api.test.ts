import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {GlmApiAdapter,isGlmApi} from '../src/backend/adapters/glm-api';
import {DeepseekAdapter} from '../src/backend/adapters/deepseek';
import {catalogAuthentication} from '../src/backend/executor-catalog';
import {DEFAULT_SETTINGS,ACP_DEFAULT_PERMISSIONS} from '../src/shared/defaults';
import type {AcpExecutor} from '../src/shared/types';

const executor:AcpExecutor={id:'acp-catalogzcode',name:'ZCode CLI',catalogId:'zcode',authentication:'bigmodel',command:'zcode',args:[],env:{},permissions:ACP_DEFAULT_PERMISSIONS,createdAt:new Date(0).toISOString()};
const key='mock-glm-key-not-a-real-credential';
const api=(authentication='glm-api-cn')=>({...executor,authentication,env:{GLM_API_KEY:key,GLM_MODEL:'glm-5.3',GLM_BASE_URL:'https://invalid.example/ignored'}});
const settings={...DEFAULT_SETTINGS,networkMode:'tun' as const};
const stream=(packets:unknown[],done=true)=>new Response(packets.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+(done?'data: [DONE]\n\n':''));
function context(root:string){const events:any[]=[],configs:any[]=[];return {events,configs,ctx:{settings,cwd:root,session:{id:'mock-session',writeMode:false},run:{id:'mock-run'},persona:'你是小狐，叫用户老大。',emit:(kind:string,text:string,data?:unknown)=>events.push({kind,text,data}),recordConfig:(x:unknown)=>configs.push(x),markDelivery:()=>{},registerProcess:()=>{},approve:async()=>({choice:'answer'})} as any};}

test('GLM API modes keep keys out of executor data and preserve native account login',()=>{
 for(const authentication of ['glm-api-cn','glm-api-global']){
  const result=catalogAuthentication(executor,{authentication,model:'glm-5.3',secrets:{GLM_API_KEY:key}});
  assert.equal(result.executor.env.GLM_MODEL,'glm-5.3');assert.equal(result.executor.model,'glm-5.3');
  assert.equal(result.executor.env.GLM_BASE_URL,authentication==='glm-api-cn'?'https://open.bigmodel.cn/api/paas/v4':'https://api.z.ai/api/paas/v4');
  assert.equal(result.secrets.GLM_API_KEY,key);assert.ok(!JSON.stringify(result.executor).includes(key));assert.ok(isGlmApi(result.executor));
 }
 assert.ok(!isGlmApi(executor));
 const native=catalogAuthentication(api(),{authentication:'bigmodel'});assert.equal(native.executor.env.GLM_API_KEY,undefined);assert.equal(native.executor.env.GLM_BASE_URL,undefined);assert.equal(native.executor.env.GLM_MODEL,undefined);
 const withoutModel=catalogAuthentication(executor,{authentication:'glm-api-cn',model:'',secrets:{GLM_API_KEY:key}});assert.equal(withoutModel.executor.model,undefined);assert.equal(withoutModel.executor.env.GLM_MODEL,undefined);assert.equal(withoutModel.secrets.GLM_API_KEY,key);
 assert.throws(()=>catalogAuthentication(executor,{authentication:'glm-api-cn',model:'GLM 5.3',secrets:{GLM_API_KEY:key}}),/模型/);
});

test('GLM probes read only balance metadata and do not claim model permissions',async()=>{
 let requests=0;const fetcher=async(url:string)=>{requests++;assert.equal(url,'https://open.bigmodel.cn/api/biz/account/query-customer-account-report');return new Response(JSON.stringify({code:200,success:true,data:{availableBalance:'20',frozenBalance:'0'}}));};
 const configured=await new GlmApiAdapter(api(),'.',fetcher as any).probe(settings);
 assert.equal(configured.id,executor.id);assert.equal(configured.auth,'api');assert.equal(configured.available,true);assert.equal(configured.capabilities.images,true);assert.equal(configured.modelOptions?.length,3);assert.match(configured.detail,/未发送模型请求/);assert.equal(requests,1);assert.equal((configured.quota as any).accountBalance.available.balance,'20');
 const empty=await new GlmApiAdapter({...api(),env:{}},'.',fetcher as any).probe(settings);assert.equal(empty.available,false);assert.equal(empty.auth,'none');
});

test('GLM streams, injects the current persona, resumes history and never sends DeepSeek credentials',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'glm-api-'));
 try{const requests:any[]=[],{ctx,events,configs}=context(root);
  const fetcher=async(url:string,options:any)=>{requests.push({url,body:JSON.parse(options.body),headers:options.headers});return stream([{model:'glm-5.3',choices:[{delta:{content:'老大，'}}]},{model:'glm-5.3',choices:[{delta:{content:'我理清楚了。'}}],usage:{prompt_tokens:12,completion_tokens:5}}]);};
  const adapter=new GlmApiAdapter(api(),root,fetcher as any);ctx.deepseekKey='a-different-provider-key';ctx.conversation='room';
  await adapter.start(ctx,'帮我整理');ctx.persona='你是更新后的小狐。';await adapter.start(ctx,'接着说');
  assert.equal(requests.length,2);assert.equal(requests[0].url,'https://open.bigmodel.cn/api/paas/v4/chat/completions');assert.equal(requests[0].headers.Authorization,'Bearer '+key);assert.equal(requests[0].body.model,'glm-5.3');assert.equal(requests[0].body.tools,undefined);
  assert.match(requests[0].body.messages[0].content,/小狐/);assert.ok(!requests[0].body.messages[0].content.includes('DeepSeek 成员'));assert.match(requests[1].body.messages[0].content,/更新后/);assert.equal(requests[1].body.messages.filter((m:any)=>m.role==='user').length,2);
  assert.equal(events.filter(e=>e.kind==='delta').map(e=>e.text).join(''),'老大，我理清楚了。老大，我理清楚了。');assert.equal(configs.filter(c=>c.source==='glm-api.response').length,2);
  const history=readFileSync(path.join(root,'glm-api-history',executor.id,'glm-api-cn','mock-session.json'),'utf8');assert.ok(!history.includes(key));assert.ok(!history.includes('a-different-provider-key'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('GLM routes shared file tools and carries reasoning into the following tool response',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'glm-tools-'));
 try{let requests=0,calls=0;const {ctx}=context(root);ctx.operationTools=()=>[{name:'read_file',description:'read',inputSchema:{type:'object'}}];ctx.callOperation=async(name:string,args:any)=>{calls++;assert.equal(name,'read_file');assert.equal(args.path,'notes.md');return {content:'a note'};};
 const fetcher=async(_url:string,options:any)=>{const body=JSON.parse(options.body);requests++;if(requests===1)return stream([{choices:[{delta:{reasoning_content:'核对材料',tool_calls:[{index:0,id:'call-1',function:{name:'read_file',arguments:'{"path":"notes.md"}'}}]}}]}]);assert.equal(body.messages.at(-1).role,'tool');assert.equal(body.messages.at(-2).reasoning_content,'核对材料');return stream([{choices:[{delta:{content:'已核对。'}}]}]);};
 await new GlmApiAdapter(api('glm-api-global'),root,fetcher as any).start(ctx,'读一下');assert.equal(requests,2);assert.equal(calls,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('GLM 401 and incomplete streams fail once without retrying a model task',async()=>{
 for(const kind of ['401','incomplete']){const root=mkdtempSync(path.join(tmpdir(),'glm-fail-'));try{let calls=0;const {ctx}=context(root);const fetcher=async()=>{calls++;return kind==='401'?new Response('Unauthorized',{status:401}):stream([{choices:[{delta:{content:'partial'}}]}],false);};await assert.rejects(new GlmApiAdapter(api(),root,fetcher as any).start(ctx,'test'),kind==='401'?/401/:/结束标记/);assert.equal(calls,1);}finally{rmSync(root,{recursive:true,force:true});}}
});

test('DeepSeek existing API transport keeps its provider and endpoint',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'deepseek-api-'));try{const {ctx}=context(root);ctx.settings={...settings,models:{deepseek:'deepseek-chat'},deepseekBaseUrl:'https://api.deepseek.com'};let requested='';const fetcher=async(url:string)=>{requested=url;return stream([{choices:[{delta:{content:'ok'}}]}]);};await new DeepseekAdapter(()=>key,root,fetcher as any).start(ctx,'test');assert.equal(requested,'https://api.deepseek.com/chat/completions');}finally{rmSync(root,{recursive:true,force:true});}
});

test('GLM deep thinking follows the topic level: on, off, or the service default when unset',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'glm-thinking-'));
 try{
  const bodies:any[]=[];const fetcher=async(_url:string,options:any)=>{bodies.push(JSON.parse(options.body));return stream([{model:'glm-5.3',choices:[{delta:{content:'好'}}]}]);};
  const adapter=new GlmApiAdapter(api(),root,fetcher as any);
  const info=await new GlmApiAdapter(api(),root,(async()=>new Response('{}',{status:500})) as any).probe(settings).catch(()=>undefined);
  if(info){assert.deepEqual(info.modelOptions?.[0].efforts,['off','on']);assert.equal(info.configuration?.effort,'documented');}
  for(const [level,expected] of [['on',{type:'enabled'}],['off',{type:'disabled'}],[undefined,undefined]] as const){
   const {ctx,configs}=context(root);(ctx.run as any).requestedConfig={model:'glm-5.3',effort:level,modelSource:'session',effortSource:level?'session':'default',capturedAt:new Date().toISOString()};
   (ctx.session as any).id='thinking-'+String(level);await adapter.start(ctx,'问一下');
   assert.deepEqual(bodies.at(-1).thinking,expected);
   assert.equal(configs.find(c=>c.source==='glm-api.request')?.effortStatus,level?'accepted':'default');
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});

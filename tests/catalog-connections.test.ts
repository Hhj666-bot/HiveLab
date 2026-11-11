import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Engine} from '../src/backend/engine';
import {catalogCandidate,catalogStatuses,managedCatalogEnvironment} from '../src/backend/executor-catalog';
import {CATALOG_REVISION,catalogExecutor} from '../src/shared/executor-catalog';
import {ACP_DEFAULT_PERMISSIONS} from '../src/shared/defaults';
import type {AcpExecutor,MemberProfile,ProviderId,Session} from '../src/shared/types';

const subscription:AcpExecutor={id:'acp-catalogzcode',name:'智谱 Coding Plan',catalogId:'zcode',authentication:'bigmodel',command:'original-zcode.cjs',args:[],env:{},permissions:ACP_DEFAULT_PERMISSIONS,createdAt:new Date(0).toISOString()};
const factory=(id:ProviderId)=>({async probe(){return {id,name:id,available:true,runtimeReady:true,auth:'subscription',detail:'isolated mock',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true}};},async start(){throw Error('No model request is allowed');},async stop(){}} as any);
function setup(){const root=mkdtempSync(path.join(process.env.TEMP!,'catalog-connections-'));const engine=new Engine(root,()=>{},()=>{},factory,{maintenanceOnly:true},(async()=>({entry:'updated-zcode.cjs',version:'test-version'})) as any);engine.store.put('executors',subscription.id,subscription);return {root,engine};}

test('same catalog program can create distinct connections without copying keys, model or native login home',async()=>{
  const {root,engine}=setup();
  try{
    engine.store.put('executors',subscription.id,{...subscription,env:{GLM_MODEL:'old-model',GLM_API_KEY:'must-not-copy'},secretKeys:['GLM_API_KEY'],model:'old-model'});
    const before=engine.store.get('executors',subscription.id);
    const first=await engine.invoke('catalog.connection.create',{id:'zcode',sourceId:subscription.id,name:'智谱 API',authentication:'glm-api-cn'}) as AcpExecutor;
    const second=await engine.invoke('catalog.connection.create',{id:'zcode',sourceId:subscription.id,name:'智谱另一个订阅',authentication:'bigmodel'}) as AcpExecutor;
    assert.notEqual(first.id,subscription.id);assert.notEqual(first.id,second.id);
    assert.equal(first.catalogId,'zcode');assert.equal(first.authentication,'glm-api-cn');assert.equal(first.command,subscription.command);
    assert.deepEqual(first.secretKeys,[]);assert.equal(first.model,undefined);assert.equal(first.env.GLM_API_KEY,undefined);
    assert.deepEqual(second.env,{});assert.deepEqual(second.secretKeys,[]);
    for(const executor of [subscription,first,second]){
      const home=path.join(root,'native','acp',executor.id),env=managedCatalogEnvironment(executor,{},home);
      assert.equal(env.HOME,home);assert.equal(env.USERPROFILE,home);
    }
    assert.deepEqual(engine.store.get('executors',subscription.id),before);
    await assert.rejects(engine.invoke('catalog.connection.create',{id:'kimi',sourceId:subscription.id,name:'wrong catalog',authentication:'kimi-api-cn'}),/不属于/);
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('API save, clear and account switch affect only the selected connection and its native sessions',async()=>{
  const {root,engine}=setup();
  try{
    const api=await engine.invoke('catalog.connection.create',{id:'zcode',sourceId:subscription.id,name:'智谱 API',authentication:'glm-api-cn'}) as AcpExecutor;
    engine.store.put('members','m-subscription',{id:'m-subscription',name:'订阅成员',executor:subscription.id,color:'#778899',motto:''});
    engine.store.put('members','m-api',{id:'m-api',name:'API 成员',executor:api.id,color:'#778899',motto:''});
    engine.store.put('sessions','s-subscription',{id:'s-subscription',provider:subscription.id,memberId:'m-subscription',nativeId:'keep-native-subscription',nativeHome:'isolated'});
    engine.store.put('sessions','s-api',{id:'s-api',provider:api.id,memberId:'m-api',nativeId:'old-api-native',nativeHome:'isolated'});
    await engine.invoke('provider.config',{provider:subscription.id,model:'GLM-5.3',effort:'high'});
    const before=engine.store.get('executors',subscription.id),oldSettings=engine.snapshot().settings;
    await engine.invoke('catalog.credentials',{id:'zcode',executorId:api.id,authentication:'glm-api-cn',model:'glm-5.3-flash',secrets:{GLM_API_KEY:'mock-api-connection-key'}});
    assert.deepEqual(engine.store.get('executors',subscription.id),before);
    assert.equal(engine.snapshot().settings.models[subscription.id],oldSettings.models[subscription.id]);
    assert.equal(engine.snapshot().settings.efforts[subscription.id],oldSettings.efforts[subscription.id]);
    assert.equal(engine.snapshot().settings.models[api.id],'glm-5.3-flash');
    assert.equal(engine.store.get<Session>('sessions','s-subscription')?.nativeId,'keep-native-subscription');
    assert.equal(engine.store.get<MemberProfile>('members','m-api')?.executor,api.id);
    assert.ok(!JSON.stringify(engine.snapshot()).includes('mock-api-connection-key'));
    await engine.invoke('catalog.credentials',{id:'zcode',executorId:api.id,authentication:'glm-api-cn',model:'glm-5.3-flash',clear:true,secrets:{}});
    assert.deepEqual(engine.store.get<AcpExecutor>('executors',api.id)?.secretKeys,[]);
    await engine.invoke('catalog.credentials',{id:'zcode',executorId:api.id,authentication:'bigmodel',secrets:{}});
    assert.equal(engine.store.get<Session>('sessions','s-api')?.nativeId,undefined);
    assert.equal(engine.store.get<Session>('sessions','s-subscription')?.nativeId,'keep-native-subscription');
    await assert.rejects(engine.invoke('catalog.credentials',{id:'kimi',executorId:api.id,authentication:'kimi-api-cn',model:'k3',secrets:{}}),/不属于/);
    await assert.rejects(engine.invoke('catalog.credentials',{id:'zcode',executorId:'acp-missing123',authentication:'bigmodel'}),/不属于/);
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('version changes and catalog reads keep the chosen connection ID and leave sibling connections intact',async()=>{
  const {root,engine}=setup();
  try{
    const api=await engine.invoke('catalog.connection.create',{id:'zcode',sourceId:subscription.id,name:'智谱 API',authentication:'glm-api-cn'}) as AcpExecutor;
    const candidate=catalogCandidate('zcode','updated-zcode.cjs',api);assert.equal(candidate.id,api.id);assert.equal(candidate.authentication,api.authentication);
    await engine.invoke('catalog.install',{id:'zcode',executorId:api.id,version:'test-version',agree:true,revision:CATALOG_REVISION});
    assert.equal(engine.store.get<AcpExecutor>('executors',api.id)?.command,'updated-zcode.cjs');
    assert.deepEqual(engine.store.get('executors',subscription.id),subscription);
    const status=(await engine.invoke('catalog.list',{executorId:api.id}) as any).items.find((item:any)=>item.entry.id==='zcode');
    assert.equal(status.provider,api.id);assert.equal(status.selectedPath,'updated-zcode.cjs');
    assert.equal(catalogStatuses(engine.store,engine.snapshot().settings).find(item=>item.entry.id==='zcode')?.provider,subscription.id);
    assert.equal(catalogExecutor([api],'zcode')?.id,api.id,'last remaining connection is discoverable after the old default is removed');
    // Older callers without executorId continue to use the original connection.
    await engine.invoke('catalog.credentials',{id:'zcode',authentication:'bigmodel',secrets:{}});
    assert.equal(engine.store.get<AcpExecutor>('executors',api.id)?.authentication,'glm-api-cn');
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('confirmed connection deletion preserves cards and historical defaults, blocks old topics and allows later rebinding',async()=>{
  const {root,engine}=setup();
  try{
    const api=await engine.invoke('catalog.connection.create',{id:'zcode',sourceId:subscription.id,name:'智谱 API',authentication:'glm-api-cn'}) as AcpExecutor;
    const member:MemberProfile={id:'m-api',name:'API 成员',executor:api.id,color:'#778899',motto:'保留人设',persona:'保留角色资料'};
    engine.store.put('members',member.id,member);
    engine.store.put('projects','history-project',{id:'history-project',name:'历史项目',directory:root,memberIds:[member.id],createdAt:new Date().toISOString()});
    engine.store.put('sessions','history-topic',{id:'history-topic',projectId:'history-project',provider:api.id,memberId:member.id,title:'保留的旧话题',nativeId:'keep-native-history',writeMode:false});
    await engine.invoke('catalog.credentials',{id:'zcode',executorId:api.id,authentication:'glm-api-cn',model:'glm-5.3-flash',secrets:{GLM_API_KEY:'mock-deletion-key'}});
    engine.store.put('quotas',api.id,{provider:api.id,checkedAt:new Date().toISOString(),balance:{status:'ready'}});
    await assert.rejects(engine.invoke('executor.delete',{id:api.id}),/确认/);
    assert.ok(engine.store.get('executors',api.id));
    await engine.invoke('executor.delete',{id:api.id,detachMembers:true});
    assert.equal(engine.store.get('executors',api.id),undefined);
    assert.equal(engine.store.get('quotas',api.id),undefined);
    assert.deepEqual(engine.store.get('members',member.id),member);
    const history=engine.store.get<Session>('sessions','history-topic')!;
    assert.equal(history.provider,api.id);assert.equal(history.nativeId,'keep-native-history');assert.equal(history.model,'glm-5.3-flash');
    assert.equal(engine.snapshot().settings.models[api.id],undefined);
    assert.deepEqual(engine.store.get('executors',subscription.id),subscription);
    await assert.rejects(engine.invoke('provider.probe',{provider:api.id}),/连接已删除/);
    await assert.rejects(engine.invoke('session.send',{sessionId:history.id,text:'must never send'}),/连接已删除/);
    const edited=await engine.invoke('team.save',{member:{...member,motto:'未连接时也可保存人物资料'}}) as MemberProfile;
    assert.equal(edited.executor,api.id);assert.equal(edited.motto,'未连接时也可保存人物资料');
    await engine.invoke('team.save',{member:{...edited,executor:subscription.id}});
    assert.equal(engine.store.get<MemberProfile>('members',member.id)?.executor,subscription.id);
    assert.equal(engine.store.get<Session>('sessions',history.id)?.provider,api.id);
    await engine.close();
    const reopened=new Engine(root,()=>{},()=>{},factory,{maintenanceOnly:true});
    try{assert.equal(reopened.store.get('executors',api.id),undefined);assert.equal(reopened.store.get<MemberProfile>('members',member.id)?.executor,subscription.id);assert.equal(reopened.store.get<Session>('sessions',history.id)?.model,'glm-5.3-flash');}finally{await reopened.close();}
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('built-in connection deletion can detach existing members and restore without losing cards or history',async()=>{
  const {root,engine}=setup();
  try{
    const member:MemberProfile={id:'m-claude',name:'Claude 成员',executor:'claude',motto:'保留资料'};
    engine.store.put('projects','builtin-project',{id:'builtin-project',name:'历史工位',directory:root,createdAt:new Date().toISOString()});
    const history={id:'builtin-topic',projectId:'builtin-project',provider:'claude',memberId:member.id,nativeId:'keep-native',writeMode:false} as Session;
    engine.store.put('members',member.id,member);engine.store.put('sessions',history.id,history);
    await assert.rejects(engine.invoke('executor.delete',{id:'claude'}),/确认/);
    engine.store.put('project_flows','active-flow',{id:'active-flow',memberIds:[member.id],status:'running'});
    await assert.rejects(engine.invoke('executor.delete',{id:'claude',detachMembers:true}),/项目流程/);
    engine.store.delete('project_flows','active-flow');
    engine.store.put('runs','queued-builtin',{id:'queued-builtin',sessionId:history.id,provider:'claude',status:'queued'});
    await assert.rejects(engine.invoke('executor.delete',{id:'claude',detachMembers:true}),/删除|排队|运行|任务/);
    assert.equal(engine.store.get('removed_providers','claude'),undefined);
    engine.store.delete('runs','queued-builtin');
    await engine.invoke('executor.delete',{id:'claude',detachMembers:true});
    assert.ok(engine.snapshot().removedProviders?.includes('claude'));
    assert.deepEqual(engine.store.get('members',member.id),member);
    assert.equal(engine.store.get<Session>('sessions',history.id)?.nativeId,'keep-native');
    await assert.rejects(engine.invoke('session.send',{sessionId:history.id,text:'must never send'}),/连接已删除/);
    await assert.rejects(engine.invoke('provider.probe',{provider:'claude'}),/连接已删除/);
    const edited=await engine.invoke('team.save',{member:{...member,motto:'断开后可编辑'}}) as MemberProfile;
    assert.equal(edited.executor,'claude');assert.equal(edited.motto,'断开后可编辑');
    await engine.invoke('executor.restore',{id:'claude'});
    assert.ok(!engine.snapshot().removedProviders?.includes('claude'));
    assert.equal(engine.store.get<Session>('sessions',history.id)?.provider,'claude');
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('deletion rejects queued work and active project flows, while unused sibling connections can be removed directly',async()=>{
  const {root,engine}=setup();
  try{
    const api=await engine.invoke('catalog.connection.create',{id:'zcode',sourceId:subscription.id,name:'智谱 API',authentication:'glm-api-cn'}) as AcpExecutor;
    const member:MemberProfile={id:'m-api',name:'API 成员',executor:api.id};
    engine.store.put('members',member.id,member);
    engine.store.put('sessions','busy-topic',{id:'busy-topic',provider:api.id,memberId:member.id});
    engine.store.put('runs','queued-run',{id:'queued-run',sessionId:'busy-topic',provider:api.id,status:'queued'});
    await assert.rejects(engine.invoke('executor.delete',{id:api.id,detachMembers:true}),/任务在进行/);
    assert.ok(engine.store.get('executors',api.id));assert.deepEqual(engine.store.get('members',member.id),member);
    engine.store.delete('runs','queued-run');
    engine.store.put('project_flows','active-flow',{id:'active-flow',memberIds:[member.id],status:'running'});
    await assert.rejects(engine.invoke('executor.delete',{id:api.id,detachMembers:true}),/项目流程/);
    assert.ok(engine.store.get('executors',api.id));
    await engine.invoke('executor.delete',{id:subscription.id});
    assert.equal(engine.store.get('executors',subscription.id),undefined);assert.ok(engine.store.get('executors',api.id));
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

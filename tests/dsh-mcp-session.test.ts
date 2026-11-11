import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';
import {DshAdapter} from '../src/backend/adapters/dsh';
import {hivelabAcpServers} from '../src/backend/adapters/hivelab-mcp';
import {AgentControl} from '../src/backend/agent-control';
import {buildEnvironment} from '../src/backend/security';
import {NativeResponseError} from '../src/backend/adapter-failure';

test('ACP bridge explicitly forwards only the session capability, never model keys',()=>{
 const env={HIVELAB_CONTROL_HELPER:'D:/app/helper.mjs',HIVELAB_CONTROL_NODE:'D:/app/HiveLab.exe',HIVELAB_CONTROL_URL:'http://127.0.0.1:12345/tools',HIVELAB_CONTROL_TOKEN:'test-only-capability',OPENAI_API_KEY:'do-not-forward'};
 const [server]=hivelabAcpServers({env} as any);assert.deepEqual(Object.fromEntries(server.env.map(e=>[e.name,e.value])),{ELECTRON_RUN_AS_NODE:'1',HIVELAB_CONTROL_URL:env.HIVELAB_CONTROL_URL,HIVELAB_CONTROL_TOKEN:env.HIVELAB_CONTROL_TOKEN});assert.ok(!server.args.includes(env.HIVELAB_CONTROL_TOKEN));assert.throws(()=>hivelabAcpServers({env:{...env,HIVELAB_CONTROL_TOKEN:''}} as any),/缺少本轮临时授权/);assert.deepEqual(hivelabAcpServers({env:{}} as any),[]);
});

test('DSH retains protocol-safe error details and the original response identity',async()=>{
 const adapter=new DshAdapter() as any,original=new NativeResponseError('Internal error',-32603,{details:'mcp-client(hivelab): initial connection or tool synchronization failed'});adapter.rpc={request:async()=>{throw original;}};
 await assert.rejects(adapter.request('session/new',{}),(error:any)=>error instanceof NativeResponseError&&error.code===original.code&&error.data===original.data&&error.message.includes('mcp-client(hivelab)'));
});

test('real signed-out DSH can create, close and resume a session with the HiveLab tool bridge; no prompt or model call',{skip:Boolean(process.env.CI)},async()=>{
 assert.ok(process.env.HIVELAB_TEST_PROFILE,'Use the isolated test bootstrap');
 const settings={...DEFAULT_SETTINGS,paths:{dsh:path.resolve('node_modules/@deepseek-ai/dsh/lib/bin.js')}},workspace=path.join(process.env.HIVELAB_DATA_DIR!,'mcp-workspace');mkdirSync(workspace,{recursive:true});
 let toolCalls=0;const control=new AgentControl(()=>true,async()=>{toolCalls++;throw Error('No tools may run in this initialization test');}),adapter=new DshAdapter() as any;
 const env={...buildEnvironment(settings),...await control.credentials('test-native-mcp'),HIVELAB_CONTROL_HELPER:path.resolve('scripts/hivelab-tools.mjs'),HIVELAB_CONTROL_NODE:process.execPath};
 try{await adapter.launch(settings,env,workspace,false);const servers=hivelabAcpServers({env} as any),session=await adapter.request('session/new',{cwd:workspace,mcpServers:servers});assert.equal(typeof session.sessionId,'string');await adapter.request('session/close',{sessionId:session.sessionId});const resumed=await adapter.request('session/resume',{sessionId:session.sessionId,cwd:workspace,mcpServers:servers});assert.ok(resumed.configOptions);await adapter.request('session/close',{sessionId:session.sessionId});assert.equal(toolCalls,0);}
 finally{await adapter.cleanup();control.close();}
});

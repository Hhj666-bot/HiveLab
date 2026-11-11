import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {AcpAdapter} from '../src/backend/adapters/acp';
import {acpNetworkHint} from '../src/backend/adapters/acp-network-hint';
import {failureMessage} from '../src/backend/adapter-failure';
import {ACP_DEFAULT_PERMISSIONS,DEFAULT_SETTINGS} from '../src/shared/defaults';
import type {AcpExecutor} from '../src/shared/types';

const executor:AcpExecutor={id:'acp-networkfixture',name:'Antigravity',command:path.resolve('tests/fixtures/network-failure-acp.mjs'),args:[],env:{},permissions:ACP_DEFAULT_PERMISSIONS,createdAt:new Date(0).toISOString()};

function context(root:string,mode:string,nativeId?:string):any{
  return {cwd:root,env:{...process.env,HIVELAB_ACP_HOME:root,HIVELAB_NETWORK_FIXTURE:mode},settings:{...DEFAULT_SETTINGS,permissions:{...DEFAULT_SETTINGS.permissions,[executor.id]:ACP_DEFAULT_PERMISSIONS}},
    session:{id:'topic',memberId:'m-gemini',provider:executor.id,writeMode:false,nativeId},run:{id:'run-network',provider:executor.id},persona:'',
    emit:()=>{},markDelivery:()=>{},recordConfig:()=>{},persistNativeSession:()=>{},registerProcess:()=>{},approve:async()=>({choice:'deny'})};
}

test('ACP network hint names the broken transport in Chinese and ignores unrelated stderr',()=>{
  const eof=acpNetworkHint('ssl.SSLEOFError: EOF occurred in violation of protocol (_ssl.c:997)','antigravity');
  assert.match(eof!,/Google 服务时，TLS 握手被中断/);assert.match(eof!,/代理节点或 TUN 出口/);
  assert.match(acpNetworkHint('ConnectionResetError: [WinError 10054] An existing connection was forcibly closed by the remote host')!,/连接被重置/);
  assert.match(acpNetworkHint('requests.exceptions.ConnectTimeout: HTTPSConnectionPool(host=\'cloudcode-pa.googleapis.com\', port=443)')!,/Google 服务（cloudcode-pa\.googleapis\.com）时，连接超时/);
  assert.equal(acpNetworkHint('ValueError: unexpected session state'),undefined);
  assert.equal(acpNetworkHint(''),undefined);
  // The Chinese text must survive failureMessage untouched instead of collapsing to a generic notice.
  const message='Antigravity 未能建立连接，任务尚未发送：'+eof;
  assert.equal(failureMessage(message,'failed','prepared'),message);
});

test('A resume that dies on SSL EOF reports the network cause instead of a bare Internal error',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'acp-network-resume-'));
  try{
    const adapter=new AcpAdapter(executor);
    await assert.rejects(adapter.start(context(root,'ssl-eof','native-1'),'hello'),(error:Error)=>{
      assert.match(error.message,/未能恢复原会话，任务尚未发送/);assert.match(error.message,/TLS 握手被中断/);assert.doesNotMatch(error.message,/Internal error/);return true;
    });
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('A new session that dies on SSL EOF says the task was not sent and why',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'acp-network-new-'));
  try{
    await assert.rejects(new AcpAdapter(executor).start(context(root,'ssl-eof'),'hello'),(error:Error)=>{
      assert.match(error.message,/^Antigravity 未能建立连接，任务尚未发送：连接 Google 服务时，TLS 握手被中断/);return true;
    });
    const plain=mkdtempSync(path.join(root,'plain-'));
    await assert.rejects(new AcpAdapter(executor).start(context(plain,'plain'),'hello'),(error:Error)=>{assert.equal(error.message,'Internal error');return true;});
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('Connection check explains an SSL EOF after the program started',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'acp-network-probe-'));
  try{
    const info=await new AcpAdapter(executor).probe(DEFAULT_SETTINGS,{...process.env,HIVELAB_ACP_HOME:root,HIVELAB_NETWORK_FIXTURE:'ssl-eof'});
    assert.equal(info.available,false);assert.match(info.detail,/程序已启动，但未能连上服务：连接 Google 服务时，TLS 握手被中断/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

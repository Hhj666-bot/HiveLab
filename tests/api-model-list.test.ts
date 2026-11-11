import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {listApiModels} from '../src/backend/api-model-list';
import {Engine} from '../src/backend/engine';

const direct={networkMode:'tun',proxyUrl:''} as const;
async function serve(handler:(request:IncomingMessage,response:ServerResponse)=>void){
  const server=createServer(handler);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {base:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('OpenAI-compatible and Anthropic-style services list their models with the right request',async()=>{
  const seen:{url?:string;auth?:string;key?:string;version?:string}[]=[];
  const service=await serve((request,response)=>{
    seen.push({url:request.url,auth:request.headers.authorization,key:request.headers['x-api-key'] as string,version:request.headers['anthropic-version'] as string});
    response.setHeader('content-type','application/json');
    if(request.url==='/compatible-mode/v1/models')response.end(JSON.stringify({data:[{id:'qwen-plus'},{id:'qwen-max'},{id:'qwen-max'},{id:'bad id'}]}));
    else if(request.url?.startsWith('/v1/models'))response.end(JSON.stringify({data:[{id:'claude-sonnet-5-5',type:'model'},{id:'claude-haiku-5-5',type:'model'}],has_more:false}));
    else{response.statusCode=404;response.end('{}');}
  });
  try{
    const openai=await listApiModels({protocol:'openai',baseUrl:service.base+'/compatible-mode/v1/',key:'sk-test'},direct);
    assert.deepEqual(openai.models,['qwen-max','qwen-plus']);
    assert.equal(seen[0].auth,'Bearer sk-test');
    const anthropic=await listApiModels({protocol:'anthropic',baseUrl:service.base,key:'relay-key'},direct);
    assert.deepEqual(anthropic.models,['claude-haiku-5-5','claude-sonnet-5-5']);
    assert.equal(seen[1].key,'relay-key');assert.equal(seen[1].version,'2023-06-01');assert.match(seen[1].url!,/^\/v1\/models\?limit=1000$/);
    await assert.rejects(()=>listApiModels({protocol:'openai',baseUrl:service.base+'/nothing',key:'k'},direct),/没有提供模型清单接口/);
  }finally{await service.close();}
});

test('a refused key, an outside plain-HTTP address and a redirect are reported, never followed',async()=>{
  const service=await serve((request,response)=>{if(request.url==='/v1/models'&&request.headers.authorization==='Bearer good'){response.statusCode=302;response.setHeader('location','http://example.com/');response.end();return;}response.statusCode=401;response.end('{}');});
  try{
    await assert.rejects(()=>listApiModels({protocol:'openai',baseUrl:service.base+'/v1',key:'wrong'},direct),/未通过认证/);
    await assert.rejects(()=>listApiModels({protocol:'openai',baseUrl:service.base+'/v1',key:'good'},direct),/失败|超时/);
    await assert.rejects(()=>listApiModels({protocol:'openai',baseUrl:'http://example.com/v1',key:'k'},direct),/https/);
    await assert.rejects(()=>listApiModels({protocol:'openai',baseUrl:'https://user:pass@example.com/v1',key:'k'},direct),/账号或密码/);
    await assert.rejects(()=>listApiModels({protocol:'openai',baseUrl:service.base+'/v1',key:''},direct),/API Key/);
  }finally{await service.close();}
});

test('settings read a connection model list with the key being typed, before anything is saved',async()=>{
  const service=await serve((request,response)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify({data:request.headers.authorization==='Bearer typed-key'?[{id:'qwen3-coder-plus'}]:[]}));});
  const root=mkdtempSync(path.join(process.env.TEMP!,'api-model-list-'));
  const engine=new Engine(root,()=>{},()=>{},undefined,{maintenanceOnly:true});
  try{
    const result=await engine.invoke('catalog.models',{id:'qwen',authentication:'openai',value:'typed-key',baseUrl:service.base+'/v1'}) as {models:string[]};
    assert.deepEqual(result.models,['qwen3-coder-plus']);
    await assert.rejects(()=>engine.invoke('catalog.models',{id:'qwen',authentication:'openai',value:'typed-key'}),/请求地址/);
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});await service.close();}
});

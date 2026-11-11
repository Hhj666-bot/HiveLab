import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {SharedPluginBridge,normalizeMcpConfig} from '../src/backend/shared-plugin-bridge';
import {Extensions} from '../src/backend/extensions';
import {NativePlugins} from '../src/backend/native-plugins';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';
const settings={...DEFAULT_SETTINGS,networkMode:'tun' as const};
function fixture(){const root=mkdtempSync(path.join(os.tmpdir(),'shared-mcp-')),extensions=new Extensions(root),native={} as NativePlugins,bridge=new SharedPluginBridge(root,()=>settings,native,extensions);return {root,bridge,extensions};}

test('MCP connections require trust and valid transports before any code runs',()=>{
 const {bridge}=fixture();assert.throws(()=>bridge.add('test',{command:'node'},false),/信任/);assert.throws(()=>normalizeMcpConfig({url:'http://example.com/mcp'}),/HTTPS/);assert.throws(()=>normalizeMcpConfig({command:'node',args:['ok',null]}),/args/);assert.equal(bridge.tools().length,0);
});
test('generic stdio MCP: probe paged schemas, call a tool, preserve error results, disable and reload',async()=>{
 const {root,bridge,extensions}=fixture();const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-parent-key-not-forwarded';
 try{
  const id=bridge.add('Generic stdio',{command:process.execPath,args:[path.resolve('tests/fixtures/shared-mcp-server.mjs')]},true);assert.equal(bridge.tools().length,0);
  await bridge.probe(id);assert.equal(bridge.tools().length,2);const name=bridge.tools().find(t=>t.name.endsWith('__echo'))!.name;
  const result=await bridge.call(name,{value:'works'});const decoded=JSON.parse((result.content as any)[0].text);assert.equal(decoded.value,'works');assert.equal(decoded.parentProviderKey,null);
  const failure=await bridge.call(bridge.tools().find(t=>t.name.endsWith('__failure'))!.name,{});assert.equal(failure.isError,true);
  await bridge.toggle(id,false);assert.equal(bridge.tools().length,0);await assert.rejects(bridge.call(name,{}),/停用/);
  const reloaded=new SharedPluginBridge(root,()=>settings,{} as NativePlugins,extensions);assert.equal(reloaded.list()[0].enabled,false);
 }finally{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;await bridge.close();}
});

test('persistent browser MCP sessions retain state across calls and disconnect on disable',async()=>{
 const {bridge}=fixture();
 try{
  const id=bridge.add('Stateful browser',{command:process.execPath,args:[path.resolve('tests/fixtures/shared-mcp-server.mjs')],keepAlive:true},true);
  await bridge.probe(id);const name=bridge.tools().find(t=>t.name.endsWith('__echo'))!.name;
  const echo=async(value:string,signal?:AbortSignal)=>JSON.parse(((await bridge.call(name,{value},signal)).content as any)[0].text);
  const first=await echo('navigate'),second=await echo('click');assert.equal(first.pid,second.pid);assert.equal(second.calls,2);
  const controller=new AbortController();controller.abort();await assert.rejects(echo('cancelled',controller.signal),/取消/);
  const third=await echo('snapshot');assert.equal(third.pid,first.pid);assert.equal(third.calls,3);
  await bridge.toggle(id,false);await bridge.toggle(id,true);const fresh=await echo('new-browser');assert.notEqual(fresh.pid,first.pid);assert.equal(fresh.calls,1);
  await bridge.remove(id);assert.equal(bridge.tools().length,0);
 }finally{await bridge.close();}
});
test('Streamable HTTP MCP: session headers, JSON/SSE response and explicit environment reference',async()=>{
 const {bridge}=fixture();process.env.HIVELAB_TEST_MCP_HEADER='fixture-token';let called=0;
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  let text='';for await(const chunk of req)text+=chunk;const m=JSON.parse(text);
  assert.equal(req.headers.authorization,'Bearer fixture-token');
  if(m.method==='notifications/initialized'){res.writeHead(202).end();return;}
  const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'http-fixture',version:'1.0'}}:m.method==='tools/list'?{tools:[{name:'hello',description:'Hello',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'hello-http'}]};
  if(m.method!=='initialize')assert.equal(req.headers['mcp-session-id'],'fixture-session');
  if(m.method==='tools/call'){called++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n\n');}else{res.writeHead(200,{'Content-Type':'application/json','Mcp-Session-Id':'fixture-session'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as any;
 try{const id=bridge.add('HTTP',{url:`http://127.0.0.1:${address.port}/mcp`,headers:{Authorization:'Bearer ${ENV:HIVELAB_TEST_MCP_HEADER}'}},true);await bridge.probe(id);const result=await bridge.call(bridge.tools()[0].name,{});assert.equal((result.content as any)[0].text,'hello-http');assert.equal(called,1);assert(!JSON.stringify(bridge.list()).includes('fixture-token'));}finally{await bridge.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));delete process.env.HIVELAB_TEST_MCP_HEADER;}
});
test('generic source import makes Skills immediately readable and preserves existing user copies',async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'shared-skill-')),source=path.join(root,'source'),data=path.join(root,'data');mkdirSync(source);writeFileSync(path.join(source,'SKILL.md'),'---\nname: portable-import\ndescription: Shared method\n---\nOriginal instructions.');
 const oldHome=process.env.HIVELAB_CODEX_HOME;process.env.HIVELAB_CODEX_HOME=path.join(root,'codex');
 const native=new NativePlugins(data,()=>({...settings,paths:{codex:process.execPath}}),()=>[],()=>{}),extensions=new Extensions(data),bridge=new SharedPluginBridge(data,()=>settings,native,extensions);
 try{const job=native.start({provider:'codex',action:'inspect',sourceKind:'local',source});await native.settled;const prepared=native.history().find(j=>j.id===job.id)!;assert.equal(prepared.status,'done',prepared.error??'');const token=prepared.preview!.token;assert.throws(()=>bridge.importSkills(token,'source',['portable-import'],false),/确认/);
  assert.deepEqual(bridge.importSkills(token,'source',['portable-import'],true).installed,['portable-import']);assert(extensions.skillIndex().some(s=>s.id==='portable-import'));
  const file=path.join(data,'extensions/skills/portable-import/SKILL.md');writeFileSync(file,readFileSync(file,'utf8')+'\nUser edit.');assert.deepEqual(bridge.importSkills(token,'source',['portable-import'],true).kept,['portable-import']);assert(readFileSync(file,'utf8').includes('User edit.'));
 }finally{await native.close();await bridge.close();if(oldHome===undefined)delete process.env.HIVELAB_CODEX_HOME;else process.env.HIVELAB_CODEX_HOME=oldHome;}
});
test('a native source without an HiveLab manifest can export a portable MCP through an immutable source snapshot',async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'source-mcp-')),source=path.join(root,'source'),data=path.join(root,'data');mkdirSync(source);
 writeFileSync(path.join(source,'server.mjs'),readFileSync(path.resolve('tests/fixtures/shared-mcp-server.mjs')));
 mkdirSync(path.join(source,'.claude-plugin'));writeFileSync(path.join(source,'.claude-plugin/marketplace.json'),JSON.stringify({name:'source-fixture',plugins:[{name:'portable',source:'./'}]}));
 writeFileSync(path.join(source,'.mcp.json'),JSON.stringify({mcpServers:{portable:{command:'node',args:['${CLAUDE_PLUGIN_ROOT}/server.mjs']}}}));
 const oldHome=process.env.HIVELAB_CODEX_HOME;process.env.HIVELAB_CODEX_HOME=path.join(root,'codex');const native=new NativePlugins(data,()=>({...settings,paths:{codex:process.execPath}}),()=>[],()=>{}),extensions=new Extensions(data),bridge=new SharedPluginBridge(data,()=>settings,native,extensions);
 try{const job=native.start({provider:'codex',action:'inspect',sourceKind:'local',source});await native.settled;const preview=native.history().find(j=>j.id===job.id)!.preview!;assert(preview.sharing?.mcp.length);const id=bridge.addFromPreview(preview.token,'source','portable',true);assert(bridge.list()[0].config.args?.[0].includes('plugin-bridge'));
  await bridge.probe(id);const result=await bridge.call(bridge.tools().find(t=>t.name.endsWith('__echo'))!.name,{value:'from-native-source'});assert.equal(JSON.parse((result.content as any)[0].text).value,'from-native-source');
 }finally{await native.close();await bridge.close();if(oldHome===undefined)delete process.env.HIVELAB_CODEX_HOME;else process.env.HIVELAB_CODEX_HOME=oldHome;}
});


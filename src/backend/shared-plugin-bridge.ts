import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,cpSync} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {fetch,ProxyAgent} from 'undici';
import type {BridgeConnection,BridgeConnectionView,McpServerConfig} from '../shared/plugin-market';
import type {Settings} from '../shared/types';
import {buildEnvironment,redact} from './security';
import {spawnOwned,stopOwned} from './process-supervisor';
import {npmLaunch} from './node-runtime';
import {prepareCliLaunch} from './adapters/common';
import {portableNode} from './portable-node-path';
import {Extensions} from './extensions';
import {NativePlugins,nativePackageFiles} from './native-plugins';

/** The SDK handles MCP; this transport keeps HiveLab's Windows job ownership and cancellation. */
class OwnedMcpTransport{
 onmessage?: (message:any)=>void;onerror?: (error:Error)=>void;onclose?:()=>void;
 private child?:ReturnType<typeof spawnOwned>;private decoder=new StringDecoder('utf8');private buffer='';private closed=false;
 constructor(private launch:{command:string;args:string[];env:NodeJS.ProcessEnv},private cwd:string){}
 async start(){
  const child=this.child=spawnOwned(this.launch.command,this.launch.args,{cwd:this.cwd,env:this.launch.env});child.stderr?.resume();
  child.stdout?.on('data',(chunk:Buffer)=>{this.buffer+=this.decoder.write(chunk);if(this.buffer.length>16*1024*1024){this.onerror?.(Error('MCP 消息超过 16 MB'));void this.close();return;}let i:number;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i).trim();this.buffer=this.buffer.slice(i+1);if(!line)continue;try{const message=JSON.parse(line);if(Array.isArray(message))for(const item of message)this.onmessage?.(item);else this.onmessage?.(message);}catch{this.onerror?.(Error('MCP stdout 不是有效 JSON-RPC；请将日志写入 stderr'));void this.close();}}});
  child.on('error',error=>this.onerror?.(error));child.once('close',()=>{if(!this.closed){this.closed=true;this.onclose?.();}});
 }
 async send(message:any){if(!this.child?.stdin?.writable||this.closed)throw Error('MCP 连接已关闭');this.child.stdin.write(JSON.stringify(message)+'\n');}
 async close(){if(this.closed)return;this.closed=true;if(this.child)await stopOwned(this.child,1000);this.onclose?.();}
}
export function normalizeMcpConfig(value:any):McpServerConfig{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('MCP 配置必须是对象');
 if(value.keepAlive!==undefined&&typeof value.keepAlive!=='boolean')throw Error('keepAlive 必须是布尔值');
 const lifetime=value.keepAlive===true?{keepAlive:true}:{};
 const strings=(v:any,label:string)=>{if(v===undefined)return undefined;if(!v||typeof v!=='object'||Array.isArray(v)||Object.values(v).some(x=>typeof x!=='string'))throw Error(label+' 必须是字符串映射');return {...v};};
 if(value.url){const u=new URL(value.url);if(u.username||u.password||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('远程 MCP 使用 HTTPS；本机可使用 loopback HTTP');return {type:'http',url:u.toString(),headers:strings(value.headers,'headers'),...lifetime};}
 if(typeof value.command!=='string'||!value.command.trim()||value.command.includes('\0'))throw Error('stdio MCP 需要 command');if(value.args!==undefined&&(!Array.isArray(value.args)||value.args.some((v:any)=>typeof v!=='string'||v.includes('\0'))))throw Error('args 必须是字符串数组');if(value.cwd!==undefined&&(typeof value.cwd!=='string'||!path.isAbsolute(value.cwd)||!existsSync(value.cwd)))throw Error('cwd 必须是已存在的绝对目录');
 return {type:'stdio',command:value.command,args:value.args??[],cwd:value.cwd,env:strings(value.env,'env'),...lifetime};
}
type McpSession={client:Client;close:()=>Promise<void>};
export class SharedPluginBridge{
 private file:string;private connections:BridgeConnection[]=[];private active=new Set<()=>Promise<void>>();
 private sessions=new Map<string,Promise<McpSession>>();private closing=false;
 constructor(private data:string,private settings:()=>Settings,private native:NativePlugins,private extensions:Extensions){this.file=path.join(data,'plugin-bridge','connections.json');if(existsSync(this.file)){const value=JSON.parse(readFileSync(this.file,'utf8'));if(!Array.isArray(value.connections))throw Error('共享 MCP 配置无效');this.connections=value.connections.map((c:BridgeConnection)=>({...c,config:normalizeMcpConfig(c.config)}));}}
 private save(){mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify({version:1,connections:this.connections},null,2));renameSync(temp,this.file);}
 list():BridgeConnectionView[]{return this.connections.map(c=>{const {env,headers,...config}=c.config;return {...c,config,envKeys:Object.keys(env??{}),headerKeys:Object.keys(headers??{})};});}
 add(name:string,raw:unknown,trusted:boolean){if(trusted!==true)throw Error('请先确认信任并允许运行此 MCP 服务');if(!name.trim()||name.length>100)throw Error('请填写 100 字以内的连接名称');const connection:BridgeConnection={id:randomUUID(),name:name.trim(),config:normalizeMcpConfig(raw),enabled:false,tools:[]};this.connections.push(connection);this.save();return connection.id;}
 async toggle(id:string,enabled:boolean){const c=this.require(id);if(enabled&&!c.verifiedAt)throw Error('请先通过 MCP 连接测试');c.enabled=enabled;this.save();if(!enabled)await this.disconnect(id);return this.list();}
 async remove(id:string){this.require(id);this.connections=this.connections.filter(c=>c.id!==id);this.save();await this.disconnect(id);return this.list();}
 private require(id:string){const c=this.connections.find(c=>c.id===id);if(!c)throw Error('MCP 连接不存在');return c;}
 private publicName(id:string,name:string){return 'mcp_'+createHash('sha256').update(id+'\0'+name).digest('hex').slice(0,12)+'__'+name.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,44);}
 tools(){return this.connections.filter(c=>c.enabled&&c.verifiedAt&&!c.error).flatMap(c=>c.tools.map(t=>({...t,name:this.publicName(c.id,t.name),description:('['+c.name+'] '+t.description).slice(0,4000)})));}
 external(name:string){for(const c of this.connections.filter(c=>c.enabled&&c.verifiedAt&&!c.error)){const t=c.tools.find(t=>this.publicName(c.id,t.name)===name);if(t)return {item:{name:c.name},tool:t,connection:c};}return undefined;}
 private launch(config:McpServerConfig){
  const base=buildEnvironment(this.settings()),env:NodeJS.ProcessEnv={};for(const [key,value]of Object.entries(base))if(/^(?:path|pathext|systemroot|windir|temp|tmp|userprofile|home|appdata|localappdata|https?_proxy|no_proxy|npm_config_(?:cache|prefix|registry)|HIVELAB_NODE_EXE|HIVELAB_NODE_SOURCE)$/i.test(key))env[key]=value;Object.assign(env,config.env);
  const node=portableNode(this.data)??base.HIVELAB_NODE_EXE??process.execPath;let args=config.args??[],command=config.command!,prefix:string[]=[],entry=command;env.HIVELAB_NODE_EXE=node;
  if(/^(?:node|node\.exe)$/i.test(command)){command=node;entry=args[0]??node;prefix=[...args];args=[];}
  else if(/^(?:npx|npx\.cmd)$/i.test(command)){const npm=npmLaunch(base,config.cwd??this.data);const cli=npm.prefix.at(-1)!;entry=path.join(path.dirname(cli),'npx-cli.js');if(!existsSync(entry))throw Error('当前 Node 环境没有 npx-cli.js');command=npm.command;prefix=[...npm.prefix.slice(0,-1),entry];Object.assign(env,...Object.entries(npm.env).filter(([k])=>/^(?:ELECTRON_RUN_AS_NODE|PATH|Path)$/.test(k)).map(([k,v])=>({[k]:v})));}
  else if(!path.isAbsolute(command)){const dirs=(env.PATH??env.Path??'').split(path.delimiter),names=process.platform==='win32'?[command+'.exe',command]:[command];const found=dirs.flatMap(d=>names.map(n=>path.join(d,n))).find(existsSync);if(!found)throw Error('找不到 MCP 命令 '+command);command=entry=found;}
  if(/\.(?:cmd|bat|ps1)$/i.test(command))throw Error('请填写实际可执行文件或 Node 入口；npx.cmd 可直接使用');
  if(/\.(?:mjs|cjs|js)$/i.test(command)){entry=command;prefix=[command];command=node;}
  if(!path.isAbsolute(command)||!existsSync(command))throw Error('MCP 可执行文件不存在');
  return prepareCliLaunch({command,prefix,path:entry},args,env);
 }
 private async connect(connection:BridgeConnection):Promise<McpSession>{
  if(this.closing)throw Error('MCP 服务正在关闭');
  const expand=(value:any):any=>typeof value==='string'?value.replace(/\$\{(?:ENV:)?([A-Z_][A-Z0-9_]*)\}/g,(_,key)=>{const resolved=process.env[key];if(resolved===undefined)throw Error('缺少 MCP 配置引用的环境变量 '+key);return resolved;}):Array.isArray(value)?value.map(expand):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,expand(v)])):value;
  const config=normalizeMcpConfig(expand(connection.config)),client=new Client({name:'hivelab-shared-plugins',version:'1.0.0'},{capabilities:{}}),settings=this.settings();let proxy:ProxyAgent|undefined;
  const transport=config.url?new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers},fetch:((input:any,init:any)=>fetch(input,{...init,dispatcher:proxy})) as any}):new OwnedMcpTransport(this.launch(config),config.cwd??this.data);
  if(config.url&&settings.networkMode==='proxy'&&!['127.0.0.1','localhost','[::1]'].includes(new URL(config.url).hostname))proxy=new ProxyAgent(settings.proxyUrl);
  let closed=false;const close=async()=>{if(closed)return;closed=true;this.active.delete(close);await client.close().catch(()=>{});await proxy?.close();};this.active.add(close);
  try{await client.connect(transport as any,{timeout:25000});if(this.closing)throw Error('MCP 服务正在关闭');return {client,close};}catch(error){await close();throw error;}
 }
 private async disconnect(id:string){const pending=this.sessions.get(id);this.sessions.delete(id);if(pending)try{await (await pending).close();}catch{/* A failed connection already cleaned up its transport. */}}
 private async session(connection:BridgeConnection){
  let pending=this.sessions.get(connection.id);
  if(!pending){pending=this.connect(connection);this.sessions.set(connection.id,pending);}
  try{const session=await pending;session.client.onclose=()=>{if(this.sessions.get(connection.id)===pending)this.sessions.delete(connection.id);void session.close();};return session;}catch(error){if(this.sessions.get(connection.id)===pending)this.sessions.delete(connection.id);throw error;}
 }
 private async withClient<T>(connection:BridgeConnection,run:(client:Client)=>Promise<T>,signal?:AbortSignal){
  if(signal?.aborted)throw Error('MCP 调用已取消');
  const session=connection.config.keepAlive?await this.session(connection):await this.connect(connection);
  if(connection.config.keepAlive){if(signal?.aborted)throw Error('MCP 调用已取消');return run(session.client);}
  const onAbort=()=>{void session.close();};signal?.addEventListener('abort',onAbort,{once:true});
  try{if(signal?.aborted)throw Error('MCP 调用已取消');return await run(session.client);}finally{signal?.removeEventListener('abort',onAbort);await session.close();}
 }
 async probe(id:string){const c=this.require(id);try{const tools=await this.withClient(c,async client=>{const rows:BridgeConnection['tools']=[],seen=new Set<string>();let cursor:string|undefined;do{const page=await client.listTools(cursor?{cursor}:undefined,{timeout:25000});for(const t of page.tools){if(typeof t.name!=='string'||!t.inputSchema||t.inputSchema.type!=='object')throw Error('MCP 返回无效的工具 schema');if(!rows.some(r=>r.name===t.name))rows.push({name:t.name,description:t.description??'',inputSchema:t.inputSchema as Record<string,unknown>});}cursor=page.nextCursor;if(cursor&&seen.has(cursor))throw Error('MCP 工具分页游标重复');if(cursor)seen.add(cursor);if(rows.length>1000)throw Error('单个 MCP 服务超过 1000 个工具，请按服务拆分');}while(cursor);return rows;},AbortSignal.timeout(90000));c.tools=tools;c.verifiedAt=new Date().toISOString();c.error=undefined;c.enabled=true;this.save();return this.list();}catch(e){c.enabled=false;c.error=redact((e as Error).message);this.save();throw e;}}
 async call(name:string,args:any,signal?:AbortSignal){const target=this.external(name);if(!target)throw Error('共享 MCP 工具已停用或不存在');return this.withClient(target.connection,client=>client.callTool({name:target.tool.name,arguments:args},{timeout:120000,signal}),signal);}
 importSkills(token:string,pluginId:string,ids:string[],trusted:boolean){if(trusted!==true)throw Error('请确认导入这些共享 Skill');const report=this.native.preparedSharing(token,pluginId),installed:string[]=[],kept:string[]=[],errors:string[]=[];for(const id of [...new Set(ids)]){const skill=report.skills.find(s=>s.id===id);if(!skill)throw Error('Skill 不在此来源预览中：'+id);if(this.extensions.list().items.some(i=>i.kind==='skill'&&i.id===id)){kept.push(id);continue;}try{const preview=this.extensions.preview('skill',skill.directory);this.extensions.install(preview.token);installed.push(id);}catch(e){errors.push(id+'：'+redact((e as Error).message));}}return {installed,kept,errors};}
 addFromPreview(token:string,pluginId:string,serverName:string,trusted:boolean){
  if(trusted!==true)throw Error('请先确认信任此 MCP 来源');const report=this.native.preparedSharing(token,pluginId),server=report.mcp.find(s=>s.name===serverName);if(!server||!report.root)throw Error('此来源没有指定的 MCP 服务');const snapshot=nativePackageFiles(report.root),dest=path.join(this.data,'plugin-bridge','sources',snapshot.hash);if(!existsSync(dest)){mkdirSync(path.dirname(dest),{recursive:true});cpSync(report.root,dest,{recursive:true});}if(nativePackageFiles(dest).hash!==snapshot.hash)throw Error('MCP 来源快照不一致');
  const replace=(v:any):any=>typeof v==='string'?v.replaceAll(report.root!,dest):Array.isArray(v)?v.map(replace):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,v])=>[k,replace(v)])):v;return this.add(serverName,replace(server.config),trusted);
 }
 async close(){this.closing=true;await Promise.allSettled([...this.sessions.keys()].map(id=>this.disconnect(id)));await Promise.allSettled([...this.active].map(close=>close()));}
}

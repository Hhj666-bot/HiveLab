import {existsSync,lstatSync,readFileSync,readdirSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {copyFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import type {Settings,AcpExecutor} from '../shared/types';
import type {NativeEcosystem,NativeProvider,NativePlugin,NativeInventory,NativePreview,NativeJob,NativeRequest} from '../shared/native-plugins';
import {buildEnvironment,redact,resolveSafePath} from './security';
import {resolveCliEntry,prepareCliLaunch,subscriptionEnvironment,JsonLineRpc,type CliCommand} from './adapters/common';
import {resolveDshEntry,buildDshEnvironment} from './adapters/dsh';
import {claudeEnvironment} from './adapters/claude';
import {spawnOwned,stopOwned} from './process-supervisor';
import {npmLaunch} from './node-runtime';
import {portableNode} from './portable-node-path';
import {inspectPluginSharing} from './plugin-sharing';

type Target={info:NativeProvider;command:CliCommand;env:NodeJS.ProcessEnv;profile?:string};
type Prepared={preview:NativePreview;root?:string;hash?:string;marketplace?:string;selection?:string;npm?:string;inspection?:boolean;expires:number};
const json=(file:string)=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const nameOk=(name:unknown):name is string=>typeof name==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(name);
const packageOk=(name:unknown):name is string=>typeof name==='string'&&/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)&&name.length<200;
const atomic=(file:string,value:unknown)=>{mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n');renameSync(temp,file);};
/** Native plugins are trusted code. Copying / previewing never imports their JavaScript. */
export function nativePackageFiles(root:string){
 if(!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())throw Error('插件来源必须是真实目录');const files:{path:string;bytes:number;hash:string}[]=[];let bytes=0;
 const walk=(dir:string,depth:number)=>{if(depth>24)throw Error('插件目录层级过深');for(const name of readdirSync(dir).sort()){
  if(['.git','node_modules'].includes(name))continue;const file=path.join(dir,name),s=lstatSync(file);if(s.isSymbolicLink()||!s.isDirectory()&&!s.isFile())throw Error('插件来源不能含链接或特殊文件：'+name);
  if(s.isDirectory())walk(file,depth+1);else{bytes+=s.size;if(bytes>100*1024*1024||files.length>=10000)throw Error('原生插件来源上限为 100 MB / 10000 个文件，请选择仓库内的插件子目录');files.push({path:path.relative(root,file),bytes:s.size,hash:createHash('sha256').update(readFileSync(file)).digest('hex')});}
 }};walk(root,0);return {files,bytes,hash:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
function findExecutable(name:string,env:NodeJS.ProcessEnv){const dirs=(env.PATH??env.Path??'').split(path.delimiter);for(const dir of dirs){const file=path.join(dir,name+(process.platform==='win32'?'.exe':''));if(existsSync(file)&&lstatSync(file).isFile())return file;}throw Error('找不到 '+name+'，请先安装并加入 PATH');}
function cleanEnv(env:NodeJS.ProcessEnv){const result={...env};for(const key of Object.keys(result))if(/^(?:HIVELAB_CONTROL_|OPENAI_API_KEY$|ANTHROPIC_API_KEY$|CLAUDE_CODE_OAUTH_TOKEN$|GEMINI_API_KEY$|GOOGLE_API_KEY$|DEEPSEEK_API_KEY$)/i.test(key))delete result[key];result.CI='1';result.GIT_TERMINAL_PROMPT='0';return result;}

export class NativePlugins{
 readonly root:string;private prepared=new Map<string,Prepared>();private jobs:NativeJob[]=[];private controller?:AbortController;private pending?:Promise<void>;private listing=new Map<string,Promise<NativeInventory>>();
 constructor(private data:string,private settings:()=>Settings,private executors:()=>AcpExecutor[],private changed:()=>void){this.root=path.join(data,'native-plugins');mkdirSync(this.root,{recursive:true});try{this.jobs=json(path.join(this.root,'jobs.json')).filter((j:NativeJob)=>j&&typeof j.id==='string').slice(-30).map((j:NativeJob)=>j.status==='running'?{...j,status:'failed',error:'应用退出后原安装结果未确认，请刷新列表核对，不会自动重试。'}:j);}catch{}}
 get busy(){return !!this.pending;}get settled(){return this.pending??Promise.resolve();}
 history(){return this.jobs.map(j=>({...j})).reverse();}
 private saveJobs(){atomic(path.join(this.root,'jobs.json'),redact(this.jobs.slice(-30)));this.changed();}
 async providers():Promise<NativeProvider[]>{
  const result:NativeProvider[]=[];for(const id of ['codex','claude','dsh'])try{result.push((await this.target(id)).info);}catch(e){const ex=this.executors().find(x=>x.id===id);result.push({id,name:ex?.name??({codex:'Codex',claude:'Claude Code',dsh:'DSH'}[id]??id),available:false,detail:redact((e as Error).message)});}return result;
 }
 private async target(id:string):Promise<Target>{
  const settings=this.settings(),base=buildEnvironment(settings);let command:CliCommand,env=base,home='',ecosystem:NativeEcosystem,name='';
  if(id==='codex'){home=base.HIVELAB_CODEX_HOME??'';ecosystem='codex';name='Codex';env={...subscriptionEnvironment('codex',base),CODEX_HOME:home};command=resolveCliEntry('codex',settings,env);}
  else if(id==='claude'){home=base.HIVELAB_CLAUDE_HOME??'';ecosystem='claude';name='Claude Code';env=claudeEnvironment(base);command=resolveCliEntry('claude',settings,env);}
  else if(id==='dsh'){home=base.HIVELAB_DSH_HOME??'';ecosystem='dsh';name='DSH';if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(settings.dshProfile)||['desktop','web','headless','sdk','sdk-minimal','acp'].includes(settings.dshProfile))throw Error('DSH 必须使用 HiveLab 合屋 独立 profile');env=buildDshEnvironment(base,home,false);const file=await resolveDshEntry(settings),script=/\.(mjs|cjs|js)$/i.test(file);command={command:script?process.execPath:file,prefix:script?[file]:[],path:file};const node=portableNode(this.data);if(node)env.HIVELAB_NODE_EXE=node;}
  else throw Error('当前只接入 Codex、DSH 和 Claude Code 的原生插件接口');
  if(!home||!path.isAbsolute(home))throw Error('执行端独立数据目录尚未配置');mkdirSync(home,{recursive:true});return {info:{id,name,ecosystem,available:true,home,detail:ecosystem==='dsh'?'原生插件安装到 profile '+settings.dshProfile:'插件由该执行端的原生机制安装和加载，下次任务生效'},command,env:cleanEnv(env),profile:id==='dsh'?settings.dshProfile:undefined};
 }
 private log(job:NativeJob,text:string){job.log=(job.log+redact(text)).slice(-14000);job.updatedAt=new Date().toISOString();}
 private async run(target:Target,args:string[],signal?:AbortSignal,job?:NativeJob,timeout=180000){return this.runCommand(prepareCliLaunch(target.command,args,target.env),target.info.home!,signal,job,timeout);}
 private async runCommand(launch:{command:string;args:string[];env:NodeJS.ProcessEnv},cwd:string,signal?:AbortSignal,job?:NativeJob,timeout=180000){
  if(signal?.aborted)throw Error('操作已取消');return new Promise<string>((resolve,reject)=>{
   const child=spawnOwned(launch.command,launch.args,{cwd,env:launch.env});let output='',errors='',size=0,done=false;
   const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(output);};
   const cancel=()=>{void stopOwned(child,1000).then(()=>finish(Error('操作已取消')),e=>finish(e));};const timer=setTimeout(()=>{void stopOwned(child,1000).then(()=>finish(Error('原生插件操作超时，请刷新核对结果，不会自动重试')),e=>finish(e));},timeout);signal?.addEventListener('abort',cancel,{once:true});
   const read=(text:string,stderr:boolean)=>{size+=Buffer.byteLength(text);if(size>4*1024*1024){void stopOwned(child,1000).then(()=>finish(Error('原生插件输出过大')),e=>finish(e));return;}if(stderr)errors=(errors+text).slice(-10000);else output+=text;if(job)this.log(job,text);};child.stdout?.setEncoding('utf8');child.stderr?.setEncoding('utf8');child.stdout?.on('data',s=>read(s,false));child.stderr?.on('data',s=>read(s,true));child.stdin?.on('error',()=>{});child.stdin?.end();child.once('error',e=>finish(e));child.once('close',code=>finish(code===0?undefined:Error(redact((errors||output||'原生程序退出代码 '+code).trim().slice(-3000)))));if(signal?.aborted)cancel();
  });
 }
 private async rpc(target:Target,method:string,params:unknown,signal?:AbortSignal){
  if(signal?.aborted)throw Error('操作已取消');
  const launch=prepareCliLaunch(target.command,['app-server'],target.env),child=spawnOwned(launch.command,launch.args,{cwd:target.info.home!,env:launch.env}),rpc=new JsonLineRpc(child);const cancel=()=>{rpc.close();void stopOwned(child,1000).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});child.stderr?.resume();
  try{await rpc.request('initialize',{clientInfo:{name:'hivelab-native-plugins',version:'1.0.0'},capabilities:{experimentalApi:true}},20000);rpc.notify('initialized');if(signal?.aborted)throw Error('操作已取消');return await rpc.request(method,params,120000);}finally{signal?.removeEventListener('abort',cancel);rpc.close();await stopOwned(child,2000);}
 }
 async inventory(provider:string):Promise<NativeInventory>{
  if(this.listing.has(provider))return this.listing.get(provider)!;if(this.busy)throw Error('插件操作尚未结束，请稍后刷新');const task=this.readInventory(await this.target(provider));this.listing.set(provider,task);try{return await task;}finally{this.listing.delete(provider);}
 }
 async codexSkills(){if(this.busy)throw Error('正在管理原生插件，请稍后刷新技能');const t=await this.target('codex');return this.rpc(t,'skills/list',{cwds:[t.info.home],forceReload:true});}
 async catalog(){const t=await this.target('codex');const value=JSON.parse(await this.run(t,['plugin','list','--available','--json'],undefined,undefined,90000));return [...(value.installed??[]),...(value.available??[])];}
 preparedSharing(token:string,pluginId:string){const p=this.prepared.get(token);if(!p||p.expires<Date.now()||!p.root)throw Error('来源预览已失效或只有注册表元数据；请用本地目录或 GitHub 来源重新检测');if(!p.preview.choices.some(c=>c.id===pluginId))throw Error('请先选择预览中的插件');if(nativePackageFiles(p.root).hash!==p.hash)throw Error('来源内容已变化，请重新预览');let root=p.root;const catalog=['.agents/plugins/marketplace.json','.claude-plugin/marketplace.json'].map(f=>path.join(root,f)).find(existsSync);if(catalog&&!p.inspection){const entry=json(catalog).plugins?.find((v:any)=>v.name===pluginId),source=typeof entry?.source==='string'?entry.source:entry?.source?.source==='local'?entry.source.path:undefined;if(!source)throw Error('此条目指向远程原生服务，未提供本地 Skill/MCP 源码');root=resolveSafePath(root,source);}return inspectPluginSharing(root);}
 async configureCodexSkill(file:string,enabled:boolean){if(this.busy)throw Error('正在管理原生插件，请稍后修改技能');return this.rpc(await this.target('codex'),'skills/config/write',{path:file,enabled});}
 private async readInventory(t:Target,signal?:AbortSignal):Promise<NativeInventory>{
  const ecosystem=t.info.ecosystem!,items:NativePlugin[]=[];let detail='';
  if(ecosystem==='codex'){const value=await this.rpc(t,'plugin/installed',{cwds:[t.info.home]},signal);for(const m of value.marketplaces??[])for(const p of m.plugins??[])if(p.installed){const version=p.localVersion??p.version,market=String(p.id??'').split('@').at(-1),candidate=nameOk(p.name)&&nameOk(market)&&typeof version==='string'&&/^[\w.+-]{1,200}$/.test(version)?path.join(t.info.home!,'plugins','cache',market!,p.name,version):undefined;items.push({id:p.id,name:p.interface?.displayName??p.name,version,enabled:p.enabled,directory:p.source?.type==='local'?p.source.path:candidate&&existsSync(candidate)?candidate:undefined});}return {provider:t.info.id,items,warnings:(value.marketplaceLoadErrors??[]).map((e:any)=>e.message??e.error??'市场读取失败')};}
  if(ecosystem==='claude'){const value=JSON.parse((await this.run(t,['plugin','list','--json'],signal,undefined,30000)).trim()),rows=Array.isArray(value)?value:value.installed??value.plugins??[];for(const p of rows)items.push({id:p.id??p.name,name:p.name??p.id,version:p.version,enabled:typeof p.enabled==='boolean'?p.enabled:null,directory:p.installPath??p.path,description:p.description});atomic(path.join(this.root,'claude-runtime.json'),{ids:items.filter(p=>p.enabled).map(p=>p.id),directories:items.filter(p=>p.enabled&&p.directory).map(p=>p.directory)});}
  if(ecosystem==='dsh'){
   const root=path.join(t.info.home!,'profiles',t.profile!),file=path.join(root,'package.json');if(!existsSync(file))return {provider:t.info.id,items,detail:'尚未初始化独立 DSH profile，安装时将使用 ACP 模板初始化。'};
   const p=json(file),bundles:string[]=p.dsh?.profile?.bundles??[];let overrides:any={};try{overrides=json(path.join(this.root,'dsh-overrides.json'));}catch{}for(const name of Object.keys(p.dependencies??{})){if(!packageOk(name)||['@deepseek-ai/dsh-base','@deepseek-ai/dsh-acp-app'].includes(name))continue;let m:any={};try{m=json(path.join(root,'node_modules',name,'package.json'));}catch{}const bundle=!!m.dsh?.bundle?.patch,entry=overrides.profile===t.profile?overrides.entries?.find((e:any)=>e.package===name):undefined;items.push({id:name,name,version:m.version??p.dependencies[name],description:m.description,enabled:bundle?bundles.includes(name):entry?!entry.disabled:null,directory:path.join(root,'node_modules',name),kind:bundle?'bundle':entry?'plugin':'dependency'});}detail='Bundle 作为原生 profile 层加载；普通 Cordis 插件可按其文档填写配置后启用。基础 ACP 组件由 HiveLab 合屋 维护，不在此列表中卸载。';
  }
  return {provider:t.info.id,items,detail};
 }
 start(request:NativeRequest):NativeJob{
  if(this.busy)throw Error('已有原生插件操作正在执行');if(!['prepare','inspect','install','enable','disable','uninstall','configure'].includes(request.action))throw Error('原生插件操作无效');if(request.action==='install'&&request.trusted!==true)throw Error('请先确认信任这个原生插件');const reads=[...this.listing.values()];
  const job:NativeJob={id:randomUUID(),provider:request.provider,action:request.action,status:'running',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),log:''};this.jobs.push(job);this.jobs=this.jobs.slice(-30);this.controller=new AbortController();const signal=this.controller.signal;
  this.pending=Promise.resolve().then(async()=>{await Promise.allSettled(reads);if(signal.aborted)throw Error('操作已取消');const t=await this.target(request.provider);if(request.action==='prepare'||request.action==='inspect'){const p=await this.prepare(t,request,signal,job);job.preview=p;}else if(request.action==='install')await this.install(t,request,signal,job);else await this.mutate(t,request,signal,job);job.status=signal.aborted?'cancelled':'done';}).catch(e=>{job.status=signal.aborted?'cancelled':'failed';job.error=redact((e as Error).message);}).finally(()=>{job.updatedAt=new Date().toISOString();this.pending=undefined;this.controller=undefined;this.saveJobs();});this.saveJobs();return {...job};
 }
 cancel(id:string){if(this.jobs.find(j=>j.id===id)?.status!=='running')throw Error('该操作已结束');this.controller?.abort();return {cancelled:true};}
 private async prepare(t:Target,r:NativeRequest,signal:AbortSignal,job:NativeJob):Promise<NativePreview>{
  const source=String(r.source??'').trim();if(!source||source.length>4096||source.includes('\0'))throw Error('请填写插件来源');const token=randomUUID(),stage=path.join(this.root,'sources',token);await mkdir(stage,{recursive:true});let root=stage;
  if(r.sourceKind==='catalog'){
   if(t.info.ecosystem!=='codex')throw Error('此市场条目只适用于 Codex');const item=(await this.catalog()).find((p:any)=>p.pluginId===source);if(!item)throw Error('该条目已不在 Codex 当前市场中，请刷新');
   const preview:NativePreview={token,provider:t.info.id,source,ecosystem:'codex',files:0,bytes:0,choices:[{id:source,name:item.name,description:item.description}],note:'从 Codex 当前配置的原生市场安装。远程账户连接不会自动转移到其他成员；本地 Skill/MCP 可在安装后检测并接入共享接口。'};this.prepared.set(token,{preview,selection:source,expires:Date.now()+30*60*1000});return preview;
  }
  if(r.sourceKind==='npm'){
   if(t.info.ecosystem!=='dsh')throw Error('当前 npm 包入口用于 DSH 原生插件；其他执行端请选择原生插件目录或 GitHub 仓库');if(!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9.*^~+-]+)?$/.test(source))throw Error('npm 包名或版本格式无效');
   const npm=npmLaunch(t.env,stage),value=JSON.parse(await this.runCommand({command:npm.command,args:[...npm.prefix,'view',source,'name','version','description','--json'],env:cleanEnv(npm.env)},stage,signal,job)),m=Array.isArray(value)?value.at(-1):value;if(!packageOk(m.name)||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version))throw Error('npm 未返回可固定的包名与版本');
   const preview:NativePreview={token,provider:t.info.id,source,ecosystem:'dsh',files:0,bytes:0,choices:[{id:m.name,name:m.name+'@'+m.version,description:m.description}],note:'使用 DSH 原生包管理器安装固定版本。Bundle 会加入 profile；普通依赖需按其文档配置。'};this.prepared.set(token,{preview,npm:m.name+'@'+m.version,expires:Date.now()+30*60*1000});return preview;
  }
  let input:string;
  if(r.sourceKind==='github'){
   const url=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)?'https://github.com/'+source:source;let parsed:URL;try{parsed=new URL(url);}catch{throw Error('请填写 GitHub 仓库 URL 或 owner/repo');}
   if(parsed.protocol!=='https:'||parsed.hostname!=='github.com'||parsed.username||parsed.password||parsed.search||parsed.hash||!/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(parsed.pathname))throw Error('请填写 HTTPS GitHub 仓库根地址；仓库内目录填写在“子目录”中');
   input=path.join(stage,'checkout');const git=findExecutable('git',t.env);await this.runCommand({command:git,args:['-c','core.hooksPath='+path.join(this.root,'no-hooks'),'-c','protocol.file.allow=never','-c','protocol.ext.allow=never','clone','--depth','1','--no-recurse-submodules','--',url,input],env:t.env},stage,signal,job);
  }else if(r.sourceKind==='local'){if(!path.isAbsolute(source)||!existsSync(source))throw Error('请选择已解压的本地插件目录');input=source;}else throw Error('请选择本地目录、GitHub 或 npm 来源');
  if(r.subdirectory)input=resolveSafePath(input,String(r.subdirectory));const snapshot=nativePackageFiles(input);root=path.join(stage,'package');await mkdir(root);for(const file of snapshot.files){if(signal.aborted)throw Error('操作已取消');const out=path.join(root,file.path);await mkdir(path.dirname(out),{recursive:true});await copyFile(path.join(input,file.path),out);}if(nativePackageFiles(root).hash!==snapshot.hash)throw Error('复制后的插件校验失败');
  if(r.action==='inspect'){const preview:NativePreview={token,provider:t.info.id,source,ecosystem:t.info.ecosystem!,choices:[{id:'source',name:'此来源的共享能力'}],files:snapshot.files.length,bytes:snapshot.bytes,note:'只读取清单，不运行插件代码。Skill 可直接接入；MCP 需要单独确认信任并连接测试。',sharing:inspectPluginSharing(root)};this.prepared.set(token,{preview,root,hash:snapshot.hash,inspection:true,expires:Date.now()+30*60*1000});return preview;}
  const choices:NativePreview['choices']=[];let marketplace:string|undefined;const eco=t.info.ecosystem!;
  if(eco==='codex'||eco==='claude'){
   const catalog=[...(eco==='codex'?['.agents/plugins/marketplace.json']:[]),'.claude-plugin/marketplace.json'].map(f=>path.join(root,f)).find(existsSync);
   if(catalog){const p=json(catalog);if(!nameOk(p.name)||!Array.isArray(p.plugins))throw Error('原生插件市场清单无效');marketplace=p.name;for(const item of p.plugins){if(nameOk(item.name))choices.push({id:item.name,name:item.interface?.displayName??item.name,description:item.description});}}
   else{const manifest=[...(eco==='codex'?['.codex-plugin/plugin.json','plugin.json']:[]),'.claude-plugin/plugin.json'].map(f=>path.join(root,f)).find(existsSync);if(!manifest)throw Error('没有找到 '+(eco==='codex'?'Codex':'Claude Code')+' 原生插件或市场清单；请选择正确执行端及插件子目录');const p=json(manifest);if(!nameOk(p.name))throw Error('插件名称无效');marketplace='hivelab-local-'+createHash('sha256').update(snapshot.hash).digest('hex').slice(0,12);const folder=path.join(stage,'marketplace'),dest=path.join(folder,'plugins',p.name);await mkdir(path.dirname(dest),{recursive:true});await rename(root,dest);root=folder;const catalogFile=path.join(root,eco==='codex'?'.agents/plugins/marketplace.json':'.claude-plugin/marketplace.json');const entry=eco==='codex'?{name:p.name,source:{source:'local',path:'./plugins/'+p.name},policy:{installation:'AVAILABLE',authentication:'ON_USE'},category:'Productivity'}:{name:p.name,source:'./plugins/'+p.name};atomic(catalogFile,{name:marketplace,owner:{name:'HiveLab 合屋 local'},plugins:[entry]});choices.push({id:p.name,name:p.displayName??p.name,description:p.description});}
  }else if(eco==='dsh'){const p=json(path.join(root,'package.json'));if(!packageOk(p.name))throw Error('DSH 包缺少有效的 package.json name');choices.push({id:p.name,name:p.name,description:p.description});}
  if(!choices.length||choices.length>500)throw Error('没有可安装的插件或市场过大，请选择单个插件子目录');
  const files=nativePackageFiles(root),preview:NativePreview={token,provider:t.info.id,source,ecosystem:eco,choices,files:files.files.length,bytes:files.bytes,note:'将调用对应 Agent 的原生安装器。插件中的 hooks、MCP 和依赖可能执行本地代码；仅安装你信任的来源。'};
  for(const [id,p] of this.prepared)if(p.expires<Date.now())this.prepared.delete(id);this.prepared.set(token,{preview,root,hash:files.hash,marketplace,expires:Date.now()+30*60*1000});return preview;
 }
 private async install(t:Target,r:NativeRequest,signal:AbortSignal,job:NativeJob){
  const p=this.prepared.get(String(r.token));if(!p||p.preview.provider!==t.info.id||p.expires<Date.now())throw Error('安装预览已失效或执行端不匹配');if(p.inspection)throw Error('这是共享能力检测预览；原生安装请重新读取原生插件安装预览');if(p.root&&nativePackageFiles(p.root).hash!==p.hash)throw Error('插件内容在预览后发生变化，请重新预览');const choice=p.preview.choices.find(c=>c.id===r.pluginId);if(!choice)throw Error('请选择预览中的插件');this.prepared.delete(String(r.token));
  const eco=t.info.ecosystem!;let expected=choice.id;
  // Native registries bind a marketplace name to its source path. Identical
  // previews must reuse an immutable location so uninstall / reinstall works.
  if((eco==='codex'||eco==='claude')&&p.root){const stable=path.join(this.root,'marketplaces',p.hash!);await mkdir(path.dirname(stable),{recursive:true});if(existsSync(stable)){if(nativePackageFiles(stable).hash!==p.hash)throw Error('已保存的本地市场校验失败，请检查来源目录');}else await rename(p.root,stable);p.root=stable;}
  if(eco==='codex'){if(p.selection)expected=p.selection;else{await this.run(t,['plugin','marketplace','add',p.root!,'--json'],signal,job);expected=choice.id+'@'+p.marketplace;}await this.run(t,['plugin','add',expected,'--json'],signal,job);}
  if(eco==='claude'){await this.run(t,['plugin','marketplace','add',p.root!,'--scope','user','--json'],signal,job);expected=choice.id+'@'+p.marketplace;await this.run(t,['plugin','install',expected,'--scope','user','--json'],signal,job);}
  if(eco==='dsh'){await this.dshManage(t,['add',p.npm??'file:'+p.root],signal,job);this.approveDshBundles(t);}
  const inventory=await this.readInventory(t,signal);if(!inventory.items.some(item=>item.id===expected||item.name===choice.id))throw Error('原生程序返回成功，但尚未在已安装列表中确认插件，请刷新核对，不会自动重试');this.log(job,'\n已在执行端原生列表确认安装。下次任务生效。\n');
 }
 private approveDshBundles(t:Target){const p=json(path.join(t.info.home!,'profiles',t.profile!,'package.json')),names=(p.dsh?.profile?.bundles??[]).filter((n:string)=>!['@deepseek-ai/dsh-base','@deepseek-ai/dsh-acp-app'].includes(n));atomic(path.join(this.root,'dsh-bundles.json'),{profile:t.profile,names});}
 private async dshManage(t:Target,args:string[],signal:AbortSignal,job:NativeJob){
  const profile=path.join(t.info.home!,'profiles',t.profile!);if(!existsSync(path.join(profile,'package.json')))await this.run(t,['--profile',t.profile!,'--from-default-profile','acp','--dump-config'],signal,job);
  const tools=path.join(this.root,'tools'),pnpm=path.join(tools,'node_modules','pnpm','bin','pnpm.cjs');await mkdir(tools,{recursive:true});if(!existsSync(pnpm)){this.log(job,'准备 DSH 官方包管理接口所需的 pnpm 10.28.2…\n');const npm=npmLaunch(t.env,tools);await this.runCommand({command:npm.command,args:[...npm.prefix,'install','--prefix',tools,'--no-audit','--no-fund','--ignore-scripts','--save-exact','pnpm@10.28.2'],env:cleanEnv(npm.env)},tools,signal,job);}
  const pnpmPackage=json(path.join(tools,'node_modules','pnpm','package.json')),lock=json(path.join(tools,'package-lock.json'));if(pnpmPackage.version!=='10.28.2'||lock.packages?.['node_modules/pnpm']?.integrity!=='sha512-QYcvA3rSL3NI47Heu69+hnz9RI8nJtnPdMCPGVB8MdLI56EVJbmD/rwt9kC1Q43uYCPrsfhO1DzC1lTSvDJiZA==')throw Error('pnpm 运行组件版本或发布校验值不匹配，未运行安装器');
  const helper=[path.join(path.dirname(fileURLToPath(import.meta.url)),'native-dsh-plugin.mjs'),path.resolve('scripts/native-dsh-plugin.mjs')].find(existsSync);if(!helper)throw Error('缺少 DSH 原生安装启动器');const node=portableNode(this.data)??t.env.HIVELAB_NODE_EXE??process.execPath,env={...t.env,HIVELAB_NODE_EXE:node};const launch=prepareCliLaunch({command:process.execPath,prefix:[helper],path:helper},[t.command.path,pnpm,node,t.profile!,...args],env);await this.runCommand(launch,profile,signal,job);
 }
 private async mutate(t:Target,r:NativeRequest,signal:AbortSignal,job:NativeJob){
  const inventory=await this.readInventory(t,signal),item=inventory.items.find(i=>i.id===r.pluginId);if(!item)throw Error('原生插件已不存在，请刷新列表');const enable=r.action==='enable',eco=t.info.ecosystem!;
  if(eco==='dsh'?!packageOk(item.id):!/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(item.id))throw Error('原生插件标识格式无效');
  if(r.action==='configure'){
   if(eco!=='dsh'||item.kind==='bundle')throw Error('此配置入口适用于 DSH 的普通 Cordis 插件');const config=r.config??{},module=r.module?.trim()||item.id;
   if(!config||typeof config!=='object'||Array.isArray(config)||JSON.stringify(config).length>65536||!(module===item.id||module.startsWith(item.id+'/'))||module.includes('..')||module.includes('\\'))throw Error('请提供有效的插件包模块路径和 64 KB 以内的配置对象');
   const file=path.join(this.root,'dsh-overrides.json');let state:any={profile:t.profile,entries:[]};if(existsSync(file)){const old=json(file);if(old.profile===t.profile)state=old;}const entry={package:item.id,module,id:'hivelab-native-'+createHash('sha256').update(item.id).digest('hex').slice(0,16),disabled:false,config};state.entries=[...state.entries.filter((e:any)=>e.package!==item.id),entry];atomic(file,state);this.log(job,'原生 Cordis 配置已保存，下次任务由 DSH 加载。\n');return;
  }
  if(eco==='codex'){if(r.action==='uninstall')await this.run(t,['plugin','remove',item.id,'--json'],signal,job);else await this.rpc(t,'config/value/write',{keyPath:'plugins.'+JSON.stringify(item.id)+'.enabled',value:enable,mergeStrategy:'upsert'},signal);}
  if(eco==='claude')await this.run(t,['plugin',r.action==='uninstall'?'uninstall':enable?'enable':'disable',item.id,'--scope','user'],signal,job);
  if(eco==='dsh'){
   const overrideFile=path.join(this.root,'dsh-overrides.json');if(r.action==='uninstall'){await this.dshManage(t,['remove',item.id],signal,job);if(existsSync(overrideFile)){const state=json(overrideFile);if(state.profile===t.profile){state.entries=state.entries.filter((e:any)=>e.package!==item.id);atomic(overrideFile,state);}}}
   else if(item.kind==='plugin'){const state=json(overrideFile),entry=state.entries.find((e:any)=>e.package===item.id);entry.disabled=!enable;atomic(overrideFile,state);}
   else{if(item.kind!=='bundle')throw Error('请先按插件文档填写 Cordis 配置再启用');const file=path.join(t.info.home!,'profiles',t.profile!,'package.json'),p=json(file),bundles:string[]=p.dsh?.profile?.bundles??[];p.dsh.profile.bundles=enable?[...new Set([...bundles,item.id])]:bundles.filter(n=>n!==item.id);atomic(file,p);}this.approveDshBundles(t);
  }
  const after=await this.readInventory(t,signal),current=after.items.find(p=>p.id===item.id);if(r.action==='uninstall'&&current)throw Error('原生程序执行后插件仍在列表中，请核对实际结果');if(r.action!=='uninstall'&&current?.enabled!==null&&current?.enabled!==enable)throw Error('原生启用状态与请求不一致，请刷新核对');this.log(job,'\n原生插件操作已完成，下次任务生效。\n');
 }
 async close(){this.controller?.abort();await this.pending;}
}

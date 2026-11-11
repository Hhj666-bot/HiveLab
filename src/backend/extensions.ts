import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,lstatSync,realpathSync,copyFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {type ChildProcess} from 'node:child_process';
import {spawnOwned} from './process-supervisor';
import {redact} from './security';
import type {ExtensionKind,ExtensionItem,ExtensionCatalog,ExtensionPreview,PluginManifest,SkillManifest,ExtensionTool} from '../shared/extensions';
import {compatibleAgent} from '../shared/extensions';
import {SkillImports,inspectSkill} from './skill-provenance';

const validId=(id:unknown):id is string=>typeof id==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)&&id.length<=48&&!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(id);
const text=(s:unknown,max:number)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
function inside(root:string,relative:string){
 if(!relative||path.isAbsolute(relative)||relative.includes('\0'))throw Error('扩展包路径无效');
 const result=path.resolve(root,relative),rel=path.relative(root,result);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('扩展包路径越界');
 let part=root;for(const component of rel.split(path.sep)){part=path.join(part,component);if(lstatSync(part).isSymbolicLink())throw Error('扩展包不能包含链接');}return result;
}
function tree(root:string){
 if(lstatSync(root).isSymbolicLink()||!lstatSync(root).isDirectory())throw Error('请选择真实的扩展包目录');
 const files:{relative:string;size:number;hash:string}[]=[];let bytes=0;
 const walk=(directory:string,depth:number)=>{if(depth>16)throw Error('扩展包目录层级过深');for(const name of readdirSync(directory).sort()){
  if(['.git','node_modules'].includes(name))throw Error('请选择单个扩展目录，包中不能包含 .git 或 node_modules');
  const target=path.join(directory,name),info=lstatSync(target);if(info.isSymbolicLink()||!info.isDirectory()&&!info.isFile())throw Error('扩展包不能包含链接或特殊文件');
  if(info.isDirectory())walk(target,depth+1);else{bytes+=info.size;if(bytes>20*1024*1024||files.length>=1000)throw Error('扩展包上限为 20 MB / 1000 个文件');files.push({relative:path.relative(root,target),size:info.size,hash:createHash('sha256').update(readFileSync(target)).digest('hex')});}
 }};walk(root,0);return {files,bytes,hash:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
function plugin(root:string,builtin:boolean):PluginManifest{
 if(!existsSync(path.join(root,'hivelab-plugin.json'))){
  const native=[['.codex-plugin/plugin.json','Codex'],['.claude-plugin/plugin.json','Claude Code'],['plugin.json','Agent Plugins']].filter(([file])=>existsSync(path.join(root,file))).map(([,label])=>label);
  if(native.length)throw Error(`检测到 ${native.join(' / ')} 原生插件包。本页仅安装 HiveLab 合屋 工具插件；请使用对应执行端的原生安装方式，或先适配为 hivelab-plugin.json。`);
  if(existsSync(path.join(root,'SKILL.md')))throw Error('这是 Skill 技能目录，请到独立的“Skills”页面安装');
  const pkg=path.join(root,'package.json');if(existsSync(pkg)&&lstatSync(pkg).isFile()&&lstatSync(pkg).size<128*1024)try{const p=JSON.parse(readFileSync(pkg,'utf8'));if(p.cordis||/^@deepseek-ai\/(?:dsh|cordis)/.test(p.name??'')||Object.keys(p.dependencies??{}).some(k=>/^@deepseek-ai\/(?:dsh|cordis)/.test(k)))throw Error('检测到 DSH / Cordis 原生插件包。需要对应执行端原生安装或适配；不能作为 HiveLab 合屋 工具插件通用安装。');}catch(e){if((e as Error).message.startsWith('检测到'))throw e;}
  throw Error('未找到 hivelab-plugin.json。请先确认仓库是 HiveLab 合屋 工具插件；GitHub 地址本身不代表格式兼容。');
 }
 const target=inside(root,'hivelab-plugin.json');if(lstatSync(target).size>128*1024)throw Error('插件清单过大');const p=JSON.parse(readFileSync(target,'utf8').replace(/^\uFEFF/,''));
 if(p.apiVersion!==1||!validId(p.id)||!text(p.name,100)||!text(p.description,2000)||!text(p.version,40)||!Array.isArray(p.tools)||p.tools.length>32)throw Error('插件清单格式无效或接口版本不兼容');
 const names=new Set();for(const t of p.tools){if(!t||!text(t.name,32)||!/^[a-z][a-z0-9_]*$/.test(t.name)||names.has(t.name)||!text(t.description,2000)||t.inputSchema&&(typeof t.inputSchema!=='object'||Array.isArray(t.inputSchema)||t.inputSchema.type!=='object'))throw Error('插件工具定义无效');names.add(t.name);}
 if(!builtin&&(p.features?.length||!text(p.entry,256)||!p.tools.length))throw Error('外部插件需要工具和 entry；不能覆盖本体界面功能');
 if(p.entry){if(!/\.(?:mjs|cjs|js)$/.test(p.entry)||!lstatSync(inside(root,p.entry)).isFile())throw Error('插件入口必须是包内 JavaScript 文件');}
 if(p.features!==undefined&&(!Array.isArray(p.features)||p.features.some((s:unknown)=>!text(s,80))))throw Error('插件功能声明无效');
 if(p.agents!==undefined&&(!Array.isArray(p.agents)||!p.agents.length||p.agents.length>32||p.agents.some((a:unknown)=>typeof a!=='string'||!/^(codex|claude|dsh|acp|acp-[a-z0-9-]{1,90})$/.test(a))))throw Error('agents 兼容声明无效，请使用 codex / claude / dsh / acp 或实际 ACP 执行端 ID');
 return {apiVersion:1,id:p.id,name:p.name,description:p.description,version:p.version,tools:p.tools,entry:p.entry,features:p.features,agents:p.agents};
}
function scalar(value:string){const s=value.trim();if(s.startsWith('"')){try{return JSON.parse(s);}catch{throw Error('SKILL.md 引号格式无效');}}return s.startsWith("'")&&s.endsWith("'")?s.slice(1,-1).replace(/''/g,"'"):s.replace(/\s+#.*$/,'');}
export function readSkillManifest(root:string):SkillManifest{
 const file=inside(root,'SKILL.md');if(lstatSync(file).size>256*1024)throw Error('SKILL.md 不能超过 256 KB');const content=readFileSync(file,'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'),front=/^---\n([\s\S]*?)\n---(?:\n|$)/.exec(content);if(!front)throw Error('SKILL.md 需要 name、description 前置元数据');
 const fields:Record<string,string>={};const lines=front[1].split('\n');for(let i=0;i<lines.length;i++){const m=/^(name|description):\s*(.*)$/.exec(lines[i]);if(!m)continue;let value=m[2];if(/^[>|][-+]?$/.test(value)){const parts:string[]=[];while(i+1<lines.length&&/^(?:\s|$)/.test(lines[i+1]))parts.push(lines[++i].trim());value=parts.join(' ');}fields[m[1]]=scalar(value);}
 if(!validId(fields.name)||!text(fields.description,2000))throw Error('Skill name 须为英文小写短横线名称，并提供 description');return {id:fields.name,name:fields.name,description:fields.description};
}
const skill=readSkillManifest;
const SKILL_TOOLS:ExtensionTool[]=[
 {name:'skills',description:'列出 HiveLab 合屋 已启用的技能及其适用场景；技能不是额外权限。'},
 {name:'read_skill',description:'按 id 读取已启用技能的 SKILL.md。按需加载，先核对当前成员是否具备技能所需工具。',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}},
 {name:'read_skill_asset',description:'读取已启用技能内的参考、脚本源码或模板文本。不会执行脚本。',inputSchema:{type:'object',properties:{id:{type:'string'},path:{type:'string'}},required:['id','path'],additionalProperties:false}},
];
export class Extensions{
 readonly directory:string;private builtinRoot:string;private states:Record<string,boolean>={};private warning?:string;private cached?:ExtensionCatalog;private manifests=new Map<string,PluginManifest>();private previews=new Map<string,{kind:ExtensionKind;root:string;hash:string;expires:number;currentHash?:string;locallyModified?:boolean}>();private children=new Set<ChildProcess>();
 private get skillImports(){return new SkillImports(path.join(this.directory,'skill-imports.json'));}
 skillInfo(id:string){const item=this.item('skill',id);return inspectSkill(path.join(item.directory,'SKILL.md'),item.builtin?'内置通用技能':'导入的通用技能',this.directory,item.builtin?'HiveLab 内置':'HiveLab',this.skillImports.get(id));}
 constructor(dataDirectory:string,builtinRoot?:string){
  this.directory=path.join(dataDirectory,'extensions');mkdirSync(this.directory,{recursive:true});for(const kind of ['plugins','skills'])mkdirSync(path.join(this.directory,kind),{recursive:true});
  this.builtinRoot=builtinRoot??[path.join(path.dirname(fileURLToPath(import.meta.url)),'extensions'),path.resolve('build/extensions')].find(existsSync)??'';
  const state=path.join(this.directory,'state.json');if(existsSync(state))try{const s=JSON.parse(readFileSync(state,'utf8'));if(s.apiVersion!==1||!s.enabled||typeof s.enabled!=='object'||Array.isArray(s.enabled)||Object.values(s.enabled).some(v=>typeof v!=='boolean'))throw Error('配置格式无效');this.states=s.enabled;}catch{this.warning='扩展启用配置损坏，用户扩展保持停用。请备份 extensions/state.json 后重新设置；账号和聊天仍可使用。';}
 }
 private roots(kind:ExtensionKind){return [{root:path.join(this.builtinRoot,kind+'s'),builtin:true},{root:path.join(this.directory,kind+'s'),builtin:false}];}
 list():ExtensionCatalog{
  if(this.cached)return this.cached;this.manifests.clear();
  const items:ExtensionItem[]=[],keys=new Set<string>();for(const kind of ['plugin','skill'] as const)for(const {root,builtin} of this.roots(kind)){
   if(!existsSync(root))continue;for(const folder of readdirSync(root).sort()){if(!validId(folder))continue;const directory=path.join(root,folder);try{
    if(lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory())throw Error('扩展目录不能是链接');const m=kind==='plugin'?plugin(directory,builtin):skill(directory),key=kind+':'+m.id;if(m.id!==folder||keys.has(key))throw Error('扩展目录与 id 不匹配或重复');keys.add(key);
    const p=kind==='plugin'?m as PluginManifest:undefined;if(p)this.manifests.set(directory,p);items.push({kind,...m,builtin,enabled:builtin?this.states[key]!==false:this.states[key]===true,directory,tools:p?.tools.map(t=>builtin?t.name:this.toolName(m.id,t.name)),features:p?.features,agents:p?.agents,layer:p?(p.tools.length?'bridge':'host'):undefined,executable:!!p?.entry});
   }catch(error){items.push({kind,id:folder,name:folder,description:'无法加载',builtin,enabled:false,directory,error:redact((error as Error).message)});}}
  }for(const item of items.filter(i=>i.kind==='skill'&&!i.error))item.provenance=inspectSkill(path.join(item.directory,'SKILL.md'),item.builtin?'内置通用技能':'导入的通用技能',this.directory,item.builtin?'HiveLab 内置':'HiveLab',this.skillImports.get(item.id));return this.cached={apiVersion:1,directory:this.directory,items,warning:this.warning};
 }
 refresh(){this.cached=undefined;return this.list();}
 private item(kind:ExtensionKind,id:string){const item=this.list().items.find(i=>i.kind===kind&&i.id===id);if(!item||item.error)throw Error('扩展不存在或不可用');return item;}
 enabled(id:string){return this.list().items.some(i=>i.kind==='plugin'&&i.id===id&&i.enabled&&!i.error);}
 require(id:string){if(!this.enabled(id))throw Error(`插件 ${id} 已停用或不可用，请在“插件”管理页中启用`);}
 private save(){const temp=path.join(this.directory,'state-'+randomUUID()+'.tmp');writeFileSync(temp,JSON.stringify({apiVersion:1,enabled:this.states},null,2));renameSync(temp,path.join(this.directory,'state.json'));this.cached=undefined;}
 toggle(kind:ExtensionKind,id:string,enabled:boolean){this.item(kind,id);this.states[kind+':'+id]=enabled;this.save();return this.list();}
 preview(kind:ExtensionKind,source:string):ExtensionPreview{
  if(!['plugin','skill'].includes(kind)||!path.isAbsolute(source))throw Error('请选择扩展目录');const info=lstatSync(source);if(info.isSymbolicLink())throw Error('扩展包不能是链接');const root=info.isDirectory()?source:path.dirname(source),m=kind==='plugin'?plugin(root,false):skill(root);
  const existing=this.list().items.find(i=>i.kind===kind&&i.id===m.id);
  if(existing&&(kind!=='skill'||existing.builtin||existing.error))throw Error('该扩展已安装；请先停用并卸载旧的用户扩展，再安装新版本');
  const currentHash=existing?tree(existing.directory).hash:undefined,imported=existing?this.skillImports.get(m.id):undefined;
  const locallyModified=existing?(!imported||currentHash!==imported.packageHash):undefined;
  const files=tree(root),token=randomUUID();for(const [id,p] of this.previews)if(p.expires<Date.now())this.previews.delete(id);if(this.previews.size>20)this.previews.clear();this.previews.set(token,{kind,root:realpathSync(root),hash:files.hash,expires:Date.now()+10*60*1000,currentHash,locallyModified});
  const p=kind==='plugin'?m as PluginManifest:undefined;return {token,files:files.files.length,bytes:files.bytes,...(currentHash?{update:{previousHash:currentHash,locallyModified:!!locallyModified,importedFrom:imported?.source}}:{}),item:{kind,...m,directory:root,builtin:false,enabled:existing?.enabled??true,tools:p?.tools.map(t=>this.toolName(m.id,t.name)),agents:p?.agents,layer:p?(p.tools.length?'bridge':'host'):undefined,executable:!!p?.entry}};
 }
 install(token:string){
  const p=this.previews.get(token);if(!p||p.expires<Date.now())throw Error('安装预览已失效，请重新选择扩展包');this.previews.delete(token);const files=tree(p.root);if(files.hash!==p.hash)throw Error('扩展包预览后发生变化，请重新预览');
  const m=p.kind==='plugin'?plugin(p.root,false):skill(p.root),existing=this.list().items.find(i=>i.kind===p.kind&&i.id===m.id);
  if(existing&&(!p.currentHash||p.kind!=='skill'||existing.builtin))throw Error('扩展已存在');
  if(p.currentHash&&(!existing||tree(existing.directory).hash!==p.currentHash))throw Error('已安装副本在预览后变化，请重新预览');
  if(p.locallyModified)throw Error('本地副本存在用户修改或缺少导入基线，已保留原副本，未覆盖');
  const root=path.join(this.directory,p.kind+'s'),target=path.join(root,m.id),temp=path.join(root,'.install-'+randomUUID());
  let archive:string|undefined;
  try{mkdirSync(temp);for(const f of files.files){const dest=path.join(temp,f.relative);mkdirSync(path.dirname(dest),{recursive:true});copyFileSync(inside(p.root,f.relative),dest);}if(tree(temp).hash!==p.hash)throw Error('复制后的扩展校验失败');
   if(existing){archive=path.join(this.directory,'skill-history',randomUUID());mkdirSync(path.dirname(archive),{recursive:true});renameSync(target,archive);}
   try{renameSync(temp,target);}catch(error){if(archive)renameSync(archive,target);throw error;}
  }finally{rmSync(temp,{recursive:true,force:true});}
  if(p.kind==='skill')this.skillImports.record(m.id,p.root,p.hash,readFileSync(path.join(target,'SKILL.md'),'utf8'),m.description);
  this.states[p.kind+':'+m.id]=existing?.enabled??true;this.save();return this.list();
 }
 remove(kind:ExtensionKind,id:string){const item=this.list().items.find(i=>i.kind===kind&&i.id===id);if(!item||!validId(id))throw Error('扩展不存在');if(item.builtin)throw Error('内置扩展随本体提供，可以停用，不能卸载');if(item.enabled)throw Error('请先停用扩展再卸载');const root=realpathSync(path.join(this.directory,kind+'s')),target=realpathSync(item.directory);if(path.dirname(target)!==root||path.basename(target)!==id)throw Error('扩展卸载路径越界');rmSync(target,{recursive:true});delete this.states[kind+':'+id];this.save();return this.list();}
 private toolName(id:string,name:string){return `ext_${id.replace(/-/g,'_').slice(0,16)}_${createHash('sha256').update(id).digest('hex').slice(0,6)}__${name.slice(0,32)}`;}
 tools(builtins:readonly ExtensionTool[],provider?:string):ExtensionTool[]{
  const tools:ExtensionTool[]=[...SKILL_TOOLS];for(const item of this.list().items.filter(i=>i.kind==='plugin'&&i.enabled&&!i.error&&compatibleAgent(i.agents,provider))){
   const p=this.manifests.get(item.directory)!;for(const t of p.tools){if(item.builtin){const builtin=builtins.find(b=>b.name===t.name);if(builtin)tools.push(builtin);}else tools.push({...t,name:this.toolName(p.id,t.name)});}
  }return tools;
 }
 skillIndex(){return this.list().items.filter(i=>i.kind==='skill'&&i.enabled&&!i.error).map(({id,name,description})=>({id,name,description}));}
 skillTool(name:string,args:any){if(name==='skills')return this.skillIndex();const item=this.item('skill',String(args.id));if(!item.enabled)throw Error('技能已停用');const relative=name==='read_skill'?'SKILL.md':String(args.path??''),target=inside(item.directory,relative),size=lstatSync(target).size;if(size>1024*1024||!lstatSync(target).isFile())throw Error('技能资源需要为 1 MB 以下的文本文件');const buffer=readFileSync(target);if(buffer.includes(0))throw Error('二进制资源请由具备文件工具的执行端按技能目录读取');return {id:item.id,directory:item.directory,path:target,content:buffer.toString('utf8')};}
 external(name:string,provider?:string){for(const item of this.list().items.filter(i=>i.kind==='plugin'&&i.enabled&&!i.builtin&&!i.error&&compatibleAgent(i.agents,provider))){const p=plugin(item.directory,false);if(!compatibleAgent(p.agents,provider))continue;const tool=p.tools.find(t=>this.toolName(p.id,t.name)===name);if(tool)return {item,manifest:p,tool};}return undefined;}
 async callExternal(name:string,args:unknown,context:{sessionId:string;runId:string;provider?:string},signal?:AbortSignal){
  const target=this.external(name,context.provider);if(!target||signal?.aborted)throw Error('插件工具不可用：当前执行端不兼容、插件已停用或请求已取消');
  const entry=inside(target.item.directory,target.manifest.entry!);const env:NodeJS.ProcessEnv={ELECTRON_RUN_AS_NODE:'1'};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','PATH','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
  return new Promise<unknown>((resolve,reject)=>{
   const child=spawnOwned(process.execPath,[entry],{cwd:target.item.directory,env,windowsHide:true,stdio:['pipe','pipe','pipe']});this.children.add(child);let output='',bytes=0,settled=false;
   const finish=(error?:Error,result?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);this.children.delete(child);if(error){child.kill();reject(error);}else resolve(result);};
   const cancel=()=>finish(Error('插件调用已取消'));const timer=setTimeout(()=>finish(Error('插件调用超过 60 秒，已停止')),60000);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
   child.stdout!.setEncoding('utf8');child.stdout!.on('data',(data:string)=>{bytes+=Buffer.byteLength(data);if(bytes>2*1024*1024){finish(Error('插件输出过大'));return;}output+=data;});child.stderr!.resume();child.stdin!.on('error',()=>{});child.on('error',e=>finish(e));child.on('close',code=>{if(settled)return;if(code!==0){finish(Error(`插件退出，代码 ${code}`));return;}try{const value=JSON.parse(output);if(value.error)throw Error(String(value.error));finish(undefined,value.result);}catch(e){finish(Error(redact((e as Error).message)));}});child.stdin!.end(JSON.stringify({apiVersion:1,tool:target.tool.name,arguments:args,context})+'\n');
  });
 }
 close(){for(const child of this.children)child.kill();this.children.clear();}
}

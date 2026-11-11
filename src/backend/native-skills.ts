import {existsSync,lstatSync,readFileSync,readdirSync,mkdirSync,copyFileSync,renameSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Settings} from '../shared/types';
import type {SkillAgent,NativeSkillCatalog,NativeSkillItem,NativeSkillPreview} from '../shared/native-skills';
import {buildEnvironment,redact} from './security';
import {readSkillManifest} from './extensions';
import {NativePlugins,nativePackageFiles} from './native-plugins';
import {SkillImports,inspectSkill} from './skill-provenance';

/** Native skills stay in their own agent home. Never import them into the
 * common tool bridge merely to make them appear in the settings UI. */
export class NativeSkills{
 private previews=new Map<string,{provider:SkillAgent;source:string;hash:string;name:string;expires:number;currentHash?:string;locallyModified?:boolean}>();
 private get imports(){return new SkillImports(path.join(this.data,'native-skills','imports.json'));}
 private reading=new Map<string,Promise<NativeSkillCatalog>>();
 private pending?:Promise<NativeSkillCatalog>;
 constructor(private data:string,private settings:()=>Settings,private native:NativePlugins){}
 get busy(){return !!this.pending;}get settled(){return this.pending?.then(()=>{},()=>{})??Promise.resolve();}
 change(action:'install'|'toggle'|'remove',p:any){if(this.pending)throw Error('已有原生技能修改正在进行');const task=this.pending=Promise.resolve().then(()=>action==='install'?this.install(String(p.token)):action==='toggle'?this.toggle(String(p.provider),String(p.id),p.enabled):this.remove(String(p.provider),String(p.id)));void task.then(()=>{if(this.pending===task)this.pending=undefined;},()=>{if(this.pending===task)this.pending=undefined;});return task;}
 directory(provider:string){
  if(!['codex','claude','dsh'].includes(provider))throw Error('技能执行端只支持 Codex、Claude Code 和 DSH');
  const env=buildEnvironment(this.settings()),home=env[{codex:'HIVELAB_CODEX_HOME',claude:'HIVELAB_CLAUDE_HOME',dsh:'HIVELAB_DSH_HOME'}[provider]!];
  if(!home||!path.isAbsolute(home))throw Error('执行端独立技能目录未配置');return path.join(home,'skills');
 }
 async list(provider:string):Promise<NativeSkillCatalog>{
  if(this.reading.has(provider))return this.reading.get(provider)!;
  const directory=this.directory(provider),task=this.read(provider as SkillAgent,directory);this.reading.set(provider,task);try{return await task;}finally{if(this.reading.get(provider)===task)this.reading.delete(provider);}
 }
 private id(file:string){return createHash('sha256').update(path.resolve(file).toLowerCase()).digest('hex').slice(0,24);}
 private personal(file:string,root:string){
  try{const dir=path.dirname(file),rel=path.relative(root,dir);return path.basename(file)==='SKILL.md'&&!!rel&&!rel.startsWith('.')&&!path.isAbsolute(rel)&&!rel.includes(path.sep)&&!lstatSync(root).isSymbolicLink()&&!lstatSync(dir).isSymbolicLink()&&!lstatSync(file).isSymbolicLink()&&path.dirname(realpathSync(dir)).toLowerCase()===realpathSync(root).toLowerCase();}catch{return false;}
 }
 private async read(provider:SkillAgent,directory:string):Promise<NativeSkillCatalog>{
  const items:NativeSkillItem[]=[],warnings:string[]=[];
  if(provider==='codex'){
   const result=await this.native.codexSkills(),seen=new Set<string>();
   for(const row of result.data??[]){for(const entry of row.errors??[])warnings.push(String(redact(entry.message??entry.error??'技能加载失败')));for(const s of row.skills??[]){if(typeof s.path!=='string'||!path.isAbsolute(s.path))continue;const id=this.id(s.path);if(seen.has(id))continue;seen.add(id);items.push({id,name:s.name,description:s.description??'',path:s.path,directory:path.dirname(s.path),scope:s.scope??'native',enabled:typeof s.enabled==='boolean'?s.enabled:null,canToggle:s.scope!=='system'&&typeof s.enabled==='boolean',canRemove:s.scope==='user'&&this.personal(s.path,directory)});}}
  }else if(existsSync(directory)){
   if(lstatSync(directory).isSymbolicLink())throw Error('独立技能根目录不能是链接');
   for(const name of readdirSync(directory).sort().slice(0,1000)){if(name.startsWith('.'))continue;const dir=path.join(directory,name),file=path.join(dir,'SKILL.md');if(lstatSync(dir).isSymbolicLink()){warnings.push('跳过技能链接：'+name);continue;}if(!lstatSync(dir).isDirectory()||!existsSync(file))continue;
    try{const m=readSkillManifest(dir);items.push({id:this.id(file),name:m.name,description:m.description,path:file,directory:dir,scope:'personal',enabled:null,canToggle:false,canRemove:false});}catch(e){warnings.push(name+'：'+String(redact((e as Error).message)));}
   }
  }
  for(const item of items)item.provenance=inspectSkill(item.path,provider+' · '+item.scope,path.dirname(directory),item.canRemove?'HiveLab / Codex 个人目录':item.scope==='system'?'执行端系统':item.scope==='plugin'?'原生插件':'用户 / 原生端',item.canRemove?this.imports.get(provider+':'+item.name):undefined);
  return {provider,directory,items,warnings,canInstall:provider==='codex',detail:provider==='codex'?'来自 Codex 原生技能列表，包含个人、系统及插件技能。同一执行端的成员共享；下次任务生效。':'这里只展示该执行端独立个人目录中的 SKILL.md，不代表完整运行时目录或已确认加载。项目、内置及插件动态提供的技能由原生端管理。'};
 }
 preview(provider:string,source:string):NativeSkillPreview{
  if(provider!=='codex')throw Error('目前仅提供 Codex 原生技能安装；其他执行端先展示独立目录');this.directory(provider);
  if(!path.isAbsolute(source))throw Error('请选择包含 SKILL.md 的真实目录');const snapshot=nativePackageFiles(source),m=readSkillManifest(source),target=path.join(this.directory(provider),m.id);
  const currentHash=existsSync(target)?nativePackageFiles(target).hash:undefined,imported=this.imports.get(provider+':'+m.id),locallyModified=currentHash?(!imported||currentHash!==imported.packageHash):undefined;
  const token=randomUUID();for(const [key,p] of this.previews)if(p.expires<Date.now())this.previews.delete(key);this.previews.set(token,{provider,source,hash:snapshot.hash,name:m.id,expires:Date.now()+30*60*1000,currentHash,locallyModified});return {token,provider,name:m.name,description:m.description,files:snapshot.files.length,bytes:snapshot.bytes,...(currentHash?{update:{previousHash:currentHash,locallyModified:!!locallyModified,importedFrom:imported?.source}}:{})};
 }
 async install(token:string){
  const p=this.previews.get(token);if(!p||p.expires<Date.now())throw Error('技能安装预览已失效，请重新选择目录');const snapshot=nativePackageFiles(p.source);if(snapshot.hash!==p.hash)throw Error('技能内容在预览后变化，请重新预览');const m=readSkillManifest(p.source);if(m.id!==p.name)throw Error('技能标识已变化');
  const root=this.directory(p.provider),target=path.join(root,p.name);mkdirSync(root,{recursive:true});if(lstatSync(root).isSymbolicLink())throw Error('技能根目录不能是链接');
  if(existsSync(target)&&!p.currentHash)throw Error('此技能已经存在');
  if(p.currentHash&&(!existsSync(target)||nativePackageFiles(target).hash!==p.currentHash))throw Error('已安装技能在预览后变化，请重新预览');
  if(p.locallyModified)throw Error('本地副本存在用户修改或缺少导入基线，已保留原副本，未覆盖');
  // Copy outside the discovery root, so a model never sees a half-installed skill.
  const stage=path.join(this.data,'native-skills','staging',randomUUID());mkdirSync(stage,{recursive:true});for(const file of snapshot.files){const out=path.join(stage,file.path);mkdirSync(path.dirname(out),{recursive:true});copyFileSync(path.join(p.source,file.path),out);}if(nativePackageFiles(stage).hash!==p.hash)throw Error('技能复制校验失败');
  const enabled=p.currentHash?(await this.list(p.provider)).items.find(i=>this.id(i.path)===this.id(path.join(target,'SKILL.md')))?.enabled??true:true;
  let archive:string|undefined;if(p.currentHash){archive=path.join(this.data,'native-skills','updated',randomUUID());mkdirSync(path.dirname(archive),{recursive:true});renameSync(target,archive);}
  try{renameSync(stage,target);}catch(error){if(archive)renameSync(archive,target);throw error;}
  this.imports.record(p.provider+':'+p.name,p.source,p.hash,readFileSync(path.join(target,'SKILL.md'),'utf8'),m.description);this.previews.delete(token);
  await this.native.configureCodexSkill(path.join(target,'SKILL.md'),enabled);this.reading.delete(p.provider);return this.list(p.provider);
 }
 async toggle(provider:string,id:string,enabled:boolean){
  if(provider!=='codex'||typeof enabled!=='boolean')throw Error('此技能不支持在此修改启用状态');const item=(await this.list(provider)).items.find(i=>i.id===id);if(!item?.canToggle)throw Error('技能不存在或由原生端管理');await this.native.configureCodexSkill(item.path,enabled);this.reading.delete(provider);const after=await this.list(provider);if(after.items.find(i=>i.id===id)?.enabled!==enabled)throw Error('原生启用状态尚未确认，请刷新核对');return after;
 }
 async remove(provider:string,id:string){
  const root=this.directory(provider),item=(await this.list(provider)).items.find(i=>i.id===id);if(!item?.canRemove||!this.personal(item.path,root))throw Error('系统、插件或独立目录以外的技能不能在这里卸载');if(item.enabled!==false)throw Error('请先停用技能，再卸载');
  const archive=path.join(this.data,'native-skills','removed',randomUUID());mkdirSync(path.dirname(archive),{recursive:true});renameSync(item.directory,archive);return this.list(provider);
 }
 async folder(provider:string,id?:string){const root=this.directory(provider);if(!id){mkdirSync(root,{recursive:true});return root;}const item=(await this.list(provider)).items.find(i=>i.id===id);if(!item)throw Error('技能已不存在，请刷新');return item.directory;}
}

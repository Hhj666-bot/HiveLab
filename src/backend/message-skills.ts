import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import type {Extensions} from './extensions';
import type {NativeSkills} from './native-skills';
import {assignSkillGroups,HYPERFRAMES_MEMBERS,skillName,MAX_MESSAGE_SKILLS,type MessageSkill,type MessageSkillChoice,type SkillSource} from '../shared/message-skills';
import type {Store} from './store';
import {skillHash} from './skill-provenance';

export class MessageSkills{
 constructor(private extensions:Extensions,private native:NativeSkills,private store?:Pick<Store,'get'|'put'|'delete'>){}
 async list(providers:string[]):Promise<{items:MessageSkillChoice[];warnings:string[]}>{
  const items:MessageSkillChoice[]=this.extensions.skillIndex().map(s=>({...s,source:'common',enabled:true,provenance:this.extensions.skillInfo(s.id)})),warnings:string[]=[],files=new Map<string,string>();
  for(const s of this.extensions.list().items.filter(i=>i.kind==='skill'&&i.enabled&&!i.error))files.set('common:'+s.id,path.join(s.directory,'SKILL.md'));
  for(const provider of [...new Set(providers)].filter(p=>['codex','claude','dsh'].includes(p))){try{const catalog=await this.native.list(provider);for(const s of catalog.items)files.set(provider+':'+s.id,s.path);items.push(...catalog.items.filter(s=>!s.error&&s.enabled!==false).map(s=>({source:provider as SkillSource,id:s.id,name:s.name,description:s.description,enabled:s.enabled,provenance:s.provenance})));warnings.push(...catalog.warnings.map(w=>provider+'：'+w));}catch(e){warnings.push(provider+' 技能目录暂不可用：'+(e as Error).message);}}
  const members=new Set<string>();
  for(const item of items){item.note=this.store?.get<{note:string}>('message_skill_notes',item.source+':'+item.id)?.note??'';if(!items.some(p=>p.source===item.source&&skillName(p.name)==='hyperframes')||!HYPERFRAMES_MEMBERS.has(skillName(item.name)))continue;
   const name=skillName(item.name),file=files.get(item.source+':'+item.id);if(name==='hyperframes'||name.startsWith('hyperframes-'))members.add(item.source+':'+item.id);else if(file)try{if(lstatSync(file).size<=256*1024&&/hyperframes/i.test(readFileSync(file,'utf8')))members.add(item.source+':'+item.id);}catch{}
  }
  return {items:assignSkillGroups(items,members),warnings};
 }
 async note(p:any){
  if(!p||typeof p.note!=='string'||p.note.length>160||!['common','codex','claude','dsh'].includes(p.source)||typeof p.id!=='string')throw Error('技能简介最多 160 字');
  const exists=p.source==='common'?this.extensions.skillIndex().some(s=>s.id===p.id):(await this.native.list(p.source)).items.some(s=>s.id===p.id&&!s.error);
  if(!exists)throw Error('技能已移除，请刷新列表');if(!this.store)throw Error('技能简介存储未就绪');
  const note=p.note.replace(/\s+/g,' ').trim(),key=p.source+':'+p.id;if(note)this.store.put('message_skill_notes',key,{note});else this.store.delete('message_skill_notes',key);return {note};
 }
 async resolve(value:unknown,providers:string[]):Promise<MessageSkill[]>{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>MAX_MESSAGE_SKILLS)throw Error(`每条消息最多指定 ${MAX_MESSAGE_SKILLS} 个技能`);
  const result:MessageSkill[]=[],seen=new Set<string>(),catalogs=new Map<string,ReturnType<NativeSkills['list']>>();let total=0;
  for(const ref of value){if(!ref||typeof ref.id!=='string'||!['common','codex','claude','dsh'].includes(ref.source))throw Error('消息技能选择无效');const key=ref.source+':'+ref.id;if(seen.has(key))continue;seen.add(key);
   let name:string,file:string,content:string,provenance:MessageSkill['provenance'];
   if(ref.source==='common'){const item=this.extensions.skillIndex().find(i=>i.id===ref.id);if(!item)throw Error('指定的通用技能已停用或移除，请重新选择');const data=this.extensions.skillTool('read_skill',{id:ref.id}) as {path:string;content:string};name=item.name;file=data.path;content=data.content;}
   else{if(!providers.includes(ref.source))throw Error('指定技能与本次参与成员的执行端不兼容，请重新选择');if(!catalogs.has(ref.source))catalogs.set(ref.source,this.native.list(ref.source));const item=(await catalogs.get(ref.source)!).items.find(i=>i.id===ref.id&&i.enabled!==false&&!i.error);if(!item)throw Error('指定的原生技能已停用或移除，请重新选择');file=item.path;name=item.name;const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024||path.basename(file)!=='SKILL.md')throw Error('技能正文必须为 256 KB 以内的 SKILL.md 文件');const data=readFileSync(file);if(data.includes(0))throw Error('技能正文需要为文本文件');content=data.toString('utf8');}
   if(ref.source==='common')provenance=this.extensions.skillInfo(ref.id);
   else provenance=(await catalogs.get(ref.source)!).items.find(i=>i.id===ref.id)?.provenance;
   total+=Buffer.byteLength(content);if(total>1024*1024)throw Error('本次指定的技能正文超过 1 MB，请减少选择');result.push({source:ref.source,id:ref.id,name,path:file,content,contentHash:skillHash(content),frozenAt:new Date().toISOString(),provenance});
  }
  return result;
 }
}

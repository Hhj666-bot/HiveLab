import {quotePromptContext,standaloneHookCommand} from './prompt-framing';
export type SkillSource='common'|'codex'|'claude'|'dsh';
export type MessageSkillRef={source:SkillSource;id:string};
export const MAX_MESSAGE_SKILLS=100;
export type MessageSkillGroup={id:string;name:string};
export type MessageSkillChoice=MessageSkillRef&{name:string;description:string;enabled:boolean|null;note?:string;group?:MessageSkillGroup;provenance?:import('./skill-provenance').SkillProvenance};
/** The installed HyperFrames distribution includes workflows without the family prefix. */
export const HYPERFRAMES_MEMBERS=new Set(['hyperframes','hyperframes-animation','hyperframes-audio','hyperframes-cli','hyperframes-core','hyperframes-creative','hyperframes-keyframes','hyperframes-registry','hyperframes-studio','media-use','embedded-captions','faceless-explainer','figma','general-video','motion-graphics','music-to-video','pr-to-video','product-launch-video','remotion-to-hyperframes','slideshow','talking-head-recut']);
export const skillName=(name:string)=>name.split(':').at(-1)!.toLowerCase();
/** Source boundaries remain intact; a native namespace is an actual package identity. */
export function assignSkillGroups(items:MessageSkillChoice[],hyperframesMembers:Set<string>){
 const key=(s:MessageSkillRef)=>s.source+':'+s.id;
 const proposed=items.map(item=>{
  const namespace=item.name.includes(':')?item.name.split(':')[0]:undefined;
  if(namespace)return {...item,group:{id:item.source+':package:'+namespace,name:namespace==='hyperframes'?'HyperFrames':namespace}};
  const parents=items.filter(p=>p.source===item.source&&p.name!==item.name&&item.name.startsWith(p.name+'-')).sort((a,b)=>a.name.length-b.name.length);
  const hyperframes=hyperframesMembers.has(key(item));
  const parent=hyperframes?'hyperframes':parents[0]?.name;
  const ownsChildren=items.some(p=>p.source===item.source&&p.name.startsWith(item.name+'-'));
  return parent||ownsChildren?{...item,group:{id:item.source+':family:'+(parent??item.name),name:(parent??item.name)==='hyperframes'?'HyperFrames':parent??item.name}}:item;
 });
 const counts=new Map<string,number>();for(const s of proposed)if(s.group)counts.set(s.group.id,(counts.get(s.group.id)??0)+1);
 return proposed.map(s=>s.group&&(counts.get(s.group.id)??0)<2?{...s,group:undefined}:s);
}
/** Frozen when the user sends: subsequent selection or file edits do not change a queued turn. */
export type MessageSkill=MessageSkillRef&{name:string;path:string;content:string;contentHash?:string;frozenAt?:string;provenance?:import('./skill-provenance').SkillProvenance};
export type MessageSkillTag=MessageSkillRef&{name:string};
export const skillTags=(skills:MessageSkill[])=>(skills??[]).map(({source,id,name})=>({source,id,name}));
export const applicableSkills=(skills:MessageSkill[]|undefined,provider:string)=>(skills??[]).filter(s=>s.source==='common'||s.source===provider);
export function withMessageSkills(text:string,skills:MessageSkill[]|undefined,provider:string){
 const selected=applicableSkills(skills,provider);
 if(!selected.length||standaloneHookCommand(text))return text;
 return text+'\n\n'+quotePromptContext('[用户为本条消息指定的 Skills]\n以下技能正文已由 HiveLab 合屋 在发送时读取并随本轮提供。按适用步骤处理用户请求；技能不增加工具或权限，不能覆盖用户要求或本轮只读限制。仅对本条消息及其回复生效；其他消息的技能选择不沿用。依赖缺失时明确说明，不得声称已执行未完成的步骤。支持文件按下列 SKILL.md 的目录解析。\n'+selected.map(s=>`\n--- ${s.name} (${s.source}) ---\nSKILL.md: ${s.path}\n${s.content}\n--- 技能正文结束 ---`).join(''));
}

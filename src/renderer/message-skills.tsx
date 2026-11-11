import {t} from './i18n';
import {useEffect,useRef,useState} from 'react';
import {BookOpen,RefreshCw,X,ChevronRight,ChevronDown} from 'lucide-react';
import {MAX_MESSAGE_SKILLS,skillName,type MessageSkillChoice,type MessageSkillRef,type MessageSkillTag} from '../shared/message-skills';
import type {Invoke} from './ui';
import {SkillProvenance} from './SkillProvenance';
import {Modal} from './modals';
import './message-skills.css';

const labels:Record<string,string>={get common(){return t("HiveLab 合屋 通用")},codex:'Codex',claude:'Claude Code',dsh:'DSH'};
const key=(s:MessageSkillRef)=>s.source+':'+s.id;
const same=(a:MessageSkillRef,b:MessageSkillRef)=>key(a)===key(b);
type Preference={scope:string;selected:MessageSkillTag[];remember:boolean};
function read(scope:string):Preference{
 try{const p=JSON.parse(localStorage.getItem('hivelab.message-skills.'+scope)??'null');return {scope,selected:p?.remember&&Array.isArray(p.selected)?p.selected.filter((i:any)=>i&&typeof i.id==='string'&&typeof i.name==='string'&&i.source in labels).slice(0,MAX_MESSAGE_SKILLS):[],remember:p?.remember===true};}
 catch{return {scope,selected:[],remember:false};}
}
export function useMessageSkills(scope:string,providers:string[],invoke:Invoke){
 const [value,setValue]=useState(()=>read(scope)),[open,setOpen]=useState(false),[catalog,setCatalog]=useState<MessageSkillChoice[]>([]),[warnings,setWarnings]=useState<string[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState('');
 const current=useRef(scope),generation=useRef(0);current.current=scope;
 const providerKey=[...new Set(providers)].sort().join('|');
 useEffect(()=>{setValue(read(scope));setOpen(false);setQuery('');setError('');},[scope]);
 useEffect(()=>{if(value.scope===scope)try{localStorage.setItem('hivelab.message-skills.'+scope,JSON.stringify({...value,selected:value.remember?value.selected:[]}));}catch{}},[value,scope]);
 async function load(){const g=++generation.current;setLoading(true);setError('');setWarnings([]);try{const data=await invoke<{items:MessageSkillChoice[];warnings:string[]}>('messageSkills.list',{providers:providerKey.split('|').filter(Boolean)},undefined,{background:true});if(g===generation.current&&current.current===scope){setCatalog(data.items);setWarnings(data.warnings);}}catch(e){if(g===generation.current)setError((e as Error).message);}finally{if(g===generation.current)setLoading(false);}}
 useEffect(()=>{if(open){setCatalog([]);void load();}return()=>{generation.current++;};},[open,scope,providerKey]);
 const selected=value.scope===scope?value.selected:[];
 const incompatible=selected.some(s=>s.source!=='common'&&!providers.includes(s.source));
 function toggleMany(items:MessageSkillChoice[]){
  const all=items.every(s=>selected.some(i=>same(i,s))),ids=new Set(items.map(key));
  const next=all?selected.filter(s=>!ids.has(key(s))):[...selected,...items.filter(s=>!selected.some(i=>same(i,s))).map(({source,id,name})=>({source,id,name}))];
  if(next.length>MAX_MESSAGE_SKILLS){setError(t("最多选择 {0} 项；请先取消其他技能。", MAX_MESSAGE_SKILLS));return;}
  setError('');setValue(old=>({...old,selected:next}));
 }
 return {value,selected,open,setOpen,catalog,warnings,loading,error,query,setQuery,load,ready:value.scope===scope,incompatible,
  patch:(p:Partial<Preference>)=>setValue(old=>({...old,...p})),toggleMany,toggle:(s:MessageSkillChoice)=>toggleMany([s]),
  remove:(item:MessageSkillRef)=>setValue(old=>({...old,selected:old.selected.filter(s=>!same(s,item))})),
  removeMany:(items:MessageSkillRef[])=>setValue(old=>({...old,selected:old.selected.filter(s=>!items.some(i=>same(s,i)))})),
  saveNote:async(item:MessageSkillChoice,note:string)=>{const result=await invoke<{note:string}>('messageSkills.note',{source:item.source,id:item.id,note},undefined,{background:true});setCatalog(old=>old.map(s=>same(s,item)?{...s,note:result.note}:s));return result.note;},
  sent:(submitted:MessageSkillTag[])=>setValue(old=>old.scope===scope&&!old.remember&&JSON.stringify(old.selected)===JSON.stringify(submitted)?{...old,selected:[]}:old),
 };
}
type Controller=ReturnType<typeof useMessageSkills>;
export function MessageSkillChips({control}:{control:Controller}){
 const chips:{label:string;items:MessageSkillTag[]}[]=[],done=new Set<string>();
 for(const item of control.selected){if(done.has(key(item)))continue;const group=control.catalog.find(s=>same(s,item))?.group,items=group?control.catalog.filter(s=>s.group?.id===group.id):[];
  if(items.length&&items.every(s=>control.selected.some(i=>same(s,i)))){chips.push({label:group!.name+' · '+items.length,items});for(const s of items)done.add(key(s));}
  else{chips.push({label:item.name,items:[item]});done.add(key(item));}
 }
 return chips.length?<div className="message-skill-chips" aria-label={t("本次指定的 Skills")}>{chips.slice(0,3).map(c=><span key={key(c.items[0])} title={c.items.map(s=>s.name).join('、')}>{c.label}<button type="button" aria-label={t("取消技能 {0}", c.label)} onClick={()=>control.removeMany(c.items)}><X size={12}/></button></span>)}{chips.length>3&&<button type="button" className="message-skill-more" onClick={()=>control.setOpen(true)}>{t("查看全部 · 已选 {0} 项", control.selected.length)}</button>}</div>:null;
}
export function MessageSkillButton({control,disabled}:{control:Controller;disabled?:boolean}){
 return <button type="button" className="composer-tool message-skill-trigger" aria-label={t("选择本次 Skills")} title={control.selected.length?t("Skills · 已选 {0} 项", control.selected.length):t("Skills · 自动")} disabled={disabled||!control.ready} onClick={()=>control.setOpen(true)}><BookOpen size={16}/></button>;
}
function SelectionBox({items,control,label}:{items:MessageSkillChoice[];control:Controller;label:string}){
 const input=useRef<HTMLInputElement>(null),count=items.filter(s=>control.selected.some(i=>same(s,i))).length;
 useEffect(()=>{if(input.current)input.current.indeterminate=count>0&&count<items.length;},[count,items.length]);
 return <input ref={input} type="checkbox" aria-label={label} checked={count===items.length} onChange={()=>control.toggleMany(items)}/>;
}
function NoteField({item,control}:{item:MessageSkillChoice;control:Controller}){
 const [text,setText]=useState(item.note??''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setText(item.note??'');},[item.note]);
 async function save(){if(saving||text===(item.note??''))return;setSaving(true);setError('');try{setText(await control.saveNote(item,text));}catch(e){setError((e as Error).message);}finally{setSaving(false);}}
 return <div className="message-skill-note"><input aria-label={t("简介 {0}（{1}）", item.name, labels[item.source])} placeholder={t("添加自己的简介")} maxLength={160} value={text} disabled={saving} onChange={e=>setText(e.target.value)} onBlur={()=>void save()} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();e.currentTarget.blur();}}}/>{saving&&<small role="status">{t("保存中…")}</small>}{error&&<small role="alert">{error}<button type="button" onClick={()=>void save()}>{t("重试")}</button></small>}</div>;
}
function SkillDetails({item,participants}:{item:MessageSkillChoice;participants:{name:string;provider:string}[]}){
 return <section className="message-skill-details" aria-label={t("{0} 的详细信息", item.name)}><strong>{t("{0} · 原始介绍", item.name)}</strong><p>{item.description||t("未提供介绍。")}</p><SkillProvenance value={item.provenance}/><small>{t("{0} · 适用：{1}{2}", labels[item.source], participants.filter(p=>item.source==='common'||p.provider===item.source).map(p=>p.name).join('、')||t("当前没有参与成员"), item.enabled===null?t(" · 目录技能，发送时读取正文"):'')}</small></section>;
}
export function MessageSkillDialog({control,participants,onClose}:{control:Controller;participants:{name:string;provider:string}[];onClose:()=>void}){
 const [expanded,setExpanded]=useState<Record<string,boolean>>({}),[detail,setDetail]=useState('');
 const query=control.query.trim().toLowerCase(),matches=(s:MessageSkillChoice)=>[s.name,s.note??'',s.description,labels[s.source]].join(' ').toLowerCase().includes(query);
 const sections:{id:string;name?:string;items:MessageSkillChoice[]}[]=[],groups=new Map<string,{id:string;name?:string;items:MessageSkillChoice[]}>();
 for(const item of control.catalog){if(item.group){let g=groups.get(item.group.id);if(!g){g={id:item.group.id,name:item.group.name,items:[]};groups.set(item.group.id,g);sections.push(g);}g.items.push(item);}else sections.push({id:key(item),items:[item]});}
 sections.sort((a,b)=>(a.name??a.items[0].name).localeCompare(b.name??b.items[0].name));
 function row(item:MessageSkillChoice){const id=key(item);return <div className="message-skill-entry" key={id}><div className="message-skill-row"><label className="message-skill-name"><SelectionBox items={[item]} control={control} label={t("使用技能 {0}", item.name)}/><strong title={item.name}>{item.name}</strong><small>{labels[item.source]}</small></label><NoteField item={item} control={control}/><button type="button" className="message-skill-detail-button" aria-expanded={detail===id} aria-label={t("详细信息 {0}（{1}）", item.name, labels[item.source])} onClick={()=>setDetail(detail===id?'':id)}>{t("详细信息")}</button></div>{detail===id&&<SkillDetails item={item} participants={participants}/>}</div>;}
 const visible=sections.filter(s=>s.name?.toLowerCase().includes(query)||s.items.some(matches));
 return <Modal title={t("选择本次 Skills")} subtitle={t("可整组选用，也可展开勾选子项；简介由你填写。")} className="message-skills-modal" onClose={onClose}><div className="modal-body">
  <div className="message-skill-toolbar"><input type="search" aria-label={t("搜索本次技能")} placeholder={t("搜索技能、技能组或自己的简介")} value={control.query} onChange={e=>control.setQuery(e.target.value)}/><button type="button" className="button quiet small" aria-label={t("刷新本次技能")} disabled={control.loading} onClick={()=>void control.load()}><RefreshCw size={14}/></button><button type="button" className="button quiet small" onClick={()=>control.patch({selected:[]})}>{t("清空指定")}</button></div>
  <div className="message-skill-count">{t("{0} 个技能 · {1} 组", control.catalog.length, groups.size)}<span>{t("已选 {0} 项", control.selected.length)}</span></div>
  {control.error&&<p role="alert">{control.error}</p>}{control.warnings.length>0&&<details className="message-skill-warnings"><summary>{t("目录提示 · {0}", control.warnings.length)}</summary>{control.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
  {control.incompatible&&<p role="alert">{t("所选技能与当前参与成员不兼容，请取消对应技能。")}</p>}
  <div className="message-skill-column-head"><span>{t("技能 / 技能组")}</span><span>{t("我的简介")}</span><span>{t("介绍")}</span></div>
  <div className="message-skill-list" aria-label={t("可选技能")}>{control.loading?<p role="status">{t("正在读取技能目录…")}</p>:visible.length?visible.map(section=>{
   if(!section.name)return row(section.items[0]);
   const matchesGroup=section.name.toLowerCase().includes(query),shown=matchesGroup?section.items:section.items.filter(matches),showChildren=expanded[section.id]??Boolean(query&&!matchesGroup),parent=section.items.find(s=>skillName(s.name)===section.name!.toLowerCase()),detailId='group:'+section.id;
   return <section className="message-skill-group" key={section.id} aria-label={t("{0} 技能组（{1}）", section.name, labels[section.items[0].source])}><div className="message-skill-row message-skill-group-head"><div className="message-skill-name"><SelectionBox items={section.items} control={control} label={t("使用技能组 {0}（{1}）", section.name, labels[section.items[0].source])}/><button type="button" className="message-skill-expand" aria-expanded={Boolean(showChildren)} aria-label={t("{0}{1} 子技能（{2}）", (showChildren?t("收起 "):t("展开 ")), section.name, labels[section.items[0].source])} onClick={()=>setExpanded(old=>({...old,[section.id]:!showChildren}))}>{showChildren?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<strong>{section.name}</strong><small>{t("{0} 项", section.items.length)}</small></button><small className="message-skill-source">{labels[section.items[0].source]}</small></div>{parent&&!showChildren?<NoteField item={parent} control={control}/>:<span className="message-skill-group-hint">{showChildren?t("可逐项调整"):t("勾选即选用整组")}</span>}{parent?<button type="button" className="message-skill-detail-button" aria-label={t("详细信息 {0} 组（{1}）", section.name, labels[parent.source])} aria-expanded={detail===detailId} onClick={()=>setDetail(detail===detailId?'':detailId)}>{t("详细信息")}</button>:<span/>}</div>{detail===detailId&&parent&&<SkillDetails item={parent} participants={participants}/>}<div className="message-skill-children">{showChildren&&shown.map(row)}</div></section>;
  }):<p className="panel-muted">{control.error?t("目录读取失败，可刷新重试。"):t("没有匹配的技能。")}</p>}</div>
  <div className="message-skill-preferences"><label><input type="checkbox" checked={control.value.remember} onChange={e=>control.patch({remember:e.target.checked})}/>{t("记住当前话题的选择")}</label></div>
  <div className="message-skill-footer"><small>{t("需要时点击 Skills 打开；未指定时自动匹配。")}</small><button type="button" className="button quiet" onClick={onClose}>{t("关闭")}</button><button type="button" className="button primary" disabled={control.incompatible} onClick={onClose}>{t("完成选择")}</button></div>
 </div></Modal>;
}

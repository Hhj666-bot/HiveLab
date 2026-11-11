import {t} from './i18n';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,ChevronRight,Search,Star,LockKeyhole,FolderOpen,MoreHorizontal,ChevronsDownUp,Info,Trash2} from 'lucide-react';
import type {DeskFileGroup,DeskFileItem,DeskFileSelection} from '../shared/desk-files';
import type {Invoke} from './ui';
import {WorkspaceFileIcon} from './workspace-file-icon';
import {useFileActions} from './file-actions';

const key=(group:string,path:string)=>JSON.stringify([group,path]);
const size=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:n<1073741824?`${(n/1048576).toFixed(1)} MB`:`${(n/1073741824).toFixed(2)} GB`;
type Node={id:string;name:string;path:string;file?:DeskFileItem;children:Node[];files:DeskFileItem[];eligible:DeskFileItem[];bytes:number};
function tree(group:DeskFileGroup):Node{
 const root:Node={id:key(group.sessionId,''),name:group.title.replace(/\s*[（(]共用目录[）)]$/,''),path:'',children:[],files:[],eligible:[],bytes:0},folders=new Map<string,Node>([['',root]]);
 for(const file of group.files){
  const parts=file.path.split('/');let parent=root,relative='';
  for(const name of parts.slice(0,-1)){
   relative=relative?relative+'/'+name:name;
   let folder=folders.get(relative);if(!folder){folder={id:key(group.sessionId,relative),name,path:relative,children:[],files:[],eligible:[],bytes:0};folders.set(relative,folder);parent.children.push(folder);}parent=folder;
  }
  parent.children.push({id:key(group.sessionId,file.path),name:parts.at(-1)??file.path,path:file.path,file,children:[],files:[file],eligible:file.protectedReason?[]:[file],bytes:file.size});
 }
 function finish(node:Node):Node{
  if(node.file)return node;
  node.children.sort((a,b)=>Number(!!a.file)-Number(!!b.file)||a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
  for(const child of node.children){finish(child);node.files.push(...child.files);node.eligible.push(...child.eligible);node.bytes+=child.bytes;}return node;
 }
 return finish(root);
}
function matching(node:Node,query:string,groupTitle:string):Node|null{
 if(!query)return node;
 if((groupTitle+'/'+node.path).toLowerCase().includes(query))return node;
 if(node.file)return null;
 const children=node.children.map(child=>matching(child,query,groupTitle)).filter((child):child is Node=>!!child);
 return children.length?{...node,children,files:children.flatMap(child=>child.files),eligible:children.flatMap(child=>child.eligible),bytes:children.reduce((n,child)=>n+child.bytes,0)}:null;
}
function TreeCheck({checked,mixed,label,disabled,onChange}:{checked:boolean;mixed:boolean;label:string;disabled:boolean;onChange:(on:boolean)=>void}){
 const input=useRef<HTMLInputElement>(null);useEffect(()=>{if(input.current)input.current.indeterminate=mixed;},[mixed]);
 return <input ref={input} type="checkbox" aria-label={label} aria-checked={mixed?'mixed':checked} checked={checked} disabled={disabled} tabIndex={-1} onChange={e=>onChange(e.target.checked)}/>;
}

export function DeskFileTree({groups,selected,busy,filterControl,invoke,onSelection,onClearSelection,onKeep,onOpenRoot,onPreview,onError,onDelete}:{onDelete?:(group:DeskFileGroup)=>void;groups:DeskFileGroup[];selected:Set<string>;busy:boolean;filterControl:ReactNode;invoke:Invoke;onSelection:(files:DeskFileSelection[],on:boolean)=>void;onClearSelection:()=>void;onKeep:(group:DeskFileGroup,file:DeskFileItem)=>void;onOpenRoot:(id:string)=>void;onPreview:(group:DeskFileGroup,file:DeskFileItem)=>void;onError:(message:string)=>void}){
 const [query,setQuery]=useState(''),[expanded,setExpanded]=useState(new Set<string>()),[searchClosed,setSearchClosed]=useState(new Set<string>()),[focused,setFocused]=useState(''),[limits,setLimits]=useState<Record<string,number>>({});
 const initialized=useRef(new Set<string>()),container=useRef<HTMLDivElement>(null),actions=useFileActions(invoke,onError);
 const signature=groups.map(g=>g.sessionId).join('\0');
 useEffect(()=>{setExpanded(old=>{const next=new Set(old);for(const g of groups)if(!initialized.current.has(g.sessionId)){initialized.current.add(g.sessionId);if(g.source==='legacy'||groups.length===1)next.add(key(g.sessionId,''));}return next;});setFocused('');},[signature]);
 useEffect(()=>{setSearchClosed(new Set());setFocused('');},[query]);
 const trees=useMemo(()=>groups.map(group=>({group,node:tree(group)})),[groups]);
 const matches=useMemo(()=>trees.map(({group,node})=>({group,node:matching(node,query.trim().toLowerCase(),group.title)})).filter((entry):entry is {group:DeskFileGroup;node:Node}=>!!entry.node),[trees,query]);
 const eligible=useMemo(()=>matches.flatMap(({group,node})=>node.eligible.map(f=>({sessionId:group.sessionId,path:f.path}))),[matches]);
 const chosen=eligible.filter(f=>selected.has(key(f.sessionId,f.path))).length;
 const isOpen=(node:Node)=>query.trim()?!searchClosed.has(node.id):expanded.has(node.id);
 function toggle(node:Node){setFocused(node.id);const update=query.trim()?setSearchClosed:setExpanded;update(old=>{const next=new Set(old);if(next.has(node.id))next.delete(node.id);else next.add(node.id);return next;});}
 function collapse(){if(query.trim()){const all=new Set<string>();const visit=(n:Node)=>{if(!n.file){all.add(n.id);n.children.forEach(visit);}};matches.forEach(({node})=>visit(node));setSearchClosed(all);}else setExpanded(new Set());setFocused('');}
 function select(group:DeskFileGroup,node:Node,on:boolean){onSelection(node.eligible.map(file=>({sessionId:group.sessionId,path:file.path})),on);}
 function focusRow(id:string){[...(container.current?.querySelectorAll<HTMLElement>('[data-tree-row]')??[])].find(row=>row.dataset.treeRow===id)?.focus();}
 function renderNode(group:DeskFileGroup,node:Node,level:number,parentId=''):ReactNode{
  const folder=!node.file,open=folder&&isOpen(node),selectedCount=node.eligible.filter(f=>selected.has(key(group.sessionId,f.path))).length,all=node.eligible.length>0&&selectedCount===node.eligible.length;
  const root=!node.path,rootId=group.rootId??'session:'+group.sessionId;
  const reference={source:'explorer' as const,id:rootId,path:node.path,name:node.name};
  const reason=node.file?.protectedReason??(group.readOnly?t("项目或外部目录，仅查看"):group.active?t("会话或终端正在运行"):'');
  const details=[root?group.directory:node.path,node.file?new Date(node.file.modifiedAt).toLocaleString():t("{0} 个文件", node.files.length),reason].filter(Boolean).join('\n');
  const preview=node.file?()=>onPreview(group,node.file!):undefined;
  return <div role="none" key={node.id}>
   <div className={'desk-tree-row'+(root?' desk-tree-root':'')+(focused===node.id?' active':'')} role="treeitem" aria-label={node.name} aria-level={level} aria-expanded={folder?open:undefined} aria-selected={focused===node.id} tabIndex={focused===node.id||!focused&&node.id===matches[0]?.node.id?0:-1} data-tree-row={node.id} data-parent-row={parentId} style={{paddingLeft:8+(level-1)*16}} title={details} onFocus={()=>setFocused(node.id)} onContextMenu={event=>{setFocused(node.id);actions.context(event,reference,preview);}} onKeyDown={event=>{
    if(event.target!==event.currentTarget)return;
    if(event.key==='ArrowRight'&&folder){event.preventDefault();if(!open)toggle(node);else if(node.children[0])focusRow(node.children[0].id);}
    else if(event.key==='ArrowLeft'){event.preventDefault();if(open)toggle(node);else if(parentId)focusRow(parentId);}
    else if(event.key==='Enter'){event.preventDefault();if(folder)toggle(node);else preview?.();}
    else if(event.key===' '){event.preventDefault();if(!busy&&node.eligible.length)select(group,node,!all);}
    else if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const r=event.currentTarget.getBoundingClientRect();actions.openAt(reference,r.left+36,r.bottom,preview);}
   }}>
    {folder?<button type="button" className="desk-tree-chevron" tabIndex={-1} aria-label={(open?t("收起 "):t("展开 "))+(node.path||node.name)} onClick={()=>toggle(node)}>{open?<ChevronDown size={13}/>:<ChevronRight size={13}/>}</button>:<span className="desk-tree-chevron"/>}
    <TreeCheck label={(folder?t("选择文件夹 "):t("选择文件 "))+group.title+' / '+node.path} checked={all} mixed={selectedCount>0&&!all} disabled={busy||!node.eligible.length} onChange={on=>select(group,node,on)}/>
    <span className={'desk-tree-icon'+(folder?' folder':'')}><WorkspaceFileIcon name={node.name} directory={folder}/></span>
    <button type="button" className="desk-tree-name" tabIndex={-1} onClick={()=>folder?toggle(node):setFocused(node.id)} onDoubleClick={()=>{if(node.file)preview?.();}}>{node.name}</button>
    {root&&<span className="desk-tree-badge">{group.active?t("运行中"):group.readOnly?t("仅查看"):group.source==='legacy'?t("共用目录"):group.archived?t("已归档"):''}</span>}
    {folder&&<small className="desk-tree-count">{node.files.length}</small>}
    {reason&&<LockKeyhole className="desk-tree-lock" size={12} aria-label={reason}/>}
    <small className="desk-tree-size">{size(node.bytes)}</small>
    <span className="desk-tree-actions">
     {root&&group.source==='session'&&onDelete&&<button type="button" className="preview-icon-button danger" aria-label={t("删除会话 {0}", node.name)} title={t("删除会话")} disabled={busy||group.active} onClick={()=>onDelete(group)}><Trash2 size={14}/></button>}
     {node.file&&<button type="button" className={'preview-icon-button'+(node.file.kept?' kept':'')} tabIndex={focused===node.id?0:-1} title={node.file.kept?t("取消保留"):t("标记保留，清理时排除")} aria-label={(node.file.kept?t("取消保留 "):t("保留文件 "))+node.path} disabled={busy||group.active||group.readOnly} onClick={()=>onKeep(group,node.file!)}><Star size={13} fill={node.file.kept?'currentColor':'none'}/></button>}
     {root&&<button type="button" className="preview-icon-button" tabIndex={focused===node.id?0:-1} aria-label={t("在侧栏查看 {0}", node.name)} title={t("在侧栏查看")} onClick={()=>onOpenRoot(rootId)}><FolderOpen size={13}/></button>}
     <button type="button" className="preview-icon-button" tabIndex={focused===node.id?0:-1} aria-label={t("更多文件操作 {0}", node.name)} title={t("更多操作")} onClick={event=>{const r=event.currentTarget.getBoundingClientRect();actions.openAt(reference,r.left,r.bottom,preview);}}><MoreHorizontal size={14}/></button>
    </span>
   </div>
   {open&&<div role="group">{node.children.slice(0,limits[node.id]??200).map(child=>renderNode(group,child,level+1,node.id))}{node.children.length>(limits[node.id]??200)&&<button type="button" className="desk-tree-more" style={{paddingLeft:24+level*16}} onClick={()=>setLimits(old=>({...old,[node.id]:(old[node.id]??200)+200}))}>{t("再显示 200 项…")}</button>}{!node.children.length&&<p className="desk-tree-empty" style={{paddingLeft:24+level*16}}>{t("文件夹为空")}</p>}{root&&group.error&&<p className="desk-files-error">{group.error}</p>}{root&&group.truncated&&<p className="explorer-muted">{t("文件较多，当前展示已扫描的前 20000 项。")}</p>}</div>}
  </div>;
 }
 return <section className="desk-file-browser" aria-label={t("工位文件目录")}>
  <div className="desk-tree-toolbar">{filterControl}<label className="desk-tree-search"><Search size={14}/><input aria-label={t("搜索工位文件")} value={query} onChange={e=>setQuery(e.target.value)} placeholder={t("搜索文件或文件夹…")}/></label><button type="button" className="preview-icon-button" title={t("收起全部目录")} aria-label={t("收起全部目录")} onClick={collapse}><ChevronsDownUp size={15}/></button></div>
  <div className="desk-tree-selection"><label><input type="checkbox" aria-label={t("选择当前结果中的可清理文件")} disabled={busy||!eligible.length} checked={eligible.length>0&&chosen===eligible.length} onChange={e=>onSelection(eligible,e.target.checked)}/>{query.trim()?t("全选搜索结果"):t("全选可清理文件")}</label>{selected.size>0&&<button type="button" onClick={onClearSelection} disabled={busy}>{t("清除选择")}</button>}<span title={t("运行中的会话、配置文件、已标记保留和明确被其他会话引用的文件均排除在清理之外。")}><Info size={12}/>{t("保护项不会被清理")}</span></div>
  <div className="desk-file-tree" role="tree" aria-label={t("工位文件树")} ref={container} onKeyDown={event=>{
   if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;const target=(event.target as HTMLElement).closest<HTMLElement>('[data-tree-row]');if(!target)return;event.preventDefault();const rows=[...container.current!.querySelectorAll<HTMLElement>('[data-tree-row]')],index=rows.indexOf(target),next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowUp'?-1:1)));rows[next]?.focus();
  }}>{matches.map(({group,node})=>renderNode(group,node,1))}{!matches.length&&<p className="desk-tree-empty">{query.trim()?t("没有匹配的文件"):t("暂无符合条件的文件")}</p>}</div>
  {actions.menu}
 </section>;
}

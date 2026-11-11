import {t} from './i18n';
import {useContext,useEffect,useRef,useState} from 'react';
import {ExternalLink,FolderOpen,Pencil,Save,RefreshCw,Eye} from 'lucide-react';
import {useFilePreview,dirtyTab,type PreviewTab} from './preview-context';
import {FilePreviewBody} from './file-preview';
import {createPortal} from 'react-dom';
import {PreviewDocumentToolbar,PreviewDocumentStatus} from './workspace-toolbar';
import {PreviewZoom} from './preview-zoom';
import type {WorkspaceText} from '../shared/workspace-files';
import './workspace-tools.css';
function relativeFile(tab:PreviewTab){const file=tab.file;if(!file.resource)return file.path??'';return (file.path??'').replaceAll('\\','/').split('/').slice(0,-1).concat(file.resource.replaceAll('\\','/')).join('/');}
export function WorkspaceDocument({tab}:{tab:PreviewTab}){
 const toolbarTarget=useContext(PreviewDocumentToolbar);
 const statusTarget=useContext(PreviewDocumentStatus),zoom=useContext(PreviewZoom)?.scale??1;
 const panel=useFilePreview()!,[editing,setEditing]=useState(dirtyTab(tab)),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),[position,setPosition]=useState({line:1,col:1}),text=useRef<HTMLTextAreaElement>(null);
 const relative=relativeFile(tab),ref={rootId:tab.file.id,path:relative},draft=tab.draft,editable=!!draft;
 useEffect(()=>{let current=true;setLoaded(false);if(tab.draft){setLoaded(true);return;}void tab.invoke<WorkspaceText>('explorer.read',ref,undefined,{background:true}).then(value=>{if(current){const content=value.content.replace(/\r\n/g,'\n');panel.draft(tab.key,{...value,content,base:content});}}).catch(()=>{}).finally(()=>{if(current)setLoaded(true);});return()=>{current=false;};},[tab.key,revision,panel.draft]);
 async function save(){if(!draft||busy||!dirtyTab(tab))return;setBusy(true);setError('');const submitted=draft.content;try{const value=await tab.invoke<WorkspaceText>('explorer.save',{...ref,content:submitted,version:draft.version},undefined,{background:true});panel.draft(tab.key,latest=>({...value,base:value.content,content:latest?.content??value.content}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function reload(){if(dirtyTab(tab)&&!window.confirm(t("重新载入会放弃此文件尚未保存的修改，确定继续吗？")))return;panel.draft(tab.key,undefined);setEditing(false);setError('');setRevision(n=>n+1);}
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void save();}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[draft,busy]);
 const action=(method:string)=>void tab.invoke(method,ref,undefined,{background:true}).catch(e=>setError((e as Error).message));
 function caret(){const n=text.current;if(!n)return;const before=n.value.slice(0,n.selectionStart),lines=before.split('\n');setPosition({line:lines.length,col:lines.at(-1)!.length+1});}
 const tools=<div className="workspace-document-tools">{!toolbarTarget&&<span title={relative}>{relative}</span>}{editable&&<><button type="button" className="preview-icon-button" aria-label={editing?t("预览"):t("编辑")} title={editing?t("返回预览"):t("编辑文件")} onClick={()=>setEditing(v=>!v)}>{editing?<Eye size={14}/>:<Pencil size={14}/>}</button>{(editing||dirtyTab(tab))&&<button type="button" className="preview-icon-button" aria-label={t("保存工作区文件")} title={busy?t("保存中…"):t("保存 · Ctrl+S")} disabled={busy||!dirtyTab(tab)} onClick={()=>void save()}><Save size={14}/></button>}</>}
 <button type="button" className="preview-icon-button" aria-label={t("重新载入工作区文件")} title={t("重新载入")} onClick={reload}><RefreshCw size={14}/></button><button type="button" className="preview-icon-button" aria-label={t("在资源管理器中打开")} title={t("在资源管理器中打开")} onClick={()=>action('explorer.reveal')}><FolderOpen size={14}/></button><button type="button" className="preview-icon-button" aria-label={t("用默认应用打开文件")} title={t("用默认应用打开")} onClick={()=>action('explorer.open')}><ExternalLink size={14}/></button></div>;
 return <div className="workspace-document">{toolbarTarget?createPortal(tools,toolbarTarget):tools}
 {error&&<p className="preview-error" role="alert">{error}</p>}
 {editing&&draft?<div className="workspace-code-editor"><textarea ref={text} style={{fontSize:13*zoom}} aria-label={t("编辑 {0}", draft.name)} value={draft.content} spellCheck={false} onSelect={caret} onChange={e=>{panel.draft(tab.key,{...draft,content:e.target.value});caret();}} onKeyDown={e=>{if(e.key==='Tab'){e.preventDefault();const node=e.currentTarget,start=node.selectionStart,end=node.selectionEnd;const value=node.value.slice(0,start)+'  '+node.value.slice(end);panel.draft(tab.key,{...draft,content:value});requestAnimationFrame(()=>{node.setSelectionRange(start+2,start+2);caret();});}}}/></div>:<FilePreviewBody key={draft?.version+':'+revision} file={tab.file} invoke={tab.invoke}/>}
 {statusTarget?createPortal(<><span>{editing?t("行 {0}，列 {1} · ", position.line, position.col):''}{draft?.encoding.toUpperCase()??(loaded?t("使用默认应用编辑"):t("读取中…"))}</span><span>{dirtyTab(tab)?t("● 未保存"):t("已保存")}{editable?' · Ctrl+S':''}</span></>,statusTarget):<div className="workspace-file-status"><span>{editing?t("行 {0}，列 {1} · ", position.line, position.col):''}{draft?.encoding.toUpperCase()??(loaded?t("使用默认应用编辑"):t("读取中…"))}</span><span>{dirtyTab(tab)?t("● 未保存"):t("已保存")}{editable?' · Ctrl+S':''}</span></div>}</div>;
}

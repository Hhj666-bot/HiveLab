import {t as tr} from './i18n';
import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import type {FileReference} from '../shared/file-preview';
import type {WorkspaceDraft} from '../shared/workspace-files';
import type {Invoke} from './ui';

export type PreviewTab={key:string;file:FileReference;invoke:Invoke;draft?:WorkspaceDraft};
export const dirtyTab=(tab:PreviewTab)=>!!tab.draft&&tab.draft.content!==tab.draft.base;
const fileKey=(file:FileReference)=>JSON.stringify([file.source,file.id,file.path??'',file.name??'',file.resource??'']);
export const previewFileName=(file:FileReference)=>file.resource?.replaceAll('\\','/').split('/').at(-1)??file.name??tr("文件");
type PreviewState={tabs:PreviewTab[];active:string;shown:boolean;open:(file:FileReference,invoke:Invoke)=>void;select:(key:string)=>void;close:(key:string)=>void;toggle:()=>void;hide:()=>void;draft:(key:string,next:WorkspaceDraft|undefined|((previous:WorkspaceDraft|undefined)=>WorkspaceDraft|undefined))=>void;move:(rootId:string,from:string,to:string)=>void;forget:(rootId:string,path:string)=>void};
const Context=createContext<PreviewState|undefined>(undefined);
export const useFilePreview=()=>useContext(Context);
/** Messages only ever open files, so they do not depend on the panel's state: opening it must not re-render a history. */
const OpenContext=createContext<PreviewState['open']|undefined>(undefined);
export const useOpenFilePreview=()=>useContext(OpenContext);

export function FilePreviewProvider({children}:{children:ReactNode}){
 const [state,setState]=useState<{tabs:PreviewTab[];active:string;shown:boolean}>({tabs:[],active:'',shown:false});
 const open=useCallback((file:FileReference,invoke:Invoke)=>{
  const key=fileKey(file);
  setState(old=>({tabs:old.tabs.some(tab=>tab.key===key)?old.tabs.map(tab=>tab.key===key?{...tab,file:{...file},invoke}:tab):[...old.tabs,{key,file:{...file},invoke}],active:key,shown:true}));
 },[]);
 const select=useCallback((active:string)=>setState(old=>({...old,active,shown:true})),[]);
 const close=useCallback((key:string)=>{const tab=state.tabs.find(t=>t.key===key);if(tab&&dirtyTab(tab)&&!window.confirm(tr("此文件有未保存的修改，确定放弃修改并关闭吗？")))return;setState(old=>{const index=old.tabs.findIndex(tab=>tab.key===key),tabs=old.tabs.filter(tab=>tab.key!==key);return {...old,tabs,shown:tabs.length>0&&old.shown,active:old.active===key?(tabs[Math.min(index,tabs.length-1)]?.key??''):old.active};});},[state.tabs]);
 const draft=useCallback((key:string,next:WorkspaceDraft|undefined|((previous:WorkspaceDraft|undefined)=>WorkspaceDraft|undefined))=>setState(old=>({...old,tabs:old.tabs.map(tab=>tab.key===key?{...tab,draft:typeof next==='function'?next(tab.draft):next}:tab)})),[]);
 const move=useCallback((rootId:string,from:string,to:string)=>setState(old=>{let active=old.active;const tabs=old.tabs.map(tab=>{const p=tab.file.path??'';if(tab.file.source!=='explorer'||tab.file.id!==rootId||p!==from&&!p.startsWith(from+'/'))return tab;const file={...tab.file,path:to+p.slice(from.length),name:(to+p.slice(from.length)).split('/').at(-1)},key=fileKey(file);if(active===tab.key)active=key;return {...tab,key,file};});return {...old,tabs,active};}),[]);
 const forget=useCallback((rootId:string,path:string)=>setState(old=>{const tabs=old.tabs.filter(tab=>tab.file.source!=='explorer'||tab.file.id!==rootId||tab.file.path!==path&&!tab.file.path?.startsWith(path+'/'));return {...old,tabs,active:tabs.some(t=>t.key===old.active)?old.active:tabs.at(-1)?.key??'',shown:old.shown&&tabs.length>0};}),[]);
 const count=state.tabs.filter(dirtyTab).length;
 useEffect(()=>{void window.hivelab?.invoke('explorer.dirty',{count}).catch(()=>{});const before=(event:BeforeUnloadEvent)=>{if(count){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[count]);
 const hide=useCallback(()=>setState(old=>({...old,shown:false})),[]);
 const toggle=useCallback(()=>setState(old=>({...old,shown:!old.shown})),[]);
 return <OpenContext.Provider value={open}><Context.Provider value={{...state,open,select,close,hide,toggle,draft,move,forget}}>{children}</Context.Provider></OpenContext.Provider>;
}

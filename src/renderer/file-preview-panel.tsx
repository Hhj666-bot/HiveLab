import {t} from './i18n';
import {useContext,useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {FileText,PanelRightClose,PanelRightOpen,Maximize2,Minimize2,X,FolderOpen,Palette} from 'lucide-react';
import {useFilePreview,previewFileName} from './preview-context';
import {FilePreviewBody} from './file-preview';
import {ErrorBoundary} from './ErrorBoundary';
import {useDrawer} from './app/use-drawer';
import {WorkspaceDocument} from './workspace-document';
import {dirtyTab} from './preview-context';
import {SharedWallpaper} from './wallpaper-context';
import {WorkspaceToolbar,WorkspaceToolbarLeading,WorkspaceToolbarPrimary,WorkspaceToolbarSecondary,WorkspaceSearchPanel,WorkspaceSummaryControl,WorkspaceDrawer,PreviewDocumentToolbar} from './workspace-toolbar';
import './file-preview-panel.css';
import {WorkspaceMenu} from './workspace-menu';
import {requestAppearance} from './appearance-preferences';
import {PreviewZoom,PreviewZoomControls} from './preview-zoom';
import {PreviewDocumentStatus} from './workspace-toolbar';
import {BrowserSidebar} from './browser-sidebar';
import {SubagentSidebar} from './subagent-panel';
import {DEFAULT_BACKGROUND} from '../shared/background';

function savedWidth(){try{const value=Number(localStorage.getItem('hivelab.file-preview.width'));return value>=280&&value<=1200?value:434;}catch{return 434;}}
export function FilePreviewWorkspace({children,tools,fileTools,search,notifications,title,terminal,headerTransparency=DEFAULT_BACKGROUND.headerTransparency!,previewTransparency=DEFAULT_BACKGROUND.previewTransparency!,terminalTransparency=DEFAULT_BACKGROUND.terminalTransparency!}:{children:ReactNode;tools?:ReactNode;fileTools?:ReactNode;search?:ReactNode;notifications?:ReactNode;title?:string;terminal?:ReactNode;headerTransparency?:number;previewTransparency?:number;terminalTransparency?:number}){
 const [toolbarTarget,setToolbarTarget]=useState<HTMLButtonElement|null>(null);
 const [toolbarLeading,setToolbarLeading]=useState<HTMLDivElement|null>(null);
 const [primaryTarget,setPrimaryTarget]=useState<HTMLDivElement|null>(null);
 const [documentTarget,setDocumentTarget]=useState<HTMLDivElement|null>(null);
 const [secondaryTarget,setSecondaryTarget]=useState<HTMLDivElement|null>(null);
 const [summaryTarget,setSummaryTarget]=useState<HTMLDivElement|null>(null),[drawer,setDrawer]=useState<'search'|'summary'>();
 const [searchPanelTarget,setSearchPanelTarget]=useState<HTMLDivElement|null>(null);
 const [statusTarget,setStatusTarget]=useState<HTMLDivElement|null>(null),[zooms,setZooms]=useState<Record<string,number>>({});
 const headerOpacity=(100-Math.max(0,Math.min(100,headerTransparency)))+'%';
 // Body portals (dialogs and context menus) share the active toolbar's value.
 useLayoutEffect(()=>{
  document.documentElement.style.setProperty('--workspace-header-opacity',headerOpacity);
  return()=>{document.documentElement.style.removeProperty('--workspace-header-opacity');};
 },[headerOpacity]);
 const unifiedHeader=useContext(SharedWallpaper);
 const panel=useFilePreview()!,shell=useRef<HTMLDivElement>(null),drag=useRef<{x:number;width:number}|undefined>(undefined),[preferred,setPreferred]=useState(savedWidth),[available,setAvailable]=useState(1200),[maximized,setMaximized]=useState(false);
 useLayoutEffect(()=>{const element=shell.current!;const measure=()=>setAvailable(element.clientWidth);const observer=new ResizeObserver(measure);observer.observe(element);measure();return()=>observer.disconnect();},[]);
 useEffect(()=>{try{localStorage.setItem('hivelab.file-preview.width',String(preferred));}catch{}},[preferred]);
 useLayoutEffect(()=>{
  const element=shell.current;if(!element||!unifiedHeader)return;
  let frame=0,header:HTMLElement|null=null;
  const observed=new Set<Element>();
  const resize=new ResizeObserver(()=>schedule());
  function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
  function measure(){
   frame=0;
   const conversation=element!.querySelector('.preview-conversation');
   const nextHeader=conversation?.querySelector<HTMLElement>('.room-top,.standee-home-header')??null;
   if(header!==nextHeader){header?.removeAttribute('data-workspace-unified-header');header=nextHeader;header?.setAttribute('data-workspace-unified-header','');}
   const toolbar=element!.querySelector<HTMLElement>('.preview-workspace-bar');
   const sections=[toolbar,conversation?.querySelector('.page-background-toolbar'),header].filter((node):node is Element=>!!node);
   const next=new Set<Element>([element!,...sections]);
   for(const node of observed)if(!next.has(node)){resize.unobserve(node);observed.delete(node);}
   for(const node of next)if(!observed.has(node)){resize.observe(node);observed.add(node);}
   const top=element!.getBoundingClientRect().top;
   const height=Math.max(0,...sections.filter(node=>node.getClientRects().length).map(node=>node.getBoundingClientRect().bottom-top));
   const toolbarHeight=Math.ceil(Math.max(0,(toolbar?.getBoundingClientRect().bottom??top)-top))+'px';if(element!.style.getPropertyValue('--workspace-toolbar-height')!==toolbarHeight)element!.style.setProperty('--workspace-toolbar-height',toolbarHeight);
   const value=Math.ceil(height)+'px';if(element!.style.getPropertyValue('--workspace-header-height')!==value)element!.style.setProperty('--workspace-header-height',value);
  }
  const changes=new MutationObserver(schedule);
  changes.observe(element,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
  measure();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();changes.disconnect();header?.removeAttribute('data-workspace-unified-header');element.style.removeProperty('--workspace-header-height');element.style.removeProperty('--workspace-toolbar-height');};
 },[unifiedHeader]);
 useLayoutEffect(()=>{
  const element=shell.current!;let frame=0;
  const measure=()=>{frame=0;const bar=element.querySelector('.preview-workspace-bar'),search=element.querySelector('.conversation-search>form'),summary=element.querySelector('.workspace-summary-slot'),bounds=element.getBoundingClientRect();if(!bar)return;const anchor=(search??element.querySelector('.preview-workspace-controls'))!.getBoundingClientRect(),summaryRect=summary?.firstElementChild?.getBoundingClientRect(),top=Math.max(bar.getBoundingClientRect().bottom,summaryRect?.bottom??0)-bounds.top+8;for(const [key,value] of Object.entries({'--workspace-drawer-width':anchor.width+'px','--workspace-drawer-right':Math.max(0,bounds.right-anchor.right)+'px','--workspace-drawer-top':top+'px','--workspace-notice-top':top+'px'}))if(element.style.getPropertyValue(key)!==value)element.style.setProperty(key,value);};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);},resize=new ResizeObserver(schedule),changes=new MutationObserver(schedule);
  for(const node of [element,element.querySelector('.preview-workspace-bar'),element.querySelector('.conversation-search'),summaryTarget])if(node)resize.observe(node);
  changes.observe(element,{childList:true,subtree:true});measure();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();changes.disconnect();};
 },[summaryTarget,searchPanelTarget,!!search]);
 const drawerMounted=useDrawer(panel.shown,'x',()=>({panel:shell.current?.querySelector<HTMLElement>('.file-preview-panel')??null,workspace:shell.current}));
 const width=Math.min(preferred,Math.max(280,available-300)),maxWidth=Math.max(280,Math.min(1200,available-300)),active=panel.tabs.find(tab=>tab.key===panel.active);
 useEffect(()=>{shell.current?.querySelector('.preview-tab.selected')?.scrollIntoView({block:'nearest',inline:'nearest'});},[panel.active,panel.tabs.length,panel.shown]);
 const resize=(value:number)=>setPreferred(Math.round(Math.max(280,Math.min(maxWidth,value))));
 const scale=zooms[panel.active]??1,setScale=(next:number|((value:number)=>number))=>setZooms(values=>({...values,[panel.active]:Math.max(.5,Math.min(4,typeof next==='function'?next(values[panel.active]??1):next))}));
 useEffect(()=>{const keys=new Set(panel.tabs.map(tab=>tab.key));setZooms(values=>{const entries=Object.entries(values).filter(([key])=>keys.has(key));return entries.length===Object.keys(values).length?values:Object.fromEntries(entries);});},[panel.tabs]);
 return <WorkspaceToolbarPrimary.Provider value={primaryTarget}><WorkspaceToolbar.Provider value={toolbarTarget}><WorkspaceToolbarLeading.Provider value={toolbarLeading}><WorkspaceToolbarSecondary.Provider value={secondaryTarget}><PreviewDocumentToolbar.Provider value={documentTarget}><WorkspaceSearchPanel.Provider value={searchPanelTarget}><WorkspaceSummaryControl.Provider value={summaryTarget}><WorkspaceDrawer.Provider value={{active:drawer,setActive:setDrawer}}><div ref={shell} className={'file-preview-workspace'+(unifiedHeader?' workspace-unified-header':'')+(panel.shown?' preview-is-open':'')+(maximized?' preview-is-maximized':'')} style={{'--file-preview-width':width+'px','--workspace-header-opacity':headerOpacity,'--workspace-preview-opacity':(100-Math.max(0,Math.min(100,previewTransparency)))+'%','--workspace-terminal-opacity':(100-Math.max(0,Math.min(100,terminalTransparency)))+'%'} as CSSProperties}>
  {unifiedHeader&&<div className="workspace-header-surface" aria-hidden="true"/>}
  <div className="preview-workspace-bar"><div className="workspace-toolbar-glass" aria-hidden="true"/><div className="preview-workspace-leading-tools">{title&&<strong className="workspace-page-title">{title}</strong>}<div className="workspace-page-leading" ref={setToolbarLeading}/></div><div className="preview-workspace-controls"><nav className="preview-workspace-primary" aria-label={t("工作区工具")}><div className="workspace-primary-page-tools" ref={setPrimaryTarget}/>
   <div className="workspace-icon-actions" role="group" aria-label={t("工作区快捷操作")}><button type="button" className={'button quiet small preview-toggle'+(panel.tabs.length?' has-files':'')} aria-label={panel.shown?t("收起文件预览"):t("打开文件预览")} title={panel.tabs.length?t("文件预览 · 有已打开的文件"):t("文件预览")} aria-expanded={panel.shown} onClick={panel.toggle}>{panel.shown?<PanelRightClose size={15}/>:<PanelRightOpen size={15}/>}</button>{tools}
   <WorkspaceMenu compact label={t("文件")} icon={<FolderOpen size={15}/>}>{fileTools}<div className="workspace-file-page-actions" ref={setSecondaryTarget}/></WorkspaceMenu>
   <button type="button" ref={setToolbarTarget} className="button quiet small" aria-label={t("外观")} title={t("外观设置")} onClick={requestAppearance}><Palette size={15}/></button></div>
  </nav>{search}<div className="workspace-summary-slot" ref={setSummaryTarget}/></div></div>
  <div className="workspace-search-slot" ref={setSearchPanelTarget}/>
  {notifications&&<div className="workspace-notice-slot">{notifications}</div>}
  <div className="preview-workspace-body"><div className="preview-conversation">{children}</div>
  <SubagentSidebar/>
  {drawerMounted&&<><div className="preview-panel-resizer" role="separator" aria-label={t("文件预览宽度")} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={280} aria-valuemax={maxWidth} tabIndex={0}
   onDoubleClick={()=>resize(available*.5)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();resize(width+(event.key==='ArrowLeft'?24:-24));}}}
   onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,width};}}
   onPointerMove={event=>{if(drag.current)resize(drag.current.width+drag.current.x-event.clientX);}}
   onPointerUp={event=>{drag.current=undefined;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{drag.current=undefined;}} onLostPointerCapture={()=>{drag.current=undefined;}}/>
  <aside className="file-preview-panel" aria-label={t("文件预览侧栏")}><header className="preview-panel-header">
   {!panel.tabs.length&&<strong>{t("文件预览")}</strong>}
   {!!panel.tabs.length&&<div className="preview-tabs" onWheel={event=>{if(Math.abs(event.deltaY)>Math.abs(event.deltaX))event.currentTarget.scrollLeft+=event.deltaY;}} role="tablist" aria-label={t("已打开的文件")}>{panel.tabs.map((tab,index)=><div className={'preview-tab'+(dirtyTab(tab)?' unsaved':'')+(tab.key===panel.active?' selected':'')} key={tab.key}><button type="button" className="glass-content-action" role="tab" id={'preview-tab-'+index} aria-selected={tab.key===panel.active} aria-controls="file-preview-tab-content" tabIndex={tab.key===panel.active?0:-1} title={tab.file.path??tab.file.name} onClick={()=>panel.select(tab.key)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const next=(index+(event.key==='ArrowLeft'?-1:1)+panel.tabs.length)%panel.tabs.length;panel.select(panel.tabs[next].key);document.getElementById('preview-tab-'+next)?.focus();}}}>{previewFileName(tab.file)}</button><button type="button" className="preview-tab-close glass-content-action" aria-label={t("关闭文件 {0}", (previewFileName(tab.file)))} onClick={()=>panel.close(tab.key)}><X size={12}/></button></div>)}</div>}
   <div className="preview-document-actions" ref={setDocumentTarget}/>
   <div className="preview-panel-controls"><button type="button" className="preview-icon-button" aria-label={maximized?t("还原预览分栏"):t("最大化文件预览")} title={maximized?t("还原分栏"):t("最大化预览")} onClick={()=>setMaximized(v=>!v)}>{maximized?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button><button type="button" className="preview-icon-button" aria-label={t("收起预览侧栏")} title={t("收起预览，保留标签")} onClick={panel.hide}><PanelRightClose size={16}/></button></div>
   </header>
   {active?<PreviewDocumentStatus.Provider value={statusTarget}><PreviewZoom.Provider value={{scale,setScale}}><div className="preview-tab-content" id="file-preview-tab-content" role="tabpanel" aria-label={previewFileName(active.file)}><ErrorBoundary area={t("文件预览")} resetKey={active.key}>{active.file.source==='explorer'?<WorkspaceDocument key={active.key} tab={active}/>:<FilePreviewBody key={active.key} file={active.file} invoke={active.invoke}/>}</ErrorBoundary></div><footer className="preview-panel-footer"><PreviewZoomControls scale={scale} setScale={setScale}/><div className="preview-document-status" ref={setStatusTarget}/></footer></PreviewZoom.Provider></PreviewDocumentStatus.Provider>:<div className="preview-empty"><FileText size={32}/><strong>{t("在这里查看文件")}</strong><p>{t("从左侧文件树或聊天中的文件卡片打开。")}</p><small>{t("HTML · Word · Excel · PDF · 图片 · 音视频 · Markdown · 代码")}</small></div>}
  </aside></>}
  <BrowserSidebar/>
  </div>
  {terminal}
 </div></WorkspaceDrawer.Provider></WorkspaceSummaryControl.Provider></WorkspaceSearchPanel.Provider></PreviewDocumentToolbar.Provider></WorkspaceToolbarSecondary.Provider></WorkspaceToolbarLeading.Provider></WorkspaceToolbar.Provider></WorkspaceToolbarPrimary.Provider>;
}

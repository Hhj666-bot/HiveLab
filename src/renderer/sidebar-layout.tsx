import {t} from './i18n';
import {useEffect,useRef,type ReactNode,type CSSProperties} from 'react';
import {ChevronRight} from 'lucide-react';
import {SharedWallpaper} from './wallpaper-context';
import {useAppearancePreferences} from './appearance-preferences';
import {useSidebarSpring} from './sidebar-spring';
import './sidebar-layout.css';

export function SidebarLayout({children,wallpaper,transparency=0}:{children:ReactNode;wallpaper?:ReactNode;transparency?:number}){
 const saved=useAppearancePreferences(),p=saved.sidebar,shell=useRef<HTMLDivElement>(null),drag=useRef<{pointer:number;x:number;width:number}|undefined>(undefined);
 const update=saved.setSidebar,shown=useSidebarSpring(p.mode,p.width,shell);
 useEffect(()=>{const expand=()=>update({mode:'expanded'});window.addEventListener('hivelab:sidebar-expand',expand);return()=>window.removeEventListener('hivelab:sidebar-expand',expand);},[update]);
 // 旧版本按页面保存的侧栏透明度：全局值还没写过时，把第一份非 0 的旧值固化为全局值，之后所有页面共用（只发生一次）。
 useEffect(()=>{saved.adoptLegacyTransparency(transparency);},[transparency]);
 return <SharedWallpaper.Provider value={!!wallpaper}><div ref={shell} className={'app-shell side-hidden sidebar-'+shown+(wallpaper?' wallpaper-shared':'')} style={{'--sidebar-width':p.width+'px','--sidebar-opacity':(100-(saved.transparency??transparency))+'%'} as CSSProperties}>
  {wallpaper}{children}
  <div className="sidebar-edge-controls">
   <button type="button" className="sidebar-edge-toggle glass-content-action" aria-expanded={p.mode==='expanded'} aria-label={p.mode==='expanded'?t("收起侧栏"):t("展开侧栏")} title={p.mode==='expanded'?t("收起侧栏"):t("展开侧栏")} onClick={()=>update({mode:p.mode==='expanded'?'icons':'expanded'})}><ChevronRight size={14}/></button>
  </div>
  {p.mode==='expanded'&&<div className="sidebar-resizer" role="separator" aria-label={t("侧栏宽度")} aria-orientation="vertical" aria-valuenow={p.width} aria-valuemin={220} aria-valuemax={420} tabIndex={0}
   onDoubleClick={()=>update({width:268})} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();update({width:Math.max(220,Math.min(420,p.width+(e.key==='ArrowLeft'?-10:10)))});}}}
   onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={pointer:e.pointerId,x:e.clientX,width:(shell.current?.querySelector('aside')?.getBoundingClientRect().width??(p.width+16))-16};}}
   onPointerMove={e=>{const d=drag.current;if(d?.pointer===e.pointerId)update({width:Math.max(220,Math.min(420,d.width+e.clientX-d.x))});}}
   onPointerUp={e=>{drag.current=undefined;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onLostPointerCapture={()=>{drag.current=undefined;}} onPointerCancel={()=>{drag.current=undefined;}}/>}
 </div></SharedWallpaper.Provider>;
}

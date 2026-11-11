import {t} from './i18n';
import {useEffect,useRef,type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';

export function WorkspaceMenu({label,icon,children,contentRef,compact=false,closeOnAction=true}:{label:string;icon:ReactNode;children?:ReactNode;contentRef?:(node:HTMLDivElement|null)=>void;compact?:boolean;closeOnAction?:boolean}){
 const menu=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(menu.current?.open&&!menu.current.contains(event.target as Node))menu.current.open=false;};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&menu.current?.open){menu.current.open=false;menu.current.querySelector('summary')?.focus();event.stopPropagation();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
 },[]);
 return <details className={'workspace-menu'+(compact?' workspace-menu-compact':'')} ref={menu}>
  <summary role="button" aria-label={label} title={label} className={compact?'preview-icon-button':'button quiet small'}>{icon}{!compact&&<><span>{label}</span><ChevronDown size={12}/></>}</summary>
  <div className="workspace-menu-content" aria-label={t("{0}选项", label)} ref={contentRef} onClick={event=>{if(closeOnAction&&(event.target as HTMLElement).closest('button')&&menu.current)menu.current.open=false;}}>{children}</div>
 </details>;
}

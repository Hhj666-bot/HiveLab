import {t} from './i18n';
import {Children,isValidElement,createContext,useContext,useState,type MouseEvent,type ReactNode} from 'react';
import {FileText} from 'lucide-react';
import {externalWebUrl} from '../shared/web-links';
import {FilePreview} from './file-preview';
import {localFileLink} from '../shared/file-links';

function labelText(children:ReactNode):string{return Children.toArray(children).map(child=>typeof child==='string'||typeof child==='number'?String(child):isValidElement<{children?:ReactNode}>(child)?labelText(child.props.children):'').join('');}

export const FileSession=createContext<string|undefined>(undefined);

/** Web links open the browser sidebar; local files keep the scoped read-only preview. */
export function MarkdownLink({href,children}:{href:string;children:ReactNode}){
  const sessionId=useContext(FileSession),[open,setOpen]=useState(false),[error,setError]=useState('');
  const webUrl=externalWebUrl(href);
  async function openWeb(event:MouseEvent<HTMLAnchorElement>){
    event.preventDefault();setError('');
    try{await window.hivelab.invoke('browser.open',{url:webUrl});}
    catch(error){setError((error as Error).message);}
  }
  if(webUrl)return <><a className="md-link" href={webUrl} title={webUrl} onClick={event=>void openWeb(event)} onAuxClick={event=>{if(event.button===1)void openWeb(event);}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();void window.hivelab.invoke('link.menu',{url:webUrl}).catch(error=>setError(error.message));}}>{children}</a>{error&&<span className="md-link-error" role="alert">{t("链接未能打开：{0}", error)}</span>}</>;
  let target='';try{target=decodeURIComponent(href).replace(/#L\d+(?:-L\d+)?$/,'');}catch{}
  const managed=/^hivelab-file:\/\/([a-f0-9-]{36})$/i.exec(target);
  const local=sessionId?localFileLink(href):undefined;
  if(!managed&&!local)return <span className="md-link" title={href}>{children}</span>;
  const label=labelText(children),name=local?.split(/[\\/]/).at(-1)??label,type=/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toUpperCase();
  return <><button type="button" className="link-button md-file-link" aria-label={label||name} title={t("{0} · 在右侧预览文件", local??name)} onClick={()=>setOpen(true)}><FileText size={14} className="md-file-link-icon" aria-hidden="true"/><span className="md-file-link-label">{children}{name&&name!==label&&<span className="md-file-link-name">{name}</span>}</span>{type&&<span className="md-file-link-type" aria-hidden="true">{type}</span>}</button>{open&&<FilePreview file={managed?{source:'generated',id:managed[1],name}:{source:'workspace',id:sessionId!,path:local!,name}} invoke={window.hivelab.invoke} onClose={()=>setOpen(false)}/>}</>;
}

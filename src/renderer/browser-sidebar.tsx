import {t} from './i18n';
import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {useDrawer} from './app/use-drawer';
import {ArrowLeft,ArrowRight,RotateCw,Square,X,ExternalLink,Maximize2,Minimize2} from 'lucide-react';
import {externalWebUrl,type BrowserSidebarState,type BrowserViewport} from '../shared/web-links';
import {useFilePreview} from './preview-context';
import './browser-sidebar.css';

const EMPTY:BrowserSidebarState={shown:false,url:'',get title(){return t("网页浏览器")},loading:false,canGoBack:false,canGoForward:false};
const OVERLAYS='.modal-overlay,.context-menu,.model-popover,.select-popover,.workspace-menu[open],.answer-export-menu,.reaction-picker,.room-mentions,.workspace-glass-drawer,.member-notice-stack';
function savedWidth(){try{return Math.max(320,Math.min(1100,Number(localStorage.getItem('hivelab.browser.width'))||560));}catch{return 560;}}

export function BrowserSidebar(){
  const [state,setState]=useState(EMPTY),[address,setAddress]=useState(''),[width,setWidth]=useState(savedWidth),[maximized,setMaximized]=useState(false),[dragging,setDragging]=useState(false);
  const viewport=useRef<HTMLDivElement>(null),drag=useRef<{x:number;width:number}|undefined>(undefined),panel=useFilePreview();
  useEffect(()=>{
    const stop=window.hivelab.onEvent(event=>{if(event.type==='browser-state')setState(event.state);});
    void window.hivelab.invoke<BrowserSidebarState>('browser.state').then(next=>{if(next?.shown)setState(next);}).catch(()=>{});
    return stop;
  },[]);
  const mounted=useDrawer(state.shown,'x',()=>({panel:document.querySelector<HTMLElement>('.browser-sidebar'),workspace:document.querySelector<HTMLElement>('.file-preview-workspace')}));
  useEffect(()=>{setAddress(state.url);},[state.url]);
  useEffect(()=>{if(state.shown)panel?.hide();},[state.shown]);
  useEffect(()=>{if(panel?.shown&&state.shown)void window.hivelab.invoke('browser.hide');},[panel?.shown]);
  useEffect(()=>{try{localStorage.setItem('hivelab.browser.width',String(width));}catch{}},[width]);
  useLayoutEffect(()=>{
    const node=viewport.current;if(!state.shown||!node)return;
    let frame=0,last='';
    const measure=()=>{
      frame=0;const r=node.getBoundingClientRect();
      const covered=[...document.querySelectorAll<HTMLElement>(OVERLAYS)].some(overlay=>overlay.checkVisibility({visibilityProperty:true}));
      const bounds:BrowserViewport={x:r.x,y:r.y,width:r.width,height:r.height,visible:!dragging&&!panel?.shown&&r.width>0&&r.height>0&&!covered};
      const key=JSON.stringify(bounds);if(key===last)return;last=key;
      void window.hivelab.invoke('browser.bounds',bounds).catch(error=>setState(previous=>({...previous,error:error.message})));
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    const resize=new ResizeObserver(schedule);resize.observe(node);
    const changes=new MutationObserver(schedule);changes.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','open','hidden']});
    // The page is a native view, so it follows the sliding panel by being placed again every frame.
    window.addEventListener('resize',schedule);window.addEventListener('hivelab:panel-frame',schedule);measure();
    return()=>{cancelAnimationFrame(frame);resize.disconnect();changes.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('hivelab:panel-frame',schedule);void window.hivelab.invoke('browser.bounds',{x:0,y:0,width:0,height:0,visible:false}).catch(()=>{});};
  },[state.shown,dragging,panel?.shown]);
  async function action(method:string,params?:unknown){try{await window.hivelab.invoke(method,params);}catch(error){setState(previous=>({...previous,error:(error as Error).message}));}}
  function visit(){const url=externalWebUrl(address.includes('://')?address:'https://'+address);if(url)void action('browser.open',{url});else setState(previous=>({...previous,error:t("请输入有效的网页地址。")}));}
  if(!mounted)return null;
  return <>
    {!maximized&&<div className="browser-panel-resizer" role="separator" aria-label={t("浏览器侧栏宽度")} aria-orientation="vertical" aria-valuenow={width} tabIndex={0}
      onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setWidth(w=>Math.max(320,Math.min(1100,w+(event.key==='ArrowLeft'?24:-24))));}}}
      onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,width};setDragging(true);}}
      onPointerMove={event=>{if(drag.current)setWidth(Math.max(320,Math.min(1100,drag.current.width+drag.current.x-event.clientX)));}}
      onPointerUp={event=>{drag.current=undefined;setDragging(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
      onLostPointerCapture={()=>{drag.current=undefined;setDragging(false);}}/>}
    <aside className={'browser-sidebar'+(maximized?' browser-maximized':'')} aria-label={t("网页浏览器侧栏")} style={{'--browser-width':width+'px'} as CSSProperties}>
      <header className="browser-panel-heading"><strong title={state.title}>{state.title}</strong><button type="button" className="preview-icon-button" aria-label={maximized?t("还原网页分栏"):t("最大化网页")} onClick={()=>setMaximized(value=>!value)}>{maximized?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button><button type="button" className="preview-icon-button" aria-label={t("关闭网页侧栏")} onClick={()=>void action('browser.hide')}><X size={16}/></button></header>
      <form className="browser-navigation" onSubmit={event=>{event.preventDefault();visit();}}>
        <button type="button" className="preview-icon-button" aria-label={t("网页后退")} disabled={!state.canGoBack} onClick={()=>void action('browser.back')}><ArrowLeft size={15}/></button>
        <button type="button" className="preview-icon-button" aria-label={t("网页前进")} disabled={!state.canGoForward} onClick={()=>void action('browser.forward')}><ArrowRight size={15}/></button>
        <button type="button" className="preview-icon-button" aria-label={state.loading?t("停止加载网页"):t("刷新网页")} onClick={()=>void action(state.loading?'browser.stop':'browser.reload')}>{state.loading?<Square size={14}/>:<RotateCw size={15}/>}</button>
        <input aria-label={t("网页地址")} value={address} spellCheck={false} onChange={event=>setAddress(event.target.value)}/>
        <button type="button" className="preview-icon-button" aria-label={t("选择其他浏览器打开")} title={t("Edge、Chrome 或其他浏览器")} onClick={()=>void action('link.menu',{url:state.url})}><ExternalLink size={15}/></button>
      </form>
      {state.error&&<p className="browser-error" role="alert">{state.error}</p>}
      <div className="browser-viewport" ref={viewport} aria-label={t("网页内容")}/>
    </aside>
  </>;
}

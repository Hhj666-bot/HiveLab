import {t} from './i18n';
import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,Bot,CheckCircle2,CircleSlash,LoaderCircle,Square,TriangleAlert} from 'lucide-react';
import {SUBAGENT_STATUS_LABEL,subagentActive,type SubagentEntry,type SubagentRecord} from '../shared/subagents';
import {useDrawer} from './app/use-drawer';
import {useOptionalAppStore} from './app/store-context';
import {Markdown} from './Markdown';
import type {Invoke} from './ui';
import './subagents.css';

type Selection={runId:string;id:string};
type PanelState={selected?:Selection;open:(runId:string,id:string,invoke:Invoke)=>void;close:()=>void;publish:(runId:string,records:SubagentRecord[])=>void};
const Context=createContext<PanelState|undefined>(undefined);
/** Cards open the panel; it is separate from the file preview and the browser. */
export const useSubagentPanel=()=>useContext(Context);
type Inner={selected?:Selection;invoke?:Invoke;published:Map<string,SubagentRecord[]>};
const InnerContext=createContext<Inner>({published:new Map()});

export function SubagentPanelProvider({children}:{children:ReactNode}){
  const [selected,setSelected]=useState<Selection>();const [invoke,setInvoke]=useState<{fn:Invoke}>();
  const [published,setPublished]=useState(()=>new Map<string,SubagentRecord[]>());
  const open=useCallback((runId:string,id:string,next:Invoke)=>{setSelected({runId,id});setInvoke({fn:next});},[]);
  const close=useCallback(()=>setSelected(undefined),[]);
  const publish=useCallback((runId:string,records:SubagentRecord[])=>setPublished(old=>old.get(runId)===records?old:new Map(old).set(runId,records)),[]);
  const state=useMemo(()=>({selected,open,close,publish}),[selected,open,close,publish]);
  const inner=useMemo(()=>({selected,invoke:invoke?.fn,published}),[selected,invoke,published]);
  return <Context.Provider value={state}><InnerContext.Provider value={inner}>{children}</InnerContext.Provider></Context.Provider>;
}

const ENTRY_LABEL:Record<SubagentEntry['kind'],string>={get text(){return t("回答")},get reasoning(){return t("思考")},get tool(){return t("操作")},get status(){return t("状态")},get warning(){return t("提醒")},get error(){return t("错误")}};
export function subagentElapsed(record:SubagentRecord,at:number){
  const ms=Math.max(0,(record.completedAt?Date.parse(record.completedAt):at)-Date.parse(record.createdAt)),s=Math.round(ms/1000);
  return s<60?t("{0} 秒", s):t("{0} 分 {1} 秒", Math.floor(s/60), s%60);
}
export function useNow(live:boolean){const [now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!live)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[live]);return now;}
export function SubagentStatusIcon({status}:{status:SubagentRecord['status']}){
  return subagentActive(status)?<LoaderCircle size={14} className="subagent-spin" aria-hidden="true"/>:status==='completed'?<CheckCircle2 size={14} aria-hidden="true"/>:status==='failed'?<TriangleAlert size={14} aria-hidden="true"/>:<CircleSlash size={14} aria-hidden="true"/>;
}
export const subagentConfig=(record:SubagentRecord)=>[record.model??t("默认模型"),record.effort].filter(Boolean).join(' · ');
const WIDTH_KEY='hivelab.subagent-panel.width',DEFAULT_WIDTH=420,MIN_WIDTH=300,MAX_WIDTH=960,CONVERSATION_MIN=320;
function savedWidth(){try{const value=Number(localStorage.getItem(WIDTH_KEY));return value>=MIN_WIDTH&&value<=MAX_WIDTH?value:DEFAULT_WIDTH;}catch{return DEFAULT_WIDTH;}}
/** The widest the panel may grow: the conversation keeps CONVERSATION_MIN beside any file preview or browser. */
function widthLimit(panel:HTMLElement|null){
  const body=panel?.parentElement;if(!body)return MAX_WIDTH;
  let others=0;for(const node of Array.from(body.children) as HTMLElement[])if(node!==panel&&!node.classList.contains('preview-conversation')&&node.getClientRects().length&&getComputedStyle(node).position!=='absolute')others+=node.getBoundingClientRect().width;
  return Math.max(MIN_WIDTH,Math.min(MAX_WIDTH,body.getBoundingClientRect().width-others-CONVERSATION_MIN));
}

/** The leftmost right-side panel: conversation | 子代理 | 文件预览 | 网页. It springs in with the shared drawer motion. */
export function SubagentSidebar(){
  const panelState=useContext(Context),{selected,invoke,published}=useContext(InnerContext);
  const live=useOptionalAppStore(state=>state.snapshot.subagents);
  const records=useMemo(()=>selected?(live?live.filter(r=>r.parentRunId===selected.runId):published.get(selected.runId))??[]:[],[selected,live,published]);
  const [last,setLast]=useState<{records:SubagentRecord[];id:string}>();
  useEffect(()=>{if(selected&&records.length)setLast({records,id:selected.id});},[selected,records]);
  const shown=!!selected&&records.some(r=>r.id===selected.id);
  const aside=useRef<HTMLElement>(null);
  const [width,setWidth]=useState(savedWidth),drag=useRef<{x:number;width:number}|undefined>(undefined),[dragging,setDragging]=useState(false);
  useEffect(()=>{try{localStorage.setItem(WIDTH_KEY,String(width));}catch{}},[width]);
  const resize=(value:number)=>setWidth(Math.round(Math.max(MIN_WIDTH,Math.min(widthLimit(aside.current),value))));
  // While closed or springing, the panel sits just left of any open file preview or browser.
  useLayoutEffect(()=>{
    const node=aside.current;if(!node)return;
    const body=node.parentElement;let next=node.nextElementSibling as HTMLElement|null;
    while(next&&!next.getClientRects().length)next=next.nextElementSibling as HTMLElement|null;
    const right=body&&next?Math.max(0,body.getBoundingClientRect().right-next.getBoundingClientRect().left):0;
    node.style.setProperty('--subagent-right',right+'px');
  });
  const mounted=useDrawer(shown,'x',()=>({panel:aside.current,workspace:aside.current?.closest<HTMLElement>('.file-preview-workspace')??null}));
  useEffect(()=>{
    if(!mounted)return;
    const frame=()=>{
      const node=aside.current;if(!node)return;
      if(node.dataset.drawerMoving!==undefined){
        // Sliding past its resting edge it must not show over the panels to its right.
        const hidden=parseFloat(node.style.translate)||0;node.style.clipPath=hidden>0?`inset(0 ${Math.min(100,hidden)}% 0 0)`:'';
      }else{
        // Another drawer is springing: travel with the conversation so the final layout is reached without a jump.
        const side=node.closest('.file-preview-workspace')?.querySelector<HTMLElement>('.preview-conversation');
        if(side?.style.translate)node.style.translate=side.style.translate;else node.style.removeProperty('translate');
      }
    };
    const landed=()=>{const node=aside.current;if(!node)return;node.style.removeProperty('clip-path');if(node.dataset.drawerMoving===undefined)node.style.removeProperty('translate');};
    window.addEventListener('hivelab:panel-frame',frame);window.addEventListener('hivelab:page-turned',landed);
    return()=>{window.removeEventListener('hivelab:panel-frame',frame);window.removeEventListener('hivelab:page-turned',landed);};
  },[mounted]);
  const shownRecords=shown?records:last?.records??[];
  const current=shownRecords.find(r=>r.id===(shown?selected!.id:last?.id));
  const now=useNow(shownRecords.some(r=>subagentActive(r.status)));
  const [stopError,setStopError]=useState('');const [stopping,setStopping]=useState(false);
  useEffect(()=>{setStopError('');},[current?.id]);
  if(!mounted||!current)return null;
  const select=(id:string)=>{if(invoke&&selected)panelState?.open(selected.runId,id,invoke);};
  const stop=async()=>{if(!invoke)return;setStopping(true);setStopError('');try{await invoke('subagent.stop',{id:current.id});}catch(error){setStopError((error as Error).message);}finally{setStopping(false);}};
  const shownWidth=Math.min(width,widthLimit(aside.current));
  return <aside ref={aside} className="subagent-sidebar" aria-label={t("子代理侧栏")} data-resizing={dragging||undefined} style={{'--subagent-width':`${shownWidth}px`} as React.CSSProperties} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();panelState?.close();}}}>
    {/* Drag the left edge to resize; arrows step 24px, double-click restores the default width. */}
    <div className="subagent-resizer" role="separator" aria-label={t("子代理侧栏宽度")} aria-orientation="vertical" aria-valuenow={shownWidth} aria-valuemin={MIN_WIDTH} aria-valuemax={widthLimit(aside.current)} tabIndex={0} title={t("拖动调整宽度，双击恢复默认")}
      onDoubleClick={()=>resize(DEFAULT_WIDTH)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();resize(shownWidth+(event.key==='ArrowLeft'?24:-24));}}}
      onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,width:shownWidth};setDragging(true);}}
      onPointerMove={event=>{if(drag.current)resize(drag.current.width+drag.current.x-event.clientX);}}
      onPointerUp={event=>{drag.current=undefined;setDragging(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
      onPointerCancel={()=>{drag.current=undefined;setDragging(false);}} onLostPointerCapture={()=>{drag.current=undefined;setDragging(false);}}/>
    <header className="subagent-sidebar-heading">
      <button type="button" className="subagent-back" onClick={panelState?.close}><ArrowLeft size={15} aria-hidden="true"/>{t("返回主代理")}</button>
      <strong>{t("子代理")}</strong>
    </header>
    {shownRecords.length>1&&<div className="subagent-tabs" role="tablist" aria-label={t("本轮子代理")}>{shownRecords.map(r=><button key={r.id} type="button" role="tab" aria-selected={r.id===current.id} className={'subagent-tab '+r.status+(r.id===current.id?' selected':'')} onClick={()=>select(r.id)}><SubagentStatusIcon status={r.status}/>#{r.index} {r.title}</button>)}</div>}
    <div className="subagent-sidebar-title">
      <div><strong><Bot size={15} aria-hidden="true"/>{t("子代理 #{0}：{1}", current.index, current.title)}</strong>
        <span className={`subagent-state ${current.status}`}><SubagentStatusIcon status={current.status}/>{SUBAGENT_STATUS_LABEL[current.status]} · {subagentConfig(current)} · {current.write?t("可写入"):t("只读")} · {subagentElapsed(current,now)}</span></div>
      {subagentActive(current.status)&&<button type="button" className="subagent-stop" disabled={stopping||current.status==='stopping'} onClick={stop}><Square size={12} aria-hidden="true"/>{t("停止")}</button>}
    </div>
    {stopError&&<p className="subagent-panel-error" role="alert">{stopError}</p>}
    <div className="subagent-panel-body" role="tabpanel" aria-label={t("子代理 #{0} 详情", current.index)}>
      <section aria-label={t("主代理交给子代理的任务")}><h3>{t("任务")}</h3><pre className="subagent-task">{current.task}</pre></section>
      <section aria-label={t("子代理结果")}><h3>{t("结果")}</h3>{current.result?<div className="subagent-result"><Markdown text={current.result}/></div>:<p className="subagent-muted">{subagentActive(current.status)?t("完成后在这里显示最终回答，主代理也会收到同样的内容。"):current.error??t("没有返回回答。")}</p>}
        {current.result&&current.error&&current.status!=='completed'&&<p className="subagent-muted">{current.error}</p>}
        {!subagentActive(current.status)&&<p className="subagent-muted">{current.delivered?t("主代理已取回这个结果。"):t("主代理尚未取回这个结果。")}</p>}
      </section>
      <section aria-label={t("子代理过程")}><h3>{t("过程")}</h3>{current.entries.length?<ol className="subagent-log" role="log" aria-label={t("子代理操作记录")}>{current.entries.map((entry,index)=><li key={index} className={`subagent-entry ${entry.kind}`}><small>{ENTRY_LABEL[entry.kind]}</small><p>{entry.text}</p></li>)}</ol>:<p className="subagent-muted">{t("还没有活动记录。")}</p>}</section>
    </div>
  </aside>;
}

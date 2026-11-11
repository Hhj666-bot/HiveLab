import {t} from './i18n';
import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronRight,LoaderCircle,Minimize2} from 'lucide-react';
import type {MemberProfile,Session} from '../shared/types';
import {CONTEXT_PERCENTS,contextBudget,contextFloor,contextMinimum,contextRows,contextTokens,parseContextTokens,type ContextUsage} from '../shared/context-usage';
import type {Invoke} from './ui';
import './context-meter.css';

const PRESETS=[64_000,128_000,200_000,256_000,400_000,500_000,1_000_000];
const level=(percent:number)=>percent>=90?'danger':percent>=70?'warn':'ok';
const share=(tokens:number,total:number)=>total?`${(tokens/total*100).toFixed(1)}%`:'—';

/** The composer's context ring: how full this topic is against the user's own limit; opens the context panel. */
export function ContextMeter({session,member,usage,invoke,roomId,threadId,compressing}:{session:Session;member?:Pick<MemberProfile,'contextLimit'|'contextPercent'>;usage?:ContextUsage;invoke:Invoke;roomId:string;threadId?:string;compressing?:boolean}){
  const config={contextLimit:session.contextLimit??member?.contextLimit,contextPercent:session.contextPercent??member?.contextPercent};
  const budget=contextBudget(usage,config),used=usage?.used;
  const percent=used!==undefined&&budget.limit?Math.min(100,Math.round(used/budget.limit*100)):undefined;
  const [anchor,setAnchor]=useState<DOMRect>(),[leaving,setLeaving]=useState(false),timer=useRef<number|undefined>(undefined);
  // Closing fades out over --motion-fast before the panel leaves the page.
  const close=()=>{if(leaving)return;setLeaving(true);timer.current=window.setTimeout(()=>{setAnchor(undefined);setLeaving(false);},160);};
  useEffect(()=>()=>window.clearTimeout(timer.current),[]);
  const label=percent!==undefined?`${percent}%`:used!==undefined?contextTokens(used):'—';
  const title=used===undefined?t("上下文：还没有读数，发一条消息后显示"):t("上下文：已用 {0}{1}，点击查看详情", contextTokens(used), budget.limit?` / ${contextTokens(budget.limit)}（${percent}%）`:'');
  const r=7,length=2*Math.PI*r;
  return <>
    <button type="button" className="composer-context composer-config glass-action" data-level={percent!==undefined?level(percent):'none'} aria-label={t("上下文{0}，查看详情", percent!==undefined?t("已用 {0}%", percent):'')} aria-haspopup="dialog" aria-expanded={!!anchor} title={title}
      onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();if(anchor)close();else setAnchor(rect);}}>
      <svg className="context-ring" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r={r} className="context-ring-track"/><circle cx="9" cy="9" r={r} className="context-ring-fill" strokeDasharray={length} strokeDashoffset={length*(1-(percent??0)/100)}/></svg>
      <span className="context-label">{label}</span>
    </button>
    {anchor&&<ContextPanel anchor={anchor} session={session} usage={usage} config={config} invoke={invoke} roomId={roomId} threadId={threadId} compressing={compressing} leaving={leaving} onClose={close}/>}
  </>;
}

function ContextPanel({anchor,session,usage,config,invoke,roomId,threadId,compressing,leaving,onClose}:{anchor:DOMRect;session:Session;usage?:ContextUsage;config:{contextLimit?:number;contextPercent?:number};invoke:Invoke;roomId:string;threadId?:string;compressing?:boolean;leaving?:boolean;onClose:()=>void}){
  const node=useRef<HTMLDivElement>(null);
  const budget=contextBudget(usage,config),view=useMemo(()=>usage?contextRows(usage,config):undefined,[usage,config.contextLimit,config.contextPercent]);
  const total=budget.limit??usage?.used??0,percent=usage&&budget.limit?Math.round(usage.used/budget.limit*100):undefined;
  const [compactOpen,setCompactOpen]=useState(false),[focus,setFocus]=useState(''),[busy,setBusy]=useState<'compact'|'save'|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const [limitText,setLimitText]=useState(()=>budget.custom?contextTokens(budget.custom):''),[percentChoice,setPercentChoice]=useState<number>(budget.percent);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{const target=event.target as Element|null;if(!node.current?.contains(target as Node)&&!target?.closest?.('.composer-context'))onClose();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape);};
  },[onClose]);
  useEffect(()=>{node.current?.focus();},[]);
  // Stays inside the window when it is resized while open.
  const [,relayout]=useState(0);useEffect(()=>{const resize=()=>relayout(n=>n+1);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  const modelWindow=usage?.window,min=contextMinimum(session.provider);
  const presets=PRESETS.filter(value=>value>=min&&(!modelWindow||value<modelWindow));
  async function save(limit:number|null){
    setError('');setSaved(false);
    if(limit!==null&&modelWindow&&limit>modelWindow){setError(t("不能超过模型自带的上限 {0}", contextTokens(modelWindow)));return;}
    if(limit!==null&&limit<min){setError(t("上下文上限不能低于 {0}", contextTokens(min)));return;}
    const point=(limit??modelWindow??0)*percentChoice/100,floor=contextFloor(usage?.baseline);
    if(point&&point<floor){setError(t("压缩点太低：这个话题的固定部分约 {0}，压缩点至少要 {1}，否则会每轮都压缩", contextTokens(usage!.baseline), contextTokens(floor)));return;}
    setBusy('save');
    try{await invoke('context.config',{sessionId:session.id,limit,percent:percentChoice});setSaved(true);if(limit===null)setLimitText('');else setLimitText(contextTokens(limit));}
    catch(cause){setError((cause as Error).message);}finally{setBusy(null);}
  }
  async function compact(){
    if(!threadId)return;setBusy('compact');setError('');
    try{await invoke('room.compress',{roomId,threadId,...(focus.trim()?{focus:focus.trim()}:{})});setCompactOpen(false);setFocus('');}
    catch(cause){setError((cause as Error).message);}finally{setBusy(null);}
  }
  const left=Math.max(8,Math.min(anchor.left,innerWidth-Math.min(372,innerWidth-16)-8)),bottom=innerHeight-anchor.top+8;
  // Rendered at the top layer like the context menus, so the workspace header never covers it.
  return createPortal(<div ref={node} tabIndex={-1} className={`model-popover context-popover member-${session.memberId??session.provider}`} role="dialog" aria-label={t("上下文")} data-leaving={leaving||undefined} style={{left,bottom,maxHeight:Math.max(240,Math.min(720,anchor.top-16))}}>
    <header className="context-head"><strong>{t("上下文")}</strong>{usage?.model&&<small>{usage.model}</small>}</header>
    {!usage?<p className="context-empty">{t("还没有读数。发一条消息后，这里会显示这个话题占用了多少上下文。")}</p>:<>
      <div className="context-total"><span>{percent!==undefined?t("已使用 {0}%", percent):t("已使用 {0}", contextTokens(usage.used))}</span><span>{contextTokens(usage.used)}{budget.limit?` / ${contextTokens(budget.limit)}`:''}</span></div>
      {budget.custom&&modelWindow&&<small className="context-sub">{t("你设定的上限；模型自带上限 {0}", contextTokens(modelWindow))}</small>}
      <div className="context-bar" aria-hidden="true">{view!.rows.filter(row=>row.tokens>0).map(row=><span key={row.key} className={`tone-${row.tone}`} style={{flexGrow:row.tokens}}/>)}</div>
      <ul className="context-rows" aria-label={t("上下文占用")}>
        {view!.rows.map(row=><li key={row.key} className={row.tokens?'':'empty'}><i className={`tone-${row.tone}`} aria-hidden="true"/><span className={row.hint?'context-hinted':''} title={row.hint}>{row.label}</span><span>{contextTokens(row.tokens)}</span><b>{share(row.tokens,total)}</b></li>)}
      </ul>
      {!!usage.parts?.mcpTools.count&&<details className="context-list"><summary><ChevronRight size={13} aria-hidden="true"/>{t("HiveLab 工具（MCP）")}<span>{usage.parts.mcpTools.count}</span></summary><ul>{usage.parts.mcpTools.names.map(name=><li key={name}>{name}</li>)}</ul></details>}
      <details className="context-list"><summary><ChevronRight size={13} aria-hidden="true"/>{t("记忆文件")}<span>{usage.parts?.memoryFiles.length??0}</span></summary>{usage.parts?.memoryFiles.length?<ul>{usage.parts.memoryFiles.map(file=><li key={file.name}>{file.name}<span>{contextTokens(file.tokens)}</span></li>)}</ul>:<p className="context-empty">{t("工作文件夹里没有执行端会读取的项目约定文件。")}</p>}</details>
    </>}
    <div className="context-compact">
      <span>{view?.left!==undefined?t("距自动压缩还剩 {0}", contextTokens(view.left)):t("自动压缩由执行端自行决定")}</span>
      <button type="button" className="button small secondary" disabled={!threadId||compressing||busy==='compact'} onClick={()=>setCompactOpen(open=>!open)}>{compressing||busy==='compact'?<LoaderCircle size={13} className="context-spin" aria-hidden="true"/>:<Minimize2 size={13} aria-hidden="true"/>}{compressing?t("正在压缩…"):t("压缩会话")}</button>
    </div>
    {compactOpen&&<form className="context-compact-form" onSubmit={event=>{event.preventDefault();void compact();}}>
      <input aria-label={t("压缩时重点保留")} placeholder={t("压缩时重点保留什么（可选）")} value={focus} maxLength={500} onChange={event=>setFocus(event.target.value)} autoFocus/>
      <small>{t("成员会把对话整理成摘要，下一条消息在新的原生会话里接着做。")}</small>
      <div><button type="submit" className="button small primary" disabled={busy==='compact'}>{t("开始压缩")}</button><button type="button" className="button small quiet" onClick={()=>setCompactOpen(false)}>{t("取消")}</button></div>
    </form>}
    <section className="context-settings" aria-label={t("上下文设置")}>
      <h4>{t("上下文上限")}</h4>
      <p className="context-note">{t("上下文太长时成员更容易出错。可以把上限设得比模型自带的小，让它更早压缩；不能超过模型自带的上限。")}</p>
      <div className="context-limit-row">
        <input aria-label={t("上下文上限")} placeholder={modelWindow?t("自带 {0}", contextTokens(modelWindow)):t("先完成一轮对话")} value={limitText} disabled={!modelWindow} onChange={event=>{setLimitText(event.target.value);setSaved(false);setError('');}}/>
        <button type="button" className="button small primary" disabled={!modelWindow||busy==='save'} onClick={()=>{const text=limitText.trim();if(!text){void save(null);return;}const value=parseContextTokens(text);if(!value){setError(t("请填写数字，例如 400k、200000 或 1M"));return;}void save(value);}}>{busy==='save'?<LoaderCircle size={13} className="context-spin" aria-hidden="true"/>:null}{t("保存")}</button>
      </div>
      {!!modelWindow&&<div className="context-chips" role="group" aria-label={t("常用上限")}>
        <button type="button" className={!budget.custom&&!limitText?'selected':''} onClick={()=>{setLimitText('');setSaved(false);}}>{t("自带 {0}", contextTokens(modelWindow))}</button>
        {presets.map(value=><button key={value} type="button" className={parseContextTokens(limitText)===value?'selected':''} onClick={()=>{setLimitText(contextTokens(value));setSaved(false);setError('');}}>{contextTokens(value)}</button>)}
      </div>}
      <h4>{t("自动压缩点")}</h4>
      <div className="context-chips" role="radiogroup" aria-label={t("自动压缩点")}>{CONTEXT_PERCENTS.map(value=><button key={value} type="button" role="radio" aria-checked={percentChoice===value} className={percentChoice===value?'selected':''} onClick={()=>{setPercentChoice(value);setSaved(false);}}>{value}%</button>)}</div>
      {error&&<p className="context-error" role="alert">{error}</p>}
      {saved&&<p className="context-saved" role="status">{t("已保存，从下一轮开始生效，也会作为这位成员新话题的默认值。")}</p>}
    </section>
    <small className="context-footnote">{t("数字来自最近一轮执行端的回报；HiveLab 加入的部分按字数估算。")}</small>
  </div>,document.body);
}

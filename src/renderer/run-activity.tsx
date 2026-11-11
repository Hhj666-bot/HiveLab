import {t} from './i18n';
import {RunElapsed} from './run-duration';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Activity,Brain,CheckCircle2,ChevronDown,LoaderCircle,Terminal,TriangleAlert} from 'lucide-react';
import type {RunSummary,Snapshot,TimelineEvent} from '../shared/types';
import {activeActivityRun,activityEntries,activityMemberId,activityPreview,isActivityEvent,mergeActivityEvents,type ActivityEntry,type RunActivityPage} from '../shared/run-activity';
import {Markdown} from './Markdown';
import {RuntimeDiagnosticsPanel} from './runtime-diagnostics';
import {Modal} from './modals';
import {dateTime,runLabel,time,type Invoke} from './ui';
import './run-activity.css';

export type ActivitySnapshot=Pick<Snapshot,'events'|'backendReady'|'restoreEpoch'|'subagents'>&{
  /** A plan proposed in this run: Claude's pending in-turn review, and whether the run is still its topic's latest turn. */
  planReview?:{approval?:import('../shared/types').Approval;latest:boolean};
};

type Loaded={runId:string;events:TimelineEvent[];before?:string;hasMore:boolean;loading:boolean;error:string};
const empty=(runId:string):Loaded=>({runId,events:[],hasMore:false,loading:true,error:''});

function useRunActivity(run:RunSummary,snapshot:ActivitySnapshot,invoke:Invoke,enabled:boolean){
  const [loaded,setLoaded]=useState<Loaded>(()=>empty(run.id)),[retry,setRetry]=useState(0);
  const generation=useRef(0),moreBusy=useRef(false),live=useRef(snapshot.events);
  live.current=snapshot.events;
  useEffect(()=>{
    const ticket=++generation.current;moreBusy.current=false;
    if(!enabled)return;
    const initial=live.current.filter(event=>event.runId===run.id&&isActivityEvent(event)).map(activityPreview);
    setLoaded({...empty(run.id),events:initial});
    const accept=(events:TimelineEvent[])=>setLoaded(old=>old.runId===run.id?{...old,events:mergeActivityEvents(old.events,events)}:old);
    const unsubscribe=window.hivelab?.onEvent?.(event=>{if(ticket===generation.current&&event.type==='event'&&event.event.runId===run.id&&isActivityEvent(event.event))accept([activityPreview(event.event)]);});
    void invoke<RunActivityPage>('run.activity',{runId:run.id},undefined,{background:true}).then(page=>{
      if(ticket!==generation.current)return;
      setLoaded(old=>({...old,runId:run.id,events:mergeActivityEvents(page.events,old.runId===run.id?old.events:[]),before:page.before,hasMore:page.hasMore,loading:false,error:''}));
    }).catch(error=>{if(ticket===generation.current)setLoaded(old=>({...old,loading:false,error:String(error.message??error)}));});
    return()=>{generation.current++;unsubscribe?.();};
  },[run.id,enabled,invoke,retry,snapshot.restoreEpoch]);
  useEffect(()=>{
    if(!enabled)return;
    const events=snapshot.events.filter(event=>event.runId===run.id&&isActivityEvent(event)).map(activityPreview);
    if(events.length)setLoaded(old=>old.runId===run.id?{...old,events:mergeActivityEvents(old.events,events)}:old);
  },[snapshot.events,run.id,enabled]);
  async function more(){
    if(moreBusy.current||!enabled||loaded.runId!==run.id||!loaded.before)return;
    const ticket=generation.current;moreBusy.current=true;setLoaded(old=>({...old,loading:true,error:''}));
    try{
      const page=await invoke<RunActivityPage>('run.activity',{runId:run.id,before:loaded.before},undefined,{background:true});
      if(ticket===generation.current)setLoaded(old=>({...old,events:mergeActivityEvents(page.events,old.events),before:page.before,hasMore:page.hasMore,loading:false}));
    }catch(error){if(ticket===generation.current)setLoaded(old=>({...old,loading:false,error:String((error as Error).message)}));}
    finally{if(ticket===generation.current)moreBusy.current=false;}
  }
  return {...(loaded.runId===run.id?loaded:empty(run.id)),more,retry:()=>setRetry(value=>value+1)};
}

const source=(entry:ActivityEntry)=>entry.fidelity==='native'?t("执行端返回"):entry.fidelity==='derived'?t("工作台记录"):t("简化记录");
const states={get running(){return t("执行中")},get pending(){return t("等待执行")},get completed(){return t("已完成")},get failed(){return t("失败或已中止")},get unknown(){return t("未返回结束状态")}};
function ActivityRow({entry}:{entry:ActivityEntry}){
  const meta=<span className="activity-meta"><time>{time(entry.at)}</time><span>{source(entry)}</span></span>;
  // Every row starts closed: the log stays scannable, and a running or failed tool is still one click away.
  if(entry.kind==='tool')return <details className={`activity-tool ${entry.state??'unknown'}`}>
    <summary>{entry.state==='running'?<LoaderCircle className="spin" size={14}/>:entry.state==='completed'?<CheckCircle2 size={14}/>:entry.state==='failed'?<TriangleAlert size={14}/>:<Terminal size={14}/>}<strong>{entry.title}</strong><span className="activity-tool-state">{states[entry.state??'unknown']}</span>{meta}</summary>
    {entry.input&&<div className="activity-code"><small>{t("参数 / 命令")}</small><pre>{entry.input}</pre></div>}
    {entry.output&&<div className="activity-code"><small>{t("操作结果")}</small><pre>{entry.output}</pre></div>}
    {!entry.input&&!entry.output&&<p className="activity-muted">{t("执行端没有返回更多操作细节。")}</p>}
  </details>;
  if(entry.kind==='reasoning'||entry.kind==='plan'||entry.kind==='progress')return <section className={'activity-text '+entry.kind}>
    <header>{entry.kind==='reasoning'?<Brain size={14}/>:<Activity size={14}/>}<strong>{entry.kind==='reasoning'?t("思考摘要"):entry.kind==='progress'?t("进度说明"):t("公开计划")}</strong>{meta}</header><Markdown text={entry.text}/>
  </section>;
  if(entry.kind==='output')return <section className="activity-text output"><header><Terminal size={14}/><strong>{t("工具输出")}</strong>{meta}</header><pre>{entry.text}</pre></section>;
  return <section className={`activity-status ${entry.kind}`}><span>{entry.kind==='error'?t("错误"):entry.kind==='warning'?t("提示"):entry.kind==='approval'?t("操作审批"):entry.kind==='question'?t("需要补充信息"):t("状态")}</span><p>{entry.text}</p>{meta}</section>;
}

export function RunActivityContent({run,snapshot,invoke,enabled=true}:{run:RunSummary;snapshot:ActivitySnapshot;invoke:Invoke;enabled?:boolean}){
  const data=useRunActivity(run,snapshot,invoke,enabled),active=activeActivityRun(run);
  const [filter,setFilter]=useState<'all'|'thinking'|'tools'>('all'),[follow,setFollow]=useState(true);
  const list=useRef<HTMLDivElement>(null),anchor=useRef<{height:number;top:number}|null>(null);
  const entries=useMemo(()=>activityEntries(data.events,active),[data.events,active]);
  const visible=entries.filter(entry=>filter==='all'||filter==='thinking'&&['reasoning','plan'].includes(entry.kind)||filter==='tools'&&['tool','output','warning','error','approval','question'].includes(entry.kind));
  useLayoutEffect(()=>{
    const node=list.current;if(!node)return;
    if(anchor.current&&!data.loading){node.scrollTop=anchor.current.top+node.scrollHeight-anchor.current.height;anchor.current=null;}
    else if(follow)node.scrollTop=node.scrollHeight;
  },[data.events,data.loading,filter,follow]);
  return <div className="run-activity-content">
    <RuntimeDiagnosticsPanel key={run.id+':'+(snapshot.restoreEpoch??'')} runId={run.id} invoke={invoke} available={snapshot.backendReady}/>
    <div className="activity-toolbar"><div role="group" aria-label={t("活动记录筛选")}>{([['all',t("全部")],['thinking',t("思考")],['tools',t("操作")]] as const).map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} className={filter===key?'selected':''} onClick={()=>setFilter(key)}>{label}</button>)}</div><span role="status">{runLabel(run)} · <RunElapsed run={run}/> {t(" · {0} 项操作", entries.filter(entry=>entry.kind==='tool').length)}</span></div>
    <p className="activity-notice">{t("思考摘要由执行端提供，未返回的内容不会补写。")}</p>
    <div className="activity-log" role="log" aria-label={t("思考与操作记录")} aria-live="off" ref={list} onScroll={event=>{const node=event.currentTarget;setFollow(node.scrollHeight-node.scrollTop-node.clientHeight<60);}}>
      {data.hasMore&&<button type="button" className="button small quiet activity-more" disabled={data.loading} onClick={()=>{if(list.current)anchor.current={height:list.current.scrollHeight,top:list.current.scrollTop};setFollow(false);void data.more();}}>{t("加载更早的活动")}</button>}
      {data.loading&&!data.events.length&&<p className="activity-muted">{t("正在读取活动记录…")}</p>}
      {!data.loading&&!visible.length&&<p className="activity-muted">{filter==='thinking'?t("执行端尚未返回思考摘要或公开计划。"):active?t("等待成员返回活动；记录会实时显示。"):t("这次运行没有返回可展示的活动记录。")}</p>}
      {visible.map(entry=><ActivityRow key={entry.id} entry={entry}/>)}
    </div>
    {data.error&&<p role="alert" className="activity-error">{data.error}<button type="button" className="link-button" onClick={data.retry}>{t("重新读取")}</button></p>}
    {!follow&&<button type="button" className="link-button activity-follow" onClick={()=>setFollow(true)}>{t("跟随最新活动 ")}<ChevronDown size={13}/></button>}
  </div>;
}

export function RunActivity({run,snapshot,invoke}:{run:RunSummary;snapshot:ActivitySnapshot;invoke:Invoke}){
  // Collapsed unless the user opens it; it never pops open on its own while a run is active.
  const [open,setOpen]=useState(false);
  return <details className="run-activity" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><Activity size={14}/><strong>{t("思考与操作")}</strong><span>{runLabel(run)}</span><ChevronDown size={14}/></summary>
    {open&&<RunActivityContent key={run.id} run={run} snapshot={snapshot} invoke={invoke}/>}
  </details>;
}

/** All connected executors use the same view; identity follows the member, not the shared provider. */
export function MemberActivityDialog({snapshot,invoke,onClose}:{snapshot:Snapshot;invoke:Invoke;onClose:()=>void}){
  const [memberId,setMemberId]=useState(''),[runId,setRunId]=useState('');
  const memberNames=new Map([...snapshot.removedMembers??[],...snapshot.members].map(member=>[member.id,member.name]));
  for(const run of snapshot.runs){const id=activityMemberId(snapshot,run);if(!memberNames.has(id))memberNames.set(id,snapshot.executors?.find(executor=>executor.id===run.provider)?.name??run.provider);}
  const runs=snapshot.runs.filter(run=>!memberId||activityMemberId(snapshot,run)===memberId).sort((a,b)=>Number(activeActivityRun(b))-Number(activeActivityRun(a))||b.createdAt.localeCompare(a.createdAt));
  const selected=runs.find(run=>run.id===runId)??runs[0];
  const title=(run:RunSummary)=>`${memberNames.get(activityMemberId(snapshot,run))} · ${snapshot.projects.find(project=>project.id===run.projectId)?.name??t("会话")} · ${dateTime(run.createdAt)} · ${runLabel(run)}`;
  return <Modal title={t("成员活动")} subtitle={t("查看每位成员的思考摘要、实际操作及返回结果。")} className="member-activity-modal" onClose={onClose}>
    <div className="modal-body"><div className="activity-selectors"><label className="field">{t("成员")}<select aria-label={t("活动成员")} value={memberId} onChange={event=>{setMemberId(event.target.value);setRunId('');}}><option value="">{t("全部成员")}</option>{[...memberNames].map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label><label className="field">{t("运行")}<select aria-label={t("活动运行")} value={selected?.id??''} onChange={event=>setRunId(event.target.value)}>{!runs.length&&<option value="">{t("暂无运行")}</option>}{runs.map(run=><option value={run.id} key={run.id}>{title(run)}</option>)}</select></label></div>
      {selected?<RunActivityContent key={selected.id+':'+(snapshot.restoreEpoch??'')} run={selected} snapshot={snapshot} invoke={invoke}/>:<p className="activity-muted">{t("这位成员还没有运行记录。")}</p>}
    </div>
  </Modal>;
}

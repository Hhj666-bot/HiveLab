import {t as tr} from './i18n';
import {useEffect,useRef,useState} from 'react';
import {joinClauses,readableContent} from '../shared/content-presentation';
import type {Project,Snapshot} from '../shared/types';
import {descendantIds} from '../shared/project-tree';
import {criterionText,criterionKind,type Plan,type Round,type Task,type Integration,type Acceptance} from '../shared/project-flow';
import type {FlowTimelinePage,FlowTimelineItem,FlowProgressDetail,ProgressSection,UserChangeHistory} from '../shared/project-progress';
import {RoundResults} from './round-results';
import {WorkLog} from './work-log';
import {ProjectRecordView} from './project-record';
import {ReviewDetails} from './review-details';
import {Markdown} from './Markdown';
import {dateTime,type Invoke} from './ui';
import {Avatar,useTeam} from './members';
import {ChevronDown,ChevronRight,RefreshCw} from 'lucide-react';
const sectionLabels={get plans(){return tr("方案版本")},get rounds(){return tr("各轮汇报")},get tasks(){return tr("任务记录")},get results(){return tr("成果版本")},get acceptances(){return tr("验收记录")}};
const statusLabels:Record<string,string>={get planning(){return tr("起草中")},get awaiting_plan(){return tr("待确认")},get active(){return tr("进行中")},get completed(){return tr("已完成")},get cancelled(){return tr("已取消")},get confirmed(){return tr("已确认")},get superseded(){return tr("已被替代")},get rejected(){return tr("已驳回")},get awaiting_confirmation(){return tr("待确认")},get draft(){return tr("草稿")},get pending(){return tr("未开始")},get executing(){return tr("执行中")},get accepted(){return tr("已验收")},get ready(){return tr("已准备")},get changes_requested(){return tr("要求修改")},get stale(){return tr("旧版本")},get awaiting_acceptance(){return tr("待验收")},get integrating(){return tr("整合中")},get checking(){return tr("检查中")},get blocked(){return tr("已阻塞")},get review_passed(){return tr("复核通过")},get review_skipped(){return tr("已提交")},get running(){return tr("执行中")},get awaiting_review(){return tr("待复核")},get queued(){return tr("排队中")},get correcting(){return tr("修正中")},get integrated(){return tr("已整合")},get escalated(){return tr("已交给你决定")},get passed(){return tr("检查通过")},get inconclusive(){return tr("无法下结论")},get assembling(){return tr("整合中")},get conflict(){return tr("有冲突")},get requested(){return tr("等待写回")},get applying(){return tr("正在写回")},get recovery_required(){return tr("写回需要处理")}};
export const label=(s:string)=>statusLabels[s]??s;
function Who({id}:{id:string}){const member=useTeam().get(id);return <span className="progress-who">{member&&<Avatar member={member} size={16} ring={false}/>}{member?.name??id}</span>;}
export function ProjectProgressView({project,snapshot,invoke}:{project:Project;snapshot:Snapshot;invoke:Invoke}){
  const [page,setPage]=useState<FlowTimelinePage>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),ticket=useRef(0),[expanded,setExpanded]=useState<string>();
  const [includeChildren,setIncludeChildren]=useState(true),childIds=descendantIds(snapshot.projects,project.id),hasChildren=childIds.length>1,scopeIds=includeChildren?childIds:[project.id],scopeKey=JSON.stringify([...scopeIds].sort());
  const stamp=JSON.stringify([snapshot.projectFlows?.filter(f=>scopeIds.includes(f.projectId)),snapshot.runs.filter(r=>scopeIds.includes(r.projectId)&&r.flowOperationId).map(r=>[r.id,r.status,r.updatedAt])]);
  async function load(more=false){const mine=++ticket.current;setBusy(true);try{const next=await invoke<FlowTimelinePage>('projectFlow.timeline',{projectId:project.id,includeChildren:hasChildren&&includeChildren,limit:10,...(more&&page?.cursor?{cursor:page.cursor}:{})});if(mine===ticket.current){setPage(old=>more?{...next,items:[...(old?.items??[]),...next.items]}:next);setError('');}}catch(e){if(mine===ticket.current)setError((e as Error).message);}finally{if(mine===ticket.current)setBusy(false);}}
  useEffect(()=>{setPage(undefined);setExpanded(undefined);void load();return()=>{ticket.current++;};},[project.id,scopeKey,includeChildren]);
  // Once the user is paging history, keep that collection until an explicit refresh.
  useEffect(()=>{if(page&&!page.cursor&&page.items.length<10)void load();},[stamp]);
  const counts=page?.counts;
  return <aside className="project-progress" aria-label={tr("项目进度")}>
    <header className="progress-head"><h2 title={page?.scope}>{tr("项目进度")}</h2><button type="button" className="icon-button" aria-label={tr("刷新保存记录")} title={tr("重新读取保存的记录")} disabled={busy} onClick={()=>void load()}><RefreshCw size={14} className={busy?'spin':''}/></button></header>
    {hasChildren&&<label className="progress-children"><input type="checkbox" checked={includeChildren} onChange={e=>setIncludeChildren(e.target.checked)}/>{tr("包含全部子项目")}</label>}
    {error&&<p className="round-results-error" role="alert">{error}</p>}{!page&&<p className="task-meta">{tr("正在读取项目历史…")}</p>}
    {page&&counts&&<section className="progress-counts" aria-label={tr("全项目统计")}>
      <p className="progress-total">{tr("共 {0} 段工作：{1} 段进行中，{2} 段已完成，{3} 段已取消。", counts.flows.total, counts.flows.active, counts.flows.completed, counts.flows.cancelled)}</p>
      <dl>
        <dt>{tr("当前方案")}</dt><dd>{tr("轮次已验收 {0}/{1} · 任务已验收 {2}/{3}{4}", counts.latestPlans.acceptedRounds, counts.latestPlans.rounds, counts.latestPlans.acceptedTasks, counts.latestPlans.tasks, counts.latestPlans.cancelledTasks?tr(" · 取消 {0}", counts.latestPlans.cancelledTasks):'')}</dd>
        <dt>{tr("历史累计")}</dt><dd>{tr("{0} 个方案 · {1} 轮 · {2} 条任务 · {3} 个成果版本 · {4} 条验收与驳回", counts.allSaved.plans, counts.allSaved.rounds, counts.allSaved.tasks, counts.allSaved.results, counts.allSaved.acceptances)}</dd>
      </dl>
      <small>{page.countScope}</small>
    </section>}
    {page?.items.map(flow=>{const open=expanded===flow.id;return <article className={`progress-flow status-${flow.status} ${open?'open':''}`} key={flow.id}>
      <button type="button" className="progress-flow-title" aria-expanded={open} onClick={()=>setExpanded(open?undefined:flow.id)}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<strong>{flow.objective}</strong><span className="progress-status">{label(flow.status)}</span></button>
      <p className="progress-flow-meta"><Who id={flow.leadMemberId}/> {tr(" 负责 · {0} 开始{1}", dateTime(flow.createdAt), flow.stage&&flow.status==='active'?' · '+flow.stage:'')}</p>
      <p className="progress-flow-meta">{tr("{0} · 轮次已验收 {1}/{2}{3}{4}{5}", flow.adoptedPlanVersion!==undefined?tr("第 {0} 版方案", flow.adoptedPlanVersion):flow.plan?tr("第 {0} 版待确认，尚未开工", flow.plan.version):tr("尚无方案"), flow.rounds.accepted, flow.rounds.total, flow.planCount>1?tr(" · 共 {0} 个方案", flow.planCount):'', flow.resultCount?tr(" · {0} 个成果版本", flow.resultCount):'', flow.lastAcceptedAt?tr(" · 最近验收 {0}", dateTime(flow.lastAcceptedAt)):'')}</p>
      {hasChildren&&<p className="progress-flow-meta">{(flow.projectPath??[flow.projectName??project.name]).join(' / ')}</p>}
      {flow.reportSummary&&<p className="progress-flow-summary">{flow.reportSummary}</p>}
      {open&&(()=>{const owner=snapshot.projects.find(p=>p.id===flow.projectId);return owner?<ProgressDetails key={flow.id} project={owner} flow={flow} invoke={invoke}/>:<p role="alert">{tr("这个项目的记录当前不可读取，请刷新。")}</p>;})()}
    </article>;})}
    {page&&!page.items.length&&<p className="task-meta">{tr("项目里还没有保存的工作流程。")}</p>}{page&&<footer className="progress-foot"><small title={tr("分页集合建立于 {0}", dateTime(page.capturedAt))}>{tr("已显示 {0} / {1} 段工作", page.items.length, page.total)}</small>{page.hasMore&&<button type="button" className="button small secondary" disabled={busy} onClick={()=>void load(true)}>{tr("更多工作")}</button>}</footer>}
  </aside>;
}
function ProgressDetails({project,flow,invoke}:{project:Project;flow:FlowTimelineItem;invoke:Invoke}){
  const [section,setSection]=useState<ProgressSection>('rounds'),[page,setPage]=useState<FlowProgressDetail>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),ticket=useRef(0),[record,setRecord]=useState(false),[log,setLog]=useState<{kind:'task'|'round';id:string}>();
  async function load(more=false){const mine=++ticket.current;setBusy(true);try{const result=await invoke<FlowProgressDetail>('projectFlow.progress.detail',{projectId:project.id,flowId:flow.id,section,limit:10,...(more&&page?.cursor?{cursor:page.cursor}:{})});if(mine===ticket.current){setPage(old=>more?{...result,items:[...(old?.items??[]),...result.items]}:result);setError('');}}catch(e){if(mine===ticket.current)setError((e as Error).message);}finally{if(mine===ticket.current)setBusy(false);}}
  useEffect(()=>{setPage(undefined);void load();return()=>{ticket.current++;};},[project.id,flow.id,section]);
  async function exportRound(id:string){try{const result=await invoke<{title:string;markdown:string}>('projectFlow.round.report.export',{projectId:project.id,roundId:id});await invoke('file.save',{name:result.title+'.md',content:result.markdown});}catch(e){setError((e as Error).message);}}
  return <div className="progress-details">
    <div className="segmented progress-tabs" role="tablist" aria-label={tr("历史记录类别")}>{(Object.keys(sectionLabels) as ProgressSection[]).map(s=><button type="button" role="tab" key={s} aria-selected={s===section} className={s===section?'selected':''} onClick={()=>{setPage(undefined);setSection(s);}}>{sectionLabels[s]}</button>)}</div>
    <button type="button" className="link-button progress-record-link" onClick={()=>setRecord(true)}>{tr("查看本段项目记录")}</button>
    {error&&<p className="round-results-error" role="alert">{error}</p>}{page&&<p className="progress-scope">{page.scope}</p>}
    {(page?.section===section?page.items:[])?.map(item=><section key={item.id} className="progress-detail-record">
      {section==='plans'?(()=>{const p=item as Plan;return <><h3>{tr("第 {0} 版方案 · {1}{2}", p.version, label(p.status), p.id===flow.adoptedPlanId?tr(" · 最后确认"):p.id===flow.plan?.id?tr(" · 当前方案"):'')}</h3><p>{p.objective}</p><p>{p.scope}</p><ul>{p.deliverables.map((s,i)=><li key={i}>{s}</li>)}</ul><h4>{tr("验收要求")}</h4><ul>{p.acceptanceCriteria.map(c=><li key={criterionText(c)}>{criterionText(c)} · {criterionKind(c)==='owner'?tr("你来定"):criterionKind(c)==='judge'?tr("成员评价"):tr("可核对")}</li>)}</ul><p>{tr("{0} 轮，方案声明 {1} 项任务；后续追加项见任务记录。", p.rounds.length, p.tasks.length)}</p></>;})()
      :section==='rounds'?(()=>{const r=item as Round;return <><h3>{tr("第 {0} 轮 · {1} · {2}{3}", r.index+1, r.title, label(r.status), r.planId!==flow.adoptedPlanId?tr(" · 历史方案"):'')}</h3><p>{r.goal}</p>{r.report?<><Markdown text={readableContent(r.report.summary)}/><p>{tr("成果：{0}", joinClauses(r.report.deliverables,'、'))}</p><p>{tr("遗留：{0}", joinClauses(r.report.remainingIssues,'；')||tr("无记录"))}</p><p>{tr("下一步：{0}", r.report.nextRoundSummary)}</p><button className="link-button" onClick={()=>void exportRound(r.id)}>{tr("导出这轮汇报")}</button></>:<p>{tr("尚无保存汇报")}</p>}<button className="link-button" onClick={()=>setLog({kind:'round',id:r.id})}>{tr("查看这轮日志")}</button>{r.integrationId&&<RoundResults projectId={project.id} roundId={r.id} integrationId={r.integrationId} invoke={invoke}/>}</>;})()
      :section==='tasks'?(()=>{const t=item as Task;return <><h3>{t.title} · {label(t.status)}{t.planId!==flow.adoptedPlanId?tr(" · 历史方案"):''}</h3><p>{t.goal}</p><p>{tr("作者：")}<Who id={t.memberId}/>{tr("；复核人：")}{t.reviewerMemberId?<Who id={t.reviewerMemberId}/>:tr("无")}</p><p>{tr("许可范围：{0}", t.allowedPaths.join('、'))}</p><ul>{t.completionCriteria.map(c=><li key={criterionText(c)}>{criterionText(c)}</li>)}</ul>{t.confirmedAt&&<p>{tr("追加确认：{0}", dateTime(t.confirmedAt))}</p>}<button className="link-button" onClick={()=>setLog({kind:'task',id:t.id})}>{tr("查看任务日志")}</button></>;})()
      :section==='results'?(()=>{const i=item as Integration;return <><h3>{tr("成果第 {0} 次 · {1}", i.sequence, label(i.status))}</h3>{i.reportDraft&&<Markdown text={i.reportDraft.summary}/>}<p>{i.checkSummary}</p><ReviewDetails projectId={project.id} invoke={invoke} artifactId={i.version?.artifactId} assessments={i.assessments} strengths={i.strengths} sources={i.checkEvidence} owner={i.deferredUserCriteria}/><RoundResults projectId={project.id} roundId={i.roundId} integrationId={i.id} invoke={invoke}/></>;})()
      :(()=>{const a=item as Acceptance|UserChangeHistory;return <><h3>{'recordedVia' in a?tr("用户驳回"):tr("验收")} · {label(a.status)}</h3><p>{a.actor==='user'?tr("你"):tr("负责人")} · {a.acceptedAt?dateTime(a.acceptedAt):dateTime(a.createdAt)}</p><Markdown text={a.opinion||tr("无附加意见")}/><p>{tr("写回文件：{0}", a.appliedPaths.join('、')||tr("未写回"))}</p>{!!a.conflictPaths.length&&<p>{tr("冲突：{0}", a.conflictPaths.join('、'))}</p>}<RoundResults projectId={project.id} roundId={a.roundId} integrationId={a.integrationId} invoke={invoke}/></>;})()}
    </section>)}
    {page&&!page.items.length&&<p className="task-meta">{tr("暂无这类保存记录。")}</p>}{page&&<footer className="progress-foot"><small>{tr("显示 {0} / {1} 条记录", page.items.length, page.total)}</small>{page.hasMore&&<button type="button" className="button small secondary" disabled={busy} onClick={()=>void load(true)}>{tr("更多{0}", sectionLabels[section])}</button>}</footer>}
    {record&&<ProjectRecordView project={project} flowId={flow.id} invoke={invoke} onClose={()=>setRecord(false)}/>}
    {log&&<WorkLog project={project} target={log} invoke={invoke} onClose={()=>setLog(undefined)}/>}
  </div>;
}

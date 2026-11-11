import {t as tr} from '../i18n';
import {joinClauses, plainFlowError, readableContent} from "../../shared/content-presentation";
import {reportForDisplay} from "../../shared/report-presentation";
import {RoundResults} from "../round-results";
import {useEffect, useState} from "react";
import {AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileDiff, Hand, LoaderCircle, Play, Send, ThumbsDown, ThumbsUp} from "lucide-react";
import type {Decision, Integration, Plan, ProjectFlowSnapshot, Round, Task} from "../../shared/project-flow";
import {FLOW_LIMITS, reviewLevel, roundReviewLevel, REVIEW_LEVEL_LABELS, type ReviewLevel, type DisputeRuling} from "../../shared/project-flow";
import {commandExitCodeNotes} from "../../shared/project-flow-review";
import {criterionText, criterionKind} from "../../shared/project-flow";
import {memberCriteria} from "../../shared/project-flow-review";
import {ReviewDetails} from "../review-details";
import {useTeam} from "../members";
import {Markdown} from "../Markdown";
import {dateTime, type Invoke} from "../ui";
import {planChanges} from "../../shared/plan-changes";
import {useRoundtableNavigation} from "../roundtable-navigation";
import {MemberName, MemberLine, Note} from "./people";
import {ROUND_STATUS, action, allowed} from "./flow-ui";
import {FlowDockActions} from "./meeting-surface";
function PlanChanges({ plan, invoke }: { plan: Plan; invoke: Invoke }) {
  const team = useTeam(), [changes, setChanges] = useState<{ version: number; items: string[] } | null>(null);
  useEffect(() => {
    let alive = true; setChanges(null);
    if (plan.parentPlanId) void invoke<Plan>('projectFlow.detail', { projectId: plan.projectId, kind: 'plan', id: plan.parentPlanId }, undefined, { background: true })
      .then(parent => { if (alive) setChanges({ version: parent.version, items: planChanges(parent, plan, id => team.get(id)?.name ?? id) }); }).catch(() => {});
    return () => { alive = false; };
  }, [plan.id, plan.parentPlanId]);
  if (!changes) return null;
  return <div className="plan-changes" aria-label={tr("和第 {0} 版相比", changes.version)}><h4>{tr("和第 {0} 版相比", changes.version)}</h4>{changes.items.length ? <ul>{changes.items.map(item => <li key={item}>{item}</li>)}</ul> : <p>{tr("内容没有变化。")}</p>}</div>;
}

export function PlanCard({ plan, invoke, lead, rounds, busy, onConfirm, onRevise,defaultLevel,onRoundLevel }: { plan: Plan; invoke: Invoke; lead: string; rounds: Round[]; busy: boolean;defaultLevel:ReviewLevel;onRoundLevel:(round:Round,level:ReviewLevel)=>Promise<boolean>; onConfirm: (choices: Record<string, boolean>,peerChoices:Record<string,boolean>,levels:Record<string,ReviewLevel>) => Promise<boolean>; onRevise: (instruction: string) => Promise<boolean> }) {
  const toRoundtable=useRoundtableNavigation();
  const [revision, setRevision] = useState<string | null>(null);
  const waiting = plan.status === 'awaiting_confirmation';
  const [peerChoices,setPeerChoices]=useState<Record<string,boolean>>({}),[levels,setLevels]=useState<Record<string,ReviewLevel|'inherit'>>({});
  // Open while it waits for the owner; once confirmed it folds to its title so the rounds come into view.
  const [open, setOpen] = useState(waiting), [choices, setChoices] = useState<Record<string, boolean>>({});
  useEffect(() => { setChoices(Object.fromEntries(plan.rounds.map(round => [round.key, round.requiresUserAcceptance !== false])));setLevels({});setPeerChoices({}); }, [plan.id]);
  useEffect(() => { setOpen(waiting); }, [plan.id, waiting]);
  const last = plan.rounds.at(-1)?.key, state = (key: string) => rounds.find(round => round.key === key);
  const label = <span className={`plan-status status-${plan.status}`}>{tr("方案第 {0} 版 · {1}", plan.version, waiting ? tr("等你确认") : plan.status === 'confirmed' ? tr("已确认") : plan.status === 'superseded' ? tr("已被新版替代") : tr("草稿"))}</span>;
  return <MemberLine id={lead} label={label}>
    <article className={`meeting-card plan-card ${waiting ? 'waiting' : ''}`} aria-label={tr("方案第 {0} 版", plan.version)}>
      <button type="button" className="plan-card-title" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<strong>{plan.objective}</strong></button>{toRoundtable&&<button className="link-button" onClick={()=>toRoundtable({projectId:plan.projectId,planId:plan.id})}>{tr("送去圆桌评审方案")}</button>}
      {open && <>
        <p className="plan-scope">{plan.scope}</p>
        {plan.parentPlanId && <PlanChanges plan={plan} invoke={invoke} />}
        <div className="plan-columns"><div><h4>{tr("交付什么")}</h4><ul>{plan.deliverables.map(item => <li key={criterionText(item)}>{criterionText(item)}（{criterionKind(item)==='owner'?tr("你来定"):criterionKind(item)==='judge'?tr("成员评价"):tr("可核对")}）</li>)}</ul></div><div><h4>{tr("怎样算完成")}</h4><ul>{plan.acceptanceCriteria.map(item => <li key={criterionText(item)}>{criterionText(item)}（{criterionKind(item)==='owner'?tr("你来定"):criterionKind(item)==='judge'?tr("成员评价"):tr("可核对")}）</li>)}</ul></div></div>
        <ol className="plan-rounds">{plan.rounds.map((round, index) => {
          const isLast = round.key === last, live = state(round.key),selectedLevel=waiting?levels[round.key]??round.reviewLevel??'inherit':live?.reviewLevel??'inherit',effective=selectedLevel==='inherit'?defaultLevel:selectedLevel,isLow=effective==='low';
          return <li key={round.key}><div className="plan-round-head"><strong>{tr("第 {0} 轮 · {1}", index + 1, round.title)}</strong>{live && live.status !== 'pending' && <span className={`round-chip status-${live.status}`}>{ROUND_STATUS[live.status]}</span>}
            {waiting ? <label className="plan-accept" title={isLast ? tr("最后一轮一定由你验收") : tr("不勾选：负责人自验后继续，不写回项目；下一次你验收时一起写回")}><input type="checkbox" checked={isLast || isLow || choices[round.key] !== false} disabled={isLast || isLow || busy} onChange={event => setChoices(previous => ({ ...previous, [round.key]: event.target.checked }))} />{tr("需要我验收")}</label>
              : <small className="plan-accept-note">{live?.requiresUserAcceptance??round.requiresUserAcceptance ? tr("你来验收") : tr("负责人自验")}</small>}</div>
            <p>{round.goal}</p><label className="plan-review-level">{tr("本轮复核程度")}<select aria-label={tr("第 {0} 轮复核程度", index+1)} value={selectedLevel} disabled={busy||!waiting&&(!live||live.status!=='pending'||Boolean(live.startedAt))} onChange={e=>{const level=e.target.value as ReviewLevel|'inherit';if(waiting)setLevels({...levels,[round.key]:level});else if(level!=='inherit'&&live)void onRoundLevel(live,level);}}><option value="inherit" disabled={!waiting}>{tr("沿用总设置")}</option>{(['high','medium','low'] as const).map(level=><option key={level} value={level}>{REVIEW_LEVEL_LABELS[level]}</option>)}</select></label>{isLow&&<small>{tr("本轮不自动检查，必须由你验收。")}</small>}{round.completionCriteria&&<ul>{round.completionCriteria.map(c=><li key={criterionText(c)}>{tr("轮次标准：{0}（{1}）", criterionText(c), criterionKind(c)==='owner'?tr("你来定"):criterionKind(c)==='judge'?tr("成员评价"):tr("可核对"))}</li>)}</ul>}{waiting?<label className="plan-peer"><input type="checkbox" aria-label={tr("第 {0} 轮整体结果也请他人复核", index+1)} checked={peerChoices[round.key]===true} disabled={busy} onChange={event=>setPeerChoices(previous=>({...previous,[round.key]:event.target.checked}))}/>{tr("本轮整体结果也请他人复核")}</label>:live?.requiresPeerReview&&<small>{tr("整轮另请其他成员复核")}</small>}
            <ul className="plan-tasks">{plan.tasks.filter(task => task.roundKey === round.key).map(task => <li key={task.key}><MemberName id={task.memberId} /><span>{task.title}</span>{task.reuse&&<small>{tr("拟沿用 {0}（后台核对后生效）", task.reuse)}</small>}{task.review&&<small>{tr("单独复核")}</small>}{task.dependencies.length > 0 && <small>{tr("等 {0}", task.dependencies.map(key => plan.tasks.find(item => item.key === key)?.title ?? key).join('、'))}</small>}{task.allowedPaths.length > 0 && <small className="plan-task-paths" title={tr("这项任务只能修改这些文件或文件夹")}>{tr("可改：{0}", task.allowedPaths.join('、'))}</small>}{task.completionCriteria.length > 0 && <details className="plan-task-criteria"><summary>{tr("完成标准 {0} 条", task.completionCriteria.length)}</summary><ul>{task.completionCriteria.map(item => <li key={criterionText(item)}>{criterionText(item)}</li>)}</ul></details>}</li>)}</ul></li>;
        })}</ol>
        {(waiting || plan.status === 'confirmed') && <div className="round-actions plan-confirm">
          {waiting && <button type="button" className="button primary" disabled={busy || !allowed(plan.allowedActions, 'projectFlow.plan.confirm')} title={action(plan.allowedActions, 'projectFlow.plan.confirm')?.reason} onClick={() => void onConfirm(Object.fromEntries(plan.rounds.map(round => [round.key, round.key === last || (levels[round.key]??round.reviewLevel??defaultLevel)==='low' || choices[round.key] !== false])),peerChoices,Object.fromEntries(Object.entries(levels).filter((entry):entry is [string,ReviewLevel]=>entry[1]!=='inherit')))}><CheckCircle2 size={14} />{tr("确认方案，开工")}</button>}
          {revision === null && <button type="button" className="button secondary" disabled={busy || !allowed(plan.allowedActions, 'projectFlow.plan.revise')} title={action(plan.allowedActions, 'projectFlow.plan.revise')?.reason ?? tr("写下意见，负责人会改出新的一版")} onClick={() => setRevision('')}>{waiting ? tr("要改一下") : tr("调整方案")}</button>}
        </div>}
        {revision !== null && <div className="plan-revise"><textarea rows={3} autoFocus aria-label={tr("对方案的修改意见")} placeholder={waiting ? tr("补充修改意见（可选），例如去掉第五条标准。") : tr("修改意见可选填；在做的任务会先做完，新方案需再次确认。")} value={revision} disabled={busy} onChange={event => setRevision(event.target.value)} />
          <div className="round-actions"><button type="button" className="button small primary" disabled={busy} onClick={() => void onRevise(revision.trim()).then(ok => { if (ok) setRevision(null); })}><Send size={13} />{tr("交给负责人改")}</button><button type="button" className="button small quiet" disabled={busy} onClick={() => setRevision(null)}>{tr("取消")}</button></div></div>}
      </>}
    </article>
  </MemberLine>;
}

export function RoundCard({ round, lead, data, invoke, busy, onDecide, onRecover,onCheck }: { round: Round; lead: string; data: ProjectFlowSnapshot; invoke: Invoke; busy: boolean; onDecide: (round: Round, integration: Integration, verdict: 'pass' | 'reject', reason?: string) => Promise<boolean>; onRecover: (acceptanceId: string, revision: number, choice: 'reconcile' | 'continue') => Promise<boolean>;onCheck:(round:Round,integration:Integration,memberId:string)=>Promise<boolean> }) {
  const toRoundtable=useRoundtableNavigation();
  const integration = data.integrations.find(item => item.id === round.integrationId), acceptance = data.acceptances.find(item => item.id === round.acceptanceId);
  const [diff, setDiff] = useState<{ changes: { path: string; kind: string }[]; text: string } | null>(null), [rejecting, setRejecting] = useState<string | null>(null);
  const awaiting = round.status === 'awaiting_acceptance' && round.requiresUserAcceptance && integration?.status === 'ready';
  const holding = data.decisions.find(item => item.status === 'open' && item.roundId === round.id && ['review-choice', 'meeting-request', 'unresolved-review', 'replan', 'review-dispute'].includes(item.kind));
  const report = round.report ? reportForDisplay(round.report) : undefined,team=useTeam(),[checker,setChecker]=useState(lead),checks=(data.requestedChecks??[]).filter(c=>c.roundId===round.id&&c.integrationId===integration?.id&&c.status==='completed');
  async function showDiff() { if (diff) { setDiff(null); return; } if (!integration?.version) return; try { setDiff(await invoke('projectFlow.artifact.diff', { artifactId: integration.version.artifactId })); } catch {} }
  if (!report && !integration) return <Note icon={<Play size={14} />}>{tr("第 {0} 轮「{1}」{2}，进度看右边的看板。", round.index + 1, round.title, ROUND_STATUS[round.status])}</Note>;
  const label = <span className={`round-chip status-${round.status}`}>{tr("第 {0} 轮成品 · {1}", round.index + 1, round.status === 'awaiting_acceptance' && !round.requiresUserAcceptance ? tr("负责人自验中") : ROUND_STATUS[round.status])}</span>;
  return <MemberLine id={lead} label={label}>
    <article className={`meeting-card round-card status-${round.status} ${awaiting ? 'awaiting' : ''}`} aria-label={tr("第 {0} 轮成品", round.index + 1)}>
      <small className="round-review-level">{tr("本轮实际复核：{0}", REVIEW_LEVEL_LABELS[integration?.reviewLevel??round.effectiveReviewLevel??roundReviewLevel(data.flow!,round)])}</small><strong className="round-card-title">{round.title}{acceptance?.acceptedAt && <small>{dateTime(acceptance.acceptedAt)} {acceptance.requiresApply && acceptance.status==='accepted' ? tr("已完成验收") : tr("负责人自验通过，尚未写回")}</small>}</strong>
      {report ? <div className="round-report"><h4>{tr("这一轮完成了")}</h4><div className="round-report-summary"><Markdown text={readableContent(report.summary)}/></div>
        {report.replyNotes?.map(note=><p className="task-meta" key={note}>{note}</p>)}
        {report.deliverables.length > 0 && <p className="round-deliverables">{report.deliverables.map(item => <span key={item} className="round-file">{item}</span>)}</p>}
        {report.userDecisionNeeded && <p className="round-report-ask"><Hand size={13} />{report.userDecisionNeeded}</p>}
        {report.remainingIssues.length > 0 && <><h4>{tr("还要注意")}</h4><ul>{report.remainingIssues.map(item => <li key={item}>{item}</li>)}</ul></>}
        {report.nextRoundSummary && <><h4>{tr("接下来")}</h4><p>{report.nextRoundSummary}</p></>}</div>
        : <p className="panel-muted">{integration?.checkSummary || tr("正在整合检查，汇报好了会出现在这里。")}</p>}
      {integration && integration.conflicts.length > 0 && <div className="round-conflicts"><AlertTriangle size={14} />{tr("整合时有 {0} 处冲突，负责人会安排修正：", integration.conflicts.length)}<ul>{integration.conflicts.map(item => <li key={item.path}>{item.path}：{item.reason}</li>)}</ul></div>}
      {integration?.version&&toRoundtable&&<button className="link-button" onClick={()=>toRoundtable({projectId:round.projectId,integrationId:integration.id,version:integration.version})}>{tr("送去圆桌评审本轮成果")}</button>}
      {integration?.version&&<RoundResults key={integration.id+":"+acceptance?.status} projectId={round.projectId} roundId={round.id} integrationId={integration.id} invoke={invoke} defaultOpen={awaiting}/>}
      <details className="round-details"><summary>{tr("验证细节")}</summary>
      {report?.systemNotes?.map((note,index)=><p className="round-system-note" key={index}>{note.text}</p>)}
      {report?.validationSummary && <div className="round-validation">{report.validationSummary.split('\n').filter(Boolean).map((line, index) => <p key={index} className={/^(个人任务按配置|本轮 AI 复核|退出码未核实)/.test(line) ? 'round-system-note' : ''}>{line}</p>)}</div>}
      {integration?.criteriaResults&&<div className="round-criteria"><h4>{tr("整轮标准核对")}</h4><ul>{integration.criteriaResults.map((result,index)=><li key={index}>{result.verified?tr("已核实"):tr("未核实")} · {result.criterion}{result.evidence&&<small> · {result.evidence}</small>}</li>)}</ul>{integration.verdict!==integration.outcome&&<small>{tr("成员原结论：")}{integration.verdict}{tr("；流程核对结果：")}{integration.outcome}{tr("。原始记录保留。")}</small>}</div>}
      </details>
      <ReviewDetails projectId={round.projectId} invoke={invoke} artifactId={integration?.version?.artifactId} assessments={integration?.assessments} strengths={integration?.strengths} sources={integration?.checkEvidence} owner={round.deferredUserCriteria??memberCriteria([...(round.completionCriteria??[]),...data.tasks.filter(t=>t.roundId===round.id&&t.status!=='cancelled').flatMap(t=>t.completionCriteria),...(round.index===(data.plan?.rounds.length??0)-1?data.plan?.acceptanceCriteria??[]:[])]).deferred}/>
      {integration?.peerReview&&<details><summary>{tr("另一位成员的整轮评价")}</summary><ReviewDetails projectId={round.projectId} invoke={invoke} artifactId={integration.version?.artifactId} assessments={integration.peerReview.assessments} strengths={integration.peerReview.strengths} sources={integration.peerReview.evidence}/></details>}
      {(round.integrationFixCount>0||Boolean(round.manualRedos?.length)||Boolean(round.userChangeRequests?.length))&&<p className="task-meta">{tr("自动整合修正 {0}/2 · 人工指定重做 {1} 次（每次只做一次） · 用户驳回 {2} 次（单独记录）", round.integrationFixCount, round.manualRedos?.length??0, round.userChangeRequests?.length??0)}</p>}
      {round.manualAcceptance&&<p className="task-meta">{tr("本轮由你进行最终判断：{0}", round.manualAcceptance.reason)}</p>}
      {checks.flatMap(check=>commandExitCodeNotes(check.evidence??[]).map(note=><p className="task-meta" key={check.id+note}>{note}</p>))}
      {integration&&[...integration.advisoryFindings??[],...integration.findings,...integration.peerReview?.findings??[]].some(finding=>finding.disposition==='advice'||finding.severity==='optional')&&<div className="round-suggestions"><h4>{tr("通过后的改进建议")}</h4><ul>{[...integration.advisoryFindings??[],...integration.findings,...integration.peerReview?.findings??[]].filter(finding=>finding.disposition==='advice'||finding.severity==='optional').map((finding,index)=><li key={finding.id+'-'+index}>{finding.severity==='should-fix'?tr("应该改"):tr("可选")} · {finding.location}：{finding.request}</li>)}</ul></div>}
      {checks.map(check=><div className="requested-check" key={check.id}><h4><MemberName id={check.memberId}/> {tr(" · 按你的要求检查：{0}", check.outcome==='pass'?tr("通过"):check.outcome==='changes_requested'?tr("有问题需要修改"):tr("无法下结论"))}</h4><small>{tr("检查只提供结果，由你决定通过或驳回。")}</small><ul>{check.criteriaResults?.map((c,index)=><li key={index}>{c.verified?tr("已核实"):tr("未核实")} · {c.criterion}：{c.evidence}</li>)}{check.findings?.map(f=><li key={f.id}>{f.location}：{f.request}</li>)}</ul><ReviewDetails projectId={round.projectId} invoke={invoke} artifactId={check.version.artifactId} assessments={check.assessments} strengths={check.strengths} sources={check.evidence}/></div>)}{awaiting&&integration&&<div className="round-actions"><select aria-label={tr("第 {0} 轮检查成员", round.index+1)} value={checker} disabled={busy} onChange={e=>setChecker(e.target.value)}>{data.flow?.memberIds.map(id=><option key={id} value={id}>{team.get(id)?.name??id}</option>)}</select><button type="button" className="button small secondary" disabled={busy||!allowed(round.allowedActions,'projectFlow.round.requestCheck')} onClick={()=>void onCheck(round,integration,checker)}>{tr("请人复核")}</button></div>}{integration?.version && <div className="round-files"><button type="button" className="link-button" onClick={() => void showDiff()}><FileDiff size={13} />{diff ? tr("收起改动") : tr("查看这一轮的改动")}</button>
        {diff && <div className="round-diff"><ul>{diff.changes.map(change => <li key={change.path} className={`change-${change.kind}`}>{change.kind === 'added' ? tr("新增") : change.kind === 'deleted' ? tr("删除") : tr("修改")} {change.path}</li>)}</ul>{diff.text && <pre>{diff.text.slice(0, 40000)}</pre>}</div>}</div>}
      {acceptance?.status === 'applying' && <p className="round-apply"><LoaderCircle size={13} className="spin" />{tr("正在把成品写入项目文件夹…")}</p>}
      {acceptance?.status === 'conflict' && <div className="round-conflicts"><AlertTriangle size={14} />{tr("写入前发现项目里这些文件已经被改过，没有写入任何文件：")}<ul>{acceptance.conflictPaths.map(path => <li key={path}>{path}</li>)}</ul>{tr("处理好这些文件后可以重新通过。")}</div>}
      {acceptance?.status === 'recovery_required' && <div className="round-conflicts bad" role="alert"><AlertTriangle size={14} />{tr("验收处理中断，请核对后继续。")}<div className="round-actions"><button type="button" className="button small secondary" disabled={busy} onClick={() => void onRecover(acceptance.id, acceptance.revision, 'reconcile')}>{tr("核对已写入的文件")}</button><button type="button" className="button small secondary" disabled={busy} onClick={() => void onRecover(acceptance.id, acceptance.revision, 'continue')}>{tr("继续写入剩下的")}</button></div></div>}
      {awaiting && <FlowDockActions><div className="round-verdict" role="group" aria-label={tr("第 {0} 轮成品", round.index + 1)}>
      <small className="round-verdict-label">{tr("第 {0} 轮 · {1}", round.index + 1, round.title)}</small>
      {rejecting === null && <div className="round-actions verdict">
        {holding && <small className="round-hold">{tr("先在上面处理「{0}」，再通过或驳回。", holding.title)}</small>}
        <button type="button" className="button primary" disabled={busy || !allowed(round.allowedActions, 'projectFlow.round.accept')} title={action(round.allowedActions, 'projectFlow.round.accept')?.reason ?? tr("通过后，这一轮的成品会写回项目文件夹")} onClick={() => void onDecide(round, integration!, 'pass')}><ThumbsUp size={14} />{tr("通过")}</button>
        <button type="button" className="button danger-outline" disabled={busy || !allowed(round.allowedActions, 'projectFlow.round.requestChanges')} title={action(round.allowedActions, 'projectFlow.round.requestChanges')?.reason ?? tr("负责人会复查并安排修正")} onClick={() => setRejecting('')}><ThumbsDown size={14} />{tr("驳回")}</button>
        <small>{tr("通过后写回项目文件夹；驳回交给负责人修正。")}</small></div>}
      {rejecting !== null && <div className="round-reject"><textarea rows={2} autoFocus aria-label={tr("驳回理由（可选）")} placeholder={tr("要改什么？可以不写，负责人会自己复查。")} value={rejecting} disabled={busy} onChange={event => setRejecting(event.target.value)} />
        <div className="round-actions"><button type="button" className="button small danger-outline" disabled={busy} onClick={() => void onDecide(round, integration!, 'reject', rejecting).then(ok => { if (ok) setRejecting(null); })}><ThumbsDown size={13} />{tr("确定驳回")}</button><button type="button" className="button small quiet" disabled={busy} onClick={() => setRejecting(null)}>{tr("取消")}</button></div></div>}
      </div></FlowDockActions>}
    </article>
  </MemberLine>;
}

export function DecisionCard({ decision, tasks, rounds,busy, onAnswer }: { decision: Decision; tasks: Task[];rounds:Round[]; busy: boolean; onAnswer: (params: { choice: string; selectedTaskIds?: string[]; allowAllEligible?: boolean;memberId?:string;opinion?:string;rulings?:DisputeRuling[] }) => Promise<boolean> }) {
  const eligible = decision.eligibleTaskIds.map(id => tasks.find(task => task.id === id)).filter((task): task is Task => Boolean(task));
  const [picked, setPicked] = useState<string[]>(() => eligible.map(task => task.id));
  const team=useTeam(),[memberId,setMemberId]=useState(''),[opinion,setOpinion]=useState(''),[rulings,setRulings]=useState<Record<string,DisputeRuling['verdict']>>({});const requiresMember=(option:string)=>[tr("重新安排"),tr("换人复核"),tr("换负责人检查"),tr("换人接手")].includes(option);
  const recommendation=rounds.find(r=>r.id===decision.roundId)?.nextConfirmation?.recommendation,disputes=decision.disputeItems??[];
  const early = decision.kind === 'early-start';
  return <section className="meeting-card decision-card" aria-label={tr("决策：{0}", decision.title)}>
    <div className="decision-card-head"><Hand size={15} /><strong>{decision.title}</strong></div>
    <p className="decision-reason">{plainFlowError(decision.reason)}</p>
    {decision.kind==='next-round'&&<div className="next-round-adjustments"><small>{tr("沿用现有负责人和分工。较大的方向或范围变化，请选“要求修改方案”。")}</small>{recommendation?.taskAdjustments.map(a=><div key={a.taskId}><strong>{tasks.find(t=>t.id===a.taskId)?.title}</strong>{a.goal&&<p>{tr("目标：{0}", a.goal)}</p>}{a.inputs?.length&&<p>{tr("补充输入：{0}", joinClauses(a.inputs,'；'))}</p>}{a.completionCriteria&&<ul>{a.completionCriteria.map(c=><li key={criterionText(c)}>{tr("核对标准：{0}", criterionText(c))}</li>)}</ul>}</div>)}{recommendation?.completionCriteria&&<ul>{recommendation.completionCriteria.map(c=><li key={criterionText(c)}>{tr("整轮标准：{0}", criterionText(c))}</li>)}</ul>}</div>}
    {decision.kind==='review-dispute'&&<div className="review-disputes"><small>{tr("每项任务最多返还 {0} 次退回次数；超过后仍可裁定，退回正常计数。你可统一裁定，也可逐条选择。", FLOW_LIMITS.disputeReturnWaivers)}</small>{disputes.map(({finding,reason})=><div key={finding.id}><strong>{finding.location} · {finding.request}</strong><p>{tr("复核依据：{0}", finding.evidence)}</p><p>{tr("作者异议：{0}", reason)}</p><label>{tr("逐条裁定")}<select aria-label={tr("裁定「{0}」", finding.request)} value={rulings[finding.id]??''} disabled={busy} onChange={e=>setRulings({...rulings,[finding.id]:e.target.value as DisputeRuling['verdict']})}><option value="">{tr("请选择…")}</option><option value="uphold-author">{tr("支持作者")}</option><option value="uphold-review">{tr("维持复核")}</option></select></label></div>)}</div>}
    {decision.kind==='replan'&&<small>{tr("{0}人工指定后只重做一次，历史修正次数不清零。", decision.stage==='integration-fix'?tr("仅替换本轮负责人，重做卡住的整合事项；后续轮次仍由原负责人负责。"):tr("仅重做这项任务，保留其他成员已通过的成果。"))}</small>}
    {decision.options.some(requiresMember)&&<label>{tr("选择接手成员")}<select aria-label={tr("为「{0}」选择成员", decision.title)} value={memberId} disabled={busy} onChange={event=>setMemberId(event.target.value)}><option value="">{tr("请选择…")}</option>{(decision.eligibleMemberIds??[]).map(id=><option key={id} value={id}>{team.get(id)?.name??id}</option>)}</select></label>}
    {!early&&<textarea aria-label={tr("「{0}」的补充意见", decision.title)} rows={2} placeholder={tr("补充意见（可选）")} disabled={busy} value={opinion} onChange={event=>setOpinion(event.target.value)}/>}
    {early && eligible.length > 0 && <div className="decision-tasks">{eligible.map(task => <label key={task.id}><input type="checkbox" checked={picked.includes(task.id)} disabled={busy} onChange={event => setPicked(previous => event.target.checked ? [...previous, task.id] : previous.filter(id => id !== task.id))} /><MemberName id={task.memberId} /><span>{task.title}</span></label>)}
      <small>{tr("提前开工以已复核的成果为起点；如果这一轮后来又改了它依赖的内容，提前做的部分会标为过期、等待重新安排。")}</small></div>}
    <div className="round-actions">{decision.options.map(option => {
      const allows = early && option === '允许提前开工';
      return <button key={option} type="button" className={`button small ${allows||option==='按原计划开始'||option==='按调整开始' ? 'primary' : 'secondary'}`} disabled={busy || allows && !picked.length || requiresMember(option)&&!memberId || option==='提交逐条裁定'&&disputes.some(d=>!rulings[d.finding.id]) || !allowed(decision.allowedActions, 'projectFlow.decision.answer')} onClick={() => void onAnswer(allows ? { choice: option, ...(picked.length === eligible.length ? { allowAllEligible: true } : { selectedTaskIds: picked }) } : { choice: option,opinion,...(requiresMember(option)?{memberId}:{}),...(option==='提交逐条裁定'?{rulings:disputes.map(d=>({findingId:d.finding.id,verdict:rulings[d.finding.id],reason:opinion||tr("用户逐条裁定")}))}:{}) })}>{option}{allows && picked.length !== eligible.length ? tr("（{0} 项）", picked.length) : ''}</button>;
    })}</div>
  </section>;
}

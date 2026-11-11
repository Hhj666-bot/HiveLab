import {t as tr} from './i18n';
import {ActiveRunProgress} from "./run-progress";
import {RoomHeader} from "./room-header";
import {WorkspaceToolbarPrimary} from "./workspace-toolbar";
import {plainFlowError} from "../shared/content-presentation";
import {RoundResults} from "./round-results";
import {WORKBENCH_READS} from "../shared/project-workbench";
import {PROGRESS_READS} from "../shared/project-progress";
import {ProjectProgressView} from "./project-progress";
import {ProjectRecordView} from "./project-record";
import {TaskAdditionView} from "./task-addition";
import type {TaskAddition} from "../shared/project-workbench";
import {WorkLog} from "./work-log";
import {LOG_READS, type LogTarget} from "../shared/work-log";
import {RESULT_READS} from "../shared/round-results";
import {useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {AlertTriangle, Check, CheckCircle2, FolderOpen, Hand, PanelRightClose, PanelRightOpen, LoaderCircle, Pause, Play, ScrollText, Sparkles, Square, X} from "lucide-react";
import type {FlowOperation, Integration, ProjectFlowSnapshot, Round, Task} from "../shared/project-flow";
import {reviewLevel, roundLead, REVIEW_LEVEL_LABELS, REVIEW_LEVEL_HINTS, QUOTA_STAGE_LABELS, type ReviewLevel} from "../shared/project-flow";
import type {Project, RoomId, RoomMessage, Snapshot} from "../shared/types";
import {Avatar, useTeam, type TeamMember} from "./members";
import {RoomView} from "./room";
import {migrateProjectMembers, projectMembers, saveProjectMembers} from "./project-members";
import {dateTime, runnable, time, type Invoke} from "./ui";
import {Modal} from "./modals";
import {MemberConfigFields, MemberRunConfig} from "./member-config";
import {ReportSwitcher, type ReportEntry} from "./report-switcher";
import type {RoundtableSource} from "../shared/roundtable";
import {JOINT_READS} from "../shared/joint-review";
import type {ConfigSelection} from "../shared/executor-config";import './project-progress.css';

import {MemberName} from "./project-room/people";
import {ROUND_STATUS, REJECT_DEFAULT, OPERATION_KIND, requestId, action, allowed} from "./project-room/flow-ui";
import {FlowMessage, FlowDock, LeadPicker} from "./project-room/meeting-surface";
import {PlanCard, RoundCard, DecisionCard} from "./project-room/decision-cards";
import {Board} from "./project-room/task-board";
import {CompletionReport, GiveUp} from "./project-room/flow-results";
export {GiveUp,SupplementReceipts} from './project-room/flow-results';
const STEPS = ['讨论', '定负责人', '方案', '执行', '验收', '完成'];

export const PROJECT_FLOW_READS = [...JOINT_READS,...PROGRESS_READS,...WORKBENCH_READS,...RESULT_READS,...LOG_READS, 'project.openPath','projectFlow.get', 'projectFlow.detail', 'projectFlow.history', 'projectFlow.artifact.files', 'projectFlow.artifact.read', 'projectFlow.artifact.diff'];

export function ProjectRoom({ snapshot, project, invoke, onOpenSession,onRoundtable,reports=[],onOpenReport }: { snapshot: Snapshot; project: Project; invoke: Invoke; onOpenSession: (sessionId: string) => void;onRoundtable?:(source:Omit<RoundtableSource,'projectId'>|{topicId:string})=>void;reports?:ReportEntry[];onOpenReport?:(memberId:string)=>void }) {
  const team = useTeam();
  const primaryToolbar=useContext(WorkspaceToolbarPrimary);
  const [logTarget,setLogTarget]=useState<LogTarget|null>(null);
  const [boardOpen,setBoardOpen]=useState(()=>{try{return localStorage.getItem('hivelab.projectBoard')!=='closed';}catch{return true;}});
  const toggleBoard=(open:boolean)=>{setBoardOpen(open);try{localStorage.setItem('hivelab.projectBoard',open?'open':'closed');}catch{}};
  const [recordOpen,setRecordOpen]=useState(false),[includePreviousRecord,setIncludePreviousRecord]=useState(true),[addition,setAddition]=useState<{memberId:string;goal:string;task?:Task;proposal?:TaskAddition;skills?:import('../shared/message-skills').MessageSkillTag[]}|null>(null);
  const [boardView,setBoardView]=useState<'work'|'progress'>('work');
  useEffect(()=>setBoardView('work'),[project.id]);
  const [config,setConfig]=useState<{memberId:string;value:ConfigSelection;revision:number}|null>(null),[configBusy,setConfigBusy]=useState(false),[configError,setConfigError]=useState('');
  useEffect(()=>{setConfig(null);setConfigError('');},[project.id]);
  useEffect(()=>setLogTarget(null),[project.id]);
  const roomId = `project:${project.id}` as RoomId;
  const [data, setData] = useState<ProjectFlowSnapshot | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [starting, setStarting] = useState(false), [picking, setPicking] = useState(false);
  const [newReviewLevel,setNewReviewLevel]=useState<ReviewLevel>('medium'), [dockOpen, setDockOpen] = useState(true);
  const nextStepBody=useRef<HTMLDivElement>(null);
  function revealStep(target:string){setDockOpen(true);window.requestAnimationFrame(()=>{const node=nextStepBody.current?.querySelector<HTMLElement>(target);if(node){node.scrollIntoView({block:'nearest'});node.tabIndex=-1;node.focus({preventScroll:true});
    // The card may already be in view: a short highlight shows where the step is.
    node.classList.remove('flow-step-flash');void node.offsetWidth;node.classList.add('flow-step-flash');window.setTimeout(()=>node.classList.remove('flow-step-flash'),1400);}});}
  const ready = (member: TeamMember) => runnable(snapshot.providers.find(info => info.id === member.executor));
  // Who takes part: chosen in 请大家一起来 (or the running flow's team); the chips above the composer change it.
  const [roster, setRoster] = useState<string[]>(() => projectMembers(project));
  // The saved list is the truth; a list kept by an older version in this browser moves onto the project once.
  useEffect(() => { setRoster(projectMembers(project)); }, [project.id, JSON.stringify(project.memberIds)]);
  useEffect(() => { void migrateProjectMembers(invoke, project); }, [project.id]);
  const loading = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++loading.current;
    try { const result = await invoke<ProjectFlowSnapshot>('projectFlow.get', { projectId: project.id }); if (ticket === loading.current) { setData({...result,jointReviews:result.jointReviews??[],blockedOperations:result.blockedOperations??[]}); setError(''); } }
    catch (cause) { if (ticket === loading.current) setError((cause as Error).message); }
  }, [invoke, project.id]);
  // The overview in every snapshot says when this project's flow moved; reload then, not on unrelated broadcasts.
  const overview = snapshot.projectFlows?.find(item => item.projectId === project.id);
  const stamp = JSON.stringify([overview,snapshot.jointReviews?.filter(r=>r.projectId===project.id), snapshot.runs.filter(run => run.projectId === project.id && run.flowOperationId).map(run => [run.id, run.status, run.updatedAt])]);
  useEffect(() => { void load(); }, [load, stamp]);
  // Blocked attempts share the same saved revision as the board and reasons.
  const blocked = data?.blockedOperations ?? [];
  useEffect(() => { setData(null); setStarting(false); setPicking(false); }, [project.id]);

  const flow = data?.flow ?? null, plan = data?.plan ?? null;
  const live = Boolean(flow && !['completed', 'cancelled'].includes(flow.status));
  const fresh = !flow || !live && starting;
  // A team that already works on this project is its roster until the owner picks people.
  useEffect(() => { if (!roster.length && flow?.memberIds.length) setRoster(flow.memberIds); }, [flow?.id]);
  const changeRoster = (ids: string[]) => { setRoster(ids); void saveProjectMembers(invoke, project.id, ids).catch(() => setRoster(projectMembers(project))); };
  const rounds = useMemo(() => (data?.rounds ?? []).filter(round => round.planId === flow?.activePlanId).sort((a, b) => a.index - b.index), [data, flow?.activePlanId]);
  const tasks = useMemo(() => (data?.tasks ?? []).filter(task => task.planId === flow?.activePlanId), [data, flow?.activePlanId]);
  const awaitingRound = rounds.find(round => round.status === 'awaiting_acceptance' && round.requiresUserAcceptance);
  // Stuck tasks with no blocked attempt to give up: 继续 retries them (the backend decides which; this only decides what to show).
  const stuckTasks = tasks.filter(task => task.status === 'blocked' && !(data?.decisions ?? []).some(d => d.status === 'open' && d.taskId === task.id));
  const canRetry = Boolean(flow && (flow.blockedReasons.length || stuckTasks.length));
  const step = fresh ? (picking ? 1 : 0) : flow!.status === 'completed' ? 6 : flow!.status === 'cancelled' ? -1 : flow!.status !== 'active' ? 2 : awaitingRound ? 4 : 3;

  const resolveAttempt=(op:FlowOperation,choice:'abandon'|'continue',evidence:string)=>mutate('projectFlow.unknown.resolve',{operationId:op.id,expectedRevision:op.revision,choice,evidence},choice==='continue'?tr("已记录接着做：沿用原会话和工作副本。"):tr("已放弃这次尝试，历史记录保留。"));
  const giveUp = (op: FlowOperation, evidence: string) => resolveAttempt(op,'abandon',evidence);
  const resultUnknown = (op: FlowOperation) => { const run = snapshot.runs.find(item => item.id === (op.correctionRunId ?? op.runId)); return Boolean(run && (run.status === 'unknown' || run.delivery === 'unknown') || data?.tasks.some(task => task.supplements?.some(item => item.status === 'unknown' && item.deliveryOperationId === op.id))); };
  async function mutate(method: string, params: Record<string, unknown>, success?: string) {
    setBusy(true);
    try { await invoke(method, { requestId: requestId(), ...params }, success); await load(); return true; } catch { await load(); return false; } finally { setBusy(false); }
  }
  async function decide(round: Round, integration: Integration, verdict: 'pass' | 'reject', reason = '') {
    if (verdict === 'pass') return mutate('projectFlow.round.accept', { roundId: round.id, expectedRevision: round.revision, integrationId: integration.id, fingerprint: integration.version?.fingerprint, opinion: tr("验收通过") }, tr("已通过，正在把成品写入项目。"));
    return mutate('projectFlow.round.requestChanges', { roundId: round.id, expectedRevision: round.revision, integrationId: integration.id, opinion: reason.trim() || tr(REJECT_DEFAULT) }, tr("已驳回，负责人会安排修正。"));
  }
  /** The plan is drafted from this room's discussion, which the backend brings along; it says so when there is none yet. */
  async function start(leadMemberId: string, memberIds: string[]) {
    const ok = await mutate('projectFlow.start', { projectId: project.id, leadMemberId, memberIds, reviewLevel: newReviewLevel,includePreviousRecord }, tr("已请负责人根据讨论起草方案，你确认后才开工。"));
    if (ok) { setStarting(false); setPicking(false); setError(''); }
  }

  const people = roster.map(id => team.get(id)).filter((member): member is TeamMember => Boolean(member));
  const planOp = blocked.find(op => op.kind === 'plan');
  const actionable = (round: Round) => { const acceptance = data?.acceptances.find(item => item.id === round.acceptanceId); return round.status === 'awaiting_acceptance' && round.requiresUserAcceptance || ['recovery_required', 'conflict', 'applying'].includes(acceptance?.status ?? ''); };
  const openDecisions = (data?.decisions ?? []).filter(item => item.status === 'open');
  const lastAccepted = rounds.filter(round => round.status === 'accepted').at(-1), lastAcceptance = lastAccepted && data?.acceptances.find(item => item.id === lastAccepted.acceptanceId);
  const acceptedLine = lastAccepted && lastAcceptance?.acceptedAt ? lastAcceptance.actor === 'lead' ? tr("第 {0} 轮「{1}」负责人自验通过，已进入第 {2} 轮；成品会在你下次验收时一起写回项目", lastAccepted.index + 1, lastAccepted.title, lastAccepted.index + 2) : tr("第 {0} 轮「{1}」已验收 · {2} 写回项目", lastAccepted.index + 1, lastAccepted.title, dateTime(lastAcceptance.acceptedAt)) : '';
  const roundOf = (roundId?: string) => { const round = rounds.find(item => item.id === roundId); return round ? tr("第 {0} 轮：", round.index + 1) : ''; };
  const currentRound = rounds.find(round => round.id === flow?.currentRoundId) ?? rounds.find(round => round.status !== 'accepted');
  const roundCard = (round: Round) => <RoundCard key={round.id} round={round} lead={roundLead(flow!,round)} data={data!} invoke={invoke} busy={busy} onDecide={decide} onCheck={(round,integration,memberId)=>mutate('projectFlow.round.requestCheck',{roundId:round.id,expectedRevision:round.revision,integrationId:integration.id,memberId},tr("已安排一次整轮检查，结果交回你决定。"))}
    onRecover={(acceptanceId, revision, choice) => mutate('projectFlow.acceptance.recover', { acceptanceId, expectedRevision: revision, choice }, choice === 'continue' ? tr("已继续写入剩下的文件。") : tr("已核对写入结果。"))} />;

  // What needs the owner now, in the order the work asks for it.
  const items = !data ? null : <>
    {fresh ? (picking
      ? <LeadPicker team={people} ready={ready} busy={busy} onCancel={() => setPicking(false)} onStart={start} />
      : <div className="dock-row"><Sparkles size={15} /><p>{tr("{0}先在聊天里和大家说说这次要做什么、有什么要求。讨论清楚了，再选一位负责人起草方案；", flow && !live ? tr("上一段工作已经结束。") : '')}<strong>{tr("你确认方案后才开工")}</strong>。</p></div>)
    : <>
      {!live && <div className="dock-row"><CheckCircle2 size={15} /><p>{flow!.status === 'completed' ? tr("这段工作已经完成，成品已写回项目。") : tr("这段工作已取消，记录和成果都保留着。")}</p><button type="button" className="button small primary" disabled={busy} onClick={() => setStarting(true)}><Sparkles size={13} />{tr("开始新的一段工作")}</button></div>}
      {!live && flow!.completionReport && <CompletionReport report={flow!.completionReport} />}
      {live && flow!.status === 'planning' && !plan && (planOp || flow!.dispatchMode !== 'running'
        ? <div className="dock-row"><AlertTriangle size={15} /><p><strong>{tr("方案起草已停止。")}</strong>{planOp ? tr("在下面的提示里放弃这次起草，再点右上角“继续”，负责人会重新起草。") : tr("点右上角“继续”，负责人会接着起草。")}</p></div>
        : <div className="dock-row"><LoaderCircle size={15} className="spin" /><p><MemberName id={flow!.leadMemberId} /> {tr(" 正在根据讨论起草方案…")}</p></div>)}
      {live && plan && (plan.status === 'awaiting_confirmation') && <div data-flow-next="plan"><PlanCard plan={plan} invoke={invoke} lead={flow!.leadMemberId} rounds={rounds} busy={busy} defaultLevel={reviewLevel(flow!)} onRoundLevel={(round,level)=>mutate('projectFlow.review.configure',{flowId:flow!.id,expectedRevision:flow!.revision,roundId:round.id,reviewLevel:level},tr("本轮复核程度已调整。"))} onConfirm={(choices,peerChoices,levels) => mutate('projectFlow.plan.confirm', { planId: plan.id, expectedRevision: plan.revision, requiresUserAcceptanceByRound: choices,requiresPeerReviewByRound:peerChoices,reviewLevelByRound:levels }, tr("方案已确认，开始派发任务。"))} onRevise={instruction => mutate('projectFlow.plan.revise', { planId: plan.id, expectedRevision: plan.revision, instruction }, tr("已请负责人按你的意见改方案。"))} /></div>}
      {live && (blocked.length > 0 || flow!.blockedReasons.length > 0 || stuckTasks.length > 0) && <div data-flow-next="blocked" className="meeting-alert" role="alert"><AlertTriangle size={15} /><div><strong>{tr("流程暂停了，需要你先看一下")}</strong>
        {blocked.length ? blocked.map(op => { const task = data.tasks.find(item => item.id === op.targetId); return <div key={op.id} className="meeting-alert-item">
          <p><strong>{OPERATION_KIND[op.kind] ?? op.kind}{task ? `：${task.title}` : ''}</strong>　{plainFlowError(op.error)}</p>
          <GiveUp task={op.kind === 'task'} unknown={resultUnknown(op)} supplement={op.kind === 'supplement-delivery'} busy={busy} onContinue={op.kind!=='supplement-delivery'?evidence=>resolveAttempt(op,'continue',evidence):undefined} onConfirm={evidence => giveUp(op, evidence)} /></div>; })
          : [...new Set([...flow!.blockedReasons, ...stuckTasks.map(task => task.blockedReason ?? tr("{0} 卡住了", task.title))])].map(reason => <p key={reason}>{plainFlowError(reason)}</p>)}
        <small>{blocked.length ? tr("结果未知的运行不会自动重发。处理完卡住的尝试后，点右上角的“继续”。") : tr("无法下结论请使用下方决策卡，任务成果保留；尚未开始就失败的任务可点“继续”重试。")}</small></div></div>}
      {live && (data.quotaWaits ?? []).map(wait => <div key={wait.id} className="dock-row"><LoaderCircle size={15} className="spin" /><p>{tr("等待 ")}<MemberName id={wait.memberId} /> {tr(" 额度恢复 · {0} · 从 {1} 开始；满 10 分钟会请你决定继续等还是换人。", QUOTA_STAGE_LABELS[wait.stage], time(wait.startedAt))}</p></div>)}
      {live && openDecisions.map(decision => <div key={decision.id} data-flow-next="decision"><DecisionCard decision={decision} tasks={data.tasks} rounds={data.rounds} busy={busy} onAnswer={params => mutate('projectFlow.decision.answer', { decisionId: decision.id, expectedRevision: decision.revision, ...params }, tr("已记录你的决定。"))} /></div>)}
      {live && rounds.filter(actionable).map(round=><div key={round.id} data-flow-next="acceptance">{roundCard(round)}</div>)}
      {acceptedLine && <div className="dock-row"><CheckCircle2 size={15} /><p>{acceptedLine}</p></div>}
    </>}
  </>;
  // Folded, the dock says what waits first (or where the work stands); a new item to handle opens it.
  const waiting: string[] = [], standing: string[] = [];
  if (data) {
    if (fresh) standing.push(picking ? tr("选一位负责人，由 TA 根据讨论起草方案") : tr("讨论清楚后，选负责人起草方案"));
    else {
      if (!live) standing.push(flow!.status === 'completed' ? tr("这段工作已经完成，成品已写回项目") : tr("这段工作已取消，记录和成果都保留着"));
      if (live && flow!.status === 'planning' && !plan) { if (planOp || flow!.dispatchMode !== 'running') waiting.push(tr("方案起草已停止")); else standing.push(tr("{0} 正在根据讨论起草方案…", team.get(flow!.leadMemberId)?.name ?? tr("负责人"))); }
      if (live && plan?.status === 'awaiting_confirmation') waiting.push(tr("确认方案第 {0} 版", plan.version));
      if (live && (blocked.length > 0 || flow!.blockedReasons.length > 0 || stuckTasks.length > 0)) waiting.push(tr("流程暂停了，需要你先看一下"));
      if (live) for (const wait of data.quotaWaits ?? []) standing.push(tr("等待 {0} 额度恢复", team.get(wait.memberId)?.name ?? tr("成员")));
      if (live) for (const decision of openDecisions) waiting.push(roundOf(decision.roundId) + decision.title);
      if (live) for (const round of rounds.filter(actionable)) waiting.push(tr("第 {0} 轮成品待验收", round.index + 1));
      if (acceptedLine) standing.push(acceptedLine);
    }
  }
  const waitingKey = waiting.join('|');
  useEffect(() => { if (waitingKey) setDockOpen(true); }, [waitingKey]);
  const nextStep=live&&blocked.length?{label:tr("核对中断结果"),run:()=>revealStep('[data-flow-next="blocked"]')}
    :live&&plan?.status==='awaiting_confirmation'?{label:tr("查看并确认方案"),run:()=>revealStep('[data-flow-next="plan"]')}
    :live&&openDecisions.length?{label:tr("处理当前决定"),run:()=>revealStep('[data-flow-next="decision"]')}
    :live&&rounds.some(actionable)?{label:tr("查看成品并验收"),run:()=>revealStep('[data-flow-next="acceptance"]')}
    :live&&flow!.dispatchMode!=='running'&&allowed(data!.allowedActions,'projectFlow.resume')?{label:tr("继续这段工作"),run:()=>void mutate('projectFlow.resume',{flowId:flow!.id,expectedRevision:flow!.revision},tr("已继续派发。"))}:undefined;
  const dock = !data || !waiting.length && !standing.length ? null : <FlowDock open={dockOpen} onToggle={setDockOpen} waiting={waiting} standing={standing}
    bodyRef={nextStepBody} action={fresh && !picking ? <button type="button" className="button small primary" disabled={busy || people.filter(ready).length < 2} title={people.filter(ready).length < 2 ? tr("至少需要两位已准备好的成员参加") : ''} onClick={() => { setPicking(true); setDockOpen(true); }}><Hand size={13} />{tr("选负责人，起草方案")}</button> : nextStep?<span className="flow-next-step" role="group" aria-label={tr("项目下一步")}><small>{tr("下一步")}</small><button type="button" className="button small primary" disabled={busy} onClick={nextStep.run}>{nextStep.label}</button></span>:undefined}>{items}</FlowDock>;

  /** Flow messages in the chat: what was posted and where it stands now; acting on it happens in the dock. */
  const renderFlow = (message: RoomMessage) => {
    if (!data) return undefined;
    if(message.roundtable)return <FlowMessage title={tr("圆桌带回的材料")} status={tr("已保存引用")} pending={false} text={message.text} onOpen={()=>onRoundtable?.({topicId:message.roundtable!.topicId})} headerAction={<button className="link-button" onClick={()=>onRoundtable?.({topicId:message.roundtable!.topicId})}>{tr("打开圆桌议题")}</button>}/>;
    if(message.jointReview)return <FlowMessage title={tr("历史共同评审结论")} status={tr("只读")} pending={false} text={message.text} onOpen={()=>{}}/>;
    let title = '', status = '', pending = false;
    if (message.flowPlan) { const summary = data.plans?.find(item => item.id === message.flowPlan!.planId) ?? (data.plan?.id === message.flowPlan.planId ? data.plan : undefined); title = tr("方案 · 第 {0} 版", message.flowPlan.version); status = summary ? PLAN_STATUS[summary.status] ?? summary.status : ''; pending = summary?.status === 'awaiting_confirmation' && summary.id === flow?.activePlanId; }
    else if (message.flowDecision) { const decision = data.decisions.find(item => item.id === message.flowDecision!.decisionId); title = decision ? tr("决策 · {0}", decision.title) : tr("决策"); pending = message.flowDecision.status === 'open' && decision?.status === 'open'; status = message.flowDecision.status === 'open' ? (pending ? tr("待你决定") : decision?.status === 'answered' ? tr("已处理") : tr("已过期")) : message.author === 'user' ? tr("你的决定") : tr("已结束"); }
    else if (message.flowReport) { const round = data.rounds.find(item => item.id === message.flowReport!.roundId); title = round ? tr("第 {0} 轮 · {1} · 汇报", round.index + 1, round.title) : tr("轮次汇报"); pending = Boolean(round && actionable(round) && round.integrationId === message.flowReport.integrationId); status = round ? round.integrationId !== message.flowReport.integrationId ? tr("已被新的汇报替代") : ROUND_STATUS[round.status] : ''; }
    return <FlowMessage compact={Boolean(message.flowDecision)} title={title} status={status} pending={pending} text={message.text} onOpen={() => setDockOpen(true)}>{(message.flowPlan||message.flowReport)&&onRoundtable&&<button className="link-button" onClick={()=>onRoundtable(message.flowPlan?{planId:message.flowPlan.planId}:{integrationId:message.flowReport!.integrationId})}>{tr("送去圆桌评审")}</button>}{message.flowReport&&!pending&&<><button className="link-button" onClick={()=>void invoke<{title:string;markdown:string}>('projectFlow.round.report.export',{projectId:project.id,roundId:message.flowReport!.roundId}).then(r=>invoke('file.save',{name:r.title+'.md',content:r.markdown})).catch(e=>setError((e as Error).message))}>{tr("导出本轮汇报")}</button><RoundResults key={message.flowReport.integrationId} projectId={project.id} roundId={message.flowReport.roundId} integrationId={message.flowReport.integrationId} invoke={invoke}/></>}</FlowMessage>;
  };

  const reviewNames={high:tr("深入复核"),medium:tr("标准复核"),low:tr("快速推进")};
  const toolbarSettings=<div className="project-toolbar-settings" role="group" aria-label={tr("会议室设置")}>{data&&(fresh||live)&&<div className="project-review-level" role="group" aria-label={tr("复核设置")}><select aria-label={tr("项目复核程度")} disabled={busy} value={fresh?newReviewLevel:reviewLevel(flow!)} title={tr("{0}\n调整只影响尚未开始的复核，已完成和在途的复核记录保留。", REVIEW_LEVEL_HINTS[fresh?newReviewLevel:reviewLevel(flow!)])} onChange={event=>{const level=event.target.value as ReviewLevel;if(fresh)setNewReviewLevel(level);else void mutate('projectFlow.review.configure',{flowId:flow!.id,expectedRevision:flow!.revision,reviewLevel:level},tr("复核程度已调整，已完成的记录保留。"));}}>{(['high','medium','low'] as const).map(level=><option key={level} value={level} title={REVIEW_LEVEL_LABELS[level]} aria-label={REVIEW_LEVEL_LABELS[level]}>{reviewNames[level]}</option>)}</select></div>}</div>;
  return <main data-page-loading={!data&&!error?'':undefined} className="project-room" aria-label={tr("{0} 的项目会议室", project.name)}>
    {primaryToolbar?createPortal(toolbarSettings,primaryToolbar):toolbarSettings}
    <RoomHeader toolbar className="project-workspace-header"><header className="room-head"><div className="room-identity">
      <span className="room-icon"><FolderOpen size={19}/></span>
      <div className="room-title"><h1>{tr("{0} 的会议室", project.name)}</h1>{flow&&live&&data?.overview.stage?<p className="project-stage" aria-label={tr("当前阶段")} title={tr("项目原目录：{0}\n任务在独立副本中执行，验收后写回。", project.directory)}>{currentRound && flow.status === 'active' && <strong>{tr("第 {0} 轮「{1}」 · ", currentRound.index + 1, currentRound.title)}</strong>}{tr("{0} · 本轮负责人 ", data.overview.stage.label)}<MemberName id={data.overview.stage.leadMemberId??flow.leadMemberId}/><span className="project-stage-review"> · {REVIEW_LEVEL_LABELS[reviewLevel(flow)]}</span></p>:<p title={tr("项目原目录：{0}\n讨论只读；任务在独立副本中执行，验收后写回。", project.directory)}>{tr("项目原目录：{0}", project.directory)}<span className="project-room-note"> {tr(" · 任务在独立副本中执行，验收后写回")}</span></p>}</div>
    </div></header></RoomHeader>
    <section className="project-room-summary" aria-label={tr("项目流程")}>
    {flow&&(fresh||live)&&<header className="project-room-head">
      
      {fresh&&flow&&<label className="project-record-setting"><input type="checkbox" checked={includePreviousRecord} onChange={e=>setIncludePreviousRecord(e.target.checked)}/>{tr("起草时参考上一段记录")}</label>}
      {flow && live && <div className="project-room-numbers" aria-label={tr("本段工作进度")}>
        <span><strong>{data!.overview.working}</strong>{tr("在做")}</span><span><strong>{data!.overview.remaining}</strong>{tr("待完成")}</span>
        <span className={data!.overview.needsUser ? 'needs-user' : ''}><strong>{data!.overview.needsUser}</strong>{tr("待你决定")}</span></div>}

      {flow && live && <div className="project-room-controls">
        {flow.dispatchMode === 'running' && !canRetry
          ? <button type="button" className="button small secondary" disabled={busy || !allowed(data!.allowedActions, 'projectFlow.pause')} title={tr("已在做的任务会做完并保存；之后不派新任务")} onClick={() => void mutate('projectFlow.pause', { flowId: flow.id, expectedRevision: flow.revision, mode: 'dispatch' }, tr("已暂停派发新任务；在做的任务会做完。"))}><Pause size={13} />{tr("暂停")}</button>
          : <button type="button" className="button small primary" disabled={busy || blocked.length > 0 || !allowed(data!.allowedActions, 'projectFlow.resume')} title={blocked.length ? tr("先处理卡住的尝试") : canRetry ? tr("继续会重试卡住的任务或复核") : tr("继续按计划派发；不会重发结果未知的运行")} onClick={() => void mutate('projectFlow.resume', { flowId: flow.id, expectedRevision: flow.revision }, tr("已继续派发。"))}><Play size={13} />{tr("继续")}</button>}
        <button type="button" className="icon-button danger" aria-label={tr("取消流程")} title={tr("取消流程（记录和成果保留）")} disabled={busy} onClick={() => { if (window.confirm(tr("取消这个项目流程？已有成果和记录会保留，在做的任务会停下。"))) void mutate('projectFlow.cancel', { flowId: flow.id, expectedRevision: flow.revision }, tr("项目流程已取消，记录保留。")); }}><Square size={14} /></button>
      </div>}
    </header>}
    <ActiveRunProgress snapshot={snapshot} invoke={invoke} sessionIds={snapshot.sessions.filter(session=>session.projectId===project.id&&Boolean(session.flowId)).map(session=>session.id)} label={tr("项目阶段")}/>
    <div className="project-room-subbar">
    <ol className="flow-steps" aria-label={tr("流程进度")}>{STEPS.map((label, index) => <li key={label} className={index < step ? 'done' : index === step ? 'current' : ''} aria-current={index === step ? 'step' : undefined}>{index < step ? <Check size={11} /> : <span>{index + 1}</span>}{tr(label)}</li>)}
      {flow?.status === 'cancelled' && !starting && <li className="cancelled">{tr("已取消")}</li>}{live && flow!.dispatchMode !== 'running' && <li className="paused">{tr("已暂停派发")}</li>}</ol>
    {onOpenReport && <ReportSwitcher entries={reports} onOpen={onOpenReport} />}
    </div>
    </section>
    {error && <p className="inline-notice error" role="alert">{error}<button type="button" className="icon-button" aria-label={tr("关闭提示")} title={tr("关闭提示")} onClick={() => setError('')}><X size={12} /></button></p>}
    {data?.taskAdditions?.map(proposal=><p key={proposal.id} className="inline-notice" role="status"><button className="button small secondary" aria-label={tr("查看待确认追加：{0}", proposal.title)} onClick={()=>setAddition({memberId:proposal.memberId,goal:proposal.goal,proposal})}>{proposal.status==='preparing'?tr("查看正在准备的追加任务"):proposal.status==='blocked'?tr("查看未完成的追加任务"):tr("查看待确认追加任务")}：{proposal.title}</button></p>)}
    {snapshot.workLogFailures?.filter(r=>r.projectId===project.id).map(r=><p key={r.roundId} className="task-meta bad" role="status">{tr("成果已经验收，工作日志保存失败。")}<button className="link-button" onClick={()=>setLogTarget({kind:'round',id:r.roundId})}>{tr("查看日志并重试")}</button></p>)}
    {!data ? <div className="project-room-loading"><LoaderCircle size={16} className="spin" />{tr("正在打开会议室…")}</div> : <div className={`project-room-grid ${boardOpen?'':'board-collapsed'}`}>
      <RoomView snapshot={snapshot} invoke={invoke} roomId={roomId} onOpenSession={(_, sessionId) => setLogTarget({kind:'session',id:sessionId})}
        project={{ roster, onRoster: changeRoster, renderFlow, dock, onTaskRequest:async(memberId,goal,mode,skills)=>{if(!flow||flow.status!=='active'){setError(tr("先确认方案后再安排或补充任务。"));return false;}const task=mode==='supplement'?(tasks.find(t=>t.memberId===memberId&&['running','correcting'].includes(t.status))??tasks.find(t=>t.memberId===memberId&&['pending','ready','queued','awaiting_review'].includes(t.status))):undefined;if(mode==='supplement'&&!task){setError(tr("该成员暂无可补充任务，请安排新任务。"));return false;}setAddition({memberId,goal,skills,...(task?{task}:{})});return true;}, onConfigureMember:memberId=>{setConfig({memberId,value:project.memberConfigs?.[memberId]??{},revision:project.memberConfigRevision??0});setConfigError('');},
          flowNextStep: Boolean(dock && ((fresh && !picking) || nextStep)),
          empty: <div className="room-empty project-room-empty"><div className="room-empty-team">{people.map(member => <Avatar key={member.id} member={member} size={48} />)}</div><h2>{tr("这次想一起做什么？")}</h2><p>{tr("先在这里说说目标、范围和要求，大家会一起讨论。讨论清楚后，在输入框上方选负责人起草方案。")}</p></div> }} />
      {!boardOpen?<aside className="project-side-rail" aria-label={tr("看板已收起")}><button type="button" className="icon-button" aria-label={tr("展开看板")} title={tr("展开看板")} onClick={()=>toggleBoard(true)}><PanelRightOpen size={16}/></button><button type="button" className="project-side-rail-label" onClick={()=>toggleBoard(true)}>{tr("看板")}</button>{data.overview.needsUser>0&&<span className="project-side-rail-count" title={tr("{0} 项待你决定", data.overview.needsUser)}>{data.overview.needsUser}</span>}</aside>:
      <div className="project-side">
        <div className="project-side-bar">
          <div className="segmented" role="tablist" aria-label={tr("项目看板视图")}>{([['work',tr("本段工作")],['progress',tr("项目进度")]] as const).map(([id,text])=><button key={id} type="button" role="tab" aria-selected={boardView===id} className={boardView===id?'selected':''} onClick={()=>setBoardView(id)}>{text}</button>)}</div>
          <span className="project-side-tools">{flow&&<button type="button" className="icon-button" aria-label={tr("查看项目记录")} title={tr("查看本段工作的项目记录")} onClick={()=>setRecordOpen(true)}><ScrollText size={15}/></button>}<button type="button" className="icon-button" aria-label={tr("收起看板")} title={tr("收起看板，让聊天更宽")} onClick={()=>toggleBoard(false)}><PanelRightClose size={15}/></button></span>
        </div>
      {boardView==='progress'?<ProjectProgressView project={project} snapshot={snapshot} invoke={invoke}/>:<Board invoke={invoke} rounds={rounds} tasks={tasks} data={data} snapshot={snapshot} busy={busy} blocked={blocked} resultUnknown={resultUnknown} onGiveUp={giveUp} onContinue={(op,evidence)=>resolveAttempt(op,'continue',evidence)} members={team.members.filter(member => flow?.memberIds.includes(member.id))} onLog={setLogTarget}
        onReassign={(task, memberId) => mutate('projectFlow.task.reassign', { taskId: task.id, expectedRevision: task.revision, memberId }, tr("已换人，新成员会从头接手这项任务。"))} />}
      </div>}
    </div>}
    {logTarget&&<WorkLog key={project.id+logTarget.kind+logTarget.id} project={project} target={logTarget} invoke={invoke} onClose={()=>setLogTarget(null)}/>}
    {recordOpen&&flow&&<ProjectRecordView project={project} flowId={flow.id} invoke={invoke} onClose={()=>setRecordOpen(false)}/>}
    {addition&&data&&<TaskAdditionView data={data} memberId={addition.memberId} initialGoal={addition.goal} initialSkills={addition.skills} supplementTask={addition.task} initialProposal={addition.proposal} invoke={invoke} onClose={()=>setAddition(null)} onDone={()=>void load()}/>}
    {config&&team.get(config.memberId)&&<Modal title={tr("{0} 的项目配置", team.get(config.memberId)!.name)} subtitle={tr("只在这个项目使用；人物卡默认设置不变。")} onClose={()=>{if(!configBusy)setConfig(null);}}>
      <div className="modal-body"><MemberConfigFields snapshot={snapshot} member={team.get(config.memberId)!.card} value={config.value} invoke={invoke} onChange={value=>setConfig({...config,value})}/>
        <MemberRunConfig snapshot={snapshot} project={project} memberId={config.memberId}/>{configError&&<p role="alert" className="task-meta bad">{configError}</p>}</div>
      <div className="modal-footer"><button className="button quiet" disabled={configBusy} onClick={()=>setConfig(null)}>{tr("取消")}</button><button className="button primary" disabled={configBusy} onClick={()=>{setConfigBusy(true);void invoke('project.update',{projectId:project.id,memberConfigs:{[config.memberId]:config.value},expectedConfigRevision:config.revision},tr("已保存项目配置。")).then(()=>setConfig(null)).catch(e=>setConfigError((e as Error).message)).finally(()=>setConfigBusy(false));}}>{tr("保存")}</button></div>
    </Modal>}
  </main>;
}

const PLAN_STATUS: Record<string, string> = { get awaiting_confirmation(){return tr("待你确认")}, get confirmed(){return tr("已确认")}, get superseded(){return tr("已被新版替代")}, get draft(){return tr("草稿")} };

import {t} from '../i18n';
import {joinClauses, plainFlowError} from "../../shared/content-presentation";
import {workspaceLocation} from "../workspace-location";
import {memberUserSummary} from "../../shared/report-presentation";
import {TaskAdditionView} from "../task-addition";
import {FlowRunStop} from "../flow-run-stop";
import {type LogTarget} from "../../shared/work-log";
import {useEffect, useState} from "react";
import {ArrowLeft, Check} from "lucide-react";
import type {FlowOperation, ProjectFlowSnapshot, Round, Task} from "../../shared/project-flow";
import {FLOW_LIMITS, reviewLevel, roundReviewLevel} from "../../shared/project-flow";
import type {Snapshot} from "../../shared/types";
import {commandExitCodeNotes} from "../../shared/project-flow-review";
import {criterionText, criterionKind} from "../../shared/project-flow";
import {memberCriteria} from "../../shared/project-flow-review";
import {ReviewDetails} from "../review-details";
import {Avatar, useTeam, type TeamMember} from "../members";
import {time, type Invoke} from "../ui";
import {useRoundtableNavigation} from "../roundtable-navigation";
import {MemberName} from "./people";
import {ROUND_STATUS, TASK_STATUS, LANES, OPERATION_KIND, action, allowed} from "./flow-ui";
import {GiveUp, SupplementReceipts} from "./flow-results";
import {TaskContext} from './TaskContext';
type BoardProps = { invoke:Invoke; rounds: Round[]; tasks: Task[]; data: ProjectFlowSnapshot; snapshot: Snapshot; members: TeamMember[]; busy: boolean; blocked: FlowOperation[]; resultUnknown: (op: FlowOperation) => boolean; onGiveUp: (op: FlowOperation, evidence: string) => Promise<boolean>; onContinue:(op:FlowOperation,evidence:string)=>Promise<boolean>;onLog: (target:LogTarget) => void; onReassign: (task: Task, memberId: string) => Promise<boolean> };

export function Board(props: BoardProps) {
  const { rounds, tasks } = props;
  const current = rounds.find(round => round.status !== 'accepted') ?? rounds.at(-1);
  const [roundId, setRoundId] = useState<string>(), [taskId, setTaskId] = useState<string>();
  const shown = rounds.find(round => round.id === roundId) ?? current, task = tasks.find(item => item.id === taskId);
  useEffect(() => { setRoundId(undefined); }, [current?.id]);
  if (!rounds.length) return <aside className="board" aria-label={t("看板")}><div className="board-head"><strong>{t("看板")}</strong></div><p className="board-empty">{t("方案确认后，每项任务会出现在这里，按待开始、进行中、待复核、已完成排列。")}</p></aside>;
  const inRound = tasks.filter(item => item.roundId === shown?.id);
  const level=shown&&props.data.flow?(shown.effectiveReviewLevel??roundReviewLevel(props.data.flow,shown)):'high';
  const lanes=LANES.filter(lane=>lane.id!=='review'||level==='high'||inRound.some(item=>item.status==='awaiting_review'));
  return <aside className="board" aria-label={t("看板")}>
    <div className="board-head"><strong>{t("看板")}</strong>
      <div className="board-rounds" role="tablist" aria-label={t("轮次")}>{rounds.map(round => <button key={round.id} type="button" role="tab" aria-selected={round.id === shown?.id} className={`${round.id === shown?.id ? 'selected' : ''} status-${round.status}`} title={`${round.title} · ${ROUND_STATUS[round.status]}`} onClick={() => { setRoundId(round.id); setTaskId(undefined); }}>{t("第 {0} 轮", round.index + 1)}{round.status === 'accepted' && <Check size={11} />}</button>)}</div></div>
    {shown && <p className="board-round-goal"><strong>{shown.title}</strong> · {shown.nextConfirmation&&shown.nextConfirmation.status!=='confirmed'?t("等待下一轮确认"):ROUND_STATUS[shown.status]}</p>}
    {shown?.status==='checking'&&<p role="status">{t("本轮整体检查中")}</p>}
    {shown&&<button className="link-button" onClick={()=>props.onLog({kind:'round',id:shown.id})}>{t("看本轮工作日志")}</button>}
    {task ? <TaskDetail {...props} task={task} onBack={() => setTaskId(undefined)} />
      : <div className="board-lanes">{lanes.map(lane => {
        const items = inRound.filter(item => lane.statuses.includes(item.status));
        if (lane.id === 'stuck' && !items.length) return null;
        return <section key={lane.id} className={`board-lane lane-${lane.id}`} aria-label={lane.label}><h4>{lane.label}<span>{items.length}</span></h4>
          {items.map(item => <TaskTile key={item.id} task={item} data={props.data} onOpen={() => setTaskId(item.id)} />)}</section>;
      })}</div>}
  </aside>;
}

export function TaskTile({ task, data, onOpen }: { task: Task; data: ProjectFlowSnapshot; onOpen: () => void }) {
  const member = useTeam().get(task.memberId);
  const review = data.reviews.filter(item => item.taskId === task.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const needsReview=task.reviewRequested===true||task.kind!=='integration-fix'&&(task.effectiveReviewLevel??reviewLevel(data.flow!))==='high';
  const waitingRound=!needsReview&&['review_skipped','integrated'].includes(task.status)&&!['accepted','awaiting_acceptance'].includes(data.rounds.find(round=>round.id===task.roundId)?.status??'');
  const line = task.blockedReason ? plainFlowError(task.blockedReason) : (waitingRound?t("等本轮整体检查"):['running', 'queued', 'correcting'].includes(task.status) && task.lastActivity ? task.lastActivity.text : review?.status === 'changes_requested' ? t("复核要求修改") : TASK_STATUS[task.status]);
  return <button type="button" className={`task-tile member-${task.memberId} status-${task.status}`} aria-label={t("任务：{0}", task.title)} onClick={onOpen}>
    <span className="task-tile-top">{member && <Avatar member={member} size={22} ring={false} mood={task.status === 'running' ? 'working' : undefined} />}<strong>{task.title}</strong></span>
    <small>{['running', 'correcting'].includes(task.status) && <span className="pulse" />}{line}</small>
    <small>{task.reviewSkipped?t("未单独复核"):!needsReview?t("本轮不单独复核"):task.review?t("单独复核"):t("复核人")}{needsReview&&!task.reviewSkipped&&<MemberName id={task.reviewerMemberId}/>}</small>
    {task.reusedFromTaskId&&<small>{t("沿用已验证成果")}</small>}
    {task.returnCount > 0 && <span className="task-tile-returns" title={t("退回次数，最多 2 次")}>{t("退回 {0}/2", task.returnCount)}</span>}
  </button>;
}

export function TaskDetail({ invoke, task, tasks, data, snapshot, members, busy, blocked, resultUnknown, onGiveUp,onContinue, onLog, onReassign, onBack }: BoardProps & { task: Task; onBack: () => void }) {
  const team = useTeam(), member = team.get(task.memberId);
  const taskSession=snapshot.sessions.find(session=>session.id===task.sessionId),location=workspaceLocation(taskSession,snapshot.projects.find(project=>project.id===task.projectId)?.directory);
  const [supplementOpen,setSupplementOpen]=useState(false);
  const review = data.reviews.filter(item => item.taskId === task.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const toRoundtable=useRoundtableNavigation();
  const submission = data.submissions.find(item => item.id === task.latestSubmissionId);
  const evidenceNotes=commandExitCodeNotes([...(submission?.evidence??[]),...(review?.evidence??[])]);
  // What blocks this task: its own attempt or its review, whichever operation is blocked.
  const stuck = blocked.find(op => op.targetId === task.id && op.kind === 'supplement-delivery') ?? blocked.find(op => op.targetId === task.id);
  const waitingOn = task.dependencies.map(id => tasks.find(item => item.id === id)).filter((item): item is Task => Boolean(item) && !['review_passed','review_skipped', 'integrated', 'accepted'].includes(item!.status));
  const canMove = allowed(task.allowedActions, 'projectFlow.task.reassign') && Boolean(action(task.allowedActions, 'projectFlow.task.reassign'));
  return <article className={`task-detail member-${task.memberId}`} aria-label={t("任务详情：{0}", task.title)}>
    <button type="button" className="link-button" onClick={onBack}><ArrowLeft size={13} />{t("回到看板")}</button>
    {action(task.allowedActions,'projectFlow.task.supplement')?.enabled&&<button className="button small" disabled={busy} onClick={()=>setSupplementOpen(true)}>{t("补充要求")}</button>}
    {supplementOpen&&<TaskAdditionView data={data} memberId={task.memberId} initialGoal="" supplementTask={task} invoke={invoke} onClose={()=>setSupplementOpen(false)} onDone={()=>setSupplementOpen(false)}/>}
    <div className="task-detail-head">{member && <Avatar member={member} size={34} />}<div><strong>{task.title}</strong><small>{t("{0} 做 · ", member?.name ?? t("成员"))}<MemberName id={task.reviewerMemberId} /> {t(" 复核")}</small></div><span className={`task-chip status-${task.status}`}>{TASK_STATUS[task.status]}</span></div>
    <p>{task.goal}</p>
    <TaskContext task={task}/>
    <div className="task-workspace-location"><p title={location.path}>{t("工作位置 · {0}", location.label)}</p><small>{location.hint}</small>{taskSession?.workspace&&!taskSession.restoredHistoryOnly&&<button type="button" className="link-button" onClick={()=>void invoke('workspace.open',{sessionId:taskSession.id}).catch(()=>{})}>{t("打开任务工作位置")}</button>}</div>
    {submission&&toRoundtable&&<button className="link-button" onClick={()=>toRoundtable({projectId:task.projectId,submissionId:submission.id,version:submission.version})}>{t("送去圆桌评审提交")}</button>}
    {submission&&<><h4>{t("做了什么")}</h4><p>{memberUserSummary(submission)}</p>{submission.replyNotes?.map(note=><p className="task-meta" key={note}>{note}</p>)}</>}
    {task.completionCriteria.length > 0 && <><h4>{t("完成标准")}</h4><ul>{task.completionCriteria.map(item => <li key={criterionText(item)}>{criterionText(item)}（{criterionKind(item)==='owner'?t("你来定"):criterionKind(item)==='judge'?t("成员评价"):t("可核对")}）</li>)}</ul></>}
    {task.allowedPaths.length > 0 && <p className="task-meta">{t("可以修改：{0}", task.allowedPaths.join('、'))}</p>}
    {waitingOn.length > 0 && task.status === 'pending' && <p className="task-meta">{t("等 {0} 先完成", waitingOn.map(item => item.title).join('、'))}</p>}
    {task.lastActivity && !task.blockedReason && task.status !== 'blocked' && <p className="task-meta">{t("最近：{0} · {1}", task.lastActivity.text, time(task.lastActivity.at))}</p>}
    {task.blockedReason && <p className="task-meta bad">{plainFlowError(task.blockedReason)}</p>}
    <SupplementReceipts task={task} />
    {submission && <p className="task-meta">{t("第 {0} 次提交：改了 {1} 个文件，{2} 条验证依据", submission.sequence, submission.changedFileCount ?? submission.changes.length, submission.evidenceCount ?? submission.evidence.length)}{(submission.outOfScopeCount ?? submission.outOfScopeChanges.length) > 0 && <strong className="bad"> {t(" · {0} 个文件超出范围", submission.outOfScopeCount ?? submission.outOfScopeChanges.length)}</strong>}</p>}
    {review && <p className={`task-meta review-${review.status}`}>{t("复核：{0} · 退回 {1}/2", review.status === 'passed' ? t("通过") : review.status === 'changes_requested' ? t("要求修改") : review.status === 'running' || review.status === 'queued' ? t("进行中") : review.status === 'stale' ? t("已过期") : review.status === 'inconclusive' ? t("无法下结论") : t("受阻"), task.returnCount)}</p>}
    {Boolean(task.disputeReturnWaiverCount)&&<p className="task-meta">{t("异议返还已用 {0}/{1} 次；换人或继续任务会保留此次数。", task.disputeReturnWaiverCount, FLOW_LIMITS.disputeReturnWaivers)}</p>}
    {evidenceNotes.map(note=><p className="task-meta" key={note}>{note}</p>)}
    {task.reviewSkipped&&<p className="task-meta">{task.reviewSkipped==='round-fix'?t("整合修正将在整轮检查中核对。"):t("个人任务按配置省略单独复核。")}</p>}
    {task.reusedFromTaskId&&<p className="task-meta">{t("已核对并沿用旧任务成果，没有重新执行。")}</p>}{task.reviewerChanges?.map((change,index)=><p className="task-meta" key={index}>{t("复核人 ")}<MemberName id={change.previousMemberId}/> → <MemberName id={change.memberId}/>：{change.reason}</p>)}{task.manualRedos?.length&&<p className="task-meta">{t("人工指定重做 {0} 次，每次仅一次工作机会，历史退回次数保留。", task.manualRedos.length)}</p>}
    {review?.criteriaResults&&<><h4>{t("复核标准核对")}</h4><ul>{review.criteriaResults.map((result,index)=><li key={index}>{result.verified?t("已核实"):t("未核实")} · {result.criterion}{result.evidence&&<small> · {result.evidence}</small>}</li>)}</ul></>}
    <ReviewDetails projectId={task.projectId} invoke={invoke} artifactId={submission?.version?.artifactId} assessments={review?.assessments} strengths={review?.strengths} sources={review?.evidence??submission?.evidence} owner={memberCriteria(task.completionCriteria).deferred}/>
    {review?.deferredUserCriteria?.length&&<p className="task-meta">{t("留待整轮用户验收：{0}", joinClauses(review.deferredUserCriteria,'、'))}</p>}
    {review?.findings.length ? <ul className="task-findings">{review.findings.map(finding => <li key={finding.id} className={`finding-${finding.severity}`}><strong>{finding.severity === 'blocking' ? t("必须改") : finding.severity === 'should-fix' ? t("建议改") : t("可选")}</strong> {finding.location}：{finding.request}<small>{finding.kind === 'verified' ? t("已核实") : finding.kind === 'suspected' ? t("待验证") : t("建议")} · {finding.evidence}</small></li>)}</ul> : null}
    <div className="round-actions">
      <button type="button" className="button small secondary" onClick={() => onLog({kind:'task',id:task.id})}>{t("看工作日志")}</button>
      {snapshot.runs.filter(run=>run.id===task.activeRunId||run.id===review?.runId).map(run=><FlowRunStop key={run.id} run={run} invoke={invoke}/>)}
      {canMove && <select aria-label={t("把「{0}」交给", task.title)} disabled={busy} value="" onChange={event => { if (event.target.value) void onReassign(task, event.target.value); }}><option value="">{t("换人…")}</option>{members.filter(item => item.id !== task.memberId).map(item => <option key={item.id} value={item.id}>{t("交给 {0}", item.name)}</option>)}</select>}

    </div>
    {stuck && <div className="task-stuck"><p className="task-meta bad">{t("卡在{0}：{1}", OPERATION_KIND[stuck.kind] ?? stuck.kind, plainFlowError(stuck.error))}</p><GiveUp key={stuck.id} task={stuck.kind === 'task'} unknown={resultUnknown(stuck)} supplement={stuck.kind === 'supplement-delivery'} busy={busy} onContinue={stuck.kind!=='supplement-delivery'?evidence=>onContinue(stuck,evidence):undefined} onConfirm={evidence => onGiveUp(stuck, evidence)} /></div>}
  </article>;
}

import type {Store} from './store';
import type {Decision, FlowOperation, Integration, Plan, ProjectFlow, Review, Round, Submission, Task} from '../shared/project-flow';
import type {RoomMessage, Run, Session} from '../shared/types';
import type {TaskContext} from '../shared/task-context';

const nextActions: Record<Task['status'], string> = {
  pending: '等待依赖完成及轮次启动', ready: '等待派发', queued: '等待执行端接收', running: '等待成员提交成果',
  awaiting_review: '等待核对当前提交版本', correcting: '按最新要求修正并重新提交',
  review_passed: '等待整合到本轮成果', review_skipped: '等待本轮整体检查', integrated: '等待本轮验收',
  accepted: '本项已验收，可查看成果与工作记录', escalated: '需要确认后续安排', blocked: '先处理阻塞或核对运行结果', cancelled: '本项已取消，查看当前方案',
};
const sameVersion = (a: {artifactId:string;fingerprint:string}, b?: {artifactId:string;fingerprint:string}) => a.artifactId === b?.artifactId && a.fingerprint === b.fingerprint;

/** Rebuild from persisted records, independent of live run pagination and process lifetime. */
export function projectTaskContext(store: Pick<Store,'get'|'list'>, task: Task): TaskContext {
  const flow = store.get<ProjectFlow>('project_flows', task.flowId);
  const plan = store.get<Plan>('flow_plans', task.planId);
  const active = flow?.activePlanId ? store.get<Plan>('flow_plans', flow.activePlanId) : undefined;
  const round = store.get<Round>('flow_rounds', task.roundId);
  const submission = task.latestSubmissionId ? store.get<Submission>('flow_submissions', task.latestSubmissionId) : undefined;
  const review = store.list<Review>('flow_reviews').filter(r => r.taskId === task.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).at(0);
  const integration = round?.integrationId ? store.get<Integration>('flow_integrations', round.integrationId) : undefined;
  const operations = store.list<FlowOperation>('flow_operations').filter(o => o.flowId === task.flowId && o.projectId === task.projectId && o.targetId === task.id && o.kind === 'task');
  const receipts = operations.flatMap(op => [...new Set([op.runId, op.correctionRunId].filter((id): id is string => Boolean(id)))].flatMap(id => {
    const run = store.get<Run>('runs', id);
    if (!run || run.flowOperationId !== op.id || run.projectId !== task.projectId || run.sessionId !== op.sessionId) return [];
    const session = store.get<Session>('sessions', run.sessionId);
    return [{runId:id, operationId:op.id, sessionId:run.sessionId, memberId:session?.memberId, createdAt:run.createdAt, status:run.status, delivery:run.delivery, nativeTurnId:run.nativeTurnId,
      current:task.sessionId === run.sessionId && session?.memberId === task.memberId && task.planId === flow?.activePlanId}];
  })).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const decisions = store.list<Decision>('flow_decisions').filter(d => d.projectId === task.projectId && d.flowId === task.flowId &&
    (d.taskId === task.id || d.eligibleTaskIds.includes(task.id) || d.answer?.taskIds.includes(task.id) || !d.taskId && d.roundId === task.roundId))
    .map(d => {
      const message = store.get<RoomMessage>('room_messages', `flow-decision:${d.id}:${d.status}`);
      return {id:d.id, title:d.title, reason:d.reason, status:d.status, answer:d.answer,
        scope:d.taskId === task.id ? '本项任务' : d.eligibleTaskIds.includes(task.id) || d.answer?.taskIds.includes(task.id) ? '指定任务' : `本轮：${round?.title ?? task.roundId}`,
        effective:d.status === 'answered' && task.planId === flow?.activePlanId && (!d.integrationId || d.integrationId === round?.integrationId) &&
          d.sourceVersions.every(v => sameVersion(v, submission?.version) || sameVersion(v, integration?.version)),
        sourceVersions:d.sourceVersions, source:message ? {messageId:message.id, threadId:message.threadId, text:message.text, at:message.at} : undefined};
    });
  const replacement = plan?.status==='superseded' ? store.list<Plan>('flow_plans').find(p => p.projectId === task.projectId && p.flowId === task.flowId && p.parentPlanId === task.planId && ['confirmed','superseded'].includes(p.status)) : undefined;
  return {planVersion:plan?.version, activePlanVersion:active?.version, requirementsRevision:task.requirementsRevision ?? 1, planStatus:plan?.status,
    replacedBy:replacement ? {id:replacement.id, version:replacement.version} : undefined,
    nextAction:task.blockedReason ? nextActions.blocked : nextActions[task.status], receipts, decisions,
    submission:submission ? {id:submission.id, sequence:submission.sequence, status:submission.status, version:submission.version, createdAt:submission.createdAt} : undefined,
    review:review ? {id:review.id, status:review.status, version:review.reviewedVersion, current:review.submissionId === submission?.id && review.status !== 'stale' && (review.requirementsRevision??1)===(task.requirementsRevision??1) && sameVersion(review.reviewedVersion, submission?.version)} : undefined};
}

/** Cache only for one snapshot; large plans and historical records are decoded once for its task list. */
export function taskContextReader(store:Store){
  const records=new Map<string,unknown>(),lists=new Map<string,unknown[]>();
  const reader:Pick<Store,'get'|'list'>={
    get<T>(entity:string,id:string):T|undefined{const key=JSON.stringify([entity,id]);if(!records.has(key))records.set(key,store.get(entity,id));return records.get(key) as T|undefined;},
    list<T>(entity:string):T[]{if(!lists.has(entity))lists.set(entity,store.list(entity));return lists.get(entity) as T[];},
  };
  return (task:Task)=>projectTaskContext(reader,task);
}

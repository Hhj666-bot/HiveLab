import type {Store} from './store';
import type {Run,Session} from '../shared/types';
import type {FlowOperation,OperationResult,Task} from '../shared/project-flow';

/** An operation ID alone cannot prove ownership after a handoff or a native reset. */
export function flowRunMatches(store:Store,operation:FlowOperation,run:Run):boolean {
  if(run.flowOperationId!==operation.id||run.projectId!==operation.projectId||!operation.sessionId||run.sessionId!==operation.sessionId)return false;
  const session=store.get<Session>('sessions',run.sessionId);
  if(!session||session.projectId!==run.projectId||session.provider!==run.provider||session.revision!==run.revision||session.flowId&&session.flowId!==operation.flowId)return false;
  if(run.nativeSessionId&&session.nativeId&&run.nativeSessionId!==session.nativeId)return false;
  const task=store.get<Task>('flow_tasks',operation.targetId);
  return operation.kind!=='task'||!task||task.sessionId===run.sessionId&&task.memberId===session.memberId;
}

export function finishedFlowReply(store:Store,operation:FlowOperation):OperationResult|undefined {
  const runId=operation.correctionRunId??operation.runId,run=runId?store.get<Run>('runs',runId):undefined;
  if(!run||!flowRunMatches(store,operation,run)||!['ended','completed'].includes(run.status)||!['sent','confirmed'].includes(run.delivery))return;
  // Keep exactly the same event selection and concatenation as Engine.waitForReply.
  const events=store.runEvents(run.id).filter(e=>!(e.data as {role?:string}|undefined)?.role),deltas=events.filter(e=>e.kind==='delta').map(e=>e.text).join('');
  const text=(deltas||events.filter(e=>e.kind==='message').map(e=>e.text).join('\n\n')).trim();if(!text)return;
  return {runId:run.id,status:run.status,text};
}
export function operationNotDelivered(store:Store,operation:FlowOperation){
  if(operation.kind==='supplement-delivery')return false;
  const runId=operation.correctionRunId??operation.runId;if(!runId)return true;
  const run=store.get<Run>('runs',runId);return Boolean(run&&flowRunMatches(store,operation,run)&&['prepared','withdrawn'].includes(run.delivery)&&!['ended','completed'].includes(run.status));
}

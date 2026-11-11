import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Store} from '../src/backend/store';
import {projectTaskContext} from '../src/backend/project-task-context';
import {finishedFlowReply,flowRunMatches,operationNotDelivered} from '../src/backend/project-flow-recovery';
import {ProjectFlowController,type FlowHost} from '../src/backend/project-flow';
import type {FlowOperation,Task,Plan,ProjectFlow,Round,Submission,Review,Decision} from '../src/shared/project-flow';
import type {Run,Session} from '../src/shared/types';

const at='2026-10-29T03:00:00.000Z';
const record={projectId:'project',flowId:'flow',revision:1,schemaVersion:1 as const,createdAt:at,updatedAt:at};
const version={artifactId:'artifact',fingerprint:'current-content',baselineId:'base'};
function seed(store:Store){
  store.put('projects','project',{id:'project',name:'任务详情',directory:store.dataDirectory,createdAt:at});
  const thread=store.ensureProjectRoom('project');
  const task:Task={...record,id:'task',planId:'plan',roundId:'round',key:'t',kind:'implementation',title:'交付文件',goal:'完成文件',memberId:'worker',reviewerMemberId:'reviewer',sessionId:'session',status:'awaiting_review',inputs:[],completionCriteria:['可读'],dependencies:[],allowedPaths:['.'],returnCount:0,rearrangeCount:0,findingIds:[],latestSubmissionId:'submission',requirementsRevision:2,supplements:[{id:'supplement',requestId:'s',text:'补充',createdAt:at,source:'task-card',status:'delivered',requestedPaths:[]}]};
  const plan:Plan={...record,id:'plan',version:1,status:'confirmed',notes:[],objective:'交付',scope:'目录',deliverables:['output'],acceptanceCriteria:['可读'],rounds:[],tasks:[]};
  const flow:ProjectFlow={...record,id:'flow',activePlanId:'plan',leadMemberId:'lead',memberIds:['lead','worker','reviewer'],roomId:'project:project',threadId:thread.id,dispatchMode:'paused',status:'active',blockedReasons:[]};
  const round:Round={...record,id:'round',planId:'plan',index:0,key:'r',title:'第一轮',goal:'交付',requiresUserAcceptance:true,taskIds:['task'],integrationFixCount:0,status:'executing'};
  const submission:Submission={...record,id:'submission',taskId:'task',sequence:2,runId:'run',sessionId:'session',version,changes:[],evidence:[],outOfScopeChanges:[],summary:'已交付',status:'submitted'};
  const session:Session={id:'session',projectId:'project',provider:'codex',title:'执行',memberId:'worker',createdAt:at,updatedAt:at,revision:1,writeMode:true,flowId:'flow',nativeId:'native-current'};
  const op:FlowOperation={...record,id:'operation',kind:'task',targetId:'task',targetRevision:1,sessionId:session.id,runId:'run',state:'running'};
  const run:Run={id:'run',sessionId:session.id,projectId:'project',provider:'codex',revision:1,status:'ended',delivery:'confirmed',input:'任务',bootId:'test',createdAt:at,updatedAt:at,completedAt:at,flowOperationId:op.id,nativeSessionId:'native-current',nativeTurnId:'turn-one'};
  const decision:Decision={...record,id:'decision',kind:'scope-change',taskId:task.id,roundId:round.id,title:'确认范围',reason:'新增文件',options:['确认'],eligibleTaskIds:[],sourceVersions:[version],status:'answered',answer:{choice:'确认',taskIds:[task.id],opinion:'仅限 output'}};
  const review:Review={...record,id:'review',taskId:task.id,submissionId:'previous-submission',reviewerMemberId:'reviewer',reviewedVersion:{...version,fingerprint:'old-content'},findings:[],evidence:[],verificationComplete:true,status:'stale'};
  for(const [entity,item] of [['project_flows',flow],['flow_plans',plan],['flow_rounds',round],['flow_tasks',task],['flow_submissions',submission],['sessions',session],['flow_operations',op],['runs',run],['flow_decisions',decision],['flow_reviews',review]] as const)store.put(entity,item.id,item);
  store.roomScope('project:project').put('room_messages','flow-decision:decision:answered',{id:'flow-decision:decision:answered',author:'user',threadId:thread.id,text:'我的选择：确认；仅限 output',at,status:'done'});
  store.appendEvent({id:'reply',runId:run.id,sessionId:run.sessionId,provider:'codex',at,kind:'message',text:'完整的实际回复',fidelity:'native'});
  return {task,op,run,session};
}

test('task details survive reopening, distinguish delivery/submission/review/acceptance and locate the user decision',()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'task-context-'));let store=new Store(root);
  try{const {task}=seed(store),before=projectTaskContext(store,task);assert.equal(before.receipts[0].delivery,'confirmed');assert.equal(before.submission?.sequence,2);assert.equal(before.review?.current,false);assert.equal(before.decisions[0].effective,true);assert.match(before.decisions[0].source!.text,/仅限 output/);assert.equal(store.get<Task>('flow_tasks','task')?.supplements?.[0].status,'delivered');
    store.close();store=new Store(root);assert.deepEqual(projectTaskContext(store,store.get<Task>('flow_tasks','task')!),before);
    store.put('flow_plans','replacement',{...store.get<Plan>('flow_plans','plan')!,id:'replacement',version:2,parentPlanId:'plan',status:'awaiting_confirmation'});
    assert.equal(projectTaskContext(store,task).replacedBy,undefined,'an unconfirmed draft does not replace effective requirements');
    store.put('flow_plans','plan',{...store.get<Plan>('flow_plans','plan')!,status:'superseded'});
    store.put('flow_plans','replacement',{...store.get<Plan>('flow_plans','replacement')!,status:'confirmed'});
    store.put('project_flows','flow',{...store.get<ProjectFlow>('project_flows','flow')!,activePlanId:'replacement'});
    const after=projectTaskContext(store,task);assert.equal(after.replacedBy?.version,2);assert.equal(after.decisions[0].effective,false);assert.equal(after.receipts[0].current,false);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('late results cannot be reused across another session, member, project, native history or revision',()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'flow-ownership-')),store=new Store(root);
  try{const {task,op,run,session}=seed(store);assert.equal(finishedFlowReply(store,op)?.text,'完整的实际回复');
    for(const patch of [{sessionId:'other'},{projectId:'other'},{revision:2},{nativeSessionId:'old-native'},{flowOperationId:'other'}]){store.put('runs',run.id,{...run,...patch});assert.equal(finishedFlowReply(store,op),undefined);}
    store.put('runs',run.id,run);store.put('flow_tasks',task.id,{...task,memberId:'replacement',sessionId:'new-session'});assert.equal(flowRunMatches(store,op,run),false);assert.equal(finishedFlowReply(store,op),undefined);
    store.put('flow_tasks',task.id,task);store.put('sessions',session.id,{...session,revision:2});assert.equal(finishedFlowReply(store,op),undefined);
    store.put('sessions',session.id,session);store.put('runs',run.id,{...run,status:'unknown',delivery:'sent'});assert.equal(finishedFlowReply(store,op),undefined);assert.equal(operationNotDelivered(store,op),false);
    store.put('runs',run.id,{...run,status:'queued',delivery:'prepared'});assert.equal(operationNotDelivered(store,op),true);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('startup distinguishes committed but unsubmitted, unconfirmed delivery and durably finished results without resending',async()=>{
  for(const phase of ['before-delivery','after-delivery','after-confirmation'] as const){
    const root=mkdtempSync(path.join(process.env.TEMP!,'flow-interruption-')),store=new Store(root);let controller:ProjectFlowController|undefined,calls=0;
    try{const {op,run,task}=seed(store);store.put('flow_tasks',task.id,{...task,status:'running'});
      store.put('runs',run.id,{...run,status:phase==='before-delivery'?'queued':phase==='after-delivery'?'unknown':'ended',delivery:phase==='before-delivery'?'prepared':phase==='after-delivery'?'sent':'confirmed'});
      const host:FlowHost={alive:()=>false,changed(){},maxParallel:()=>2,available:()=>true,quotaAllows:()=>true,session(){throw Error('unexpected session');},async run(){calls++;throw Error('unexpected model request');},async stop(){}};
      controller=new ProjectFlowController(store,host);const recovered=store.get<FlowOperation>('flow_operations',op.id)!;
      if(phase==='before-delivery'){assert.equal(recovered.state,'done');assert.deepEqual(recovered.result,{notDelivered:true});}
      else{assert.equal(recovered.state,'blocked');assert.equal(recovered.recovery,phase==='after-delivery'?'interrupted':'completed');}
      assert.equal(calls,0);assert.equal(store.get<ProjectFlow>('project_flows','flow')?.dispatchMode,'paused');
    }finally{await controller?.close();store.close();rmSync(root,{recursive:true,force:true});}
  }
});

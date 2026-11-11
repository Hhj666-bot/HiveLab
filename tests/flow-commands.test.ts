import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Store } from "../src/backend/store";
import { ProjectFlowController, type FlowHost } from "../src/backend/project-flow";
import type {
  Decision,
  FlowOperation,
  FlowRecord,
  Plan,
  ProjectFlow,
  Round,
  Task,
} from "../src/shared/project-flow";
import { FlowError } from "../src/shared/project-flow";

function fixture(t: TestContext) {
  const parent = path.resolve(process.env.TEMP!);
  const root = mkdtempSync(path.join(parent, "flow-commands-"));
  const directory = path.join(root, "project");
  mkdirSync(directory);
  writeFileSync(path.join(directory, "input.txt"), "original");
  const store = new Store(path.join(root, "data"));
  const date = new Date().toISOString();
  const record = (id: string): FlowRecord => ({
    id,
    projectId: "project",
    flowId: "flow",
    schemaVersion: 1,
    revision: 1,
    createdAt: date,
    updatedAt: date,
  });
  store.put("projects", "project", {
    id: "project",
    name: "测试项目",
    directory,
    createdAt: date,
    collaborationPaused: false,
  });
  for (const id of ["lead", "worker"])
    store.put("members", id, { id, name: id, executor: "codex", color: "#334455", motto: "" });
  let calls = 0;
  const host: FlowHost = {
    alive: () => false,
    changed() {},
    maxParallel: () => 2,
    available: () => true,
    quotaAllows: () => true,
    session() {
      throw new Error("No model session may be opened");
    },
    async run() {
      calls++;
      throw new Error("No model request may be sent");
    },
    async stop() {},
  };
  const controller = new ProjectFlowController(store, host);
  const flow: ProjectFlow = {
    ...record("flow"),
    leadMemberId: "lead",
    memberIds: ["lead", "worker"],
    activePlanId: "plan",
    roomId: "project:project",
    dispatchMode: "paused",
    status: "awaiting_plan",
    blockedReasons: [],
    reviewLevel: "medium",
  };
  const plan: Plan = {
    ...record("plan"),
    version: 1,
    status: "awaiting_confirmation",
    notes: [],
    objective: "完成测试任务",
    scope: "项目目录",
    deliverables: ["output.txt"],
    acceptanceCriteria: ["内容完整"],
    rounds: [{ key: "r1", title: "第一轮", goal: "交付", requiresUserAcceptance: true }],
    tasks: [
      {
        key: "t1",
        roundKey: "r1",
        title: "执行任务",
        memberId: "worker",
        goal: "完成输出",
        inputs: [],
        completionCriteria: ["内容完整"],
        dependencies: [],
        allowedPaths: ["."],
      },
    ],
  };
  store.put("project_flows", flow.id, flow);
  store.put("flow_plans", plan.id, plan);
  t.after(async () => {
    await controller.close();
    store.close();
    assert.equal(path.dirname(root), parent);
    rmSync(root, { recursive: true, force: true });
    assert.equal(calls, 0, "command handling must not send a model request");
  });
  const invoke = (method: string, params: Record<string, unknown>) =>
    controller.invoke(method, { projectId: "project", ...params });
  return { store, controller, flow, plan, record, invoke, host };
}

const code = (expected: string) => (error: unknown) =>
  error instanceof FlowError && error.code === expected;

test('interruption before task transaction commit rolls back tasks and allows one safe retry', async t => {
  const {store,invoke}=fixture(t),put=store.put.bind(store);
  let interrupted=false;
  store.put=(entity,id,value)=>{if(entity==='flow_tasks'&&!interrupted){interrupted=true;throw Error('injected-before-commit');}put(entity,id,value);};
  const params={planId:'plan',expectedRevision:1,requestId:'fault-before-commit'};
  await assert.rejects(invoke('projectFlow.plan.confirm',params),/injected-before-commit/);
  assert.equal(store.list('flow_tasks').length,0);
  assert.equal(store.get('flow_requests',params.requestId),undefined);
  store.put=put;
  await invoke('projectFlow.plan.confirm',params);
  assert.equal(store.list('flow_tasks').length,1);
});

test('task commit saves its receipt atomically and replays it after lost delivery and restart', async t => {
  const {store,invoke,controller,host}=fixture(t),put=store.put.bind(store);
  let writes=0;
  store.put=(entity,id,value)=>{if(entity==='flow_requests'&&(value as {result?:unknown}).result!==undefined&&++writes===2)throw Error('injected-after-commit');put(entity,id,value);};
  const params={planId:'plan',expectedRevision:1,requestId:'fault-after-commit'};
  const result=await invoke('projectFlow.plan.confirm',params);
  store.put=put;
  await controller.close();
  const restored=new ProjectFlowController(store,host);
  try{assert.deepEqual(await restored.invoke('projectFlow.plan.confirm',{projectId:'project',...params}),result);assert.equal(store.list('flow_tasks').length,1);}finally{await restored.close();}
});

test("plan confirmation keeps concurrent request receipts and creates one set of tasks", async (t) => {
  const { store, invoke } = fixture(t);
  const params = { planId: "plan", expectedRevision: 1, requestId: "confirm-once" };
  const [first, repeated] = await Promise.all([
    invoke("projectFlow.plan.confirm", params),
    invoke("projectFlow.plan.confirm", params),
  ]);
  assert.deepEqual(repeated, first);
  assert.equal(store.list<Task>("flow_tasks").length, 1);
  assert.equal(store.list<Round>("flow_rounds").length, 1);
  assert.equal(store.get<Plan>("flow_plans", "plan")?.status, "confirmed");
  assert.deepEqual(await invoke("projectFlow.plan.confirm", params), first);
  await assert.rejects(
    invoke("projectFlow.plan.confirm", { ...params, expectedRevision: 2 }),
    code("REQUEST_REUSED"),
  );
  await assert.rejects(
    invoke("projectFlow.plan.confirm", { ...params, requestId: "stale-confirm" }),
    code("STALE_REVISION"),
  );
  assert.equal(store.get("flow_requests", "stale-confirm"), undefined);
});

test("task supplements retain revision checks and unfinished rounds cannot be accepted", async (t) => {
  const { store, invoke } = fixture(t);
  await invoke("projectFlow.plan.confirm", {
    planId: "plan",
    expectedRevision: 1,
    requestId: "confirm",
  });
  const task = store.list<Task>("flow_tasks")[0];
  await invoke("projectFlow.task.supplement", {
    taskId: task.id,
    expectedRevision: task.revision,
    requestId: "supplement",
    text: "增加明确的使用说明",
  });
  const updated = store.get<Task>("flow_tasks", task.id)!;
  assert(updated.goal.includes("增加明确的使用说明"));
  assert.equal(updated.supplements?.length, 1);
  assert(updated.revision > task.revision);
  await assert.rejects(
    invoke("projectFlow.task.supplement", {
      taskId: task.id,
      expectedRevision: task.revision,
      requestId: "stale-supplement",
      text: "旧界面的补充",
    }),
    code("STALE_REVISION"),
  );
  const round = store.list<Round>("flow_rounds")[0];
  await assert.rejects(
    invoke("projectFlow.round.accept", {
      roundId: round.id,
      expectedRevision: round.revision,
      requestId: "early-accept",
    }),
    code("NOT_FOUND"),
  );
  assert.equal(store.get<Round>("flow_rounds", round.id)?.status, "executing");
});

test('reassignment commits a durable handoff and one replayable receipt',async t=>{
  const {store,invoke}=fixture(t);
  await invoke('projectFlow.plan.confirm',{planId:'plan',expectedRevision:1,requestId:'confirm-for-handoff'});
  const task=store.list<Task>('flow_tasks')[0];
  store.put('flow_tasks',task.id,{...task,sessionId:'old-session',activeRunId:'old-run'});
  const p={taskId:task.id,expectedRevision:task.revision,requestId:'handoff-once',memberId:'lead',opinion:'按最新补充继续'};
  const result=await invoke('projectFlow.task.reassign',p);
  const reassigned=store.get<Task>('flow_tasks',task.id)!;
  assert.equal(reassigned.memberId,'lead');assert.equal(reassigned.sessionId,undefined);
  assert.equal(reassigned.handovers?.length,1);assert.equal(reassigned.handovers?.[0].fromSessionId,'old-session');assert.equal(reassigned.handovers?.[0].fromRunId,'old-run');
  assert.deepEqual(await invoke('projectFlow.task.reassign',p),result);assert.equal(store.get<Task>('flow_tasks',task.id)?.handovers?.length,1);
});

test("decision answers remain idempotent and a closed decision rejects new requests", async (t) => {
  const { store, flow, record, invoke } = fixture(t);
  store.put("project_flows", flow.id, { ...flow, status: "active", dispatchMode: "running" });
  const decision: Decision = {
    ...record("decision"),
    kind: "meeting-request",
    title: "待确认要求",
    reason: "用户要求",
    options: ["暂停派发"],
    eligibleTaskIds: [],
    sourceVersions: [],
    status: "open",
  };
  store.put("flow_decisions", decision.id, decision);
  const params = {
    decisionId: decision.id,
    expectedRevision: 1,
    requestId: "answer",
    choice: "暂停派发",
  };
  const answer = await invoke("projectFlow.decision.answer", params);
  assert.equal(store.get<ProjectFlow>("project_flows", flow.id)?.dispatchMode, "paused");
  assert.equal(store.get<Decision>("flow_decisions", decision.id)?.status, "answered");
  assert.deepEqual(await invoke("projectFlow.decision.answer", params), answer);
  await assert.rejects(
    invoke("projectFlow.decision.answer", { ...params, requestId: "answer-again" }),
    code("STALE_REVISION"),
  );
});

test("unknown delivery cannot resume or be declared reconciled without completed evidence", async (t) => {
  const { store, flow, record, invoke } = fixture(t);
  store.put("project_flows", flow.id, { ...flow, status: "active" });
  const operation: FlowOperation = {
    ...record("op"),
    kind: "plan",
    targetId: "plan",
    targetRevision: 1,
    state: "blocked",
    runId: "unknown-run",
    error: "结果未知",
  };
  store.put("flow_operations", operation.id, operation);
  store.put("runs", "unknown-run", {
    id: "unknown-run",
    status: "unknown",
    delivery: "unknown",
    completedAt: record("unused").updatedAt,
  });
  await assert.rejects(
    invoke("projectFlow.resume", { flowId: flow.id, expectedRevision: 1, requestId: "resume" }),
    code("UNKNOWN_RESULT"),
  );
  await assert.rejects(
    invoke("projectFlow.unknown.resolve", {
      operationId: operation.id,
      expectedRevision: 1,
      requestId: "reconcile",
      choice: "reconcile",
      evidence: "用户口头声称已经完成",
    }),
    code("UNKNOWN_RESULT"),
  );
  assert.equal(store.get<FlowOperation>("flow_operations", operation.id)?.state, "blocked");
  assert.equal(store.get<ProjectFlow>("project_flows", flow.id)?.dispatchMode, "paused");
});

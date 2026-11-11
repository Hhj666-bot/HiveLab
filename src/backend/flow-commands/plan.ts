import { ProjectWorkbench } from "../project-workbench";
import {
  assertProjectSerial,
  assertProjectPaths,
  captureProjectBoundary,
  assertProjectBoundary,
} from "../project-access";
import type { Store } from "../store";
import type { Project, RoomId } from "../../shared/types";
import { FlowArtifacts } from "../project-flow-artifacts";
import { captureFlowDiscussion } from "../project-flow-discussion";
import {
  FlowError,
  type FlowRecord,
  type ProjectFlow,
  type Plan,
  type Round,
  type Task,
  type Decision,
  type FlowArtifact,
  type Integration,
} from "../../shared/project-flow";
import { text, object } from "../../shared/project-flow-protocol";
import { reviewLevel, type ReviewLevel } from "../../shared/project-flow";
import { JointReviews } from "../joint-review";
import type { FlowHost } from "../project-flow";
import type { CommandParams, FlowCommand } from "./registry";
import {completeFlowRequest} from './request-receipt';

export interface PlanCommandHost {
  readonly need: <T>(entity: string, id: string) => T;
  readonly joint: JointReviews;
  readonly store: Store;
  readonly runtime: FlowHost;
  readonly record: (projectId: string, flowId: string) => FlowRecord;
  readonly configuredLevel: (value: unknown, fallback?: ReviewLevel) => ReviewLevel;
  readonly workbench: ProjectWorkbench;
  readonly launch: (job: () => Promise<void>, failure?: (error: Error) => void) => void;
  readonly proposed: (flow: ProjectFlow, instruction: string, parent?: Plan) => Promise<void>;
  readonly check: (record: FlowRecord, p: Record<string, unknown>) => void;
  readonly flow: (id: string) => ProjectFlow;
  readonly update: <T extends FlowRecord>(entity: string, item: T, patch: Partial<T>) => T;
  readonly prepareReplan: (flow: ProjectFlow) => void;
  readonly artifacts: FlowArtifacts;
  readonly reviewer: (
    flow: ProjectFlow,
    author: string,
    assigned?: Pick<Task, "reviewerMemberId">[],
    eligible?: string[],
  ) => string;
  readonly reusableTasks: (
    plan: Plan,
    base: FlowArtifact,
    taskMap: Map<string, Task>,
    roundMap: Map<string, Round>,
  ) => Promise<{ entity: string; id: string; value: unknown }[]>;
}

const at = () => new Date().toISOString();

export function createPlanCommands(host: PlanCommandHost) {
  return {
    "projectFlow.start": async (p: CommandParams): Promise<unknown> => {
      const project = host.need<Project>("projects", String(p.projectId));
      if (project.kind) throw new FlowError("INVALID_PROJECT", "请在工作项目中启动项目流程。");
      const sourceJointReviewId =
          p.sourceJointReviewId === undefined ? undefined : text(p.sourceJointReviewId),
        sourceJointReview = sourceJointReviewId
          ? await host.joint.sourceForPlan(sourceJointReviewId, project.id)
          : undefined;
      assertProjectSerial(host.store, project.id);
      if (
        host.store
          .list<ProjectFlow>("project_flows")
          .some((f) => f.projectId === project.id && !["completed", "cancelled"].includes(f.status))
      )
        throw new FlowError("FLOW_ACTIVE", "这个项目已有进行中的流程。");
      const memberIds = [...new Set(Array.isArray(p.memberIds) ? p.memberIds.map(String) : [])],
        leadMemberId = text(p.leadMemberId);
      if (
        !memberIds.includes(leadMemberId) ||
        !memberIds.length ||
        memberIds.some((id) => !host.runtime.available(id, false))
      )
        throw new FlowError("MEMBER_UNAVAILABLE", "请选择已连接的负责人和团队成员。");
      if (!memberIds.some((id) => id !== leadMemberId))
        throw new FlowError("REVIEWER_REQUIRED", "负责人参与任务时需要另一名成员复核。");
      if (
        !host.runtime.quotaAllows(
          leadMemberId,
          host.runtime.configuration?.(project.id, leadMemberId).model,
        )
      )
        throw new FlowError("QUOTA_BLOCKED", "负责人额度已耗尽，请刷新额度或选择其他负责人。");
      const topic =
          p.topic === undefined
            ? (sourceJointReview?.conclusion?.summary ?? "")
            : text(p.topic, true),
        previous = host.store
          .list<ProjectFlow>("project_flows")
          .filter(
            (flow) =>
              flow.projectId === project.id && ["completed", "cancelled"].includes(flow.status),
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      host.store.ensureProjectRoom(project.id);
      const discussionContext = captureFlowDiscussion(
        host.store,
        project.id,
        p,
        topic ? undefined : previous?.updatedAt,
      );
      if (
        !topic &&
        !discussionContext.messages.length &&
        !discussionContext.minutes?.text.trim() &&
        !discussionContext.background?.trim()
      )
        throw new FlowError(
          "INVALID_REQUEST",
          "请先在本项目会议室讨论这次要完成的内容，或填写 topic。",
        );
      const instruction = topic || "根据本项目会议讨论起草方案",
        flow: ProjectFlow = {
          ...host.record(project.id, ""),
          leadMemberId,
          memberIds,
          reviewLevel: host.configuredLevel(p.reviewLevel, "medium"),
          roomId: discussionContext.roomId,
          threadId: discussionContext.threadId,
          topic: instruction,
          discussionContext,
          dispatchMode: "running",
          status: "planning",
          blockedReasons: [],
        };
      flow.writeBoundary = captureProjectBoundary(host.store, project.id);
      flow.sourceJointReviewId = sourceJointReviewId;
      if (p.sourceRoundtable) {
        if (!host.runtime.roundtableSource)
          throw new FlowError("INVALID_SUBJECT", "圆桌材料不可用。");
        flow.sourceRoundtable = object(p.sourceRoundtable, [
          "topicId",
          "conclusionId",
          "messageId",
        ]) as NonNullable<ProjectFlow["sourceRoundtable"]>;
        await host.runtime.roundtableSource(flow.sourceRoundtable, project.id);
      }
      if (host.runtime.configuration)
        flow.memberConfigs = Object.fromEntries(
          memberIds.map((id) => [id, host.runtime.configuration!(project.id, id)]),
        );
      flow.memberNames = Object.fromEntries(
        host.store
          .members()
          .filter((m) => memberIds.includes(m.id))
          .map((m) => [m.id, m.name]),
      );
      if (previous && p.includePreviousRecord !== false) {
        const record = host.workbench.record({ flowId: previous.id });
        flow.previousRecord = { flowId: previous.id, summary: record.summary };
      }
      flow.flowId = flow.id;
      host.store.put("project_flows", flow.id, flow);
      host.launch(() => host.proposed(flow, instruction));
      return {
        requestId: p.requestId,
        entityId: flow.id,
        revision: flow.revision,
        pending: true,
      };
    },
    "projectFlow.plan.revise": async (p: CommandParams): Promise<unknown> => {
      const plan = host.need<Plan>("flow_plans", String(p.planId));
      host.check(plan, p);
      const flow = host.flow(plan.flowId),
        instruction =
          text(p.instruction ?? "", true) ||
          "用户选择修改方案，未补充意见。沿用现有任务目标和范围，复查方案并提出改进。";
      if (
        !["awaiting_confirmation", "confirmed"].includes(plan.status) ||
        flow.activePlanId !== plan.id
      )
        throw new FlowError("STALE_REVISION", "该方案已被替代。");
      const roomId = ("project:" + flow.projectId) as import("../../shared/types").RoomId,
        minutes = host.store.roomState(roomId).discussion?.meetingMinutes;
      if (
        minutes?.source === "user" &&
        minutes.status === "done" &&
        host.store.currentRoomThread(roomId).id === flow.threadId
      )
        host.update("project_flows", flow, {
          discussionContext: captureFlowDiscussion(host.store, flow.projectId, {
            threadId: flow.threadId,
            minutesMessageId: minutes.messageId,
          }),
        });
      host.prepareReplan(host.flow(flow.id));
      host.launch(() => host.proposed(host.flow(flow.id), instruction, plan));
      return {
        requestId: p.requestId,
        entityId: plan.id,
        revision: plan.revision,
        pending: true,
      };
    },
    "projectFlow.plan.confirm": async (p: CommandParams): Promise<unknown> => {
      const plan = host.need<Plan>("flow_plans", String(p.planId));
      host.check(plan, p);
      const flow = host.flow(plan.flowId);
      if (
        plan.status !== "awaiting_confirmation" ||
        flow.activePlanId !== plan.id ||
        flow.status !== "awaiting_plan"
      )
        throw new FlowError("STALE_REVISION", "该方案已被替代或正在调整。");
      if (flow.sourceJointReviewId)
        await host.joint.sourceForPlan(flow.sourceJointReviewId, flow.projectId);
      if (flow.sourceRoundtable)
        await host.runtime.roundtableSource!(flow.sourceRoundtable, flow.projectId);
      assertProjectBoundary(host.store, flow.projectId, flow.writeBoundary);
      assertProjectPaths(
        host.store,
        flow.projectId,
        plan.tasks.flatMap((t) => t.allowedPaths),
      );
      assertProjectSerial(host.store, flow.projectId);
      for (const r of plan.rounds) {
        const choice = (p.requiresUserAcceptanceByRound as Record<string, boolean> | undefined)?.[
          r.key
        ];
        if (choice !== undefined && typeof choice !== "boolean")
          throw new FlowError("INVALID_REQUEST", "每轮验收选择必须明确。");
      }
      const level = host.configuredLevel(p.reviewLevel, reviewLevel(flow)),
        peerChoices = p.requiresPeerReviewByRound as Record<string, unknown> | undefined;
      for (const r of plan.rounds)
        if (peerChoices?.[r.key] !== undefined && typeof peerChoices[r.key] !== "boolean")
          throw new FlowError("INVALID_REQUEST", "整轮他人复核选择必须明确。");
      const priorRound = flow.currentRoundId
          ? host.store.get<Round>("flow_rounds", flow.currentRoundId)
          : undefined,
        priorIntegration = priorRound?.integrationId
          ? host.store.get<Integration>("flow_integrations", priorRound.integrationId)
          : undefined,
        priorArtifact =
          priorRound?.status === "accepted" && priorIntegration?.version
            ? host.artifacts.get(priorIntegration.version.artifactId)
            : priorRound?.baseVersion
              ? host.artifacts.get(priorRound.baseVersion.artifactId)
              : undefined;
      const base = await host.artifacts.capture(
        flow,
        priorArtifact?.root ?? host.need<Project>("projects", flow.projectId).directory,
        "base",
        priorArtifact?.baseArtifactId,
        priorArtifact?.fingerprint,
      );
      const roundMap = new Map<string, Round>(),
        taskMap = new Map<string, Task>();
      try {
        host.check(host.need<Plan>("flow_plans", plan.id), p);
        const latest = host.flow(flow.id);
        if (latest.status !== "awaiting_plan" || latest.activePlanId !== plan.id)
          throw new FlowError("STALE_REVISION", "捕获基线期间方案或流程已改变。");
      } catch (error) {
        await host.artifacts.remove(base);
        throw error;
      }
      plan.rounds.forEach((r, index) => {
        const choice = (p.requiresUserAcceptanceByRound as Record<string, boolean> | undefined)?.[
            r.key
          ],
          roundLevel = host.configuredLevel(
            (p.reviewLevelByRound as Record<string, unknown> | undefined)?.[r.key],
            r.reviewLevel ?? level,
          );
        const round: Round = {
          ...host.record(flow.projectId, flow.id),
          ...r,
          planId: plan.id,
          index,
          reviewLevel:
            (p.reviewLevelByRound as Record<string, unknown> | undefined)?.[r.key] !== undefined
              ? roundLevel
              : r.reviewLevel,
          requiresUserAcceptance:
            index === plan.rounds.length - 1 || roundLevel === "low"
              ? true
              : (choice ?? r.requiresUserAcceptance),
          requiresPeerReview: peerChoices?.[r.key] === true,
          taskIds: [],
          integrationFixCount: 0,
          status: index === 0 ? "executing" : "pending",
          startedAt: index === 0 ? flow.createdAt : undefined,
          baseVersion: index === 0 ? host.artifacts.version(base) : undefined,
        };
        roundMap.set(r.key, round);
      });
      for (const spec of plan.tasks) {
        const round = roundMap.get(spec.roundKey)!,
          reviewerMemberId =
            spec.reviewerMemberId ?? host.reviewer(flow, spec.memberId, [...taskMap.values()]);
        const task: Task = {
          ...host.record(flow.projectId, flow.id),
          ...spec,
          planId: plan.id,
          roundId: round.id,
          kind: "implementation",
          reviewerMemberId,
          returnCount: 0,
          disputeReturnWaiverCount: 0,
          rearrangeCount: 0,
          status: "pending",
          findingIds: [],
        };
        taskMap.set(spec.key, task);
        round.taskIds.push(task.id);
      }
      const rounds = [...roundMap.values()];
      rounds.forEach((r, i) => (r.predecessorRoundId = rounds[i - 1]?.id));
      const reused = await host.reusableTasks(plan, base, taskMap, roundMap);
      try {
        assertProjectPaths(
          host.store,
          flow.projectId,
          plan.tasks.flatMap((t) => t.allowedPaths),
        );
        assertProjectSerial(host.store, flow.projectId);
        if (flow.sourceJointReviewId)
          await host.joint.sourceForPlan(flow.sourceJointReviewId, flow.projectId);
        if (flow.sourceRoundtable)
          await host.runtime.roundtableSource!(flow.sourceRoundtable, flow.projectId);
        host.check(host.need<Plan>("flow_plans", plan.id), p);
        const latest = host.flow(flow.id);
        if (latest.status !== "awaiting_plan" || latest.activePlanId !== plan.id)
          throw new FlowError("STALE_REVISION", "核对沿用成果期间方案或流程已改变。");
      } catch (error) {
        await host.artifacts.remove(base);
        throw error;
      }
      host.store.transaction(() => {
        if (plan.parentPlanId) {
          const parent = host.need<Plan>("flow_plans", plan.parentPlanId);
          host.update("flow_plans", parent, { status: "superseded" });
          for (const t of host.store
            .list<Task>("flow_tasks")
            .filter(
              (t) => t.planId === parent.id && !["accepted", "integrated"].includes(t.status),
            ))
            host.update("flow_tasks", t, { status: "cancelled" });
          for (const d of host.store
            .list<Decision>("flow_decisions")
            .filter((d) => d.flowId === flow.id && d.status === "open"))
            host.update("flow_decisions", d, { status: "expired" });
        }
        for (const write of reused) host.store.put(write.entity, write.id, write.value);
        for (const r of rounds) host.store.put("flow_rounds", r.id, r);
        for (const t of taskMap.values())
          host.store.put("flow_tasks", t.id, {
            ...t,
            dependencies: t.dependencies.map((key) => taskMap.get(key)!.id),
          });
        host.update("flow_plans", plan, {
          status: "confirmed",
          confirmedAt: at(),
        });
        host.update("project_flows", host.flow(flow.id), {
          status: "active",
          reviewLevel: level,
          currentRoundId: rounds[0].id,
          blockedReasons: [],
        });
        completeFlowRequest(host.store,p.requestId,{requestId:p.requestId,entityId:flow.id,revision:host.flow(flow.id).revision,pending:false});
      });
      return {
        requestId: p.requestId,
        entityId: flow.id,
        revision: host.flow(flow.id).revision,
        pending: false,
      };
    },
  } satisfies Record<string, FlowCommand>;
}

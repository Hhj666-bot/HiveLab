import { randomUUID } from "node:crypto";
import type { Store } from "../store";
import type { Run } from "../../shared/types";
import { projectFlowCardWrite } from "../project-room-reports";
import {
  checkSupplementCapacity,
  requirementsRevision,
  supplementRequest,
  SUPPLEMENTABLE,
} from "../project-flow-supplements";
import {
  FlowError,
  type FlowRecord,
  type ProjectFlow,
  type Round,
  type Task,
  type Submission,
  type Review,
  type Decision,
  type FlowOperation,
  type TaskSupplement,
  type TaskSupplementResult,
} from "../../shared/project-flow";
import { text } from "../../shared/project-flow-protocol";
import type { FlowHost } from "../project-flow";
import type { CommandParams, FlowCommand } from "./registry";

export interface SupplementCommandHost {
  readonly need: <T>(entity: string, id: string) => T;
  readonly check: (record: FlowRecord, p: Record<string, unknown>) => void;
  readonly flow: (id: string) => ProjectFlow;
  readonly store: Store;
  readonly record: (projectId: string, flowId: string) => FlowRecord;
  readonly update: <T extends FlowRecord>(entity: string, item: T, patch: Partial<T>) => T;
  readonly operation: (
    flow: ProjectFlow,
    kind: string,
    target: FlowRecord,
    sessionId?: string,
  ) => FlowOperation;
  readonly patchSupplement: (
    taskId: string,
    supplementId: string,
    patch: Partial<TaskSupplement>,
  ) => Task;
  readonly runtime: FlowHost;
}

const at = () => new Date().toISOString();
const finished = new Set(["review_passed", "review_skipped", "integrated", "accepted"]);

export function createSupplementCommands(host: SupplementCommandHost) {
  async function supplementTask(p: Record<string, unknown>): Promise<TaskSupplementResult> {
    let task = host.need<Task>("flow_tasks", String(p.taskId));
    host.check(task, p);
    const flow = host.flow(task.flowId),
      requestId = String(p.requestId);
    if (!["active", "completed"].includes(flow.status) || flow.activePlanId !== task.planId)
      throw new FlowError("STALE_REVISION", "只能补充当前执行方案中的任务。");
    const request = supplementRequest(host.store, flow, task, p);
    if (finished.has(task.status))
      return {
        requestId,
        entityId: task.id,
        revision: task.revision,
        pending: false,
        disposition: "new-task-required",
        nextAction: "projectFlow.task.add",
        requiresNewFlow: flow.status === "completed",
        draft: {
          originTaskId: task.id,
          flowId: flow.id,
          roundId: task.roundId,
          memberId: task.memberId,
          goal: request.content,
          allowedPaths: [...task.allowedPaths],
          ...(request.sourceMessageId ? { sourceMessageId: request.sourceMessageId } : {}),
        },
      };
    if (flow.status !== "active")
      throw new FlowError("STALE_REVISION", "流程已结束，不能修改历史任务。");
    const operations = host.store
      .list<FlowOperation>("flow_operations")
      .filter((op) => op.targetId === task.id);
    if (
      task.supplements?.some((s) => s.status === "unknown") ||
      operations.some(
        (op) =>
          op.state === "blocked" &&
          (op.kind === "supplement-delivery" ||
            host.store.get<Run>("runs", op.correctionRunId ?? op.runId ?? "")?.status ===
              "unknown"),
      )
    )
      throw new FlowError("UNKNOWN_RESULT", "先核对原任务或补充的未知投递，补充不会自动重发。");
    if (!SUPPLEMENTABLE.has(task.status))
      throw new FlowError("TASK_ACTIVE", "请先处理任务的阻塞或重新安排，再补充要求。");
    if (task.supplements?.some((s) => s.status === "delivering"))
      throw new FlowError("SUPPLEMENT_PENDING", "上一项补充还在确认投递，请稍后刷新。");
    if (task.supplements?.some((s) => s.status === "awaiting_scope"))
      throw new FlowError("SCOPE_PENDING", "先处理已有补充的范围决策。");
    checkSupplementCapacity(task, request.content);
    const supplement: TaskSupplement = {
      id: randomUUID(),
      requestId,
      text: request.content,
      createdAt: at(),
      source: request.source,
      ...(request.sourceMessageId ? { sourceMessageId: request.sourceMessageId } : {}),
      requestedPaths: request.requestedPaths,
      status: request.outside.length ? "awaiting_scope" : "pending",
    };
    if (request.outside.length) {
      const decision: Decision = {
        ...host.record(flow.projectId, flow.id),
        kind: "scope-change",
        taskId: task.id,
        roundId: task.roundId,
        supplementId: supplement.id,
        title: "补充要求超出当前任务范围",
        reason: `补充：${supplement.text}\n需处理的范围：${request.outside.join("、")}。原任务和许可范围尚未修改。`,
        options: ["调整方案", "保持原范围"],
        eligibleTaskIds: [],
        sourceVersions: task.latestSubmissionId
          ? [host.need<Submission>("flow_submissions", task.latestSubmissionId).version]
          : [],
        status: "open",
      };
      supplement.decisionId = decision.id;
      host.store.transaction(() => {
        task = host.update("flow_tasks", task, {
          supplements: [...(task.supplements ?? []), supplement],
        });
        host.store.putMany([
          { entity: "flow_decisions", id: decision.id, value: decision },
          projectFlowCardWrite(host.store, "decision", decision)!,
        ]);
      });
      return {
        requestId,
        entityId: task.id,
        revision: task.revision,
        pending: true,
        disposition: "scope-change",
        supplementId: supplement.id,
        decisionId: decision.id,
      };
    }
    if (Array.isArray(p.messageSkills)) {
      host.store.put("message_skills", "supplement:" + supplement.id, { items: p.messageSkills });
      host.store.put("message_skills", "task:" + task.id, { items: p.messageSkills });
    }
    supplement.requirementsRevision = requirementsRevision(task) + 1;
    if (task.status === "awaiting_review")
      supplement.withdrawnSubmissionId = task.latestSubmissionId;
    host.store.transaction(() => {
      if (supplement.withdrawnSubmissionId)
        host.update(
          "flow_submissions",
          host.need<Submission>("flow_submissions", supplement.withdrawnSubmissionId),
          {
            status: "stale",
            staleReason: "用户补充了任务要求，本次提交已撤回，复核不能使用旧标准。",
          },
        );
      for (const review of host.store
        .list<Review>("flow_reviews")
        .filter(
          (review) => review.taskId === task.id && ["queued", "running"].includes(review.status),
        ))
        host.update("flow_reviews", review, {
          status: "stale",
          staleReason: "用户补充了要求，等待作者修正后重新提交。",
        });
      for (const op of operations.filter(
        (op) =>
          ["review", "adjudication"].includes(op.kind) &&
          ["prepared", "running"].includes(op.state),
      ))
        host.update("flow_operations", op, {
          state: "done",
          result: { supersededBySupplement: supplement.id },
        });
      for (const decision of host.store
        .list<Decision>("flow_decisions")
        .filter(
          (d) =>
            d.taskId === task.id &&
            d.status === "open" &&
            d.submissionId === supplement.withdrawnSubmissionId,
        ))
        host.update("flow_decisions", decision, { status: "expired" });
      task = host.update("flow_tasks", task, {
        goal: task.goal + "\n\n用户补充：" + supplement.text,
        completionCriteria: [
          ...new Set([...task.completionCriteria, "补充要求：" + supplement.text]),
        ],
        requirementsRevision: supplement.requirementsRevision,
        supplements: [...(task.supplements ?? []), supplement],
        ...(supplement.withdrawnSubmissionId
          ? {
              status: "correcting",
              latestSubmissionId: undefined,
              activeRunId: undefined,
            }
          : {}),
      });
      if (supplement.sourceMessageId) {
        const round = host.need<Round>("flow_rounds", task.roundId);
        host.update("flow_rounds", round, {
          meetingHandledIds: [
            ...new Set([...(round.meetingHandledIds ?? []), supplement.sourceMessageId]),
          ],
          meetingResponses: [
            ...(round.meetingResponses ?? []),
            {
              messageId: supplement.sourceMessageId,
              disposition: "in-scope-fix",
              summary: "用户已将这项要求补充到任务 " + task.title + "，按新的完成标准复核。",
              paths: supplement.requestedPaths,
              fixTaskId: task.id,
            },
          ],
        });
      }
    });
    const authorOperation = operations.find((op) => op.kind === "task" && op.state === "running"),
      runId = authorOperation && (authorOperation.correctionRunId ?? authorOperation.runId);
    if (
      !authorOperation ||
      !runId ||
      authorOperation.correctionRunId ||
      host.flow(flow.id).dispatchMode !== "running"
    )
      return {
        requestId,
        entityId: task.id,
        revision: task.revision,
        pending: true,
        disposition: "recorded",
        supplementId: supplement.id,
      };
    const delivery = host.operation(flow, "supplement-delivery", task, task.sessionId);
    host.update("flow_operations", delivery, {
      state: "running",
      runId,
      supplementId: supplement.id,
    });
    host.patchSupplement(task.id, supplement.id, {
      status: "delivering",
      deliveryOperationId: delivery.id,
    });
    const prompt = `用户明确补充当前任务，这不是复核退回，不改变许可文件范围。\n补充要求：${supplement.text}\n任务目标：${task.goal}\n最新完成标准：${JSON.stringify(task.completionCriteria)}\n结束时仍只返回 hivelab.project-flow submission JSON，completionResults 必须逐项包含最新完成标准。`;
    let outcome: "current" | "next-turn" | "unknown";
    try {
      outcome = (await host.runtime.steer?.(runId, prompt, delivery.id)) ?? "next-turn";
    } catch {
      outcome = "unknown";
    }
    host.store.transaction(() => {
      if (outcome === "unknown") {
        const reason = "补充要求的投递结果待核对，未自动重发。";
        host.patchSupplement(task.id, supplement.id, {
          status: "unknown",
          deliveredRunId: runId,
        });
        host.update("flow_operations", delivery, {
          state: "blocked",
          error: reason,
        });
        const previous = host.need<FlowOperation>("flow_operations", authorOperation.id);
        if (["prepared", "running"].includes(previous.state))
          host.update("flow_operations", previous, {
            state: "done",
            result: {
              supersededBySupplement: supplement.id,
              deliveryUnknown: true,
            },
          });
        task = host.update("flow_tasks", host.need<Task>("flow_tasks", task.id), {
          status: "blocked",
          statusBeforeBlock: "correcting",
          blockedReason: reason,
          activeRunId: undefined,
        });
        const latestFlow = host.flow(flow.id);
        host.update("project_flows", latestFlow, {
          dispatchMode: "paused",
          blockedReasons: [...new Set([...latestFlow.blockedReasons, reason])],
        });
      } else {
        host.patchSupplement(task.id, supplement.id, {
          status: outcome === "current" ? "delivered" : "pending",
          delivery: outcome,
          deliveredRunId: outcome === "current" ? runId : undefined,
        });
        host.update("flow_operations", delivery, {
          state: "done",
          result: { delivery: outcome },
        });
        if (outcome === "current") {
          const latest = host.need<FlowOperation>("flow_operations", authorOperation.id);
          if (latest.state === "running")
            host.update("flow_operations", latest, {
              requirementsRevision: supplement.requirementsRevision,
            });
        }
      }
    });
    task = host.need<Task>("flow_tasks", task.id);
    return {
      requestId,
      entityId: task.id,
      revision: task.revision,
      pending: outcome !== "current",
      disposition: outcome,
      supplementId: supplement.id,
      operationId: delivery.id,
    };
  }

  return {
    "projectFlow.task.supplement": async (p: CommandParams): Promise<unknown> => {
      return supplementTask(p);
    },
  } satisfies Record<string, FlowCommand>;
}

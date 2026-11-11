import { ProjectWorkbench } from "../project-workbench";
import type { Store } from "../store";
import {
  FlowError,
  type FlowRecord,
  type ProjectFlow,
  type Round,
  type Task,
  type Decision,
  type FlowOperation,
} from "../../shared/project-flow";
import { reviewLevel, type ReviewLevel } from "../../shared/project-flow";
import type { FlowHost } from "../project-flow";
import type { CommandParams, FlowCommand } from "./registry";

export interface LifecycleCommandHost {
  readonly flow: (id: string) => ProjectFlow;
  readonly check: (record: FlowRecord, p: Record<string, unknown>) => void;
  readonly store: Store;
  readonly retryable: (flow: ProjectFlow) => Task[];
  readonly update: <T extends FlowRecord>(entity: string, item: T, patch: Partial<T>) => T;
  readonly restoreCompleted: (flow: ProjectFlow) => void;
  readonly resumePlanning: (flow: ProjectFlow) => void;
  readonly runtime: FlowHost;
  readonly workbench: ProjectWorkbench;
  readonly configuredLevel: (value: unknown, fallback?: ReviewLevel) => ReviewLevel;
  readonly need: <T>(entity: string, id: string) => T;
  readonly tasks: (flowId: string) => Task[];
}

export function createLifecycleCommands(host: LifecycleCommandHost) {
  async function changeDispatch(method: string, p: CommandParams): Promise<unknown> {
    const flow = host.flow(String(p.flowId));
    host.check(flow, p);
    if (["completed", "cancelled"].includes(flow.status))
      throw new FlowError("STALE_REVISION", "流程已结束，不能修改历史状态。");
    if (method.endsWith("resume")) {
      const held = host.store
        .list<FlowOperation>("flow_operations")
        .filter((o) => o.flowId === flow.id && o.state === "blocked" && o.recovery !== "completed");
      if (held.length)
        throw new FlowError("UNKNOWN_RESULT", "请先处理阻塞事项，继续不会重发未知运行。");
      if (
        host.store
          .list<Decision>("flow_decisions")
          .some(
            (d) =>
              d.flowId === flow.id &&
              d.status === "open" &&
              ["unresolved-review", "replan", "review-dispute"].includes(d.kind),
          )
      )
        throw new FlowError("DECISION_REQUIRED", "请先处理复核或重做决策；继续不会自动重做。");
      // A task that failed before any member started (preparing its copy, merging dependencies) has no attempt to give up;
      // continuing retries it. Tasks blocked after a member's work keep waiting for the owner.
      // A review that could not decide is reviewed again (the task itself is kept).
      for (const task of host.retryable(flow))
        host.update("flow_tasks", task, {
          status:
            ["pending", "ready", "queued"].includes(task.statusBeforeBlock ?? "") ||
            !task.latestSubmissionId
              ? "pending"
              : "awaiting_review",
          blockedReason: undefined,
          statusBeforeBlock: undefined,
          activeRunId: undefined,
        });
      if (flow.blockedReasons.length) host.update("project_flows", flow, { blockedReasons: [] });
    }
    host.update("project_flows", host.flow(flow.id), {
      dispatchMode: method.endsWith("resume")
        ? "running"
        : p.mode === "stop"
          ? "stopping"
          : "paused",
      ...(method.endsWith("cancel") ? { status: "cancelled" as const } : {}),
    });
    if (method.endsWith("resume")) {
      host.restoreCompleted(host.flow(flow.id));
      host.resumePlanning(host.flow(flow.id));
    }
    if (p.mode === "stop" || method.endsWith("cancel"))
      await Promise.all(
        host.store
          .list<FlowOperation>("flow_operations")
          .filter((o) => o.flowId === flow.id && o.state === "running" && o.runId)
          .map((o) => host.runtime.stop(o.correctionRunId ?? o.runId!)),
      );
    if (method.endsWith("cancel")) await host.workbench.finish(flow.id);
    return {
      requestId: p.requestId,
      entityId: flow.id,
      revision: host.flow(flow.id).revision,
      pending: false,
      activeTaskContinues: p.mode !== "stop",
    };
  }
  return {
    "projectFlow.review.configure": async (p: CommandParams): Promise<unknown> => {
      const flow = host.flow(String(p.flowId));
      host.check(flow, p);
      if (["completed", "cancelled"].includes(flow.status))
        throw new FlowError("STALE_REVISION", "流程已结束。");
      const level = host.configuredLevel(p.reviewLevel);
      if (level === "high" && flow.memberIds.length < 2)
        throw new FlowError("REVIEWER_REQUIRED", "最高程度需要另一名成员复核负责人自己的任务。");
      if (p.roundId) {
        const round = host.need<Round>("flow_rounds", String(p.roundId));
        if (
          round.flowId !== flow.id ||
          round.planId !== flow.activePlanId ||
          round.status !== "pending" ||
          host.tasks(flow.id).some((t) => t.roundId === round.id && t.sessionId)
        )
          throw new FlowError("ROUND_STARTED", "每轮程度只可在尚未开工时单独调整。");
        host.update("flow_rounds", round, {
          reviewLevel: level,
          ...(level === "low" ? { requiresUserAcceptance: true } : {}),
        });
        return {
          requestId: p.requestId,
          entityId: round.id,
          revision: host.need<Round>("flow_rounds", round.id).revision,
          pending: false,
        };
      }
      const updated = host.update("project_flows", flow, {
        reviewLevel: level,
      });
      return {
        requestId: p.requestId,
        entityId: flow.id,
        revision: updated.revision,
        pending: false,
      };
    },
    "projectFlow.pause": (p: CommandParams) => changeDispatch("projectFlow.pause", p),
    "projectFlow.resume": (p: CommandParams) => changeDispatch("projectFlow.resume", p),
    "projectFlow.cancel": (p: CommandParams) => changeDispatch("projectFlow.cancel", p),
  } satisfies Record<string, FlowCommand>;
}

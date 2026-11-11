import type { Store } from "../store";
import type { Run } from "../../shared/types";
import {
  FlowError,
  type FlowRecord,
  type ProjectFlow,
  type Round,
  type Task,
  type Decision,
  type FlowOperation,
  type Integration,
  type TaskSupplement,
} from "../../shared/project-flow";
import { text } from "../../shared/project-flow-protocol";
import { type ManualRedo, type RequestedRoundCheck } from "../../shared/project-flow";
import { finishedFlowReply } from "../project-flow-recovery";
import type { CommandParams, FlowCommand } from "./registry";

export interface RecoveryCommandHost {
  readonly need: <T>(entity: string, id: string) => T;
  readonly check: (record: FlowRecord, p: Record<string, unknown>) => void;
  readonly store: Store;
  readonly update: <T extends FlowRecord>(entity: string, item: T, patch: Partial<T>) => T;
  readonly flow: (id: string) => ProjectFlow;
  readonly restoreCompleted: (flow: ProjectFlow) => void;
  readonly patchSupplement: (
    taskId: string,
    supplementId: string,
    patch: Partial<TaskSupplement>,
  ) => Task;
  readonly completeRedo: (
    redos: ManualRedo[] | undefined,
    status: ManualRedo["status"],
  ) => ManualRedo[] | undefined;
  readonly roundRedoDecision: (
    flow: ProjectFlow,
    round: Round,
    integration: Integration,
    reason: string,
  ) => Decision;
  readonly decision: (
    flow: ProjectFlow,
    kind: Decision["kind"],
    task: Task,
    title: string,
    reason: string,
  ) => Decision;
  readonly resumePlanning: (flow: ProjectFlow) => void;
}

const at = () => new Date().toISOString();

export function createRecoveryCommands(host: RecoveryCommandHost) {
  return {
    "projectFlow.unknown.resolve": async (p: CommandParams): Promise<unknown> => {
      const op = host.need<FlowOperation>("flow_operations", String(p.operationId));
      host.check(op, p);
      if (
        op.state !== "blocked" ||
        !["reconcile", "abandon", "continue"].includes(String(p.choice))
      )
        throw new FlowError("INVALID_REQUEST", "请选择待核对操作及处理方式。");
      const runId = op.correctionRunId ?? op.runId,
        run = runId ? host.store.get<Run>("runs", runId) : undefined;
      if (
        ["queued", "running", "waiting_user", "stopping"].includes(run?.status ?? "") ||
        (run?.status === "rate_limited" && !run.completedAt)
      )
        throw new FlowError(
          "UNKNOWN_RESULT",
          "旧运行尚未确认停止；请先处理成员问题，或停止并核对旧运行。",
        );
      const evidence = text(p.evidence ?? "", true);
      if (p.choice === "reconcile") {
        if (!finishedFlowReply(host.store, op))
          throw new FlowError(
            "UNKNOWN_RESULT",
            "只有实际已正常结束、投递明确、且保留完整回复的运行才能恢复；不能仅凭声明标为完成。",
          );
        host.update("flow_operations", op, { recovery: "completed" });
        const flow = host.flow(op.flowId);
        if (flow.dispatchMode === "running") host.restoreCompleted(flow);
        return {
          requestId: p.requestId,
          entityId: op.id,
          revision: host.need<FlowOperation>("flow_operations", op.id).revision,
          pending: true,
        };
      }
      if (p.choice === "continue" && op.kind === "supplement-delivery")
        throw new FlowError(
          "UNKNOWN_RESULT",
          "补充投递结果未知时先核对回执，不能当成成员任务续做或重复投递。",
        );
      host.store.transaction(() => {
        host.update("flow_operations", op, {
          state: "done",
          resumeRequested: p.choice === "continue" || op.kind === "plan" || op.kind === "rearrange",
          result: {
            [p.choice === "continue" ? "continued" : "abandoned"]: true,
            evidence,
          },
          error:
            "用户明确选择" + (p.choice === "continue" ? "接着做" : "放弃重做") + "：" + evidence,
        });
        const task = host.store.get<Task>("flow_tasks", op.targetId);
        if (task) {
          if (op.kind === "supplement-delivery" && op.supplementId) {
            host.patchSupplement(task.id, op.supplementId, {
              status: "pending",
              delivery: "next-turn",
              deliveredRunId: undefined,
            });
            const receipt = host.store.get<Record<string, unknown>>("outbox", op.id);
            if (receipt)
              host.store.put("outbox", op.id, {
                ...receipt,
                acknowledgedAt: at(),
                acknowledgement: { choice: "abandon", evidence },
              });
            const previous = run?.flowOperationId
              ? host.store.get<FlowOperation>("flow_operations", run.flowOperationId)
              : undefined;
            if (previous?.targetId === task.id && previous.kind === "task")
              host.update("flow_operations", previous, {
                state: "done",
                result: {
                  ...(previous.result as Record<string, unknown> | undefined),
                  abandoned: true,
                  abandonedWithSupplement: op.id,
                  evidence,
                },
              });
          }
          if (
            p.choice !== "continue" &&
            task.manualRedos?.at(-1)?.status === "pending" &&
            ["task", "supplement-delivery"].includes(op.kind)
          ) {
            const round = host.need<Round>("flow_rounds", task.roundId),
              flow = host.flow(task.flowId);
            host.update("flow_tasks", task, {
              status: task.kind === "integration-fix" ? "cancelled" : "escalated",
              blockedReason: "人工指定的单次尝试已明确放弃，需要重新选择。",
              activeRunId: undefined,
              manualRedos: host.completeRedo(task.manualRedos, "failed"),
            });
            if (task.kind === "integration-fix" && round.integrationId) {
              host.update("flow_rounds", round, {
                status: "blocked",
                manualRedos: host.completeRedo(round.manualRedos, "failed"),
              });
              host.roundRedoDecision(
                flow,
                round,
                host.need<Integration>("flow_integrations", round.integrationId),
                "人工指定负责人的单次运行已放弃，需要重新选择。",
              );
            } else
              host.decision(
                flow,
                "replan",
                host.need<Task>("flow_tasks", task.id),
                "人工重做需要重新选择",
                "本次工作已明确放弃。历史计数保留，选择新成员后仅再做一次。",
              );
          } else
            host.update("flow_tasks", task, {
              status:
                ["review", "adjudication"].includes(op.kind) && task.latestSubmissionId
                  ? "awaiting_review"
                  : op.kind === "rearrange"
                    ? "escalated"
                    : p.choice === "continue"
                      ? "correcting"
                      : "pending",
              blockedReason: undefined,
              activeRunId: undefined,
              ...(op.kind === "task"
                ? p.choice === "continue"
                  ? {
                      inputs: [
                        ...task.inputs,
                        "上次运行被中断。请检查当前文件状态，在原副本把任务做完，再按格式提交；历史退回计数保留。",
                      ],
                    }
                  : { sessionId: undefined, executionBase: undefined }
                : {}),
            });
        } else if (["integration-check", "peer-review", "round-report"].includes(op.kind)) {
          const integration = host.need<Integration>("flow_integrations", op.targetId),
            round = host.need<Round>("flow_rounds", integration.roundId);
          if (
            round.integrationId === integration.id &&
            round.planId === host.flow(op.flowId).activePlanId
          ) {
            host.update("flow_rounds", round, { status: "checking" });
            host.update("flow_integrations", integration, {
              status: "checking",
              ...(op.kind === "integration-check"
                ? { checkRunId: undefined, outcome: undefined }
                : {}),
              ...(op.kind === "peer-review" ? { peerReview: undefined } : {}),
            });
          }
        } else if (op.kind === "requested-check") {
          const check = host.need<RequestedRoundCheck>("flow_requested_checks", op.targetId),
            round = host.need<Round>("flow_rounds", check.roundId);
          host.update("flow_requested_checks", check, { status: "pending" });
          host.update("flow_rounds", round, { status: "checking" });
        } else if (op.kind === "next-round") {
          const round = host.need<Round>("flow_rounds", op.targetId);
          if (
            round.planId === host.flow(op.flowId).activePlanId &&
            round.nextConfirmation?.status === "suggesting"
          )
            host.update("flow_rounds", round, { status: "pending" });
        }
        const flow = host.flow(op.flowId),
          others = host.store
            .list<FlowOperation>("flow_operations")
            .filter((o) => o.flowId === op.flowId && o.state === "blocked");
        host.update("project_flows", flow, {
          blockedReasons: [
            ...new Set(
              others
                .filter((o) => o.recovery !== "completed")
                .map((o) => o.error)
                .filter((e): e is string => Boolean(e)),
            ),
          ],
        });
      });
      const latestFlow = host.flow(op.flowId);
      if (latestFlow.dispatchMode === "running") host.resumePlanning(latestFlow);
      return {
        requestId: p.requestId,
        entityId: op.id,
        revision: host.need<FlowOperation>("flow_operations", op.id).revision,
        pending: false,
      };
    },
  } satisfies Record<string, FlowCommand>;
}

import type { Store } from "../store";
import { FlowApply, type ApplyJournal } from "../project-flow-apply";
import { roundMeetingMaterial } from "../project-flow-room";
import {
  FlowError,
  type FlowRecord,
  type ProjectFlow,
  type Round,
  type Task,
  type Decision,
  type Integration,
  type Acceptance,
} from "../../shared/project-flow";
import { text } from "../../shared/project-flow-protocol";
import {
  type ManualRedo,
  type UserChangeRequest,
  type RequestedRoundCheck,
} from "../../shared/project-flow";
import type { CommandParams, FlowCommand } from "./registry";

export interface RoundCommandHost {
  readonly need: <T>(entity: string, id: string) => T;
  readonly check: (record: FlowRecord, p: Record<string, unknown>) => void;
  readonly requestRoundCheck: (
    round: Round,
    integration: Integration,
    memberId: string,
  ) => RequestedRoundCheck;
  readonly busyTargets: Set<string>;
  readonly flow: (id: string) => ProjectFlow;
  readonly store: Store;
  readonly pendingScope: (roundId: string) => boolean;
  readonly update: <T extends FlowRecord>(entity: string, item: T, patch: Partial<T>) => T;
  readonly record: (projectId: string, flowId: string) => FlowRecord;
  readonly launch: (job: () => Promise<void>, failure?: (error: Error) => void) => void;
  readonly accept: (
    round: Round,
    integration: Integration,
    acceptance: Acceptance,
  ) => Promise<void>;
  readonly blocked: (flowId: string, error: Error, targetId?: string) => void;
  readonly applications: FlowApply;
  readonly finishAcceptance: (
    round: Round,
    integration: Integration,
    acceptance: Acceptance,
  ) => Promise<void>;
  readonly integrationFix: (
    round: Round,
    integration: Integration,
    reason: string,
    completionCriteria?: string[],
    onStaged?: (task?: Task) => void,
    manualRedo?: ManualRedo,
    userRequest?: UserChangeRequest,
  ) => Promise<void>;
}

const at = () => new Date().toISOString();

export function createRoundCommands(host: RoundCommandHost) {
  return {
    "projectFlow.round.requestCheck": async (p: CommandParams): Promise<unknown> => {
      const round = host.need<Round>("flow_rounds", String(p.roundId));
      host.check(round, p);
      const integration = host.need<Integration>("flow_integrations", String(p.integrationId)),
        check = host.requestRoundCheck(round, integration, text(p.memberId));
      return {
        requestId: p.requestId,
        entityId: check.id,
        revision: check.revision,
        pending: true,
      };
    },
    "projectFlow.round.accept": async (p: CommandParams): Promise<unknown> => {
      const round = host.need<Round>("flow_rounds", String(p.roundId));
      host.check(round, p);
      const integration = host.need<Integration>("flow_integrations", String(p.integrationId));
      if (
        host.busyTargets.has(round.id) ||
        (round.acceptanceId &&
          ["requested", "applying", "recovery_required"].includes(
            host.need<Acceptance>("flow_acceptances", round.acceptanceId).status,
          ))
      )
        throw new FlowError("RECOVERY_REQUIRED", "上一项验收写入还未核对完成。");
      const flow = host.flow(round.flowId);
      if (
        flow.status !== "active" ||
        round.planId !== flow.activePlanId ||
        round.status !== "awaiting_acceptance" ||
        round.integrationId !== integration.id ||
        integration.status !== "ready" ||
        p.fingerprint !== integration.version?.fingerprint
      )
        throw new FlowError("STALE_VERSION", "请选择当前待验收的整合版本。");
      if (
        host.store
          .list<Decision>("flow_decisions")
          .some(
            (decision) =>
              decision.roundId === round.id &&
              [
                "meeting-request",
                "review-choice",
                "unresolved-review",
                "replan",
                "review-dispute",
              ].includes(decision.kind) &&
              decision.status === "open",
          )
      )
        throw new FlowError("MEETING_PENDING", "请先处理会议要求或复核决策，再验收成品。");
      if (host.pendingScope(round.id))
        throw new FlowError("SCOPE_PENDING", "请先处理补充要求的范围决策，再验收成品。");
      if (roundMeetingMaterial(host.store, round).pendingUserMessages.length) {
        host.update("flow_rounds", round, { status: "checking" });
        throw new FlowError(
          "MEETING_PENDING",
          "会议里有新的发言尚未纳入汇报，负责人会先补充汇报，请核对后再验收。",
        );
      }
      const acceptance: Acceptance = {
        ...host.record(round.projectId, round.flowId),
        roundId: round.id,
        integrationId: integration.id,
        version: integration.version!,
        actor: "user",
        opinion: String(p.opinion ?? "验收通过"),
        requiresApply: true,
        status: "requested",
        appliedPaths: [],
        conflictPaths: [],
      };
      host.store.transaction(() => {
        host.store.put("flow_acceptances", acceptance.id, acceptance);
        host.update("flow_rounds", round, { acceptanceId: acceptance.id });
      });
      host.busyTargets.add(round.id);
      host.launch(
        async () => {
          try {
            await host.accept(round, integration, acceptance);
          } finally {
            host.busyTargets.delete(round.id);
          }
        },
        (error) => {
          const journal = host.store.get<ApplyJournal>("flow_apply_journals", acceptance.id);
          host.update("flow_acceptances", acceptance, {
            status: journal ? "recovery_required" : "conflict",
          });
          if (!journal) host.blocked(round.flowId, error);
        },
      );
      return {
        requestId: p.requestId,
        entityId: acceptance.id,
        revision: acceptance.revision,
        operationId: acceptance.id,
        pending: true,
      };
    },
    "projectFlow.acceptance.recover": async (p: CommandParams): Promise<unknown> => {
      const acceptance = host.need<Acceptance>("flow_acceptances", String(p.acceptanceId));
      host.check(acceptance, p);
      if (acceptance.status !== "recovery_required" || host.busyTargets.has(acceptance.roundId))
        throw new FlowError("RECOVERY_REQUIRED", "当前没有可核对的中断验收，或正在核对。");
      if (!["reconcile", "continue"].includes(String(p.choice)))
        throw new FlowError("INVALID_REQUEST", "请选择核对结果或继续剩余写入。");
      host.busyTargets.add(acceptance.roundId);
      try {
        const round = host.need<Round>("flow_rounds", acceptance.roundId),
          integration = host.need<Integration>("flow_integrations", acceptance.integrationId),
          journal = host.store.get<ApplyJournal>("flow_apply_journals", acceptance.id);
        if (!journal) {
          if (p.choice === "continue") await host.accept(round, integration, acceptance);
        } else {
          const recovered = await host.applications.recover(
            acceptance.id,
            p.choice as "reconcile" | "continue",
          );
          if (recovered.state === "applied")
            await host.finishAcceptance(round, integration, acceptance);
          else
            host.update("flow_acceptances", acceptance, {
              status: "recovery_required",
              conflictPaths: recovered.conflicts.map((c) => c.path),
            });
        }
      } finally {
        host.busyTargets.delete(acceptance.roundId);
      }
      return {
        requestId: p.requestId,
        entityId: acceptance.id,
        revision: host.need<Acceptance>("flow_acceptances", acceptance.id).revision,
        pending: false,
      };
    },
    "projectFlow.round.requestChanges": async (p: CommandParams): Promise<unknown> => {
      const round = host.need<Round>("flow_rounds", String(p.roundId));
      host.check(round, p);
      const flow = host.flow(round.flowId);
      if (
        flow.status !== "active" ||
        round.planId !== flow.activePlanId ||
        round.status !== "awaiting_acceptance" ||
        round.integrationId !== p.integrationId
      )
        throw new FlowError("STALE_VERSION", "该成品已不处于待验收状态。");
      if (
        host.busyTargets.has(round.id) ||
        (round.acceptanceId &&
          ["requested", "applying", "recovery_required"].includes(
            host.need<Acceptance>("flow_acceptances", round.acceptanceId).status,
          ))
      )
        throw new FlowError("RECOVERY_REQUIRED", "先核对验收写入，再请求修改。");
      const integration = host.need<Integration>("flow_integrations", round.integrationId!);
      await host.integrationFix(
        round,
        integration,
        text(p.opinion ?? "", true) || "用户选择驳回本轮，请复查未满足的要求；未补充意见。",
        undefined,
        undefined,
        undefined,
        {
          id: String(p.requestId),
          integrationId: integration.id,
          opinion: text(p.opinion ?? "", true),
          at: at(),
        },
      );
      return {
        requestId: p.requestId,
        entityId: round.id,
        revision: host.need<Round>("flow_rounds", round.id).revision,
        pending: false,
      };
    },
  } satisfies Record<string, FlowCommand>;
}

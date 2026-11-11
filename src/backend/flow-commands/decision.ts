import {
  FlowError,
  type FlowRecord,
  type ProjectFlow,
  type Decision,
} from "../../shared/project-flow";
import type { CommandParams, FlowCommand } from "./registry";

export interface DecisionCommandHost {
  readonly need: <T>(entity: string, id: string) => T;
  readonly check: (record: FlowRecord, p: Record<string, unknown>) => void;
  readonly flow: (id: string) => ProjectFlow;
  readonly answerDecision: (decision: Decision, p: Record<string, unknown>) => Promise<void>;
}

export function createDecisionCommands(host: DecisionCommandHost) {
  return {
    "projectFlow.decision.answer": async (p: CommandParams): Promise<unknown> => {
      const decision = host.need<Decision>("flow_decisions", String(p.decisionId));
      host.check(decision, p);
      if (decision.status !== "open")
        throw new FlowError("STALE_REVISION", "这张决策卡已处理或过期。");
      if (["completed", "cancelled"].includes(host.flow(decision.flowId).status))
        throw new FlowError("STALE_REVISION", "流程已结束，决策不再有效。");
      await host.answerDecision(decision, p);
      return {
        requestId: p.requestId,
        entityId: decision.id,
        revision: host.need<Decision>("flow_decisions", decision.id).revision,
        pending: false,
      };
    },
  } satisfies Record<string, FlowCommand>;
}

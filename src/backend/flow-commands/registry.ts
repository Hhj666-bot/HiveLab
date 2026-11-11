import type { createRecordsCommands } from "./records";
import type { createTaskCommands } from "./task";
import type { createLifecycleCommands } from "./lifecycle";
import type { createPlanCommands } from "./plan";
import type { createSupplementCommands } from "./supplement";
import type { createRoundCommands } from "./round";
import type { createDecisionCommands } from "./decision";
import type { createRecoveryCommands } from "./recovery";
import { FlowError } from "../../shared/project-flow";

export type CommandParams = Record<string, unknown>;
export type FlowCommand = (params: CommandParams) => Promise<unknown>;
export type FlowCommandMethod =
  | keyof ReturnType<typeof createRecordsCommands>
  | keyof ReturnType<typeof createTaskCommands>
  | keyof ReturnType<typeof createLifecycleCommands>
  | keyof ReturnType<typeof createPlanCommands>
  | keyof ReturnType<typeof createSupplementCommands>
  | keyof ReturnType<typeof createRoundCommands>
  | keyof ReturnType<typeof createDecisionCommands>
  | keyof ReturnType<typeof createRecoveryCommands>;

/** Dispatch only; request receipts, recovery and wakeups belong to the controller. */
export class FlowCommands {
  private handlers: Map<FlowCommandMethod, FlowCommand>;
  constructor(handlers: Record<FlowCommandMethod, FlowCommand>) {
    this.handlers = new Map(Object.entries(handlers) as [FlowCommandMethod, FlowCommand][]);
  }
  invoke(method: string, params: CommandParams): Promise<unknown> {
    const command = this.handlers.get(method as FlowCommandMethod);
    if (!command) throw new FlowError("NOT_IMPLEMENTED", "这个操作将在下一里程碑接入。");
    return command(params);
  }
}

import { ProjectWorkbench } from "../project-workbench";
import { WorkLogs } from "../work-log";
import { FlowError, type ProjectFlow } from "../../shared/project-flow";
import type { CommandParams, FlowCommand } from "./registry";

export interface RecordsCommandHost {
  readonly flow: (id: string) => ProjectFlow;
  readonly workbench: ProjectWorkbench;
  readonly logs: WorkLogs;
}

export function createRecordsCommands(host: RecordsCommandHost) {
  return {
    "projectFlow.record.write": async (p: CommandParams): Promise<unknown> => {
      const flow = host.flow(String(p.flowId));
      if (flow.projectId !== p.projectId) throw new FlowError("NOT_FOUND", "记录不属于当前项目。");
      return host.workbench.write(flow.id);
    },
    "projectFlow.log.write": async (p: CommandParams): Promise<unknown> => {
      return host.logs.write(p);
    },
  } satisfies Record<string, FlowCommand>;
}

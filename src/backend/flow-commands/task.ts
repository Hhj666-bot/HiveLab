import { type FlowRecord, type Task } from "../../shared/project-flow";
import type { CommandParams, FlowCommand } from "./registry";
import type {Store} from '../store';
import {completeFlowRequest} from './request-receipt';

export interface TaskCommandHost {
  readonly store:Store;
  readonly prepareAddition: (
    p: Record<string, unknown>,
  ) => Promise<{ requestId: unknown; entityId: string; proposalId: string; pending: boolean }>;
  readonly confirmAddition: (
    p: Record<string, unknown>,
  ) => Promise<
    | { requestId: unknown; entityId: string; decisionId: string; pending: boolean }
    | { entityId: string | undefined; pending: boolean; revision?: undefined }
    | { entityId: string; revision: number; pending: boolean }
  >;
  readonly need: <T>(entity: string, id: string) => T;
  readonly check: (record: FlowRecord, p: Record<string, unknown>) => void;
  readonly manualTaskRedo: (task: Task, p: Record<string, unknown>, decisionId: string) => void;
}

export function createTaskCommands(host: TaskCommandHost) {
  return {
    "projectFlow.task.prepare": async (p: CommandParams): Promise<unknown> => {
      return host.prepareAddition(p);
    },
    "projectFlow.task.add": async (p: CommandParams): Promise<unknown> => {
      return host.confirmAddition(p);
    },
    "projectFlow.task.reassign": async (p: CommandParams): Promise<unknown> => {
      const task = host.need<Task>("flow_tasks", String(p.taskId));
      host.check(task, p);
      return host.store.transaction(()=>{
        host.manualTaskRedo(task, p, String(p.requestId));
        return completeFlowRequest(host.store,p.requestId,{
        requestId: p.requestId,
        entityId: task.id,
        revision: host.need<Task>("flow_tasks", task.id).revision,
        pending: false,
        });
      });
    },
  } satisfies Record<string, FlowCommand>;
}

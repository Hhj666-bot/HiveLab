import type { createRoomsApi } from "./rooms";
import type { createMembersApi } from "./members";
import type { createWorkApi } from "./work";
import type { createAutomationApi } from "./automation";
import type { createDataApi } from "./data";

export type RpcParams = Record<string, unknown>;
export type RpcHandler = (params: RpcParams) => Promise<unknown>;
export type RpcMethod =
  | keyof ReturnType<typeof createRoomsApi>
  | keyof ReturnType<typeof createMembersApi>
  | keyof ReturnType<typeof createWorkApi>
  | keyof ReturnType<typeof createAutomationApi>
  | keyof ReturnType<typeof createDataApi>;

/** Exact method dispatch; transport and maintenance guards run before this registry. */
export class RpcRegistry {
  private handlers: Map<RpcMethod, RpcHandler>;
  constructor(handlers: Record<RpcMethod, RpcHandler>) {
    this.handlers = new Map(Object.entries(handlers) as [RpcMethod, RpcHandler][]);
  }
  invoke(method: string, params: RpcParams): Promise<unknown> {
    const handler = this.handlers.get(method as RpcMethod);
    if (!handler) throw new Error("这个操作当前不可用，请刷新工作台后重试。");
    return handler(params);
  }
}

/** Optional runtime hooks used by the engine and its collaborators. */
export interface EngineTiming {
  runBudgetMs?: number;
  roomRuntimeReuse?: boolean;
  runtimeIdleMs?: number;
  runtimeLimit?: number;
  roomReplyIdleMs?: number;
  providerRetryMs?: number;
  automationNow?: () => number;
  automationTickMs?: number;
  maintenanceOnly?: boolean;
  hostOperation?: (method: string, params: unknown) => Promise<any>;
}

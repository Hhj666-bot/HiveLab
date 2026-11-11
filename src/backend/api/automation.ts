import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { Settings } from "../../shared/types";
import { Store } from "../store";
import { AutomationScheduler } from "../automation-scheduler";
import type { TimedJob } from "../../shared/automation";
import { AUTOMATION_PAUSE_FILE, validateDailyLife } from "../../shared/automation";
import { AutomaticBudget } from "../automatic-budget";
import { DailyLife } from "../daily-life";
import type { Snapshot } from "../../shared/types";
import type { RpcParams, RpcHandler } from "./registry";

export interface AutomationApiHost {
  readonly snapshot: () => Snapshot;
  settings: Settings;
  readonly store: Store;
  readonly dailyLife: DailyLife;
  readonly broadcast: () => void;
  readonly automation: AutomationScheduler;
  readonly timedJob: (params: RpcParams) => TimedJob;
}

export function createAutomationApi(host: AutomationApiHost) {
  return {
    "automation.list": async (params: RpcParams): Promise<unknown> => {
      return host.snapshot().automation;
    },
    "automation.policy.save": async (params: RpcParams): Promise<unknown> => {
      const policies = AutomaticBudget.validate(params.policies),
        dailyLife =
          params.dailyLife === undefined
            ? host.settings.dailyLife
            : validateDailyLife(params.dailyLife);
      host.settings = {
        ...host.settings,
        dailyLife,
        automationPolicies: {
          ...host.settings.automationPolicies,
          ...policies,
        },
      };
      host.store.put("settings", "main", host.settings);
      host.dailyLife.sync();
      host.broadcast();
      return host.snapshot().automation;
    },
    "automation.life.acknowledge": async (params: RpcParams): Promise<unknown> => {
      if (
        !["daily-opening", "member-chat"].includes(String(params.feature)) ||
        params.acknowledgeUnknown !== true
      )
        throw new Error("请先核对上次发言和活动记录，再明确恢复未来的触发。");
      host.automation.acknowledgeManaged(params.feature as "daily-opening" | "member-chat");
      return host.snapshot().automation;
    },
    "automation.save": async (params: RpcParams): Promise<unknown> => {
      return host.timedJob(params);
    },
    "automation.remove": async (params: RpcParams): Promise<unknown> => {
      host.automation.remove(String(params.id));
      return { removed: true };
    },
    "automation.pause": async (params: RpcParams): Promise<unknown> => {
      host.automation.pause();
      return { paused: true };
    },
    "automation.resume": async (params: RpcParams): Promise<unknown> => {
      const marker = path.join(host.store.dataDirectory, AUTOMATION_PAUSE_FILE);
      if (existsSync(marker)) unlinkSync(marker);
      host.automation.resume();
      return { resumed: true };
    },
  } satisfies Record<string, RpcHandler>;
}

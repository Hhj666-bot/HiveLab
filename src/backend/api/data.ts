import { type RunExecutionActive } from "../run-execution";
import { discussionCallLimits } from "../../shared/discussion-budget";
import { memberPermissions, normalizeMemberPermissions } from "../../shared/permissions";
import path from "node:path";
import type { Project, ProviderId, Session, Settings } from "../../shared/types";
import { DEFAULT_SETTINGS, normalizePermissions } from "../../shared/defaults";
import { Store } from "../store";
import { buildEnvironment } from "../security";
import { invalidateClaudeChecks } from "../adapters/claude";
import { RoomRuntimePool } from "../runtime-pool";
import { validateDailyLife } from "../../shared/automation";
import { AutomaticBudget } from "../automatic-budget";
import { DailyLife } from "../daily-life";
import { BackupRestorer } from "../backup-restore";
import type { BackupReason } from "../../shared/backup";
import type { Snapshot } from "../../shared/types";
import type { ProviderRegistry } from "../provider-registry";
import type { RpcParams, RpcHandler } from "./registry";
import { DEFAULT_COVENANT, readCovenant, saveCovenant } from "../../shared/workspace-covenant";

export interface DataApiHost {
  readonly store: Store;
  readonly createDataBackup: (
    reason: BackupReason,
  ) => Promise<import("../../shared/backup").BackupEntry>;
  readonly beginDataMaintenance: () => void;
  readonly endDataMaintenance: () => void;
  readonly maintenance: boolean;
  readonly snapshot: () => Snapshot;
  readonly alive: boolean;
  readonly dailyLife: DailyLife;
  readonly active: Map<string, RunExecutionActive>;
  readonly memberOperations: Set<string>;
  readonly acpLogins: Set<string>;
  readonly invalidateRuntimes: (provider?: ProviderId, stopActive?: boolean) => Promise<void>;
  readonly schedule: () => Promise<void>;
  readonly providerRegistry: ProviderRegistry;
  readonly executorIds: () => ProviderId[];
  readonly broadcast: () => void;
  settings: Settings;
  readonly roomRuntimes: RoomRuntimePool;
  readonly diagnostics: () => Promise<{ path: string }>;
}

const now = () => new Date().toISOString();
const bounded = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(Math.floor(number), max)) : fallback;
};

export function createDataApi(host: DataApiHost) {
  return {
    "covenant.read": async (): Promise<unknown> => readCovenant(host.store.dataDirectory),
    "covenant.save": async (params: RpcParams): Promise<unknown> => {
      if (typeof params.content !== "string") throw new Error("公约内容必须是文本。");
      saveCovenant(host.store.dataDirectory, params.content);
      return readCovenant(host.store.dataDirectory);
    },
    "covenant.append": async (params: RpcParams): Promise<unknown> => {
      if (typeof params.title !== "string" || !params.title.trim()) throw new Error("请输入条目标题。");
      if (typeof params.content !== "string") throw new Error("条目内容必须是文本。");
      const current = readCovenant(host.store.dataDirectory);
      saveCovenant(host.store.dataDirectory, `${current.content.trimEnd()}\n\n## ${params.title.trim()}\n\n${params.content.trim()}\n`);
      return readCovenant(host.store.dataDirectory);
    },
    "covenant.reset": async (): Promise<unknown> => {
      saveCovenant(host.store.dataDirectory, DEFAULT_COVENANT);
      return readCovenant(host.store.dataDirectory);
    },
    "backup.list": async (params: RpcParams): Promise<unknown> => {
      return new BackupRestorer(host.store.dataDirectory).list();
    },
    "backup.preview": async (params: RpcParams): Promise<unknown> => {
      return new BackupRestorer(host.store.dataDirectory).preview(String(params.id));
    },
    "backup.create": async (params: RpcParams): Promise<unknown> => {
      return host.createDataBackup("manual");
    },
    "backup.delete": async (params: RpcParams): Promise<unknown> => {
      if (params.confirm !== true) throw new Error("请先确认删除这份备份。");
      return new BackupRestorer(host.store.dataDirectory).remove(String(params.id));
    },
    "internal.restore.begin": async (params: RpcParams): Promise<unknown> => {
      host.beginDataMaintenance();
      return { ready: true };
    },
    "internal.restore.cancel": async (params: RpcParams): Promise<unknown> => {
      host.endDataMaintenance();
      return { cancelled: true };
    },
    "internal.backup.beforeRestore": async (params: RpcParams): Promise<unknown> => {
      if (!host.maintenance) throw new Error("恢复前尚未暂停执行服务。");
      return host.createDataBackup("before-restore");
    },
    snapshot: async (params: RpcParams): Promise<unknown> => {
      return host.snapshot();
    },
    "internal.room.opened": async (params: RpcParams): Promise<unknown> => {
      if (typeof params.visible !== "boolean") throw new Error("窗口状态无效。");
      if (host.alive) host.dailyLife.opened(params.visible);
      return { received: host.alive };
    },
    "internal.provider.loginBegin": async (params: RpcParams): Promise<unknown> => {
      const id = String(params.provider);
      if (!["claude", "codex", "dsh"].includes(id)) throw new Error("执行端无效。");
      if (host.store.get("removed_providers", id))
        throw new Error("这个执行端连接已删除，请先重新添加连接。");
      if (host.active.size || host.memberOperations.has(id) || host.acpLogins.has(id))
        throw new Error("请先停止当前任务或等待下载完成，再登录。");
      host.acpLogins.add(id);
      try {
        await host.invalidateRuntimes(id as ProviderId, true);
      } catch (error) {
        host.acpLogins.delete(id);
        throw error;
      }
      return { started: true };
    },
    "internal.provider.loginEnd": async (params: RpcParams): Promise<unknown> => {
      host.acpLogins.delete(String(params.provider));
      void host.schedule();
      return { ended: true };
    },
    "internal.provider.invalidate": async (params: RpcParams): Promise<unknown> => {
      if (!params.provider || params.provider === "dsh") host.providerRegistry.balanceRevision++;
      for (const id of params.provider ? [params.provider as ProviderId] : host.executorIds()) {
        host.providerRegistry.cancelProbeRetry(id);
        host.providerRegistry.probeRevisions.set(
          id,
          (host.providerRegistry.probeRevisions.get(id) ?? 0) + 1,
        );
        host.store.put("quotas", id, {
          provider: id,
          windows: [],
          checkedAt: now(),
          source: "event",
          accountStamp: host.providerRegistry.quotaAccountStamp(id),
        });
      }
      await host.invalidateRuntimes(params.provider as ProviderId | undefined, true);
      host.broadcast();
      return { invalidated: true };
    },
    /** The interface language touches no runtime, so it saves even while members are working. */
    "settings.language": async (params: RpcParams): Promise<unknown> => {
      const language = params.language;
      if (language !== "zh-CN" && language !== "en") throw new Error("界面语言无效，请选择中文或英文。");
      if (host.settings.language === language) return host.settings;
      const next: Settings = { ...host.settings, language };
      host.settings = next;
      host.store.put("settings", "main", next);
      host.broadcast();
      return next;
    },
    "settings.save": async (params: RpcParams): Promise<unknown> => {
      if (host.active.size) throw new Error("请先停止正在运行的成员，再修改执行端或网络设置");
      const previous = host.settings;
      const value = (params.settings || params) as Partial<Settings>;
      const next = {
        ...host.settings,
        ...value,
        paths: { ...host.settings.paths, ...value.paths },
        models: { ...host.settings.models, ...value.models },
        efforts: { ...host.settings.efforts, ...value.efforts },
        // A settings dialog opened before a language switch must not switch it back.
        language: host.settings.language,
      };
      if (value.automationPolicies !== undefined)
        next.automationPolicies = AutomaticBudget.validate({
          ...host.settings.automationPolicies,
          ...value.automationPolicies,
        });
      if (value.dailyLife !== undefined) next.dailyLife = validateDailyLife(value.dailyLife);
      if (value.discussionCallLimits !== undefined)
        next.discussionCallLimits = discussionCallLimits(value.discussionCallLimits);
      if (
        !["official", "npmmirror"].includes(next.npmRegistry ?? "official") ||
        !["bundled", "local"].includes(next.nodeRuntime ?? "bundled") ||
        !["subscription", "api"].includes(next.claudeAuthMode ?? "subscription")
      )
        throw new Error("下载源、运行环境或登录方式无效。");
      if (!["tun", "proxy"].includes(next.networkMode))
        throw new Error("网络模式无效，请在设置里重新选择网络连接方式。");
      if (!Number.isInteger(next.maxParallel) || next.maxParallel < 1 || next.maxParallel > 8)
        throw new Error("同时运行数量应为 1–8");
      next.maxRunMinutes = bounded(next.maxRunMinutes, 0, 1440, DEFAULT_SETTINGS.maxRunMinutes);
      next.deepseekMaxRequests = bounded(
        next.deepseekMaxRequests,
        1,
        200,
        DEFAULT_SETTINGS.deepseekMaxRequests,
      );
      next.permissions = normalizePermissions(next.permissions);
      next.memberPermissions = normalizeMemberPermissions(
        next.memberPermissions,
        new Set(host.store.members().map((member) => member.id)),
      );
      if (typeof next.defaultAutoApprove !== "boolean")
        throw new Error("新工作会话自动批准设置无效");
      next.stopTimeoutMs = Math.max(1000, Math.min(Number(next.stopTimeoutMs) || 10000, 60000));
      buildEnvironment(next);
      // Model/effort choices change the next run, not the last observed account connection.
      const affected = host
        .executorIds()
        .filter(
          (id) =>
            host.settings.nodeRuntime !== next.nodeRuntime ||
            (id === "claude" &&
              (host.settings.claudeAuthMode !== next.claudeAuthMode ||
                host.settings.claudeBaseUrl !== next.claudeBaseUrl)) ||
            host.settings.networkMode !== next.networkMode ||
            host.settings.proxyUrl !== next.proxyUrl ||
            host.settings.paths[id] !== next.paths[id] ||
            (id !== "deepseek" &&
              JSON.stringify(host.settings.permissions[id]) !==
                JSON.stringify(next.permissions[id])) ||
            (id === "dsh" &&
              (host.settings.dshProfile !== next.dshProfile ||
                host.settings.deepseekBaseUrl !== next.deepseekBaseUrl)) ||
            (id === "deepseek" &&
              (host.settings.deepseekBaseUrl !== next.deepseekBaseUrl ||
                host.settings.deepseekEnabled !== next.deepseekEnabled)),
        );
      const runtimeAffected = host
        .executorIds()
        .filter(
          (id) =>
            affected.includes(id) ||
            host.settings.models[id] !== next.models[id] ||
            host.settings.efforts[id] !== next.efforts[id] ||
            host.store
              .members()
              .some(
                (member) =>
                  member.executor === id &&
                  JSON.stringify(host.settings.memberPermissions?.[member.id]) !==
                    JSON.stringify(next.memberPermissions?.[member.id]),
              ),
        );
      // Retire all affected idle runtimes together, and do not persist a settings
      // change whose native cleanup failed. Healthy cleanup never waits in series.
      if (runtimeAffected.length) {
        invalidateClaudeChecks();
        const providers = new Set(runtimeAffected);
        await host.roomRuntimes.invalidate((key) => {
          const provider = host.store.get<Session>("sessions", key)?.provider;
          return Boolean(provider && providers.has(provider));
        });
      }
      if (host.active.size || host.settings !== previous)
        throw new Error("保存期间任务或配置发生变化，已保留最新设置，请重试。");
      host.settings = next;
      host.store.put("settings", "main", next);
      for (const executor of host.store.executors()) {
        const permissions = next.permissions[executor.id];
        if (permissions && JSON.stringify(permissions) !== JSON.stringify(executor.permissions))
          host.store.put("executors", executor.id, { ...executor, permissions });
      }
      host.dailyLife.sync();
      host.providerRegistry.providers = host.providerRegistry.providers.map((info) =>
        affected.includes(info.id) ? { ...info, stale: true } : info,
      );
      for (const id of affected) {
        host.providerRegistry.probeRevisions.set(
          id,
          (host.providerRegistry.probeRevisions.get(id) ?? 0) + 1,
        );
        const info = host.providerRegistry.providers.find((info) => info.id === id);
        if (info) host.store.put("providers", id, info);
      }
      host.broadcast();
      for (const id of affected) void host.providerRegistry.probe(id).catch(() => {});
      return next;
    },
    "internal.lookup": async (params: RpcParams): Promise<unknown> => {
      // Main-process checks need one record, not the whole workbench snapshot.
      const session = params.sessionId
        ? host.store.get<Session>("sessions", String(params.sessionId))
        : undefined;
      const projectId = params.projectId ?? session?.projectId;
      return {
        session,
        project: projectId ? host.store.get<Project>("projects", String(projectId)) : undefined,
        ...(params.executors ? { executors: host.store.executors() } : {}),
      };
    },
    "diagnostics.export": async (params: RpcParams): Promise<unknown> => {
      return host.diagnostics();
    },
  } satisfies Record<string, RpcHandler>;
}

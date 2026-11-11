import { runtimeDiagnostics } from "../runtime-diagnostics";
import { googleQuotaHome } from "../adapters/google-quota";
import { kimiPlatform } from "../adapters/kimi-balance";
import { GlmApiAdapter, isGlmApi } from "../adapters/glm-api";
import { tokenActivity } from "../../shared/token-activity";
import { type RunExecutionActive } from "../run-execution";
import { logoutProvider } from "../provider-logout";
import { memberPermissions } from "../../shared/permissions";
import {
  CATALOG_REVISION,
  catalogEntry,
  catalogProvider,
  catalogExecutor,
} from "../../shared/executor-catalog";
import {
  catalogStatuses,
  catalogCandidate,
  catalogAuthentication,
  nativeConnectionEnvironment,
  assertCatalogVersionUnused,
} from "../executor-catalog";
import { resolveCliEntry } from "../adapters/common";
import { listApiModels } from "../api-model-list";
import { claudeApiKeyValue } from "../adapters/claude";
import { nodeRuntimeInfo } from "../node-runtime";
import type { CompatibilityReport, ExecutorIdentity } from "../../shared/compatibility";
import type { MemberVersions, MemberInstallation } from "../../shared/member-versions";
import { normalizeConfigSelection, type RequestedRunConfig } from "../../shared/executor-config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AcpExecutor,
  AcpExecutorId,
  MemberPermissions,
  MemberProfile,
  PermissionMember,
  Project,
  ProviderId,
  ProviderInfo,
  PushEvent,
  Run,
  Session,
  Settings,
  UserProfile,
} from "../../shared/types";
import {
  BUILTIN_MEMBERS,
  SECRET_PLACEHOLDER,
  isAcpId,
  isSecretName,
  normalizeExecutor,
  normalizeMember,
  rememberExecutors,
} from "../../shared/defaults";
import { AcpAdapter } from "../adapters/acp";
import { ClaudeAdapter } from "../adapters/claude";
import { ZcodeAdapter } from "../adapters/zcode";
import type { CatalogLoginState } from "../../shared/executor-catalog";
import { Store } from "../store";
import { buildEnvironment, redact, registerSecret } from "../security";
import { installedVersions, latestVersion, removeVersion } from "../member-versions";
import { checkNetwork } from "../network";
import { RoomRuntimePool } from "../runtime-pool";
import type { ProjectFlow } from "../../shared/project-flow";
import { MemberWorkspaces } from "../member-workspaces";
import type { PersonaFile } from "../persona-file";
import { assignMemberCodes } from "../member-codes";
import { codeChanges, codeRewriter, rewriteMemberCodes, validateCodes } from "../../shared/member-codes";
import { forgetStorageUsage, removeDatabaseBackups, removeOldLogs, storageUsage } from "../storage-usage";
import { sweepOwnedTemp } from "../owned-temp";
import type { ProviderRegistry } from "../provider-registry";
import type { RpcParams, RpcHandler } from "./registry";

export interface MembersApiHost {
  readonly providerRegistry: ProviderRegistry;
  readonly store: Store;
  settings: Settings;
  readonly memberInstallations: Map<string, MemberInstallation>;
  readonly catalogOperation: (
    params: RpcParams,
    install: boolean,
  ) => Promise<import("../../shared/executor-catalog").CatalogStatus | undefined>;
  readonly active: Map<string, RunExecutionActive>;
  readonly memberOperation: <T>(member: string, action: () => Promise<T>) => Promise<T>;
  readonly broadcast: () => void;
  readonly require: <T>(entity: string, id: string) => T;
  readonly acpSecrets: Map<string, Record<string, string>>;
  readonly invalidateRuntimes: (provider?: ProviderId, stopActive?: boolean) => Promise<void>;
  readonly executorIds: () => ProviderId[];
  readonly memberOperations: Set<string>;
  readonly acpLogins: Set<string>;
  readonly executorLoginStates: Map<string, CatalogLoginState>;
  readonly schedule: () => Promise<void>;
  readonly memberVersions: (value: unknown, checkLatest: boolean) => Promise<MemberVersions>;
  readonly member: (value: unknown) => "claude" | "codex" | "dsh";
  readonly memberProgram: (
    member: "codex" | "claude" | "dsh",
    info?: ProviderInfo,
  ) => Promise<ExecutorIdentity>;
  readonly memberInstaller: (
    data: string,
    member: import("../../shared/executor-catalog").CatalogId,
    version: string,
    env: NodeJS.ProcessEnv,
    options?: import("../member-versions").InstallOptions,
  ) => Promise<import("../member-versions").InstalledVersion>;
  readonly useMemberPath: (
    member: "codex" | "claude" | "dsh",
    entry: string | undefined,
  ) => Promise<MemberVersions>;
  readonly memberStopPreview: (memberId: string) => unknown;
  readonly stopMember: (params: Record<string, unknown>) => Promise<{
    requested: number;
    remaining: {
      runId: string;
      sessionId: string;
      status: import("../../shared/types").RunStatus;
      title: string;
      projectName: string | undefined;
      location: string;
      updatedAt: string;
    }[];
  }>;
  readonly removingExecutors: Set<string>;
  readonly roomRuntimes: RoomRuntimePool;
  readonly runConfiguration: (session: Session) => RequestedRunConfig;
  readonly memberWorkspaces: MemberWorkspaces;
  readonly permissionsFor: (id: ProviderId, settings: Settings) => MemberPermissions;
  readonly requireIdle: (sessionId: string, action: string) => void;
  readonly removeExecutor: (id: AcpExecutorId) => void;
  readonly externalAdapter: (executor: AcpExecutor) => AcpAdapter | GlmApiAdapter | ZcodeAdapter | ClaudeAdapter;
  readonly executorLoginAdapters: Map<string, AcpAdapter | GlmApiAdapter | ZcodeAdapter | ClaudeAdapter>;
  readonly push: (event: PushEvent) => void;
  readonly alive: boolean;
  readonly loginChecks: Set<Promise<unknown>>;
  readonly personaFile: PersonaFile;
  readonly importPersona: (
    executor: string,
  ) => Promise<{ path: string; text: string; truncated: boolean }>;
}

const now = () => new Date().toISOString();

export function createMembersApi(host: MembersApiHost) {
  return {
    "provider.diagnostics": async (params: RpcParams): Promise<unknown> => {
      const provider = String(params.provider ?? "") as ProviderId;
      const info = host.providerRegistry.providers.find((p) => p.id === provider);
      if (
        !info &&
        !host.store.get<AcpExecutor>("executors", provider) &&
        !["codex", "claude", "dsh", "deepseek"].includes(provider)
      )
        throw Error("执行端不存在");
      const homeKey =
        provider === "codex"
          ? "HIVELAB_CODEX_HOME"
          : provider === "claude"
            ? "HIVELAB_CLAUDE_HOME"
            : provider === "dsh"
              ? "HIVELAB_DSH_HOME"
              : undefined;
      const home = info?.authDirectory ?? (homeKey ? process.env[homeKey] : undefined);
      return runtimeDiagnostics({ provider, info, settings: host.settings, events: [], home });
    },
    "provider.tokenActivity": async (params: RpcParams): Promise<unknown> => {
      return tokenActivity(
        host.store.tokenUsageEvents(),
        host.store.list<Session>("sessions"),
        host.store.list<Run>("runs"),
        [...host.store.historicalMembers(), ...host.store.members()]
          .filter((m, i, all) => all.findLastIndex((other) => other.id === m.id) === i)
          .map(({ id, name }) => ({ id, name })),
        {
          memberId: typeof params.memberId === "string" ? params.memberId : undefined,
          timeZone: typeof params.timeZone === "string" ? params.timeZone : "Asia/Shanghai",
        },
      );
    },
    "catalog.list": async (params: RpcParams): Promise<unknown> => {
      return {
        revision: CATALOG_REVISION,
        items: catalogStatuses(
          host.store,
          host.settings,
          params.executorId as string | undefined,
        ).map((item) => ({
          ...item,
          installation: host.memberInstallations.get(item.provider),
        })),
        node: nodeRuntimeInfo(host.settings),
      };
    },
    "catalog.installation": async (params: RpcParams): Promise<unknown> => {
      return host.memberInstallations.get(
        catalogExecutor(host.store.executors(), catalogEntry(params.id).id, params.executorId)
          ?.id ?? catalogProvider(catalogEntry(params.id).id),
      );
    },
    "catalog.latest": async (params: RpcParams): Promise<unknown> => {
      const entry = catalogEntry(params.id);
      const version = await latestVersion(
        entry.id,
        buildEnvironment(host.settings),
        host.store.dataDirectory,
      );
      host.providerRegistry.rememberLatest(entry.id, version);
      return { version };
    },
    "catalog.install": async (params: RpcParams): Promise<unknown> => {
      return host.catalogOperation(params, true);
    },
    "catalog.use": async (params: RpcParams): Promise<unknown> => {
      return host.catalogOperation(params, false);
    },
    "catalog.remove": async (params: RpcParams): Promise<unknown> => {
      const entry = catalogEntry(params.id),
        provider = catalogProvider(entry.id);
      if (host.active.size) throw new Error("请先停止当前任务。");
      return host.memberOperation(provider, async () => {
        await removeVersion(host.store.dataDirectory, entry.id, String(params.version), () => {
          if (host.active.size) throw new Error("任务已开始运行，未删除版本。");
          assertCatalogVersionUnused(host.store, host.settings, entry.id, String(params.version));
        });
        forgetStorageUsage();
        return { removed: true };
      });
    },
    /** Remove every managed version of a program, including the one in use. Connections, cards, history and
     *  login directories stay; the connection reports the program as missing until it is installed again. */
    "catalog.uninstall": async (params: RpcParams): Promise<unknown> => {
      const entry = catalogEntry(params.id),
        provider = catalogProvider(entry.id);
      if (host.active.size) throw new Error("请先停止当前任务，再卸载程序。");
      const connections = host.store.executors().filter((item) => item.catalogId === entry.id);
      if (connections.some((item) => host.acpLogins.has(item.id)))
        throw new Error("该执行端正在登录，请完成或取消登录后再卸载。");
      return host.memberOperation(provider, async () => {
        const versions = installedVersions(host.store.dataDirectory, entry.id);
        if (!versions.length) throw new Error("没有可卸载的托管版本。");
        await host.invalidateRuntimes(provider as ProviderId, true);
        for (const item of connections) await host.invalidateRuntimes(item.id, true);
        for (const item of versions)
          await removeVersion(host.store.dataDirectory, entry.id, item.version, () => {
            if (host.active.size) throw new Error("任务已开始运行，未卸载。");
          });
        // A built-in program keeps its path in settings; a path into the removed folders would only dangle.
        const root = path.resolve(host.store.dataDirectory, "members", entry.id),
          paths = { ...host.settings.paths };
        let changed = false;
        for (const [key, value] of Object.entries(paths)) {
          const rel = value ? path.relative(root, path.resolve(value)) : "..";
          if (value && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)) {
            delete paths[key as ProviderId];
            changed = true;
          }
        }
        if (changed) {
          host.settings = { ...host.settings, paths };
          host.store.put("settings", "main", host.settings);
        }
        host.broadcast();
        for (const item of connections) void host.providerRegistry.probe(item.id).catch(() => {});
        if (!isAcpId(provider)) void host.providerRegistry.probe(provider).catch(() => {});
        forgetStorageUsage();
        return { uninstalled: versions.length };
      });
    },
    /** Settings: which models an API connection may use, read from the service with the typed or saved key. */
    "catalog.models": async (params: RpcParams): Promise<unknown> => {
      const typed = typeof params.value === "string" && params.value.trim() ? params.value.trim() : undefined;
      if (typed) registerSecret(typed);
      const givenBase = typeof params.baseUrl === "string" ? params.baseUrl.trim() : "";
      if (params.provider === "claude") {
        return listApiModels(
          { protocol: "anthropic", baseUrl: givenBase || host.settings.claudeBaseUrl || "https://api.anthropic.com", key: typed ?? claudeApiKeyValue() ?? "" },
          host.settings,
        );
      }
      const entry = catalogEntry(params.id),
        executor = catalogExecutor(host.store.executors(), entry.id, params.executorId);
      const auth = entry.authentication.find((item) => item.id === (params.authentication ?? executor?.authentication));
      if (!auth || auth.kind !== "api") throw new Error("只有 API Key 连接可以读取模型清单。");
      const secretKey = auth.secretKeys?.[0] ?? "";
      const saved = executor && executor.authentication === auth.id ? host.acpSecrets.get(executor.id)?.[secretKey] : undefined;
      const baseName = entry.modelConfiguration?.baseUrlEnvironment ?? Object.keys(auth.environment ?? {}).find((name) => /BASE_URL$/.test(name));
      const baseUrl = givenBase || (baseName ? (executor?.authentication === auth.id ? executor.env[baseName] : undefined) ?? auth.environment?.[baseName] : undefined)
        || (secretKey === "ANTHROPIC_API_KEY" ? "https://api.anthropic.com" : "");
      if (!baseUrl) throw new Error("请先填写请求地址，再读取模型清单。");
      return listApiModels({ protocol: secretKey === "ANTHROPIC_API_KEY" ? "anthropic" : "openai", baseUrl, key: typed ?? saved ?? "" }, host.settings);
    },
    "catalog.connection.create": async (params: RpcParams): Promise<unknown> => {
      const entry = catalogEntry(params.id);
      const source = catalogExecutor(host.store.executors(), entry.id, params.sourceId);
      // Claude, Codex and DSH are built-in adapters: the first connection lives in settings.paths,
      // so an additional account starts from the installed program instead of an executor row.
      const builtIn = !isAcpId(catalogProvider(entry.id));
      if (!source && !builtIn) throw new Error("请先从清单安装并配置这个执行端。");
      if (host.store.executors().length >= 12) throw new Error("最多接入 12 个外接程序。");
      const name = typeof params.name === "string" ? params.name.trim().slice(0, 40) : "";
      if (!name) throw new Error("请给独立连接起个名字。");
      const id = `acp-${randomUUID().replace(/-/g, "").slice(0, 12)}` as AcpExecutorId;
      const program = source?.command ?? host.settings.paths[entry.id as ProviderId]
        ?? resolveCliEntry(entry.id as ProviderId, host.settings, buildEnvironment(host.settings)).path;
      const candidate = {
        ...catalogCandidate(entry.id, program, undefined, id),
        id,
        name,
      };
      if (builtIn) {
        const native = nativeConnectionEnvironment(entry.id, host.store.dataDirectory, id);
        if (!native) throw new Error(`${entry.name} 的独立连接尚未开放，请继续使用原来的连接。`);
        candidate.env = { ...candidate.env, ...native };
        // The new account starts with the same boundary as the installed program's first connection.
        candidate.permissions = host.settings.permissions[entry.id as PermissionMember] ?? candidate.permissions;
      }
      const { executor } = catalogAuthentication(candidate, {
        authentication: params.authentication,
        clear: true,
      });
      host.store.put("executors", executor.id, executor);
      rememberExecutors(host.store.executors());
      host.broadcast();
      void host.providerRegistry.probe(executor.id).catch(() => {});
      return executor;
    },
    "catalog.credentials": async (params: RpcParams): Promise<unknown> => {
      const entry = catalogEntry(params.id),
        selected = catalogExecutor(host.store.executors(), entry.id, params.executorId);
      if (!selected) throw new Error("内置成员请使用各自的登录入口。");
      const provider = selected.id;
      if (host.active.size) throw new Error("请先停止当前任务，再修改登录方式。");
      return host.memberOperation(provider, async () => {
        const previous = host.require<AcpExecutor>("executors", provider);
        if (previous.catalogId !== entry.id) throw new Error("这个连接不是清单管理的执行端。");
        const { executor, secrets } = catalogAuthentication(previous, params);
        const authenticationChanged =
          (previous.authentication ?? (entry.id === "zcode" ? "zai" : undefined)) !==
          executor.authentication;
        if (entry.id === "zcode" && authenticationChanged) {
          for (const session of host.store
            .list<Session>("sessions")
            .filter((item) => item.provider === provider)) {
            // Canonical HiveLab history remains; a new account must not resume a thread pinned to the old provider.
            host.store.put("sessions", session.id, {
              ...session,
              nativeId: undefined,
              nativeHome: undefined,
            });
          }
        }
        for (const value of Object.values(secrets)) registerSecret(value);
        if (entry.modelConfiguration?.resetOnAuthenticationChange && authenticationChanged) {
          const models = { ...host.settings.models },
            efforts = { ...host.settings.efforts };
          delete models[provider];
          delete efforts[provider];
          host.settings = { ...host.settings, models, efforts };
          host.store.put("settings", "main", host.settings);
        }
        host.acpSecrets.set(provider, secrets);
        if (entry.id === "zcode" && isGlmApi(executor)) {
          host.settings = {
            ...host.settings,
            models: { ...host.settings.models, [provider]: executor.model },
            efforts: { ...host.settings.efforts, [provider]: undefined },
          };
          host.store.put("settings", "main", host.settings);
        }
        if (entry.id === "kimi") {
          host.settings = {
            ...host.settings,
            models: { ...host.settings.models, [provider]: executor.model },
          };
          host.store.put("settings", "main", host.settings);
        }
        host.store.put("executors", provider, executor);
        await host.invalidateRuntimes(provider);
        const known = host.providerRegistry.providers.find((item) => item.id === provider);
        if (known) host.providerRegistry.publishProvider({ ...known, stale: true });
        host.broadcast();
        return { saved: !!Object.keys(secrets).length, executor };
      });
    },
    "provider.probe": async (params: RpcParams): Promise<unknown> => {
      await host.invalidateRuntimes(params.provider as ProviderId | undefined);
      return host.providerRegistry.probe(params.provider as ProviderId | undefined);
    },
    "provider.logout": async (params: RpcParams): Promise<unknown> => {
      const id = String(params.provider) as ProviderId;
      if (!host.executorIds().includes(id)) throw new Error("执行端不存在。");
      if (host.active.size || host.memberOperations.has(id) || host.acpLogins.has(id))
        throw new Error("请先停止当前任务、取消登录或等待下载完成，再登出。");
      host.memberOperations.add(id);
      try {
        await host.invalidateRuntimes(id, true);
        await logoutProvider(
          id,
          host.settings,
          buildEnvironment(host.settings),
          host.store.executors().find((item) => item.id === id),
        );
        host.providerRegistry.providers = host.providerRegistry.providers.map((info) =>
          info.id === id
            ? {
                ...info,
                auth: "none" as const,
                available: false,
                stale: true,
                quota: undefined,
                detail: "已登出，请重新登录。",
              }
            : info,
        );
        host.store.delete("quotas", id);
        host.providerRegistry.probeRevisions.set(
          id,
          (host.providerRegistry.probeRevisions.get(id) ?? 0) + 1,
        );
        const info = host.providerRegistry.providers.find((item) => item.id === id);
        if (info) host.store.put("providers", id, info);
        host.executorLoginStates.delete(id);
        host.broadcast();
        return { loggedOut: true };
      } finally {
        host.memberOperations.delete(id);
        void host.schedule();
      }
    },
    "provider.compatibility": async (params: RpcParams): Promise<unknown> => {
      return host.store
        .list<CompatibilityReport>("compatibility_reports")
        .filter((r) => r.provider === params.provider)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 50);
    },
    "provider.config": async (params: RpcParams): Promise<unknown> => {
      const id = String(params.provider) as ProviderId;
      if (!host.executorIds().includes(id)) throw new Error("执行端不存在");
      const choice = normalizeConfigSelection({
        model: params.model ?? null,
      });
      const settings = {
        ...host.settings,
        models: { ...host.settings.models, [id]: choice.model ?? undefined },
        efforts: { ...host.settings.efforts, [id]: undefined },
      };
      return host.providerRegistry.inspectProvider(id, settings, "configuration");
    },
    "provider.balance": async (params: RpcParams): Promise<unknown> => {
      const external = host.store.get<AcpExecutor>("executors", String(params.provider));
      if (external && (kimiPlatform(external) || isGlmApi(external)))
        return host.providerRegistry.refreshQuota(external.id);
      if (params.provider !== "dsh") throw new Error("这位成员程序尚未提供账户余额接口。");
      return host.providerRegistry.refreshBalance();
    },
    "provider.quota": async (params: RpcParams): Promise<unknown> => {
      const external = host.store.get<AcpExecutor>("executors", String(params.provider));
      if (
        params.provider !== "claude" &&
        params.provider !== "codex" &&
        !(external && (external.catalogId==='antigravity'||googleQuotaHome(external)))
      )
        throw new Error("这位成员程序尚未提供独立的额度刷新接口。");
      return host.providerRegistry.refreshQuota(params.provider as ProviderId);
    },
    "network.check": async (params: RpcParams): Promise<unknown> => {
      return checkNetwork(host.settings);
    },
    "member.versions": async (params: RpcParams): Promise<unknown> => {
      return host.memberVersions(params.provider, !!params.checkLatest);
    },
    "member.installation": async (params: RpcParams): Promise<unknown> => {
      return host.memberInstallations.get(host.member(params.provider));
    },
    "member.install": async (params: RpcParams): Promise<unknown> => {
      // Explicit, user-initiated update: install alongside existing versions, then switch to it.
      const member = host.member(params.provider);
      if (host.active.size) throw new Error("请先停止正在运行的成员，再切换版本");
      if (!host.store.get("catalog_consents", member))
        try {
          await host.memberProgram(member);
        } catch {
          throw new Error("首次使用请从内置清单阅读厂商条款后下载。");
        }
      return host.memberOperation(member, async () => {
        const startedAt = now();
        host.memberInstallations.set(member, {
          version: String(params.version),
          phase: "installing",
          startedAt,
          phaseStartedAt: startedAt,
        });
        try {
          const item = await host.memberInstaller(
            host.store.dataDirectory,
            member,
            String(params.version),
            buildEnvironment(host.settings),
            {
              requireIntegrity: true,
              progress: (value) => {
                const current = host.memberInstallations.get(member);
                if (!current) return;
                host.memberInstallations.set(member, {
                  ...current,
                  ...value,
                  phaseStartedAt: current.phase === value.phase ? current.phaseStartedAt : now(),
                });
              },
            },
          );
          if (host.active.size)
            return {
              ...(await host.memberVersions(member, false)),
              installation: undefined,
              installedOnly: true,
              detail: "安装已完成；有任务正在运行，请空闲后切换",
            };
          const current = host.memberInstallations.get(member)!;
          host.memberInstallations.set(member, {
            ...current,
            phase: "connection",
            phaseStartedAt: now(),
          });
          try {
            return {
              ...(await host.useMemberPath(member, item.entry)),
              installation: undefined,
            };
          } catch (error) {
            if (host.active.size)
              return {
                ...(await host.memberVersions(member, false)),
                installation: undefined,
                installedOnly: true,
                detail: (error as Error).message,
              };
            throw error;
          }
        } finally {
          host.memberInstallations.delete(member);
        }
      });
    },
    "member.use": async (params: RpcParams): Promise<unknown> => {
      const member = host.member(params.provider);
      if (host.active.size) throw new Error("请先停止正在运行的成员，再切换版本");
      return host.memberOperation(member, async () => {
        if (!params.version) return host.useMemberPath(member, undefined);
        const item = installedVersions(host.store.dataDirectory, member).find(
          (x) => x.version === params.version,
        );
        if (!item) throw new Error("该版本尚未完整安装");
        return host.useMemberPath(member, item.entry);
      });
    },
    "member.remove": async (params: RpcParams): Promise<unknown> => {
      const member = host.member(params.provider);
      if (host.active.size) throw new Error("请先停止正在运行的任务");
      return host.memberOperation(member, async () => {
        const version = String(params.version);
        await removeVersion(host.store.dataDirectory, member, version, () => {
          if (host.active.size) throw new Error("任务已开始运行，未删除版本");
          const selected = host.settings.paths[member];
          const relative = selected
            ? path.relative(
                path.resolve(host.store.dataDirectory, "members", member, version),
                path.resolve(selected),
              )
            : undefined;
          if (
            relative !== undefined &&
            relative !== ".." &&
            !relative.startsWith(".." + path.sep) &&
            !path.isAbsolute(relative)
          )
            throw new Error("不能删除正在使用的版本，请先切换");
          assertCatalogVersionUnused(host.store, host.settings, member, version);
        });
        return host.memberVersions(member, false);
      });
    },
    "member.stop.preview": async (params: RpcParams): Promise<unknown> => {
      return host.memberStopPreview(String(params.memberId));
    },
    "member.stop": async (params: RpcParams): Promise<unknown> => {
      return host.stopMember(params);
    },
    "team.save": async (params: RpcParams): Promise<unknown> => {
      // A card keeps its identity; changing its executor only affects new contexts.
      const members = host.store.members();
      const given = (params.member ?? {}) as Partial<MemberProfile>;
      const existing = given.id ? members.find((member) => member.id === given.id) : undefined;
      const addingTemplate =
        params.addTemplate === true &&
        BUILTIN_MEMBERS.some((member) => member.id === given.id) &&
        !host.store.get("removed_members", given.id!);
      if (params.addTemplate === true && existing)
        throw new Error("这张模板人物卡已添加，请刷新后编辑已有人物。");
      if (given.id && !existing && !addingTemplate) throw new Error("这位成员不存在，请刷新工作台");
      const card = normalizeMember(
        given,
        existing,
        existing ? undefined : `m-${randomUUID().slice(0, 8)}`,
      );
      const disconnected =
        existing?.executor === card.executor &&
        !!host.store.get("removed_providers", card.executor);
      if (host.store.get("removed_providers", card.executor) && !disconnected)
        throw new Error("这个执行端连接已删除，请先在连接与版本中重新添加。");
      if (host.removingExecutors.has(card.executor))
        throw new Error("该执行端正在删除连接，请完成后再保存人物。");
      if (isAcpId(card.executor) && !host.store.get("executors", card.executor) && !disconnected)
        throw new Error("请先保存这个 AI 程序的连接设置");
      if (!existing && members.length >= 16) throw new Error("团队最多 16 位成员");
      if (existing && card.executor !== existing.executor) {
        if (host.active.size) throw new Error("请先停止当前任务，再更换人物绑定的执行端。");
        if (
          host.store
            .list<import("../../shared/project-flow").ProjectFlow>("project_flows")
            .some(
              (flow) =>
                flow.memberIds?.includes(card.id) &&
                !["completed", "cancelled"].includes(flow.status),
            )
        )
          throw new Error("请先结束项目流程，再更换人物绑定的执行端。");
        card.model = undefined;
        card.effort = undefined;
      }
      await host.roomRuntimes.invalidate(
        (key) =>
          (host.store.get<Session>("sessions", key)?.memberId ??
            host.store.get<Session>("sessions", key)?.provider) === card.id,
      );
      if (existing && card.executor !== existing.executor) {
        if (
          host.active.size ||
          host.store.members().find((member) => member.id === card.id)?.executor !==
            existing.executor
        )
          throw new Error("成员任务或绑定已变化，请停止任务并刷新后重试。");
        host.store.transaction(() => {
          for (const session of host.store
            .list<Session>("sessions")
            .filter(
              (session) => (session.memberId ?? session.provider) === card.id && !session.flowId,
            )) {
            const config = host.runConfiguration(session);
            host.store.put("sessions", session.id, {
              ...session,
              model: session.model ?? config.model,
              effort: session.effort ?? config.effort,
            });
          }
          for (const project of host.store
            .list<Project>("projects")
            .filter((project) => project.memberConfigs?.[card.id])) {
            const memberConfigs = { ...project.memberConfigs };
            delete memberConfigs[card.id];
            host.store.put("projects", project.id, {
              ...project,
              memberConfigs,
              memberConfigRevision: (project.memberConfigRevision ?? 0) + 1,
            });
          }
          host.store.put("members", card.id, card);
        });
      } else host.store.put("members", card.id, card);
      host.memberWorkspaces.folder(card.id, true);
      host.memberWorkspaces.ensureMember(card.id);
      const coded = assignMemberCodes(host.store, card.id)[0];
      if (coded) card.code = coded.code;
      host.personaFile.export(card.id);
      host.broadcast();
      return card;
    },
    "executor.save": async (params: RpcParams): Promise<unknown> => {
      const given = (params.executor ?? {}) as Partial<AcpExecutor>;
      const existing = given.id
        ? host.store.get<AcpExecutor>("executors", String(given.id))
        : undefined;
      if (given.id && !existing) throw new Error("这个外接程序不存在，请刷新工作台");
      if (given.id && host.acpLogins.has(String(given.id)))
        throw new Error("请完成或取消登录后再修改连接。");
      if (!existing && host.store.executors().length >= 12)
        throw new Error("最多接入 12 个外接程序");
      const executor = normalizeExecutor(
        given,
        existing
          ? { ...existing, permissions: host.permissionsFor(existing.id, host.settings) }
          : undefined,
        existing
          ? undefined
          : (`acp-${randomUUID().replace(/-/g, "").slice(0, 12)}` as AcpExecutorId),
      );
      // Secret values never reach the database or a snapshot, even when sent as ordinary variables.
      const previous = host.acpSecrets.get(executor.id) ?? {},
        secrets: Record<string, string> = {};
      for (const [key, value] of Object.entries(
        params.secrets && typeof params.secrets === "object" ? params.secrets : {},
      ))
        if (
          isSecretName(key) &&
          /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) &&
          typeof value === "string" &&
          value
        )
          secrets[key] = value.slice(0, 4096);
      for (const key of Object.keys(executor.env))
        if (isSecretName(key)) {
          const value = executor.env[key];
          delete executor.env[key];
          const resolved = value === SECRET_PLACEHOLDER ? previous[key] : value;
          if (resolved) secrets[key] = resolved;
        }
      for (const value of Object.values(secrets)) registerSecret(value);
      executor.secretKeys = Object.keys(secrets).sort();
      host.acpSecrets.set(executor.id, secrets);
      host.store.put("executors", executor.id, executor);
      host.settings = {
        ...host.settings,
        permissions: { ...host.settings.permissions, [executor.id]: executor.permissions },
      };
      host.store.put("settings", "main", host.settings);
      rememberExecutors(host.store.executors());
      await host.invalidateRuntimes(executor.id);
      const known = host.providerRegistry.providers.find((info) => info.id === executor.id);
      if (known)
        host.providerRegistry.publishProvider({ ...known, name: executor.name, stale: true });
      host.broadcast();
      void host.providerRegistry.probe(executor.id).catch(() => {});
      return executor;
    },
    "executor.restore": async (params: RpcParams): Promise<unknown> => {
      const id = String(params.id) as ProviderId;
      if (!["codex", "claude", "dsh"].includes(id)) throw new Error("所选内置执行端不存在。");
      host.store.delete("removed_providers", id);
      host.broadcast();
      return { restored: true };
    },
    "executor.delete": async (params: RpcParams): Promise<unknown> => {
      const id = String(params.id);
      const builtin = ["codex", "claude", "dsh"].includes(id);
      if (!builtin && (!isAcpId(id) || !host.store.get("executors", id)))
        throw new Error("这个执行端不存在");
      return host.memberOperation(id, async () => {
        host.removingExecutors.add(id);
        try {
          if (host.acpLogins.has(id)) throw new Error("请完成或取消登录后再删除连接。");
          const users = host.store.members().filter((member) => member.executor === id);
          if (users.length && params.detachMembers !== true)
            throw new Error(
              `还有成员在使用它：${users.map((member) => member.name).join("、")}。请从删除确认框中确认保留人物卡并断开连接。`,
            );
          if (
            users.length &&
            host.store
              .list<import("../../shared/project-flow").ProjectFlow>("project_flows")
              .some(
                (flow) =>
                  flow.memberIds?.some((memberId) =>
                    users.some((member) => member.id === memberId),
                  ) && !["completed", "cancelled"].includes(flow.status),
              )
          )
            throw new Error("请先结束使用这些人物卡的项目流程，再删除连接。");
          for (const session of host.store
            .list<Session>("sessions")
            .filter((item) => item.provider === id))
            host.requireIdle(session.id, "删除外接程序");
          await host.invalidateRuntimes(id as ProviderId);
          // Preserve the defaults used by old topics before removing connection-wide settings.
          for (const session of host.store
            .list<Session>("sessions")
            .filter((item) => item.provider === id)) {
            host.requireIdle(session.id, "删除连接");
            const config = host.runConfiguration(session);
            host.store.put("sessions", session.id, {
              ...session,
              model: session.model ?? config.model,
              effort: session.effort ?? config.effort,
            });
          }
          if (builtin) {
            const provider = id as ProviderId,
              paths = { ...host.settings.paths };
            delete paths[provider];
            host.settings = { ...host.settings, paths };
            host.store.put("settings", "main", host.settings);
            host.providerRegistry.cancelProbeRetry(provider);
            host.providerRegistry.probeRevisions.set(
              provider,
              (host.providerRegistry.probeRevisions.get(provider) ?? 0) + 1,
            );
            host.store.put("removed_providers", provider, { id: provider, at: now() });
            host.store.delete("providers", provider);
            host.providerRegistry.providers = host.providerRegistry.providers.filter(
              (info) => info.id !== provider,
            );
          } else host.removeExecutor(id as AcpExecutorId);
          host.broadcast();
          return { deleted: true };
        } finally {
          host.removingExecutors.delete(id);
        }
      });
    },
    "executor.authenticate": async (params: RpcParams): Promise<unknown> => {
      const executor = host.require<AcpExecutor>("executors", String(params.id));
      if (host.active.size || host.memberOperations.has(executor.id))
        throw new Error("请先等待当前任务或下载完成，再登录执行端。");
      if (host.acpLogins.has(executor.id)) throw new Error("登录正在进行，请在已打开的页面里完成");
      const adapter = host.externalAdapter(executor);
      host.acpLogins.add(executor.id);
      host.executorLoginAdapters.set(executor.id, adapter);
      host.executorLoginStates.set(executor.id, {
        phase: "starting",
        message: "正在启动官方登录…",
      });
      let authorized = false;
      try {
        await host.invalidateRuntimes(executor.id, true);
        const result = await adapter.authenticate(
          buildEnvironment(host.settings),
          params.methodId == null ? undefined : String(params.methodId),
          (state) => {
            if (host.executorLoginStates.get(executor.id)?.phase !== "cancelled") {
              host.executorLoginStates.set(executor.id, state);
              host.push({ type: "executor-login", id: executor.id, state });
            }
          },
        );
        if (host.executorLoginStates.get(executor.id)?.phase === "cancelled")
          throw new Error("登录已取消。");
        authorized = true;
        host.executorLoginStates.set(executor.id, {
          phase: "completed",
          message: "官方授权已完成，正在检查连接。",
        });
        return {
          detail: `${executor.name} 已完成登录（${result.method}）。`,
        };
      } catch (error) {
        if (host.executorLoginStates.get(executor.id)?.phase !== "cancelled")
          host.executorLoginStates.set(executor.id, {
            phase: "failed",
            message:
              executor.catalogId === "zcode" && error instanceof Error
                ? String(redact(error.message)).slice(0, 400)
                : "官方登录没有完成，请重试或检查网络。",
          });
        throw error;
      } finally {
        const completed = host.executorLoginStates.get(executor.id);
        if (
          host.alive &&
          authorized &&
          host.executorLoginStates.get(executor.id)?.phase !== "cancelled"
        ) {
          const check = host.providerRegistry
            .probe(executor.id)
            .then(() => {
              if (!host.alive || host.executorLoginStates.get(executor.id) !== completed) return;
              const info = host.providerRegistry.providers.find((item) => item.id === executor.id);
              const state: CatalogLoginState = {
                phase: "completed",
                message: info?.available
                  ? "官方授权已完成，连接检查通过。"
                  : `官方授权已完成，连接检查未通过：${info?.detail || "请重新检查成员连接。"}`,
              };
              host.executorLoginStates.set(executor.id, state);
              host.push({ type: "executor-login", id: executor.id, state });
            })
            .catch(() => {});
          host.loginChecks.add(check);
          void check.finally(() => host.loginChecks.delete(check));
        }
        host.acpLogins.delete(executor.id);
        host.executorLoginAdapters.delete(executor.id);
        if (host.alive) void host.schedule();
      }
    },
    "executor.loginStatus": async (params: RpcParams): Promise<unknown> => {
      return host.executorLoginStates.get(String(params.id));
    },
    "executor.cancelLogin": async (params: RpcParams): Promise<unknown> => {
      const id = String(params.id),
        adapter = host.executorLoginAdapters.get(id);
      if (adapter) {
        host.executorLoginStates.set(id, {
          phase: "cancelled",
          message: "登录已取消。",
        });
        await adapter.stop();
      }
      return { cancelled: !!adapter };
    },
    "team.visibility": async (params: RpcParams): Promise<unknown> => {
      const member = host.store.members().find((item) => item.id === String(params.id));
      if (!member) throw new Error("这位成员不存在");
      if (typeof params.hidden !== "boolean") throw new Error("请选择显示或隐藏人物卡");
      const card = { ...member, cardHidden: params.hidden };
      host.store.put("members", member.id, card);
      // Visibility never invalidates a native context or stops a connection/turn.
      host.broadcast();
      return card;
    },
    "team.arrange": async (params: RpcParams): Promise<unknown> => {
      // Both surfaces use the same gesture but keep independent sequences.
      const orderField=params.scope==='sidebar'?'sidebarOrder':'standeeOrder';
      const requested: string[] = Array.isArray(params.ids)
        ? params.ids.map((id: unknown) => String(id))
        : [];
      const members = host.store.members();
      const byId = new Map(members.map((member) => [member.id, member]));
      if (!requested.length || requested.some((id: string) => !byId.has(id)))
        throw new Error("成员列表已经变化，请刷新后再调整站位");
      if (new Set(requested).size !== requested.length)
        throw new Error("成员列表已经变化，请刷新后再调整站位");
      requested.forEach((id: string, index: number) => {
        const member = byId.get(id)!;
        if (member[orderField] !== index)
          host.store.put("members", id, { ...member, [orderField]: index });
      });
      host.broadcast();
      return host.store.members();
    },
    "team.delete": async (params: RpcParams): Promise<unknown> => {
      const member = host.store.members().find((item) => item.id === String(params.id));
      if (!member) throw new Error("这位成员不存在");
      if (params.folderChoice !== undefined && params.folderChoice !== "keep")
        throw new Error("删除人物卡会保留个人文件夹和成果，不能同时删除文件");
      const sessions = host.store
        .list<Session>("sessions")
        .filter((session) => (session.memberId ?? session.provider) === member.id);
      for (const session of sessions) host.requireIdle(session.id, "删除成员");
      const folder = host.memberWorkspaces.preserveMemberFolder(member.id);
      const {
        id,
        executor,
        name,
        color,
        portrait,
        avatar,
        portraitScale,
        portraitOffset,
        face,
        avatarFace,
        templateId,
        builtIn,
        code,
      } = member;
      // Retain only attribution for history. Sessions, native IDs, outputs and shared executors stay intact.
      host.store.transaction(() => {
        host.store.put("removed_members", id, {
          id,
          executor,
          name,
          color,
          portrait,
          avatar,
          portraitScale,
          portraitOffset,
          face,
          avatarFace,
          templateId,
          builtIn,
          code,
        });
        host.store.delete("members", id);
        const overrides = { ...host.settings.memberPermissions };
        delete overrides[id];
        host.settings = { ...host.settings, memberPermissions: overrides };
        host.store.put("settings", "main", host.settings);
        for (const project of host.store
          .list<Project>("projects")
          .filter(
            (project) =>
              !project.kind && (project.memberIds?.includes(id) || project.memberConfigs?.[id]),
          )) {
          const configs = { ...project.memberConfigs };
          delete configs[id];
          host.store.put("projects", project.id, {
            ...project,
            memberIds: project.memberIds?.filter((value) => value !== id),
            memberConfigs: configs,
          });
        }
      });
      const sessionIds = new Set(sessions.map((session) => session.id));
      await host.roomRuntimes.invalidate((key) => sessionIds.has(key));
      host.personaFile.export();
      forgetStorageUsage();
      host.broadcast();
      return { deleted: true, sessions: sessions.length, folder };
    },
    "team.reset": async (params: RpcParams): Promise<unknown> => {
      const member = BUILTIN_MEMBERS.find((item) => item.id === String(params.id));
      if (!member) throw new Error("只有内置成员可以恢复默认资料");
      const current = host.store.members().find((item) => item.id === member.id);
      if (!current) throw new Error("这张人物卡已删除，请添加新成员");
      host.store.put("members", member.id, {
        ...member,
        executor: current.executor,
        cardHidden: current.cardHidden,
        code: current.code,
      });
      await host.roomRuntimes.invalidate(
        (key) =>
          (host.store.get<Session>("sessions", key)?.memberId ??
            host.store.get<Session>("sessions", key)?.provider) === member.id,
      );
      host.personaFile.export(member.id);
      host.broadcast();
      return host.store.members().find((item) => item.id === member.id);
    },
    "storage.usage": async (params: RpcParams): Promise<unknown> =>
      storageUsage(host.store, host.settings, host.memberWorkspaces, params.refresh === true),
    "storage.deleteTopic": async (params: RpcParams): Promise<unknown> => {
      const result = await host.memberWorkspaces.deleteTopic(String(params.memberId ?? ""), String(params.threadId ?? ""), params.deleteFiles === true);
      forgetStorageUsage();
      host.broadcast();
      return result;
    },
    "storage.deleteSession": async (params: RpcParams): Promise<unknown> => {
      const memberId=String(params.memberId??''),sessionId=String(params.sessionId??'');
      const record=host.store.get<{memberId:string}>('desk_file_sessions',sessionId);
      const session=host.store.get<Session>('sessions',sessionId);
      if(record?.memberId!==memberId && (session?.memberId??session?.provider)!==memberId)throw Error('会话不属于这个工位');
      const topic=host.memberWorkspaces.topicsOf(memberId).find(item=>item.id==='desk-topic-'+sessionId);
      if(topic)await host.memberWorkspaces.deleteTopic(memberId,topic.id,params.deleteFiles===true);
      else if(session)throw Error('请在原会话入口删除这段记录');
      else if(params.deleteFiles===true)await host.memberWorkspaces.files.removeSessionFiles(sessionId);
      else throw Error('聊天记录已删除；如需清理保留文件，请勾选同步删除文件');
      forgetStorageUsage();host.broadcast();return {deleted:true};
    },
    "storage.removeBackups": async (params: RpcParams): Promise<unknown> => ({
      removed: await removeDatabaseBackups(host.store.dataDirectory, params.names),
    }),
    "storage.removeLogs": async (params: RpcParams): Promise<unknown> => ({
      removed: await removeOldLogs(host.store.dataDirectory, Number(params.days) || 30),
    }),
    /** Only directories marked by a HiveLab process that has since ended; the same rule as the startup sweep. */
    "storage.sweepTemp": async (): Promise<unknown> => {
      const result = await sweepOwnedTemp(path.join(host.store.dataDirectory, "process-temp"));
      forgetStorageUsage();
      return result;
    },
    /** Settings → 人物设定: set every member's code at once. Relations follow ids, so nothing else changes. */
    "team.codes": async (params: RpcParams): Promise<unknown> => {
      const given = params.codes && typeof params.codes === "object" ? (params.codes as Record<string, unknown>) : {};
      // An outside edit of 人物设定.md names members by their current codes: import it before the codes move,
      // or its sections would be matched to whoever takes those codes next.
      host.personaFile.reconcile();
      const members = host.store.members();
      const codes = Object.fromEntries(members.map((member) => [member.id, String(given[member.id] ?? member.code ?? "").trim()]));
      const problem = validateCodes(members, codes);
      if (problem) throw new Error(problem);
      // Optionally carry the move into persona text that names teammates by number ("身份=02", "姐姐 01").
      const rewrite = params.rewriteText === true ? codeRewriter(codeChanges(members, codes)) : undefined;
      const changed: string[] = [];
      let rewritten = 0;
      host.store.transaction(() => {
        for (const member of members) {
          const text = rewrite ? rewriteMemberCodes(member, rewrite) : { count: 0, fields: {} };
          if (member.code === codes[member.id] && !text.count) continue;
          host.store.put("members", member.id, { ...member, ...text.fields, code: codes[member.id] });
          changed.push(member.id);
          rewritten += text.count;
        }
      });
      host.personaFile.export();
      // Codes and persona text are part of every member's instructions; the next turn starts from the new ones.
      const ids = new Set(changed);
      if (ids.size)
        await host.roomRuntimes.invalidate((key) => ids.has(host.store.get<Session>("sessions", key)?.memberId ?? host.store.get<Session>("sessions", key)?.provider ?? ""));
      host.broadcast();
      return { members: host.store.members().map(({ id, code }) => ({ id, code })), rewritten };
    },
    "persona.file.read": async (): Promise<unknown> => host.personaFile.read(),
    "persona.file.save": async (params: RpcParams): Promise<unknown> => {
      const document = host.personaFile.saveText(params.content as string);
      host.broadcast();
      return document;
    },
    /** Visual editor: cards by id with the fields to set; the file is rewritten from the cards afterwards. */
    "persona.file.apply": async (params: RpcParams): Promise<unknown> => {
      const given = Array.isArray(params.members) ? (params.members as Record<string, unknown>[]) : [];
      const updates = given.map((item) => {
        const { id, ...fields } = item;
        return { id: String(id ?? ""), fields: fields as import("../../shared/persona-file").PersonaFields };
      });
      host.personaFile.apply(updates);
      host.broadcast();
      return host.personaFile.read();
    },
    "profile.save": async (params: RpcParams): Promise<unknown> => {
      const given = (params.profile ?? {}) as Partial<UserProfile>;
      const name = typeof given.name === "string" ? given.name.trim().slice(0, 40) : "";
      if (!name) throw new Error("名字不能为空");
      const avatar =
        typeof given.avatar === "string" &&
        /^[a-f0-9-]{8,64}\.(png|jpe?g|webp|gif)$/i.test(given.avatar)
          ? given.avatar
          : undefined;
      const profile: UserProfile = { name, ...(avatar ? { avatar } : {}) };
      host.store.put("profile", "main", profile);
      await host.roomRuntimes.invalidate();
      host.broadcast();
      return profile;
    },
    "persona.import": async (params: RpcParams): Promise<unknown> => {
      return host.importPersona(String(params.executor));
    },
  } satisfies Record<string, RpcHandler>;
}

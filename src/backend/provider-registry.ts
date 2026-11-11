import { googleQuotaStamp } from "./adapters/google-quota";
import { isGlmApi } from "./adapters/glm-api";
import { type RunExecutionActive } from "./run-execution";
import { newCompatibility, withCompatibility, currentIdentity } from "./compatibility";
import type { CompatibilityReport, ExecutorIdentity } from "../shared/compatibility";
import { newerVersion, type MemberVersionUse } from "../shared/member-versions";
import type { CatalogId } from "../shared/executor-catalog";
import { memberVersionUseKey, sameMemberProgram } from "./member-version-status";
import { requestedConfig } from "../shared/executor-config";
import { createHash } from "node:crypto";
import path from "node:path";
import type {
  AcpExecutor,
  Adapter,
  AdapterContext,
  MemberPermissions,
  MemberQuota,
  ProviderId,
  ProviderInfo,
  Run,
  Session,
  Settings,
} from "../shared/types";
import { accountRefreshTargets, mergeQuota, quotaReport } from "../shared/quota";
import { PROVIDER_NAMES, isAcpId } from "../shared/defaults";
import { Store } from "./store";
import { buildEnvironment, redact } from "./security";
import { extractVersion, isVerified, latestVersion } from "./member-versions";
import { fileStamp } from "./runtime-pool";
import { ProjectFlowController } from "./project-flow";
import { claudeOAuthTokenConfigured } from "./adapters/claude";
import type { EngineTiming } from "./engine-options";

export interface ProviderRegistryHost {
  readonly store: Store;
  readonly settings: Settings;
  readonly projectFlow: Pick<ProjectFlowController, "kick"> | undefined;
  readonly schedule: () => Promise<void>;
  readonly alive: boolean;
  readonly maintenance: boolean;
  readonly memberOperations: Set<string>;
  readonly adapter: (id: ProviderId) => Adapter;
  readonly broadcast: () => void;
  readonly closed: boolean;
  readonly permissionsFor: (id: ProviderId, settings: Settings) => MemberPermissions;
  readonly memberProgram: (
    member: "codex" | "claude" | "dsh",
    info?: ProviderInfo,
  ) => Promise<ExecutorIdentity>;
  readonly key: string | undefined;
  readonly executorIds: () => ProviderId[];
  readonly timing: EngineTiming | undefined;
  readonly active: Map<string, RunExecutionActive>;
}

const now = () => new Date().toISOString();
const UPDATE_CHECK_DELAY_MS = 60_000,
  UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60_000,
  UPDATE_CHECK_RETRY_MS = 30 * 60_000;

/** Owns provider registry state and lifecycle. */
export class ProviderRegistry {
  constructor(private host: ProviderRegistryHost) {}

  close() {
    clearInterval(this.accountRefreshTimer);
    this.accountRefreshTimer = undefined;
    clearTimeout(this.updateCheckTimer);
    this.updateCheckTimer = undefined;
    for (const id of this.probeRetries.keys()) this.cancelProbeRetry(id);
    this.deferredProbeRetries.clear();
  }

  providers: ProviderInfo[] = [];

  probeRevisions = new Map<ProviderId, number>();

  probeRetries = new Map<ProviderId, NodeJS.Timeout>();

  deferredProbeRetries = new Map<ProviderId, number>();

  providerChecks = new Map<string, Promise<ProviderInfo>>();

  balanceRevision = 0;

  private accountRefreshTimer?: NodeJS.Timeout;

  private updateCheckTimer?: NodeJS.Timeout;

  /** Latest official release per package, held for this run only: a restart checks again. */
  private latestVersions = new Map<CatalogId, string>();

  balanceCheck?: {
    key: string;
    task: Promise<MemberQuota | undefined>;
  };

  quotaChecks = new Map<ProviderId, { key: string; task: Promise<MemberQuota | undefined> }>();

  compatibilityQueues = new Map<ProviderId, Promise<unknown>>();

  quotaAccountStamp(provider: ProviderId) {
    const external = this.host.store.get<AcpExecutor>("executors", provider);
    // An added Claude connection keeps its own login directory, so its quota belongs to that account only.
    const connectionHome =
      external?.catalogId === "claude" ? external.env?.CLAUDE_CONFIG_DIR : undefined;
    const home =
      connectionHome ??
      (provider === "claude"
        ? process.env.HIVELAB_CLAUDE_HOME
        : provider === "codex"
          ? process.env.HIVELAB_CODEX_HOME
          : undefined);
    const account =
      provider === "dsh"
        ? [process.env.HIVELAB_DSH_HOME ?? "", this.host.settings.dshProfile]
        : home
          ? fileStamp(path.join(home, provider === "claude" ? ".credentials.json" : "auth.json"))
          : null;
    return createHash("sha256")
      .update(
        JSON.stringify([
          provider,
          this.host.settings.paths[provider] ?? "",
          account,
          ...(external
            ? [
                external,
                googleQuotaStamp(external),
                external.catalogId === "kimi" ||
                isGlmApi(external) ||
                connectionHome
                  ? fileStamp(
                      path.join(this.host.store.dataDirectory, "secrets", external.id + ".secret"),
                    )
                  : undefined,
              ]
            : []),
        ]),
      )
      .digest("hex");
  }

  memberQuota(provider: ProviderId) {
    const saved = this.host.store.get<MemberQuota>("quotas", provider);
    return saved && saved.accountStamp === this.quotaAccountStamp(provider) ? saved : undefined;
  }

  rememberQuota(
    provider: ProviderId,
    data: unknown,
    checkedAt: string,
    source: MemberQuota["source"],
  ) {
    const report = quotaReport(provider, data, checkedAt, source);
    if (!report) return false;
    this.host.store.put("quotas", provider, {
      ...mergeQuota(this.memberQuota(provider), report),
      accountStamp: this.quotaAccountStamp(provider),
    });
    if (this.host.projectFlow) {
      this.host.projectFlow.kick();
      void this.host.schedule();
    }
    return true;
  }

  startAccountRefresh(intervalMs = 30000) {
    if (this.accountRefreshTimer || !this.host.alive) return;
    this.accountRefreshTimer = setInterval(() => {
      if (!this.host.alive || this.host.maintenance) return;
      const targets = accountRefreshTargets(
        this.host.store.members(),
        this.host.store.executors(),
        claudeOAuthTokenConfigured(),
      );
      for (const { provider } of targets) {
        const info = this.providers.find((item) => item.id === provider);
        if (!info || info.auth === "none" || this.host.memberOperations.has(provider)) continue;
        void (provider === "dsh" ? this.refreshBalance() : this.refreshQuota(provider)).catch(
          () => {},
        );
      }
    }, intervalMs);
    this.accountRefreshTimer.unref();
  }

  /** Looks for new releases on a schedule so an outdated program is noticed without opening the version panel.
   *  Only version metadata is read; HiveLab never installs a program without a click. */
  startUpdateChecks(delayMs = UPDATE_CHECK_DELAY_MS) {
    if (this.updateCheckTimer || !this.host.alive) return;
    this.updateCheckTimer = setTimeout(() => {
      this.updateCheckTimer = undefined;
      void this.checkUpdates().then((complete) => {
        if (this.host.alive)
          this.startUpdateChecks(complete ? UPDATE_CHECK_INTERVAL_MS : UPDATE_CHECK_RETRY_MS);
      });
    }, delayMs);
    this.updateCheckTimer.unref();
  }

  /** Connections pin their own program, so each one in use is compared on its own; a package is looked up once. */
  async checkUpdates(lookup: typeof latestVersion = latestVersion) {
    if (!this.host.alive || this.host.maintenance) return false;
    const packages = new Set<CatalogId>();
    for (const info of this.providers) {
      const id = this.catalogIdOf(info.id);
      if (id && info.version) packages.add(id);
    }
    let complete = true;
    for (const id of packages) {
      try {
        const version = await lookup(
          id,
          buildEnvironment(this.host.settings),
          this.host.store.dataDirectory,
        );
        if (!this.host.alive || this.host.maintenance) return false;
        this.rememberLatest(id, version);
      } catch {
        complete = false;
      }
    }
    return complete;
  }

  /** Records a release found by any check and refreshes the members using that package. */
  rememberLatest(id: CatalogId, version: string) {
    this.latestVersions.set(id, version);
    for (const [index, info] of this.providers.entries()) {
      if (this.catalogIdOf(info.id) !== id) continue;
      const next = this.withUpdate(info);
      if (next.updateVersion === info.updateVersion) continue;
      this.providers[index] = next;
      this.host.store.put("providers", next.id, next);
      this.host.broadcast();
    }
  }

  private catalogIdOf(id: ProviderId): CatalogId | undefined {
    if (id === "deepseek") return undefined;
    return isAcpId(id) ? this.host.store.get<AcpExecutor>("executors", id)?.catalogId : id;
  }

  /** Derived on every publish, so an installed update clears the offer and a stored one never outlives its check. */
  private withUpdate(info: ProviderInfo): ProviderInfo {
    const { updateVersion: _previous, ...rest } = info;
    const id = this.catalogIdOf(info.id),
      latest = id && this.latestVersions.get(id),
      current = extractVersion(info.version);
    return latest && current && newerVersion(latest, current)
      ? { ...rest, updateVersion: latest }
      : rest;
  }

  async refreshBalance() {
    if (!this.host.alive) return;
    if (this.host.memberOperations.has("dsh"))
      throw new Error("DeepSeek 程序正在更新，请稍后刷新余额。");
    const settings = this.host.settings,
      revision = this.balanceRevision;
    const key = JSON.stringify([
      revision,
      this.quotaAccountStamp("dsh"),
      settings.networkMode,
      settings.proxyUrl,
    ]);
    if (this.balanceCheck?.key === key) return this.balanceCheck.task;
    const task = (async () => {
      let balance;
      try {
        balance = await this.host
          .adapter("dsh")
          .accountBalance?.(settings, buildEnvironment(settings));
      } catch {
        /* Balance availability never changes connectivity. */
      }
      if (!this.host.alive) return;
      if (revision !== this.balanceRevision || settings !== this.host.settings)
        return this.memberQuota("dsh");
      this.rememberQuota("dsh", { accountBalance: balance }, balance?.checkedAt ?? now(), "probe");
      this.host.broadcast();
      if (balance?.signedOut) {
        this.loginLost("dsh");
        await this.probe("dsh").catch(() => {});
      }
      return this.memberQuota("dsh");
    })();
    this.balanceCheck = { key, task };
    try {
      return await task;
    } finally {
      if (this.balanceCheck?.task === task) this.balanceCheck = undefined;
    }
  }

  async refreshQuota(provider: ProviderId) {
    if (!this.host.alive) return;
    if (this.host.memberOperations.has(provider))
      throw new Error(`${PROVIDER_NAMES[provider]} 程序正在更新，请稍后刷新额度。`);
    const settings = this.host.settings,
      revision = this.probeRevisions.get(provider) ?? 0,
      accountStamp = this.quotaAccountStamp(provider);
    const key = JSON.stringify([revision, accountStamp, settings.networkMode, settings.proxyUrl]);
    if (this.quotaChecks.get(provider)?.key === key) return this.quotaChecks.get(provider)!.task;
    const task = (async () => {
      let result;
      try {
        result = await this.host
          .adapter(provider)
          .accountQuota?.(settings, buildEnvironment(settings));
      } catch {}
      if (!this.host.alive) return;
      if (
        settings !== this.host.settings ||
        revision !== (this.probeRevisions.get(provider) ?? 0) ||
        (provider !== "claude" && accountStamp !== this.quotaAccountStamp(provider))
      )
        return this.memberQuota(provider);
      this.rememberQuota(
        provider,
        result?.payload ??
          (provider === "codex"
            ? { accountRateLimits: undefined }
            : provider === "claude"
              ? { accountUsage: undefined }
              : this.host.store.get<AcpExecutor>("executors", provider)?.catalogId === "kimi"
                ? {
                    accountBalance: {
                      status: "unavailable",
                      kind: "kimi-api",
                      wallets: [],
                      bonusWallets: [],
                    },
                  }
                : this.host.store.get<AcpExecutor>("executors", provider)?.catalogId === "zcode"
                  ? {
                      accountBalance: {
                        status: "unavailable",
                        kind: "glm-api",
                        wallets: [],
                        bonusWallets: [],
                        reason: "GLM 余额查询暂不可用。",
                      },
                    }
                  : { googleQuota: { status: "unavailable", reason: "额度查询暂不可用。" } }),
        result?.checkedAt ?? now(),
        "probe",
      );
      this.host.broadcast();
      // The login is gone: check the connection again so the member shows it needs a login.
      if (result?.signedOut) {
        this.loginLost(provider);
        if (provider === "claude") await this.probe(provider).catch(() => {});
      }
      return this.memberQuota(provider);
    })();
    this.quotaChecks.set(provider, { key, task });
    try {
      return await task;
    } finally {
      if (this.quotaChecks.get(provider)?.task === task) this.quotaChecks.delete(provider);
    }
  }

  rememberCompatibility(report: CompatibilityReport) {
    if (this.host.closed) return;
    this.host.store.put("compatibility_reports", report.id, redact(report));
    const old = this.host.store
      .list<CompatibilityReport>("compatibility_reports")
      .filter((r) => r.provider === report.provider && r.id !== report.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    for (const item of old.slice(49)) this.host.store.delete("compatibility_reports", item.id);
  }

  async inspectProvider(
    id: ProviderId,
    settings: Settings,
    trigger: CompatibilityReport["trigger"] = "probe",
  ) {
    // Startup, settings save and a manual check can otherwise initialize the same native home concurrently.
    // Different connection settings still get a new check, and the revision guard rejects stale results.
    const key = JSON.stringify([
      id,
      settings.networkMode,
      settings.proxyUrl,
      settings.paths[id],
      settings.models[id],
      settings.efforts[id],
      id !== "deepseek" ? this.host.permissionsFor(id, settings) : undefined,
      id === "dsh" ? [settings.dshProfile, settings.deepseekBaseUrl] : undefined,
      isAcpId(id) ? this.host.store.get("executors", id) : undefined,
    ]);
    const existing = this.providerChecks.get(key);
    if (existing) return existing;
    const previous = this.compatibilityQueues.get(id);
    const task = (async () => {
      if (previous) await previous.catch(() => {});
      if (!this.host.alive || this.host.maintenance)
        throw new Error("执行服务已停止或正在恢复，未启动排队中的探测。");
      const report = newCompatibility(id, trigger, settings);
      this.rememberCompatibility(report);
      const result = await withCompatibility(report, () =>
        this.host.adapter(id).probe(settings, buildEnvironment(settings)),
      ).catch(
        (error) =>
          ({
            id,
            name: PROVIDER_NAMES[id],
            available: false,
            auth: "unknown",
            detail: (error as Error).message,
            capabilities: {
              steer: false,
              cancel: "process",
              streaming: false,
              write: false,
              history: false,
            },
          }) as ProviderInfo,
      );
      const info: ProviderInfo = redact({
        ...result,
        checkedAt: now(),
        stale: false,
      });
      if (
        ["codex", "claude", "dsh"].includes(id) &&
        !settings.paths[id] &&
        !info.path &&
        !info.runtimeReady &&
        /未找到|ENOENT|找不到/.test(info.detail)
      ) {
        info.installationRequired = true;
        info.detail = "尚未下载官方程序，请从内置清单选择、下载并登录。";
      }
      if (isAcpId(id) && !info.permissionSupport) {
        // HiveLab only sees the permission requests a connected program chooses to send.
        info.permissionSupport = {
          commandReadIsolation: false,
          commandWriteIsolation: "approval-only",
          networkIsolation: "none",
        };
      } else if (!isAcpId(id) && id !== "deepseek") {
        const permissions = this.host.permissionsFor(id, settings);
        info.verified = isVerified(id as "codex" | "claude" | "dsh", info.version);
        info.permissionSupport = {
          commandReadIsolation: false,
          commandWriteIsolation:
            permissions.fileScope === "any"
              ? "none"
              : id === "claude" ||
                  (id === "codex" && process.platform === "win32" && !info.windowsSandbox?.ready)
                ? "approval-only"
                : "native",
          networkIsolation: permissions.network ? "none" : "commands-disabled",
        };
      }
      report.completedAt = now();
      report.outcome = info.available
        ? "passed"
        : info.runtimeReady && info.auth === "none"
          ? "needs-auth"
          : "failed";
      report.account = info.auth;
      report.capabilities = info.capabilities;
      report.identity = {
        ...report.identity,
        ...(info.path && !report.identity.path ? { path: info.path } : {}),
        ...(info.version ? { version: info.version, versionSource: "native" as const } : {}),
      };
      if (report.outcome === "failed") report.error = info.detail;
      info.compatibility = report;
      this.rememberCompatibility(report);
      return info;
    })();
    this.compatibilityQueues.set(id, task);
    void task
      .finally(() => {
        if (this.compatibilityQueues.get(id) === task) this.compatibilityQueues.delete(id);
      })
      .catch(() => {});
    this.providerChecks.set(key, task);
    try {
      return await task;
    } finally {
      if (this.providerChecks.get(key) === task) this.providerChecks.delete(key);
    }
  }

  publishProvider(info: ProviderInfo) {
    info = this.withUpdate({
      ...info,
      lastRunCompatibility:
        info.lastRunCompatibility ??
        this.providers.find((item) => item.id === info.id)?.lastRunCompatibility,
    });
    if (info.quota)
      this.rememberQuota(
        info.id,
        info.quota,
        info.quotaCheckedAt ?? info.checkedAt ?? now(),
        "probe",
      );
    const index = this.providers.findIndex((x) => x.id === info.id);
    if (index < 0) this.providers.push(info);
    else this.providers[index] = info;
    this.host.store.put("providers", info.id, info);
    this.host.broadcast();
  }

  cancelProbeRetry(id: ProviderId) {
    clearTimeout(this.probeRetries.get(id));
    this.probeRetries.delete(id);
    this.deferredProbeRetries.delete(id);
  }

  async confirmProvider(ctx: AdapterContext) {
    const run = this.host.store.get<Run>("runs", ctx.run.id),
      info = this.providers.find((info) => info.id === ctx.run.provider);
    if (
      !this.host.alive ||
      !info ||
      !run ||
      !["ended", "completed"].includes(run.status) ||
      run.delivery !== "confirmed" ||
      run.revision !== this.host.store.get<Session>("sessions", run.sessionId)?.revision
    )
      return;
    const replied = this.host.store
      .runEvents(run.id)
      .some(
        (event) =>
          event.runId === run.id &&
          event.fidelity === "native" &&
          ["message", "delta"].includes(event.kind) &&
          event.text.trim() &&
          !(event.data as { role?: string } | undefined)?.role,
      );
    if (!replied) return;
    const identity = currentIdentity();
    if (info.id === "codex" || info.id === "claude" || info.id === "dsh") {
      const key = identity && memberVersionUseKey(info.id, identity);
      if (key && identity)
        this.host.store.put("member_version_uses", key, {
          provider: info.id,
          identity,
          runId: run.id,
          completedAt: run.completedAt ?? now(),
          requestedConfig: run.requestedConfig,
          effectiveConfig: run.effectiveConfig,
        } satisfies MemberVersionUse);
      // A completed old bound session is evidence for its own version, never for today's selected program.
      try {
        if (identity && !sameMemberProgram(identity, await this.host.memberProgram(info.id, info)))
          return;
      } catch {
        return;
      }
    }
    if (
      !this.host.alive ||
      this.providers.find((item) => item.id === info.id) !== info ||
      (info.auth === "none" && Date.parse(run.createdAt) < Date.parse(info.checkedAt ?? ""))
    )
      return;
    this.cancelProbeRetry(info.id);
    this.probeRevisions.set(info.id, (this.probeRevisions.get(info.id) ?? 0) + 1);
    this.publishProvider({
      ...info,
      quotaCheckedAt: info.quotaCheckedAt ?? info.checkedAt,
      available: true,
      stale: false,
      runtimeReady: true,
      auth:
        info.id === "claude"
          ? ctx.settings.claudeAuthMode === "api"
            ? "api"
            : "subscription"
          : info.id === "codex"
            ? "subscription"
            : info.id === "dsh"
              ? "account"
              : info.auth,
      checkedAt: now(),
      detail: "本轮已收到并核对成员回复，连接已确认。",
      connectionCheck: { source: "run", runId: run.id },
    });
  }

  loginLost(id: ProviderId) {
    const info = this.providers.find((info) => info.id === id);
    if (!info) return;
    this.cancelProbeRetry(id);
    this.publishProvider({
      ...info,
      available: false,
      auth: "none",
      checkedAt: now(),
      quota: undefined,
      quotaCheckedAt: undefined,
      detail: "登录已失效，请在成员设置里重新登录，然后检测连接。",
    });
  }

  async probe(provider?: ProviderId, automaticRetry = false) {
    if (!this.host.alive || this.host.maintenance) return this.providers;
    if (provider && this.host.store.get("removed_providers", provider))
      throw new Error("这个执行端连接已删除，请先重新添加连接。");
    const empty =
      !this.host.store.members().length &&
      !this.host.store.executors().length &&
      !Object.values(this.host.settings.paths).some(Boolean) &&
      !this.host.key;
    await Promise.all(
      (provider ? [provider] : empty ? [] : this.host.executorIds()).map(async (id) => {
        this.cancelProbeRetry(id);
        const revision = (this.probeRevisions.get(id) ?? 0) + 1;
        this.probeRevisions.set(id, revision);
        const info = await this.inspectProvider(id, this.host.settings);
        if (!this.host.alive || this.probeRevisions.get(id) !== revision) return;
        const retry =
          !automaticRetry &&
          !info.available &&
          !["none", "api"].includes(info.auth) &&
          !/所选|没有接受|配置.*不支持/.test(info.detail) &&
          id !== "deepseek";
        const delay = Math.max(1, this.host.timing?.providerRetryMs ?? 30_000);
        info.connectionCheck = {
          source: "probe",
          retryAttempt: automaticRetry ? 1 : 0,
          ...(retry ? { retryAt: new Date(Date.now() + delay).toISOString() } : {}),
        };
        this.publishProvider(info);
        if (retry) {
          const timer = setTimeout(() => {
            this.probeRetries.delete(id);
            if (!this.host.alive || this.probeRevisions.get(id) !== revision) return;
            if ([...this.host.active.values()].some((active) => active.ctx.run.provider === id)) {
              this.deferredProbeRetries.set(id, revision);
              return;
            }
            void this.probe(id, true).catch(() => {});
          }, delay);
          timer.unref();
          this.probeRetries.set(id, timer);
        }
      }),
    );
    return this.providers;
  }
}

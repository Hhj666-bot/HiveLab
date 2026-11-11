import {GlmApiAdapter} from "./adapters/glm-api";
import {type RunExecutionActive} from "./run-execution";
import {ensurePortableNode} from "./portable-node";
import {newCompatibility, withCompatibility, confirmProgram, readProgramIdentity} from "./compatibility";
import {CATALOG_REVISION, catalogEntry, catalogProvider, catalogExecutor} from "../shared/executor-catalog";
import {catalogStatuses, catalogCandidate, assertCatalogVersionUnused} from "./executor-catalog";
import type {CompatibilityReport, ExecutorIdentity} from "../shared/compatibility";
import type {MemberVersions, MemberVersionUse, MemberInstallation} from "../shared/member-versions";
import {memberVersionUseKey, sameMemberProgram} from "./member-version-status";
import {resolveCliEntry} from "./adapters/common";
import type {AcpExecutor, AcpExecutorId, Adapter, ProviderId, ProviderInfo, Run, Settings} from "../shared/types";
import {isAcpId, rememberExecutors} from "../shared/defaults";
import {AcpAdapter} from "./adapters/acp";
import {ZcodeAdapter} from "./adapters/zcode";
import {ClaudeAdapter} from "./adapters/claude";
import {Store} from "./store";
import {buildEnvironment, redact} from "./security";
import {MEMBER_PACKAGES, VERIFIED_VERSIONS, installedVersions, latestVersion, versionOfPath, removeVersion} from "./member-versions";
import {resolveDshEntry} from "./adapters/dsh";
import {ProviderRegistry} from "./provider-registry";
import type {CatalogId} from "../shared/executor-catalog";
import type {InstallOptions, InstalledVersion} from "./member-versions";

const now = () => new Date().toISOString();

export interface MemberProgramsHost {
  settings: Settings;
  providerRegistry: ProviderRegistry;
  store: Store;
  memberInstallations: Map<string, MemberInstallation>;
  acpLogins: Set<string>;
  memberOperations: Set<string>;
  factory: ((id: ProviderId) => Adapter) | undefined;
  externalAdapter: (executor: AcpExecutor) => GlmApiAdapter | ZcodeAdapter | AcpAdapter | ClaudeAdapter;
  invalidateRuntimes: (provider?: ProviderId, stopActive?: boolean) => Promise<void>;
  active: Map<string, RunExecutionActive>;
  memberInstaller: (data: string, member: CatalogId, version: string, env: NodeJS.ProcessEnv, options?: InstallOptions) => Promise<InstalledVersion>;
  broadcast: () => void;
}

/** MemberPrograms owns this domain; mutable engine state is read through live host accessors. */
export class MemberPrograms {
  constructor(private host:MemberProgramsHost) {}
  member(value: unknown) {
    if (value !== "codex" && value !== "claude" && value !== "dsh")
      throw new Error("该成员不支持版本管理");
    return value;
  }
  async memberProgram(
    member: "codex" | "claude" | "dsh",
    info?: ProviderInfo,
  ): Promise<ExecutorIdentity> {
    const entry =
      member === "dsh"
        ? await resolveDshEntry(this.host.settings)
        : resolveCliEntry(
            member,
            this.host.settings,
            buildEnvironment(this.host.settings),
          ).path;
    const identity = {
      ...newCompatibility(member, "probe", this.host.settings).identity,
      ...readProgramIdentity(entry),
    };
    // A native version may be available for a standalone executable without a manifest.
    const observed = [info?.compatibility, info?.lastRunCompatibility]
      .filter((r): r is CompatibilityReport => !!r)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .find((r) => sameMemberProgram(identity, r.identity));
    if (!identity.version && observed?.identity.version) {
      identity.version = observed.identity.version;
      identity.versionSource = observed.identity.versionSource;
    }
    return identity;
  }
  async memberVersions(
    provider: unknown,
    checkLatest: boolean,
  ): Promise<MemberVersions> {
    const member = this.member(provider);
    const info = this.host.providerRegistry.providers.find((x) => x.id === member);
    const configured = this.host.settings.paths[member];
    const activeVersion = versionOfPath(
      this.host.store.dataDirectory,
      member,
      configured,
    );
    let latest: string | undefined, latestError: string | undefined;
    if (checkLatest)
      try {
        latest = await latestVersion(
          member,
          buildEnvironment(this.host.settings),
          this.host.store.dataDirectory,
        );
        this.host.providerRegistry.rememberLatest(member, latest);
      } catch (error) {
        latestError = (error as Error).message;
      }
    let identity: ExecutorIdentity | undefined,
      connection: MemberVersions["connection"];
    try {
      identity = await this.memberProgram(member, info);
      const observed =
        info?.connectionCheck?.source === "run"
          ? info.lastRunCompatibility?.identity
          : info?.compatibility?.identity;
      const matches = sameMemberProgram(identity, observed);
      connection = !matches
        ? { state: "unchecked", detail: "当前程序等待连接检查。" }
        : info?.stale
          ? { state: "stale", detail: "上次已连接，等待重新确认。" }
          : {
              state: info?.available ? "connected" : "failed",
              detail: info?.detail ?? "等待连接检查。",
              checkedAt: info?.checkedAt,
            };
    } catch (error) {
      connection = {
        state: "failed",
        detail: String(redact((error as Error).message)),
      };
    }
    const key = identity && memberVersionUseKey(member, identity),
      successfulUse = key
        ? this.host.store.get<MemberVersionUse>("member_version_uses", key)
        : undefined;
    const report = info?.lastRunCompatibility,
      lastRun =
        report && sameMemberProgram(identity, report.identity)
          ? {
              outcome: report.outcome,
              completedAt: report.completedAt,
              error: report.error ? String(redact(report.error)) : undefined,
            }
          : undefined;
    return {
      member,
      packageName: MEMBER_PACKAGES[member],
      current: identity?.version,
      baselineVersions: VERIFIED_VERSIONS[member],
      connection,
      successfulUse,
      lastRun,
      installation: this.host.memberInstallations.get(member),
      source: configured
        ? activeVersion
          ? "hivelab"
          : "custom"
        : member === "claude"
          ? "global"
          : "bundled",
      activeVersion,
      selectedPath: configured ?? null,
      installed: installedVersions(this.host.store.dataDirectory, member).map(
        (x) => x.version,
      ),
      latest,
      latestError,
    };
  }
  async memberOperation<T>(
    member: string,
    action: () => Promise<T>,
  ): Promise<T> {
    if (this.host.acpLogins.has(member))
      throw new Error("该执行端正在登录，请完成或取消登录后再操作。");
    if (this.host.memberOperations.has(member))
      throw new Error("该成员正在安装或切换版本，请等待完成");
    this.host.memberOperations.add(member);
    try {
      return await action();
    } finally {
      this.host.memberOperations.delete(member);
    }
  }
  async inspectCatalogCandidate(executor: AcpExecutor) {
    const report = newCompatibility(executor.id, "candidate", this.host.settings);
    this.host.providerRegistry.rememberCompatibility(report);
    const adapter =
      this.host.factory?.(executor.id) ?? this.host.externalAdapter(executor);
    const info = await withCompatibility(report, () =>
      adapter.probe(this.host.settings, buildEnvironment(this.host.settings)),
    );
    const auth = catalogEntry(executor.catalogId).authentication.find(
      (item) => item.id === executor.authentication,
    );
    if (
      auth?.kind === "api" &&
      !executor.secretKeys?.length &&
      info.runtimeReady
    ) {
      info.available = false;
      info.auth = "none";
      info.detail =
        "程序已连接，需要在 HiveLab 合屋 中填写 API Key 后使用。未发送模型任务。";
    }
    info.checkedAt = now();
    info.stale = false;
    report.completedAt = now();
    report.outcome = info.available
      ? "passed"
      : info.runtimeReady && info.auth === "none"
        ? "needs-auth"
        : "failed";
    report.account = info.auth;
    report.capabilities = info.capabilities;
    if (info.version)
      report.identity = {
        ...report.identity,
        version: info.version,
        versionSource: "native",
      };
    if (report.outcome === "failed") report.error = info.detail;
    info.compatibility = report;
    this.host.providerRegistry.rememberCompatibility(report);
    return info;
  }
  async useCatalogExecutor(executor: AcpExecutor) {
    const original = this.host.settings,
      previous = this.host.store.get<AcpExecutor>("executors", executor.id);
    if (!previous && this.host.store.executors().length >= 12)
      throw new Error("最多接入 12 个外接程序。");
    await this.host.invalidateRuntimes(executor.id);
    const info = await this.inspectCatalogCandidate(executor);
    if (
      this.host.active.size ||
      this.host.settings !== original ||
      JSON.stringify(previous) !==
        JSON.stringify(this.host.store.get("executors", executor.id))
    )
      throw new Error("检查期间任务或配置发生变化，原配置已保留，请重试。");
    if (!info.available && !(info.runtimeReady && info.auth === "none"))
      throw new Error("候选执行端未通过连接检查，原配置已保留：" + info.detail);
    if (
      info.compatibility?.identity.path &&
      info.compatibility.identity.digest
    ) {
      const check = newCompatibility(executor.id, "candidate", this.host.settings);
      await withCompatibility(
        check,
        () => confirmProgram(info.compatibility!.identity.path!),
        info.compatibility.identity,
      );
    }
    this.host.store.put("executors", executor.id, executor);
    this.host.store.delete('removed_providers', executor.id);
    rememberExecutors(this.host.store.executors());
    this.host.providerRegistry.cancelProbeRetry(executor.id);
    this.host.providerRegistry.probeRevisions.set(
      executor.id,
      (this.host.providerRegistry.probeRevisions.get(executor.id) ?? 0) + 1,
    );
    this.host.providerRegistry.publishProvider(info);
    return executor;
  }
  async catalogOperation(params: any, install: boolean) {
    const entry = catalogEntry(params.id),
      selected = catalogExecutor(this.host.store.executors(), entry.id, params.executorId),
      provider = selected?.id ?? catalogProvider(entry.id);
    if (install && entry.downloadable === false)
      throw new Error("该执行端已从下载清单移除；已有连接和历史记录仍保留。");
    if (this.host.active.size)
      throw new Error("请先停止正在运行的成员，再下载或切换执行端。");
    const consent = this.host.store.get<{ revision: string }>(
      "catalog_consents",
      entry.id,
    );
    if (
      consent?.revision !== CATALOG_REVISION &&
      (params.agree !== true || params.revision !== CATALOG_REVISION)
    )
      throw new Error("请先阅读并同意该厂商的条款。");
    return this.memberOperation(provider, async () => {
      const before = installedVersions(this.host.store.dataDirectory, entry.id),
        version = String(params.version),
        startedAt = now();
      this.host.memberInstallations.set(provider, {
        version,
        phase: "installing",
        startedAt,
        phaseStartedAt: startedAt,
      });
      try {
        const item = install
          ? await this.host.memberInstaller(
              this.host.store.dataDirectory,
              entry.id,
              version,
              buildEnvironment(this.host.settings),
              {
                requireIntegrity: true,
                progress: (value) => {
                  const current = this.host.memberInstallations.get(provider);
                  if (!current) return;
                  this.host.memberInstallations.set(provider, {
                    ...current,
                    ...value,
                    phaseStartedAt:
                      current.phase === value.phase
                        ? current.phaseStartedAt
                        : now(),
                  });
                },
              },
            )
          : before.find((item) => item.version === version);
        if (!item) throw new Error("这个版本没有完整安装。");
        this.host.memberInstallations.set(provider, {
          ...this.host.memberInstallations.get(provider)!,
          phase: "connection",
          phaseStartedAt: now(),
        });
        if (isAcpId(provider))
          await this.useCatalogExecutor(
            catalogCandidate(
              entry.id,
              item.entry,
              this.host.store.get("executors", provider),
              provider as AcpExecutorId,
            ),
          );
        else {
          try {
            await this.useMemberPath(this.member(provider), item.entry);
          } catch (error) {
            if (
              entry.id !== "dsh" ||
              !process.versions.electron ||
              !/Electron.*不兼容|node-addon|NODE_MODULE_VERSION|ERR_DLOPEN_FAILED/i.test(
                (error as Error).message,
              )
            )
              throw error;
            this.host.memberInstallations.set(provider, {
              ...this.host.memberInstallations.get(provider)!,
              detail:
                "正在从 nodejs.org 下载并校验 DSH 兼容运行环境（26.4.0）。",
            });
            await ensurePortableNode(
              this.host.store.dataDirectory,
              buildEnvironment(this.host.settings),
            );
            await this.useMemberPath("dsh", item.entry);
          }
        }
        this.host.store.put("catalog_consents", entry.id, {
          revision: CATALOG_REVISION,
          at: now(),
          packageName: entry.packageName,
          termsUrl: entry.termsUrl,
        });
        return catalogStatuses(this.host.store, this.host.settings, isAcpId(provider) ? provider : undefined).find(
          (item) => item.entry.id === entry.id,
        );
      } catch (error) {
        if (install && !before.some((item) => item.version === version))
          await removeVersion(this.host.store.dataDirectory, entry.id, version, () =>
            assertCatalogVersionUnused(
              this.host.store,
              this.host.settings,
              entry.id,
              version,
            ),
          ).catch(() => {});
        throw error;
      } finally {
        this.host.memberInstallations.delete(provider);
        this.host.broadcast();
      }
    });
  }
  async useMemberPath(
    member: "codex" | "claude" | "dsh",
    entry: string | undefined,
  ) {
    const original = this.host.settings,
      paths = { ...original.paths };
    if (entry) paths[member] = entry;
    else delete paths[member];
    const candidate = { ...original, paths },
      info = await this.host.providerRegistry.inspectProvider(member, candidate, "candidate");
    try {
      if (this.host.active.size)
        throw new Error(
          "任务正在运行，新版本已安装但暂不切换。请等任务结束或停止后，再点击切换版本。",
        );
      if (this.host.settings !== original)
        throw new Error("探测期间设置已改变，请重试切换；原配置已保留");
      if (!info.available && !(info.auth === "none" && info.runtimeReady))
        throw new Error(
          "新版本连接检查未通过，原版本已保留。请查看成员设置中的连接结果：" +
            info.detail,
        );
      if (
        info.compatibility?.identity.path &&
        info.compatibility.identity.digest
      ) {
        const recheck = newCompatibility(member, "candidate", candidate);
        await withCompatibility(
          recheck,
          () => confirmProgram(info.compatibility!.identity.path!),
          info.compatibility.identity,
        );
      }
      const requestedModel = candidate.models[member],
        requestedEffort = candidate.efforts[member],
        options = info.modelOptions ?? [];
      const selected = requestedModel
        ? options.find((option) => option.id === requestedModel)
        : options.find((option) => option.isDefault);
      if (requestedModel && options.length && !selected)
        throw new Error("候选版本不支持所选模型，原版本已保留。");
      if (
        requestedEffort &&
        selected &&
        selected.efforts.length &&
        !selected.efforts.includes(requestedEffort)
      )
        throw new Error("候选版本不支持所选思考程度，原版本已保留。");
    } catch (error) {
      if (info.compatibility) {
        info.compatibility.outcome = "failed";
        info.compatibility.error = String(redact((error as Error).message));
        info.compatibility.completedAt = now();
        this.host.providerRegistry.rememberCompatibility(info.compatibility);
      }
      throw error;
    }
    this.host.providerRegistry.cancelProbeRetry(member);
    this.host.providerRegistry.probeRevisions.set(member, (this.host.providerRegistry.probeRevisions.get(member) ?? 0) + 1);
    this.host.settings = candidate;
    this.host.store.delete('removed_providers', member);
    this.host.store.put("settings", "main", candidate);
    this.host.providerRegistry.publishProvider(info);
    await this.host.invalidateRuntimes(member);
    return this.memberVersions(member, false);
  }
}

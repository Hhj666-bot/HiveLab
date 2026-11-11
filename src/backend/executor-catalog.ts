import path from "node:path";
import type {
  AcpExecutor,
  AcpExecutorId,
  ProviderId,
  Settings,
} from "../shared/types";
import { ACP_DEFAULT_PERMISSIONS, isAcpId } from "../shared/defaults";
import {
  CATALOG_REVISION,
  EXECUTOR_CATALOG,
  ALL_EXECUTOR_CATALOG,
  catalogEntry,
  catalogProvider,
  catalogExecutor,
  type CatalogId,
  type CatalogStatus,
} from "../shared/executor-catalog";
import { installedVersions } from "./member-versions";
import type { Store } from "./store";
import { zcodeRepairVersion } from "./zcode-install";
import {cursorNodeEnvironment} from "./cursor-install";

export function catalogStatuses(
  store: Store,
  settings: Settings,
  executorId?: string,
): CatalogStatus[] {
  const executors = store.executors();
  const selectedExecutor = executorId === undefined ? undefined : executors.find(item => item.id === executorId);
  if (executorId !== undefined && !selectedExecutor?.catalogId) throw new Error('所选清单连接不存在。');
  return EXECUTOR_CATALOG.map((entry) => {
    const executor = selectedExecutor?.catalogId === entry.id ? selectedExecutor : catalogExecutor(executors, entry.id),
      provider = executor?.id ?? catalogProvider(entry.id);
    const selected = executor?.command ?? settings.paths[provider],
      installed = installedVersions(store.dataDirectory, entry.id);
    const selectedVersion = selected
      ? installed.find(
          (item) =>
            path.resolve(item.entry).toLowerCase() ===
            path.resolve(selected).toLowerCase(),
        )?.version
      : undefined;
    const repair =
      entry.id === "zcode" && !selectedVersion
        ? zcodeRepairVersion(store.dataDirectory, selected)
        : undefined;
    return {
      entry,
      provider,
      installed: installed.map((item) => item.version),
      selectedPath: selected,
      selectedVersion: selectedVersion ?? repair,
      needsRepair: !!repair,
      configured: !!selected,
      consented:
        store.get<{ revision: string }>("catalog_consents", entry.id)
          ?.revision === CATALOG_REVISION,
    };
  });
}
export function catalogCandidate(
  id: CatalogId,
  command: string,
  existing?: AcpExecutor,
  connection?: AcpExecutorId,
): AcpExecutor {
  const entry = catalogEntry(id),
    provider = connection ?? catalogProvider(id);
  // A built-in program (Claude, Codex, DSH) keeps its native connection under a fixed ID;
  // an additional account gets its own executor ID and shares the installed program.
  if (!isAcpId(provider)) throw new Error("内置成员使用原生连接。");
  if (existing && existing.catalogId !== id)
    throw new Error("清单连接编号已被其他配置使用，未覆盖原配置。");
  return {
    ...existing,
    id: existing?.id ?? provider,
    name: existing?.name ?? entry.name,
    command,
    args: [...entry.args],
    env: existing?.env ?? {},
    permissions: existing?.permissions ?? ACP_DEFAULT_PERMISSIONS,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    catalogId: id,
    authentication: existing?.authentication ?? (existing && id === 'zcode' ? 'zai' : entry.authentication[0].id),
  };
}
/** An additional connection of a built-in program keeps its own login directory, never the first connection's.
 *  The program itself is installed once; only credentials and native state are per connection. */
export function nativeConnectionEnvironment(
  entry: CatalogId,
  dataDirectory: string,
  executorId: string,
): Record<string, string> | undefined {
  if (entry !== "claude") return undefined;
  return {
    CLAUDE_CONFIG_DIR: path.join(
      dataDirectory,
      "native",
      "claude",
      "connections",
      executorId,
    ),
  };
}
/** Managed programs never read a user's global login folders or inherit another program's API key. */
export function managedCatalogEnvironment(
  executor: AcpExecutor,
  base: NodeJS.ProcessEnv,
  home: string,
): NodeJS.ProcessEnv {
  const env = { ...base };
  for (const key of Object.keys(env))
    if (
      /^(?:GEMINI|GOOGLE|QWEN|QODER|QODERCN|CURSOR|KIMI|OPENCODE|OPENAI|XAI|MINIMAX|ZCODE|ZAI|ZHIPU|BIGMODEL)_/i.test(
        key,
      )
    )
      delete env[key];
  for (const entry of ALL_EXECUTOR_CATALOG)
    for (const auth of entry.authentication)
      for (const key of auth.secretKeys ?? []) delete env[key];
  Object.assign(env, executor.env, {
    HIVELAB_NODE_CHILD_MODE: "1",
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_DATA_HOME: path.join(home, "data"),
    XDG_STATE_HOME: path.join(home, "state"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    NODE_COMPILE_CACHE: path.join(home, "cache", "node"),
  });
  const entry = executor.catalogId
    ? catalogEntry(executor.catalogId)
    : undefined;
  for (const [key, directory] of Object.entries(
    entry?.profileDirectories ?? {},
  ))
    env[key] = path.join(home, directory);
  if (entry?.providerConfigEnvironment) {
    const auth = entry.authentication.find(
      (item) => item.id === executor.authentication,
    );
    if (auth?.kind === "api")
      env[entry.providerConfigEnvironment] = JSON.stringify({
        enabled_providers: [auth.id],
        provider: {
          [auth.id]: { options: { apiKey: `{env:${auth.secretKeys![0]}}` } },
        },
      });
  }
  if(entry?.id==='antigravity'){
    for(const key of Object.keys(env))if(/^(GEMINI_|GOOGLE_|GCLOUD_|CLOUDSDK_)/i.test(key)||key==='AGY_ADC_AUTH')delete env[key];
    const current=env.PATH??env.Path??'';delete env.Path;env.PATH=path.dirname(executor.command)+path.delimiter+current;
  }
  if(entry?.id==='cursor')return cursorNodeEnvironment(executor.command,{...env,NODE_COMPILE_CACHE:path.join(home,'cache','node')});
  return env;
}
export function catalogAuthentication(executor: AcpExecutor, params: any) {
  const entry = catalogEntry(executor.catalogId),
    auth = entry.authentication.find(
      (item) => item.id === params.authentication,
    );
  if (!auth) throw new Error("请选择清单中支持的登录方式。");
  const env = { ...executor.env },
    secrets: Record<string, string> = {};
  for (const method of entry.authentication) {
    for (const key of method.secretKeys ?? []) delete env[key];
    for (const key of Object.keys(method.environment ?? {})) delete env[key];
  }
  for (const item of ALL_EXECUTOR_CATALOG)
    for (const key of [
      item.modelConfiguration?.environment,
      item.modelConfiguration?.baseUrlEnvironment,
    ])
      if (key) delete env[key];
  Object.assign(env, auth.environment ?? {});
  for (const [key, value] of Object.entries(params.secrets ?? {})) {
    if (
      !auth.secretKeys?.includes(key) ||
      typeof value !== "string" ||
      value.length > 4096
    )
      throw new Error("密钥变量不属于所选登录方式。");
    if (value.trim()) secrets[key] = value.trim();
  }
  const model = String(params.model ?? "")
    .trim()
    .slice(0, 120);
  if(entry.id==='kimi'&&auth.kind==='api'&&/\s/.test(model))throw new Error('Kimi 模型请填写 API Model ID，不要填写显示名称。Kimi Code 的 K3 请填 k3；开放平台以其模型清单为准。');
  if(entry.id==='zcode'&&auth.kind==='api'&&model&&/\s/.test(model))throw new Error('请填写 GLM API 模型 ID，例如 glm-5.3；也可以留空后在对话中选择。');
  if (
    entry.modelConfiguration?.providerPrefix &&
    model &&
    !model.startsWith(auth.id + "/")
  )
    throw new Error(
      "所选模型必须属于当前登录方式，格式为“" + auth.id + "/模型”。",
    );
  if (
    auth.kind === "api" &&
    Object.keys(secrets).length &&
    auth.modelRequired &&
    !model
  )
    throw new Error("请填写这个 API 账号可用的模型。");
  const config = entry.modelConfiguration;
  if (
    config?.baseUrlRequired &&
    Object.keys(secrets).length &&
    !String(params.baseUrl ?? "").trim()
  )
    throw new Error("请填写该 API 账号对应的服务地址。");
  if (config?.environment && model) env[config.environment] = model;
  if (config?.baseUrlEnvironment && params.baseUrl) {
    const url = new URL(String(params.baseUrl));
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("API 服务地址无效。");
    env[config.baseUrlEnvironment] = url.toString().replace(/\/$/, "");
  }
  return {
    executor: {
      ...executor,
      authentication: auth.id,
      env,
      model: config?.persistSelection ? model || undefined : undefined,
      secretKeys: Object.keys(secrets).sort(),
    },
    secrets,
  };
}
export function assertCatalogVersionUnused(
  store: Store,
  settings: Settings,
  id: CatalogId,
  version: string,
) {
  const root = path.resolve(store.dataDirectory, "members", id, version);
  const inside = (file: string | undefined) => {
    if (!file) return false;
    const rel = path.relative(root, path.resolve(file));
    return (
      !rel ||
      (!rel.startsWith(".." + path.sep) &&
        rel !== ".." &&
        !path.isAbsolute(rel))
    );
  };
  if (
    Object.values(settings.paths).some(inside) ||
    store.executors().some((item) => inside(item.command))
  )
    throw new Error("这个版本仍被执行端或人物卡选用，请先切换到其他版本。");
}

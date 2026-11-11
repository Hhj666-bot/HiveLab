import {t} from './i18n';
import type { AcpExecutor, AcpExecutorId, ProviderId } from "./types";
import type { MemberInstallation } from "./member-versions";

export type CatalogId =
  | "claude"
  | "codex"
  | "dsh"
  | "antigravity"
  | "gemini"
  | "qwen"
  | "qoder"
  | "qodercn"
  | "cursor"
  | "kimi"
  | "opencode"
  | "zcode";
export interface CatalogAuthentication {
  id: string;
  label: string;
  kind: "browser" | "api";
  billing?: "subscription" | "metered";
  description?: string;
  secretLabel?: string;
  secretKeys?: string[];
  environment?: Record<string, string>;
  modelRequired?: boolean;
}
export interface ExecutorCatalogEntry {
  id: CatalogId;
  name: string;
  vendor: string;
  homepage: string;
  license: string;
  licenseUrl: string;
  termsUrl: string;
  packageName: string;
  bin: string;
  recommendedVersion: string;
  verifiedVersions: string[];
  minimumNode: string;
  args: string[];
  authentication: CatalogAuthentication[];
  capabilities: string[];
  limitations: string[];
  setupScript?: boolean;
  sources: string[];
  distribution?: "antigravity-official" | "zcode-official" | "qoder-official" | "cursor-official";
  downloadable?: false;
  adapter?: "zcode";
  profileDirectories?: Record<string, string>;
  login?: {
    args: string[];
    domains: string[];
    authenticateAfter?: string;
    viaAcp?: boolean;
    noBrowser?: boolean;
  };
  modelConfiguration?: {
    environment?: string;
    baseUrlEnvironment?: string;
    baseUrlRequired?: boolean;
    providerPrefix?: boolean;
    persistSelection?: boolean;
    resetOnAuthenticationChange?: boolean;
  };
  providerConfigEnvironment?: string;
  managedConfig?: {
    directoryEnvironment: string;
    file: string;
    disableAutoUpdate: true;
  };
}
export const CATALOG_REVISION = "2026-10-09";
/** Reviewed official distributions only. The renderer cannot supply an installation URL or package. */
export const ALL_EXECUTOR_CATALOG: readonly ExecutorCatalogEntry[] = [
  {
    id:'antigravity',name:'Antigravity',vendor:'Google LLC',homepage:'https://antigravity.google/docs/ide/extensions',
    get license(){return t("Google 专有许可")},licenseUrl:'https://antigravity.google/terms',termsUrl:'https://antigravity.google/terms',
    get packageName(){return t("Google 官方 ACP")},bin:'agy_acp_server.exe',recommendedVersion:'1.4.5',verifiedVersions:['1.4.5','1.4.0'],get minimumNode(){return t("原生程序，无需 Node")},args:[],distribution:'antigravity-official',
    authentication:[{id:'oauth-personal',get label(){return t("Google 官方账号登录")},kind:'browser',billing:'subscription',get description(){return t("通过 Google 官方页面授权；每个连接独立保存登录状态。")}}],
    login:{args:[],domains:['google.com','antigravity.google'],viaAcp:true},
    capabilities:['官方 ACP','独立账号','模型选择','原会话恢复','流式回复'],
    limitations:['使用完整 Google 官方发行包并校验 SHA-256 与签名。','登录、会话检查与实际模型回复是不同步骤；保存人物卡的新连接后，请新建话题验证。','若官方要求验证账号，请完成当前官方页面提示后重试。'],
    sources:['https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json','https://antigravity.google/docs/ide/extensions'],
  },
  {
    id: "cursor",
    name: "Cursor CLI",
    vendor: "Anysphere / Cursor",
    homepage: "https://cursor.com/docs/cli/overview",
    get license(){return t("专有许可及随包第三方许可")},
    licenseUrl: "https://cursor.com/terms-of-service",
    termsUrl: "https://cursor.com/terms-of-service",
    packageName: "@anysphere/agent-cli-runtime",
    bin: "agent",
    recommendedVersion: "2026.10.01-e373342",
    verifiedVersions: ["2026.10.01-e373342"],
    get minimumNode(){return t("官方包自带")},
    args: ["--disable-auto-update", "acp"],
    distribution: "cursor-official",
    authentication: [{
      id: "cursor_login", get label(){return t("Cursor 官方账号登录")}, kind: "browser", billing: "subscription",
      get description(){return t("使用 Cursor 账号的套餐额度，与 Cursor 编辑器共享；可用模型和额度由官方账号决定。")},
    }],
    profileDirectories: { CURSOR_CONFIG_DIR: "cursor", CURSOR_DATA_DIR: "data/cursor" },
    login: { args: ["--disable-auto-update", "login"], domains: ["cursor.com"], viaAcp: true },
    capabilities: ["官方 CLI", "ACP 连接", "官方账号订阅额度", "流式回复", "原会话恢复", "提问与计划确认"],
    limitations: [
      "下载 Cursor 官方 Windows x64 程序及其自带运行环境；不安装编辑器，不修改系统 PATH。",
      "账号登录后使用官方可用模型；套餐额度耗尽时需要等待恢复或调整官方套餐。",
    ],
    sources: ["https://cursor.com/docs/cli/installation", "https://cursor.com/docs/cli/acp", "https://cursor.com/docs/cli/reference/authentication", "https://cursor.com/help/models-and-usage/usage-limits"],
  },
  {
    id: "zcode",
    adapter: "zcode",
    login: {
      args: ["login", "--json"],
      domains: ["z.ai", "bigmodel.cn"],
      noBrowser: true,
    },
    name: "ZCode CLI",
    get vendor(){return t("Z.ai / 智谱")},
    homepage: "https://zcode.z.ai/",
    get license(){return t("Apache-2.0 及随包第三方许可")},
    licenseUrl: "https://github.com/zai-org/ZCode/blob/main/LICENSE",
    termsUrl: "https://github.com/zai-org/ZCode/blob/main/NOTICE.md",
    packageName: "@zcode/cli",
    bin: "zcode",
    recommendedVersion: "3.14.5",
    verifiedVersions: ["3.14.5（CLI 0.16.9）"],
    minimumNode: "24.14.0",
    args: [],
    distribution: "zcode-official",
    modelConfiguration: { resetOnAuthenticationChange: true, environment: 'GLM_MODEL', persistSelection: true },
    authentication: [
      { id: "bigmodel", get label(){return t("BigModel 中国区官方账号登录")}, kind: "browser", billing: "subscription", get description(){return t("中国区智谱账号请选择此项，通过 BigModel 官方授权使用对应编程套餐。")} },
      { id: "zai", get label(){return t("Z.ai 海外官方账号登录")}, kind: "browser", billing: "subscription", get description(){return t("海外 Z.ai 账号使用此项；中国区 BigModel 账号请选择国内登录。")} },
      { id: "glm-api-cn", get label(){return t("GLM API Key（BigModel 中国区）")}, kind: "api", billing: "metered", secretKeys: ["GLM_API_KEY"], modelRequired: false, environment: { GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4" }, get description(){return t("直连 BigModel 普通 API，按 API 账户计费。Coding Plan 请使用上方 ZCode 官方账号登录；此入口不使用套餐额度。")} },
      { id: "glm-api-global", get label(){return t("GLM API Key（Z.ai 海外）")}, kind: "api", billing: "metered", secretKeys: ["GLM_API_KEY"], modelRequired: false, environment: { GLM_BASE_URL: "https://api.z.ai/api/paas/v4" }, get description(){return t("直连 Z.ai 普通 API，使用海外站 Key 和该账号可用的模型。与中国站 Key、Coding Plan 套餐分开。")} },
    ],
    capabilities: [
      "官方原生 CLI",
      "文件工具",
      "原会话恢复",
      "原生模型与思考程度选择",
      "实际请求模型核对",
      "完成后一次性显示回复",
      "GLM 普通 API Key 直连（文本流式回复、公共文件工具）",
    ],
    limitations: [
      "从 ZCode 官方 Windows 安装包提取 CLI，并核对官方 SHA-512；不安装 ZCode 桌面应用。",
      "下载版本号对应官方桌面发行版。",
      "写入任务目前要求自动允许命令、任意文件范围及联网；其他权限组合只支持只读对话。",
    ],
    sources: [
      "https://github.com/zai-org/ZCode",
      "https://zcode.z.ai/",
      "https://cdn-zcode.z.ai/zcode/electron/releases/3.14.5/windows-x64/latest.yml",
    ],
  },
  {
    id: "claude",
    name: "Claude Code",
    vendor: "Anthropic",
    homepage: "https://code.claude.com/docs/",
    get license(){return t("专有许可")},
    licenseUrl:
      "https://github.com/anthropics/claude-code/blob/main/LICENSE.md",
    termsUrl: "https://code.claude.com/docs/en/legal-and-compliance",
    packageName: "@anthropic-ai/claude-code",
    bin: "claude",
    recommendedVersion: "2.1.292",
    verifiedVersions: ["2.1.288", "2.1.292"],
    minimumNode: "22.0.0",
    args: [],
    setupScript: true,
    authentication: [
      {
        id: "subscription",
        get label(){return t("订阅登录（官方 Claude Code）")},
        kind: "browser",
        environment: { HIVELAB_CLAUDE_AUTH_MODE: "subscription" },
      },
      {
        id: "api",
        label: "Anthropic API Key",
        kind: "api",
        secretKeys: ["ANTHROPIC_API_KEY"],
        environment: { HIVELAB_CLAUDE_AUTH_MODE: "api" },
      },
    ],
    capabilities: ["原生文件工具", "图片输入", "原会话恢复"],
    limitations: [
      "由用户自行下载官方程序，HiveLab 合屋 安装包不含 Claude Code。",
      "订阅和 API 分别计费。",
    ],
    login: {
      args: ["--restricted", "auth", "login"],
      domains: ["claude.ai", "claude.com", "anthropic.com", "console.anthropic.com"],
    },
    // A relay or a compatible gateway is per connection: each API account keeps its own request address.
    modelConfiguration: { baseUrlEnvironment: "ANTHROPIC_BASE_URL", baseUrlRequired: false },
    sources: [
      "https://code.claude.com/docs/en/authentication",
      "https://registry.npmjs.org/@anthropic-ai/claude-code",
    ],
  },
  {
    id: "codex",
    name: "Codex",
    vendor: "OpenAI",
    homepage: "https://github.com/openai/codex",
    license: "Apache-2.0",
    licenseUrl: "https://github.com/openai/codex/blob/main/LICENSE",
    termsUrl: "https://openai.com/policies/terms-of-use/",
    packageName: "@openai/codex",
    bin: "codex",
    recommendedVersion: "0.160.1",
    verifiedVersions: ["0.160.0", "0.160.1"],
    minimumNode: "16.0.0",
    args: ["app-server"],
    authentication: [
      { id: "subscription", get label(){return t("ChatGPT 官方登录")}, kind: "browser" },
    ],
    capabilities: ["原生文件工具", "图片输入", "原会话恢复"],
    limitations: ["本轮保留已有的 ChatGPT 订阅登录方式。"],
    sources: [
      "https://github.com/openai/codex",
      "https://registry.npmjs.org/@openai/codex",
    ],
  },
  {
    id: "dsh",
    name: "DeepSeek Harness",
    vendor: "DeepSeek",
    homepage: "https://www.npmjs.com/package/@deepseek-ai/dsh",
    license: "MIT",
    licenseUrl: "https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=code",
    termsUrl:
      "https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html",
    packageName: "@deepseek-ai/dsh",
    bin: "dsh",
    recommendedVersion: "0.2.0-rc.2",
    verifiedVersions: ["0.2.0-rc.2"],
    minimumNode: "26.4.0",
    args: ["--profile", "hivelab"],
    authentication: [
      { id: "account", get label(){return t("DeepSeek 官方账号登录")}, kind: "browser" },
    ],
    capabilities: ["ACP", "原生工具", "独立账号目录"],
    limitations: [
      "需要标准 Node.js ≥ 26.4.0；内置环境不兼容时使用经校验的官方便携备用环境。",
    ],
    sources: [
      "https://registry.npmjs.org/@deepseek-ai/dsh",
      "https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=readme",
    ],
  },
  {
    id: "gemini",
    downloadable: false,
    name: "Gemini CLI",
    vendor: "Google",
    homepage: "https://geminicli.com/",
    license: "Apache-2.0",
    licenseUrl: "https://github.com/google-gemini/gemini-cli/blob/main/LICENSE",
    termsUrl: "https://geminicli.com/docs/tos-privacy/",
    packageName: "@google/gemini-cli",
    bin: "gemini",
    recommendedVersion: "0.63.0",
    verifiedVersions: ["0.63.0"],
    minimumNode: "20.0.0",
    args: ["--experimental-acp"],
    authentication: [
      { id: "oauth-personal", get label(){return t("Google 官方浏览器登录")}, kind: "browser" },
      {
        id: "gemini-api-key",
        label: "Gemini API Key",
        kind: "api",
        secretKeys: ["GEMINI_API_KEY"],
      },
    ],
    capabilities: ["ACP", "文件工具", "图片输入由初始化结果确认"],
    limitations: ["组织账号可能需要 Google Cloud 项目。"],
    sources: [
      "https://geminicli.com/docs/cli/cli-reference/",
      "https://geminicli.com/docs/get-started/authentication/",
      "https://registry.npmjs.org/@google/gemini-cli",
    ],
  },
  {
    id: "qoder",
    profileDirectories: { QODER_CONFIG_DIR: "qoder" },
    login: { args: ["login"], domains: ["qoder.com"] },
    managedConfig: {
      directoryEnvironment: "QODER_CONFIG_DIR",
      file: "settings.json",
      disableAutoUpdate: true,
    },
    name: "Qoder CLI",
    get vendor(){return t("Qoder（国际版）")},
    homepage: "https://qoder.com/cli",
    get license(){return t("专有许可")},
    licenseUrl: "https://qoder.com/terms-of-service",
    termsUrl: "https://qoder.com/terms-of-service",
    packageName: "@qoder-ai/qodercli",
    bin: "qoder",
    recommendedVersion: "1.1.66",
    verifiedVersions: ["1.1.66"],
    minimumNode: "20.0.0",
    args: ["--acp"],
    distribution: "qoder-official",
    authentication: [
      {
        id: "qoder",
        get label(){return t("Qoder 官方账号登录")},
        kind: "browser",
        billing: "subscription",
      },
      {
        id: "qoder-token",
        get label(){return t("Qoder 官方个人访问令牌")},
        kind: "api",
        billing: "subscription",
        secretKeys: ["QODER_PERSONAL_ACCESS_TOKEN"],
        get secretLabel(){return t("个人访问令牌")},
        get description(){return t("使用 Qoder 账号的套餐与额度；在官方账号的 Integrations 页面生成个人访问令牌。")},
      },
    ],
    capabilities: ["官方原生 Windows CLI", "ACP", "原会话恢复"],
    limitations: [
      "使用 Qoder 国际版账号的套餐与额度。",
      "登录、配置和会话使用 HiveLab 合屋 独立目录；国内版请另选 Qoder CN CLI，不会将旧会话改绑。",
    ],
    sources: [
      "https://docs.qoder.com/cli/installation",
      "https://docs.qoder.com/cli/authentication",
      "https://docs.qoder.com/cli/acp",
    ],
  },
  {
    id: "qodercn",
    profileDirectories: { QODERCN_CONFIG_DIR: "qoder-cn" },
    login: { args: ["login"], domains: ["qoder.cn", "qoder.com.cn"] },
    managedConfig: {
      directoryEnvironment: "QODERCN_CONFIG_DIR",
      file: "settings.json",
      disableAutoUpdate: true,
    },
    name: "Qoder CN CLI",
    get vendor(){return t("Qoder（国内版）")},
    homepage: "https://qoder.cn/cli",
    get license(){return t("专有许可")},
    licenseUrl:
      "https://terms.alicdn.com/legal-agreement/terms/c_platform_service_agreement/20231023213402278/20231023213402278.html",
    termsUrl:
      "https://terms.alicdn.com/legal-agreement/terms/c_platform_service_agreement/20231023213402278/20231023213402278.html",
    packageName: "@qodercn-ai/qoderclicn",
    bin: "qodercn",
    recommendedVersion: "1.1.67",
    verifiedVersions: ["1.1.67"],
    minimumNode: "20.18.1",
    args: ["--acp"],
    distribution: "qoder-official",
    authentication: [
      {
        id: "qodercn",
        get label(){return t("Qoder CN 官方账号登录")},
        kind: "browser",
        billing: "subscription",
      },
      {
        id: "qodercn-token",
        get label(){return t("Qoder CN 官方个人访问令牌")},
        kind: "api",
        billing: "subscription",
        secretKeys: ["QODERCN_PERSONAL_ACCESS_TOKEN"],
        get secretLabel(){return t("个人访问令牌")},
        get description(){return t("使用 Qoder CN 国内版账号的套餐与额度；令牌在国内版官方账号的 Integrations 页面生成。")},
      },
    ],
    capabilities: ["官方原生 Windows CLI", "ACP", "独立国内版账号"],
    limitations: [
      "使用 Qoder CN 国内版账号；国际版连接和原有会话独立保留。",
      "登录与配置保存在 HiveLab 合屋 独立目录，不读取国际版登录资料。",
    ],
    sources: [
      "https://docs.qoder.cn/cli/installation",
      "https://docs.qoder.cn/cli/acp",
      "https://static.qoder.com.cn/qoder-cli-cn/channels/manifest.json",
    ],
  },
  {
    id: "qwen",
    modelConfiguration: {
      environment: "OPENAI_MODEL",
      baseUrlEnvironment: "OPENAI_BASE_URL",
      baseUrlRequired: true,
    },
    downloadable: false,
    name: "Qwen Code",
    vendor: "Alibaba / Qwen",
    homepage: "https://github.com/QwenLM/qwen-code",
    license: "Apache-2.0",
    licenseUrl: "https://github.com/QwenLM/qwen-code/blob/main/LICENSE",
    termsUrl:
      "https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-product-terms-of-service",
    packageName: "@qwen-code/qwen-code",
    bin: "qwen",
    recommendedVersion: "0.25.0",
    verifiedVersions: ["0.25.0"],
    minimumNode: "22.0.0",
    args: ["--acp"],
    authentication: [
      {
        id: "openai",
        get label(){return t("兼容 API Key")},
        kind: "api",
        secretKeys: ["OPENAI_API_KEY"],
        modelRequired: true,
      },
    ],
    capabilities: ["ACP", "文件工具", "模型配置协商"],
    limitations: [
      "旧 Qwen OAuth 已停用；按官方 API 或 Token Plan 配置。",
      "API 模型和服务地址需与所用账号一致。",
    ],
    sources: [
      "https://github.com/QwenLM/qwen-code/blob/main/docs/users/quickstart.md",
      "https://registry.npmjs.org/@qwen-code/qwen-code",
    ],
  },
  {
    id: "kimi",
    profileDirectories: { KIMI_CODE_HOME: "kimi-code" },
    login: {
      args: ["acp", "--login"],
      domains: ["kimi.com", "kimi.ai"],
      authenticateAfter: "login",
    },
    modelConfiguration: { environment: "KIMI_MODEL_NAME", persistSelection: true, resetOnAuthenticationChange: true },
    name: "Kimi Code CLI",
    vendor: "Moonshot AI",
    homepage: "https://moonshotai.github.io/kimi-code/",
    license: "MIT",
    licenseUrl: "https://github.com/MoonshotAI/kimi-code/blob/main/LICENSE",
    termsUrl: "https://www.kimi.com/user/agreement/en/modelUse",
    packageName: "@moonshot-ai/kimi-code",
    bin: "kimi",
    recommendedVersion: "2.1.1",
    verifiedVersions: ["2.1.1"],
    minimumNode: "22.19.0",
    args: ["acp"],
    setupScript: true,
    authentication: [
      {
        id: "kimi-code",
        get label(){return t("Kimi Code 会员登录")},
        kind: "browser",
        billing: "subscription",
        get description(){return t("通过 Kimi 官方网页授权，使用包含 Kimi Code 额度的会员权益。新 Go 会员不含编程额度。")},
      },
      {
        id: "kimi-api",
        get label(){return t("Moonshot 开放平台 API Key（国际站）")},
        kind: "api",
        billing: "metered",
        get description(){return t("用于 platform.kimi.ai / platform.moonshot.ai 的国际站开放平台 Key；会员 Key 请选 Kimi Code 入口。模型填写 API Model ID。")},
        secretKeys: ["KIMI_MODEL_API_KEY"],
        modelRequired: false,
        environment: {
          KIMI_MODEL_PROVIDER_TYPE: "kimi",
          KIMI_MODEL_BASE_URL: "https://api.moonshot.ai/v1",
        },
      },
      {
        id: "kimi-api-cn",get label(){return t("Moonshot 开放平台 API Key（中国站）")},kind: "api",billing: "metered",
        get description(){return t("用于 platform.kimi.com / platform.moonshot.cn 的中国站开放平台 Key。K3 的 API Model ID 为 kimi-k3。")},
        secretKeys: ["KIMI_MODEL_API_KEY"],modelRequired: false,
        environment: {KIMI_MODEL_PROVIDER_TYPE: "kimi",KIMI_MODEL_BASE_URL: "https://api.moonshot.cn/v1"},
      },
      {
        id: "kimi-code-key",get label(){return t("Kimi Code 会员 Key（中国站）")},kind: "api",billing: "subscription",
        get description(){return t("用于 Kimi Code 控制台生成的会员 Key。模型填写 k3、kimi-for-coding 或 kimi-for-coding-highspeed；以账号权益为准。")},
        secretKeys: ["KIMI_MODEL_API_KEY"],modelRequired: false,
        environment: {KIMI_MODEL_PROVIDER_TYPE: "kimi",KIMI_MODEL_BASE_URL: "https://api.kimi.com/coding/v1"},
      },
      {
        id: "kimi-code-key-global",get label(){return t("Kimi Code 会员 Key（海外站）")},kind: "api",billing: "subscription",
        get description(){return t("用于 Kimi Code 海外站会员 Key，连接 api.kimi.ai。模型填写 API Model ID，例如 k3。")},
        secretKeys: ["KIMI_MODEL_API_KEY"],modelRequired: false,
        environment: {KIMI_MODEL_PROVIDER_TYPE: "kimi",KIMI_MODEL_BASE_URL: "https://api.kimi.ai/coding/v1"},
      },
    ],
    capabilities: ["ACP", "文件工具", "图片能力由初始化结果确认"],
    limitations: [
      "Windows 文件命令依赖 Git Bash。",
      "API 使用 KIMI_MODEL_* 临时凭据入口，不向配置文件写入 Key。",
    ],
    sources: [
      "https://moonshotai.github.io/kimi-code/en/guides/getting-started",
      "https://moonshotai.github.io/kimi-code/en/configuration/env-vars.html",
      "https://registry.npmjs.org/@moonshot-ai/kimi-code",
    ],
  },
  {
    id: "opencode",
    providerConfigEnvironment: "OPENCODE_CONFIG_CONTENT",
    modelConfiguration: {
      providerPrefix: true,
      persistSelection: true,
      resetOnAuthenticationChange: true,
    },
    name: "OpenCode",
    vendor: "Anomaly",
    homepage: "https://opencode.ai/",
    license: "MIT",
    licenseUrl: "https://github.com/anomalyco/opencode/blob/dev/LICENSE",
    termsUrl: "https://opencode.ai/legal/terms-of-service",
    packageName: "opencode-ai",
    bin: "opencode",
    recommendedVersion: "1.18.35",
    verifiedVersions: ["1.18.35"],
    minimumNode: "22.0.0",
    args: ["acp"],
    setupScript: true,
    authentication: [
      {
        id: "opencode-go",
        get label(){return t("OpenCode Go / Go Plus 订阅")},
        kind: "api",
        billing: "subscription",
        secretKeys: ["OPENCODE_API_KEY"],
        get description(){return t("使用 OpenCode Console 中的 Go / Go Plus 订阅密钥，消耗订阅额度。")},
      },
      {
        id: "kimi-code-plan-cn",
        get label(){return t("Kimi Code 会员额度（中国站）")},
        kind: "api",
        billing: "subscription",
        secretKeys: ["KIMI_API_KEY"],
        get description(){return t("使用 Kimi Code Console 的专用密钥与会员编程额度；Moonshot 平台的按量密钥不适用。")},
      },
      {
        id: "kimi-code-plan-global",
        get label(){return t("Kimi Code 会员额度（国际站）")},
        kind: "api",
        billing: "subscription",
        secretKeys: ["KIMI_API_KEY"],
        get description(){return t("使用 Kimi 国际站 Code Console 的专用密钥与会员编程额度。")},
      },
      {
        id: "zai-coding-plan",
        label: "Z.ai GLM Coding Plan",
        kind: "api",
        billing: "subscription",
        secretKeys: ["ZAI_API_KEY"],
        get description(){return t("使用 Z.ai Coding Plan 的密钥与订阅额度。")},
      },
      {
        id: "zhipuai-coding-plan",
        get label(){return t("智谱 GLM Coding Plan（中国站）")},
        kind: "api",
        billing: "subscription",
        secretKeys: ["ZHIPU_API_KEY"],
        get description(){return t("使用智谱开放平台 Coding Plan 专用密钥与订阅额度。")},
      },
      {
        id: "minimax-coding-plan",
        get label(){return t("MiniMax Coding Plan（国际站）")},
        kind: "api",
        billing: "subscription",
        secretKeys: ["MINIMAX_CODING_PLAN_API_KEY"],
        get description(){return t("使用 MiniMax Coding Plan 的专用密钥与订阅额度。")},
      },
      {
        id: "minimax-cn-coding-plan",
        get label(){return t("MiniMax Coding Plan（中国站）")},
        kind: "api",
        billing: "subscription",
        secretKeys: ["MINIMAX_CODING_PLAN_API_KEY"],
        get description(){return t("使用 MiniMax 中国站 Coding Plan 的专用密钥与订阅额度。")},
      },
      {
        id: "opencode",
        get label(){return t("OpenCode Zen（按量）")},
        kind: "api",
        billing: "metered",
        secretKeys: ["OPENCODE_API_KEY"],
      },
      {
        id: "xai",
        label: "Grok / xAI API Key",
        kind: "api",
        secretKeys: ["XAI_API_KEY"],
      },
      {
        id: "minimax",
        label: "MiniMax API Key",
        kind: "api",
        secretKeys: ["MINIMAX_API_KEY"],
      },
      {
        id: "anthropic",
        label: "Anthropic API Key",
        kind: "api",
        secretKeys: ["ANTHROPIC_API_KEY"],
      },
      {
        id: "openai",
        label: "OpenAI API Key",
        kind: "api",
        secretKeys: ["OPENAI_API_KEY"],
      },
    ],
    capabilities: ["ACP", "多家模型提供方", "文件工具"],
    limitations: [
      "HiveLab 合屋 使用官方命令行程序，不能使用桌面 OpenCode.exe 充当 ACP 程序。",
      "订阅密钥使用所选套餐额度；按量 API 单独计费。",
    ],
    sources: [
      "https://opencode.ai/docs/",
      "https://opencode.ai/docs/acp/",
      "https://opencode.ai/docs/providers/",
      "https://registry.npmjs.org/opencode-ai",
    ],
  },
];
export const EXECUTOR_CATALOG = ALL_EXECUTOR_CATALOG.filter(
  (entry) => entry.downloadable !== false,
);
export function catalogEntry(id: unknown): ExecutorCatalogEntry {
  const entry = ALL_EXECUTOR_CATALOG.find((item) => item.id === id);
  if (!entry) throw new Error(t("执行端不在内置清单中，请使用手动添加。"));
  return entry;
}
export const catalogProvider = (id: CatalogId): ProviderId =>
  ["claude", "codex", "dsh"].includes(id)
    ? (id as ProviderId)
    : (`acp-catalog${id}` as AcpExecutorId);
/** Catalog entries identify programs; executor IDs identify independent accounts/connections. */
export function catalogExecutor(executors: AcpExecutor[], id: CatalogId, executorId?: unknown): AcpExecutor | undefined {
  if (executorId !== undefined) {
    const executor = executors.find(item => item.id === executorId);
    if (!executor || executor.catalogId !== id) throw new Error(t("所选连接不属于这个清单执行端，请刷新后重试。"));
    return executor;
  }
  return executors.find(item => item.id === catalogProvider(id) && item.catalogId === id)
    ?? executors.find(item => item.catalogId === id);
}
export interface CatalogStatus {
  entry: ExecutorCatalogEntry;
  provider: ProviderId;
  installed: string[];
  selectedVersion?: string;
  configured: boolean;
  consented: boolean;
  installation?: MemberInstallation;
  selectedPath?: string;
  needsRepair?: boolean;
}
export interface NodeRuntimeInfo {
  source: "bundled" | "local" | "portable";
  version: string;
  available: boolean;
  local?: { version: string; available: boolean; detail?: string };
  detail?: string;
}
export interface CatalogLoginState {
  phase: "starting" | "waiting" | "checking" | "completed" | "failed" | "cancelled";
  message: string;
  url?: string;
  code?: string;
}

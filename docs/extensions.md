# HiveLab 合屋 插件与 Skills

进入 **设置与连接 → 扩展分类 → 插件 / Skills**，两者独立管理。设置侧栏分为工作室、执行端、扩展三个分组。每页支持搜索、启用状态与来源筛选、排序及每页 12 / 24 / 48 项分页，工具名和位置默认折叠。扩展独立保存，按钮点击后立即保存，不需要点设置页底部的“保存设置”。安装、启停和卸载只在成员空闲时进行，忙碌时拒绝本次修改，不中断任务；下一次任务使用新配置。

Skills 页现已按 **Codex / Claude Code / DSH / HiveLab 合屋 通用** 分组。Codex 原生安装的 Humanizer 等技能直接在 Codex 组显示，无需重复导入；下文的 Skill 工具桥接口和导入说明对应“HiveLab 合屋 通用”组。具体管理范围与开发接口见[按执行端管理 Skills](skills.md)。

## 插件应该按什么区分？

按执行端生态和运行层区分，不按人物卡或模型名称区分。Astra、Sol 都通过 Codex 工作时，通常共享该执行端的扩展；使用不同执行端的成员不能假定通用。

- **HiveLab 合屋 本体插件**：背景、预览、用量等界面功能，由本体加载。
- **HiveLab 合屋 工具桥插件**：使用 `hivelab-plugin.json`，由 HiveLab 合屋 提供给兼容 Agent。默认可用于支持该工具桥的执行端；开发者可通过 `agents` 声明只用于特定执行端。
- **原生插件**：Codex、DSH / Cordis、Claude Code 各有插件配置、生命周期、hooks 或内置工具要求。插件页的“原生 Agent 插件”分栏现在接管这三家的安装、列表、启停与卸载。GitHub 只是下载来源，并不能证明插件格式兼容。详见[原生插件使用说明](native-plugins.md)。
- **Skill / MCP**：标准技能和 MCP 服务有机会复用，但仍依赖实际工具、协议、权限、配置和执行端版本。工具桥插件、原生 MCP 配置和原生插件包不是同一种安装格式。

插件页分“原生 Agent 插件”和“HiveLab 合屋 插件”。后者可筛选“HiveLab 合屋 本体”“通用工具桥”和 Codex / DSH / Claude Code / ACP 可用工具。这些筛选只展示 HiveLab 合屋 格式插件。选择 `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json` 或 DSH / Cordis 包时，应转到原生分栏选择对应执行端，不能当作 HiveLab 合屋 工具桥脚本执行。Skills 始终独立管理。

## 当前接口检查结果与迁移

原有代码具有各执行端原生的 MCP / ACP 接入，DeepSeek Harness 自身也有插件机制，但没有 HiveLab 合屋 本体的统一插件管理或 Skill 包管理。本次新增 Plugin API v1，继续调用原生 Codex / DSH / ACP Agent，不替换它们的执行循环。

八个随本体安装的插件：工作室协作、交互确认、文件交付、电脑操作、原生生图、文件与图片预览、每日用量、页面背景。插件清单注册其工具和功能，由注册表决定向 Agent 暴露哪些工具、允许哪些入口。停用后对应扩展工具或功能停止提供；历史消息、成果下载、用量记录和背景配置保留，重新启用即可恢复。

“工作室协作”提供 `open_browser({url})`，接受完整的 HTTP/HTTPS 地址，将网页显示在应用内右侧浏览器。该工具通过当前任务的 MCP 授权调用桌面服务；返回侧栏显示状态、地址和标题。网页加载情况由侧栏展示，网页内容读取和交互由执行端已有的浏览器工具承担。

权限审批、账号连接、会话存储、消息传递、附件粘贴、窗口适配与原生 Agent 的执行/补充指令协议是本体基础设施，继续由本体负责。立绘、人物关系和语气是已有用户数据，不因迁移重置。本次没有把这些基础设施改为可卸载插件。原生 Agent 仍可能拥有自己的电脑/文件/搜索工具；停用 HiveLab 合屋 同名插件不等于禁用该 Agent 的全部原生工具，应通过权限设置控制。

## 安装和管理

- **安装插件目录**：选择解压后包含 `hivelab-plugin.json` 的单个目录。先看安装预览，再确认安装。带脚本的插件需要勾选信任。
- **安装 / 导入 Skill**：选择包含 `SKILL.md` 的单个技能目录。其 references、scripts、assets 等支持文件一起复制。
- **启停**：插件或技能的开关独立保存，下次任务生效。内置扩展可以停用；本地扩展先停用后卸载。
- **更新 HiveLab 合屋 工具桥插件和导入的 Skill**：先停用并卸载旧版本，再安装新版本。这两个格式的安装器没有自动依赖安装或在线市场；原生插件通过独立分栏调用原生安装器，可能下载依赖。
- HiveLab 合屋 工具桥插件和导入 Skill 的包上限为 20 MB / 1000 个文件，不接收链接、`.git` 或 `node_modules`。请先在资源管理器解压 ZIP，选择单个扩展目录。原生安装器的限制见其独立说明。
- 用户扩展及开关保存在 `D:\HiveLab\local-data\data\extensions`，程序更新不会覆盖。内置插件清单、技能和示例随本体存放在 `D:\HiveLab\runtime\resources\app\dist\extensions`。
- 当前聊天资料备份没有包含用户扩展目录；如需迁移或备份技能与插件，另行复制整个 `extensions` 目录。

## Codex 已安装的技能能用吗？

兼容的 `SKILL.md` 技能可以导入。HiveLab 合屋 的 Codex 使用独立的 `HIVELAB_CODEX_HOME`，因此不能把桌面端“已安装”当作 HiveLab 合屋 已发现。可从 `%USERPROFILE%\.codex\skills\<技能名>`、`.agents\skills` 或对应插件的技能目录选择一个技能，导入副本。不会复制 Codex 登录文件、配置或 API Key；原目录升级不会自动更新副本。

HiveLab 合屋 会在任务开始时提供技能名称和描述，由成员根据任务通过 `read_skill` 按需读取正文，通过 `read_skill_asset` 读取参考文件。索引通过同一接口传给 Codex、DSH 及支持 HiveLab 合屋 工具的 ACP 执行端；没有文件/工具调用能力的执行端无法保证执行脚本或调用额外工具。也可以直接要求“使用某某 skill”。

Skill 是工作方法，不是工具安装器。依赖 Codex 桌面专属工具、MCP、外部软件、Python 库或账户的技能仍需要这些能力；安装时不会自动获取它们。项目目录中由原生 Agent 自己发现的技能继续遵循执行端规则，不由此管理页统一启停。原生发现与 HiveLab 合屋 导入副本是两条独立路径，避免重复安装相同技能。

格式参考：[OpenAI Skills](https://developers.openai.com/plugins/concepts/skills)。

## 插件开发接口 v1

参考程序目录 `dist/extensions/examples/hello-plugin`。无需改 HiveLab 合屋 源码即可安装新的工具插件。

`hivelab-plugin.json` 必需字段：`apiVersion: 1`、`id`（小写短横线名称，最多 48 字符）、`name`、`description`、`version`、`entry`（包内 `.mjs/.cjs/.js`）、`tools`（最多 32 个）。工具提供 `name`（小写字母、数字及下划线，最多 32 字符）、`description` 和 JSON Schema `inputSchema`（object）。发布名称会加包命名空间以避免冲突，以 tools/list 实际返回为准。外部插件不能声明本体界面功能、覆盖内置工具或绕过审批。

可选 `agents` 兼容范围示例：`["codex"]`、`["dsh"]`、`["claude"]`、`["codex","dsh"]`、`["acp"]` 或特定 `acp-xxx` ID。不提供该字段保持旧版通用工具桥行为；空数组与未知值会被拒绝。提供该字段后，工具发现、HTTP 调用及实际执行都会按当前任务的执行端检查范围，不能通过手动写工具名绕过。它只限制 HiveLab 合屋 工具桥插件的分发，不能把 Codex / DSH / Claude Code 原生包自动转换为通用格式。

HiveLab 合屋 使用自己的 Node/Electron Node 模式启动入口，工作目录为插件目录。每次调用为独立进程，通过 stdin 发送一个 JSON：

```json
{"apiVersion":1,"tool":"greet","arguments":{"name":"老大"},"context":{"sessionId":"...","runId":"..."}}
```

stdout 必须只输出一个 JSON 响应并退出：

```json
{"result":{"message":"你好，老大！"}}
```

失败输出 `{"error":"原因"}`。诊断日志写 stderr，不混入 stdout。标准库可直接使用，不自动安装 npm 依赖。结果通过现有 HiveLab 合屋 MCP/CLI 工具桥返回给原生 Agent。插件调用会出现在“思考与操作”中，60 秒超时或任务取消会终止入口进程。插件不应自行创建脱离主进程的后台任务。

插件进程不会获得 HiveLab 合屋 控制令牌和模型密钥环境变量，但仍以当前 Windows 用户运行，**独立进程不等于系统沙箱**。完全访问模式按既有授权运行；其他模式每次调用外部插件都需要用户批准。不要安装不信任的代码。权限等级、电脑操作提示条和原生执行端限制仍由本体管理，不能由插件清单覆盖。

## Skill 接口 v1

Skill 采用目录形式，必需文件 `SKILL.md`：

```markdown
---
name: example-skill
description: 用户明确要求整理任务时使用。
---

按目标、现状、下一步三项组织答案。
```

支持普通/引号标量以及 description 的 `>` / `|` 多行形式；其他元数据字段保留在原文中但不作为接口配置解析。主文件上限 256 KB；单个按需读取的文本资源上限 1 MB。二进制资源不通过文本读取工具返回。脚本文件只保存和读取，不会因安装或加载技能自动运行。

工具：`skills` 列出启用技能；`read_skill({id})` 读取正文；`read_skill_asset({id,path})` 读取包内参考，禁止路径越界和链接。

随本体提供 `team-handoff` 交接技能及未安装的 `example-skill` 示例。新技能不需要重新编译本体。

# 按执行端管理 Skills

入口：**设置与连接 → Skills**。分为 **Codex / Claude Code / DSH / HiveLab 合屋 通用**，默认打开 Codex。同用一个执行端环境的人物共享技能，例如 Sol 与 Astra 都使用 HiveLab 合屋 的 Codex 环境，不需要各装一份。

## Codex

列表直接读取 Codex 原生 `skills/list`，包括当前独立环境返回的个人、系统及插件技能，显示真实启用状态。已经安装的 Humanizer 会出现，原生标识可能为 `humanizer:humanizer`；没有重复导入 HiveLab 合屋 通用目录。

- 支持搜索、启用状态与来源筛选，以及每页 12 / 24 / 48 项分页。
- “安装 Codex Skill”选择含 `SKILL.md` 的本地目录，预览后确认。需要 GitHub 技能时先下载并解压到本机，选择实际技能目录。本次没有新增在线 Skill 搜索或 GitHub 下载表单。
- 安装到 HiveLab 合屋 独立 `CODEX_HOME/skills`，不会安装到桌面 Codex、DSH、Claude 或通用技能目录。资源文件一起复制，忽略 `.git` 和 `node_modules`，不执行安装脚本。
- 个人技能可以启停，修改写进 Codex 原生配置，下次任务生效。系统技能不可在此启停或卸载。插件技能可用的单项开关以原生端返回为准，卸载插件请到“原生 Agent 插件”。
- 卸载个人技能必须先停用，再展开“详情与管理”确认；副本移到 `D:\HiveLab\local-data\data\native-skills\removed\<编号>`，以便恢复。不会删除系统或插件目录。重装同路径技能会重新写入启用配置。
- 任务运行时拒绝安装 / 启停 / 卸载，提示等待，不会结束任何成员。只读查看不要求退出 HiveLab 合屋。

## Claude Code 与 DSH

本轮展示各自独立 home 下的 `skills/<名称>/SKILL.md`。这两组标记“已发现 · 未确认加载”，不将文件存在当成原生运行时已启用。未就绪的执行端仍可查看已保存的个人目录。

项目目录、内置技能、插件运行时注册技能可能不在这些扫描结果中；空列表不等于执行端完全没有技能。本轮尚未接管这两家的技能安装和启停；不要通过复制到 Codex 分组来“转用”依赖特定执行端的技能。插件附带技能继续由对应原生插件管理。

## HiveLab 合屋 通用

保留已有 `team-handoff` 和用户导入的技能，仍提供搜索、筛选、分页、安装、启停与卸载。通用技能由 HiveLab 合屋 工具桥按需提供给兼容成员，和执行端原生技能独立管理。把 Codex 原生技能显示出来，不会自动创建一份通用副本。

## 开发交接

源码入口：

| 文件 | 责任 |
| --- | --- |
| `src/shared/native-skills.ts` | 分组目录、条目、预览类型 |
| `src/backend/native-skills.ts` | Codex 原生列表 / 配置、个人技能快照安装和归档卸载；Claude / DSH 个人目录只读扫描 |
| `src/backend/native-plugins.ts` | 复用现有 CLI、独立 home、归属进程与 RPC；新增 `codexSkills` / `configureCodexSkill` |
| `src/backend/extensions.ts` | 导出已有 Skill 元数据解析器，通用技能行为保持原样 |
| `src/backend/engine.ts` | `nativeSkills.*` 路由、忙碌保护、扩展代次与调度互斥 |
| `src/main/main.ts` | 技能目录选择与打开；不接受任意文件执行请求 |
| `src/renderer/agent-skills.tsx` | 四组入口、原生技能列表、筛选分页、预览和操作 |
| `src/renderer/extensions.tsx` | Skills 页面接入分组壳，保留通用管理组件 |

RPC：`nativeSkills.list({provider})`、`preview({provider,path})`、`install({token})`、`toggle({provider,id,enabled})`、`remove({provider,id})`、`pick()`、`folder({provider,id?})`。原生端 ID 只允许 codex / claude / dsh。打开目录时主进程重新从目录返回值解析条目，不信任界面传来的绝对路径。

Codex 启停调用 `skills/config/write({path,enabled})`。ID 为原生技能绝对路径的摘要，操作前重新读取原生列表，不能用自造 ID 修改任意文件。系统技能只读；卸载只能作用于独立技能根目录的直接子目录，拒绝链接、系统和插件技能。安装预览 30 分钟有效，复制前后验证内容快照，上限沿用原生来源的 100 MB / 10000 文件 / 24 层；先在发现根目录外完成复制，再原子移动，防止发现半成品。

NativeSkills 修改期间复用 `configurationTask`，暂停新任务调度，与原生插件修改互斥；完成后递增 `extensionEpoch`，使后续任务不复用旧扩展配置。失败不伪造启用成功，需刷新原生状态核对。插件和 Skills 没有自动升级。

验证命令（在源码根目录运行）：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node --import ./scripts/test-bootstrap.mjs --import tsx --test tests/native-skills.test.ts
node --import ./scripts/test-bootstrap.mjs tests/ui/agent-skills-smoke.mjs
node --import ./scripts/test-bootstrap.mjs tests/ui/extensions-smoke.mjs
node scripts/build.mjs
node --import ./scripts/test-bootstrap.mjs tests/extensions-electron-smoke.mjs
```

真实 Codex 无登录、无模型回归覆盖安装、启停、归档卸载、重装重新启用、受保护作用域、来源变化与三家目录隔离。UI 模拟覆盖 Humanizer 展示、分页筛选、Codex 操作、DSH 未确认状态、通用技能保持和 540px 窄窗。真实用户目录只读核对 Humanizer 的路径、启用状态和管理能力，不做真实技能装卸。没有付费模型任务。

日常程序替换前仍须用户从托盘退出；更新器不杀进程。更新包 / 最终回执：`D:\HiveLab\local-data\updates\2026-10-18-agent-skills`，实际安装提交与文件哈希以该目录回执和日常程序 `build-manifest.json` 为准。用户人物卡、聊天、登录和已装 Humanizer 不因界面更新迁移。

参考：Claude Code 的[技能说明](https://code.claude.com/docs/en/skills)；DSH 0.2.0-rc.2 的 `@deepseek-ai/dsh-skill-filesystem/README.md` 和实现。这里刻意区分原生 API 已确认状态与目录观察结果，后续完整接管 Claude / DSH 时不要把两者合并成一个布尔值。

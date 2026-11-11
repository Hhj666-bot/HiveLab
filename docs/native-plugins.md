# Codex、DSH、Claude Code 原生插件

入口：**设置与连接 → 插件 → 原生 Agent 插件**。选择 Codex、Claude Code 或 DSH；“HiveLab 合屋 插件”和“Skills”仍各自管理。本轮只接入这三家。

## 安装现成插件

1. 选择插件所属的执行端。同一执行端下的人物卡共享插件，例如同为 Codex 的 Astra 和 Sol 不用重复安装。
2. 点“安装现成插件”。本地 ZIP 先解压，选择插件目录或插件市场目录；也可填写 GitHub 仓库根地址 `https://github.com/作者/仓库`。仓库中的单个插件放在子目录时，填写“仓库内子目录”。GitHub 入口需要本机 Git 可用。
3. DSH 还可以选择 npm 包，填写 `包名`、`@组织/包名` 或带版本号的形式。预览会固定实际版本。
4. 点“读取安装预览”，核对插件名称；市场中有多个插件时选择其中一个。勾选信任来源，再确认安装。
5. 等操作结束。列表来自对应的原生执行端；成功后下一次成员任务生效。列表支持搜索、启用、停用、卸载；卸载有二次确认。

成员正在执行任务时，修改会被拒绝并提示等待，不会为了安装插件停止成员。安装开始后暂时不能开始新的成员任务。安装记录可查看原生诊断输出，也可以取消正在进行的操作。取消或失败后应刷新原生列表核对实际结果；取消不等于回滚已完成的安装步骤。

## 三种原生机制

| 执行端 | 可识别来源 | 安装和加载方式 |
| --- | --- | --- |
| Codex | `.codex-plugin/plugin.json`；原生插件市场 `.agents/plugins/marketplace.json`；兼容清单最终由原生端校验 | 原生 `plugin` 命令安装，app-server 读取实际安装状态与写启用配置 |
| Claude Code | `.claude-plugin/plugin.json`；`.claude-plugin/marketplace.json` | 原生 `plugin` 命令，用户范围；任务启动显式传入已启用插件，保留 HiveLab 合屋 审批桥 |
| DSH | 有合法 `package.json` 的 DSH bundle / Cordis 包、npm 包 | DSH 自己的 `plugin add/remove` 和 profile 层；配置后由原生 Cordis 加载 |

单个 Codex / Claude 插件不必自己准备市场清单：HiveLab 合屋 会保留插件原目录内容，生成本地市场包装，再调用原生安装器。第三方插件中使用的 hooks、MCP、agents 等是否能运行，仍取决于该执行端版本、账号、运行依赖及插件本身。HiveLab 合屋 的插件安装成功不等于第三方服务已登录。

DSH bundle 安装后加入原生 profile。普通 Cordis 包先作为依赖安装，在列表点“Cordis 配置”，按插件作者文档填模块名和 JSON 配置，再“保存配置并启用”。模块名允许包本身或包内子路径，不猜测插件配置字段。配置会以原生配置形式保存在本机数据目录。基础 DSH / ACP 组件不在可卸载插件列表中。

DSH 首次管理插件会在 HiveLab 合屋 数据目录准备固定版本 pnpm 10.28.2；检查版本与发布锁文件校验值后，用它调用原生包管理接口。它不会替换用户项目的依赖。原生插件自己安装依赖、执行安装脚本的行为属于所确认信任的来源。

## 数据与备份

程序在 `D:\HiveLab\runtime`，原生管理记录和来源副本在 `D:\HiveLab\local-data\data\native-plugins`。执行端数据目录以管理页“执行端数据目录”打开的实际路径为准：使用 HiveLab 合屋 独立的 Codex、Claude、DSH home，而非默认接管桌面应用的全部插件。

- `sources` 保存下载 / 复制的来源；`marketplaces` 按内容校验值保存固定位置的本地市场，让卸载后重装同一插件不因市场路径变化失败。已安装市场会引用这里，**不要清理这些目录来卸载插件**。
- `jobs.json` 保存最近 30 项操作结果和脱敏诊断；重启不会自动重试失败 / 中断的操作。
- `claude-runtime.json` 保存原生列表同步出的启用标识；`dsh-bundles.json`、`dsh-overrides.json` 保存获准 bundle 和普通插件配置。
- 备份需同时包含 `native-plugins` 和对应执行端 home。现有聊天备份不能替代这一完整插件备份。

## 当前范围

支持本地目录、公开 GitHub 仓库根地址（可选子目录），以及 DSH 的 npm 包。暂不提供 ZIP 直接导入、私有 GitHub 交互登录、任意 Git 地址、任意 ACP / Gemini 插件接口、自动更新、市场统一搜索或自动补全第三方登录。原生端要求额外确认 / 授权或版本不支持时显示实际错误，不跳过原生检查。

本地和 GitHub 来源快照上限 100 MB / 10000 个文件，忽略 `.git`、`node_modules`，拒绝链接和特殊文件。需要预先编译的插件，请选择作者的可安装发布目录；只提供源码并依赖已有 `node_modules` 的目录不保证可安装。

原生插件是可执行代码，使用对应执行端自己的加载机制；并非 HiveLab 合屋 工具桥的沙箱。安装信任确认可能允许其 hooks / 依赖脚本在任务前运行，不能假定所有原生 hook 都逐条经过 HiveLab 合屋 工具审批。成员权限继续控制其现有工具，但请只安装可信插件。该确认是安装流程的一部分，不需要为每个人物重复安装同一插件。

参考机制：[Codex 插件打包](https://developers.openai.com/plugins/build/plugins)、[Claude Code 插件清单](https://code.claude.com/docs/en/plugins-reference)、[DeepSeek Harness 源码](https://github.com/deepseek-ai/deepseek-harness)。本机适配以开发交接中的已验证版本为准。

## DSH 安装插件后出现 Internal error / unknown session

2026-10-18 修复了 HiveLab 合屋 工具桥的一处初始化错误：DSH 启动 MCP 子进程时不保证继承任意环境变量，旧桥接声明只传了 Node 模式，没有明确传递本轮的工具桥临时授权，所以会话在回答前就失败。停用插件也会复现，不能仅据安装时间判断是插件不兼容。

修复版明确传递本轮 loopback 地址和临时令牌，不传模型密钥；恢复原生会话失败时不再尝试关闭尚未确认打开的会话，并保留原生错误里的 details。修复不修改人物卡、聊天、登录或插件启停状态。升级后可在原话题重试，不必删除历史或重新登录。此修复验证了无登录 DSH 的工具桥初始化与新建 / 恢复 / 关闭会话，没有发送模型 prompt；具体插件工具仍需用户实际任务验证。

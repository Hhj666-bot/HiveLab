# 运行诊断（AR-01）

## 使用入口

- 在工位或成员活动里展开“思考与操作”，再展开“运行诊断”，读取所选运行的记录。
- 在“设置与连接 → 连接与版本”中展开“连接与运行诊断”，读取当前执行端的配置与最近连接记录。
- 点击“刷新诊断”重新读取。查询不会登录、修改权限、发送模型任务、执行 Hook 或重发运行。

诊断分为程序与连接、账号、会话与配置、任务投递、工具权限、技能与 Hook 六部分。每项有状态、原因、来源和记录时间；来源没有提供时间时明确显示。读取时间与来源记录时间分别展示。

## 记录的含义

- **配置记录**：保存了请求或配置，不能单独证明原生执行效果。
- **有记录**：找到了对应运行、事件或原生回报，具体证明范围见该项说明。
- **记录待刷新**：沿用执行端已有的 stale 状态，不把旧连接检查当成当前检查。
- **未确认**：没有足够证据，不补造默认结论。

新的运行在工作目录准备完成、派发给适配器之前保存 `Run.diagnosticContext`：实际目录、独立 home、有效成员权限和本轮写入/审批设置。适配器确认原生会话后，native ID 绑定到同一运行。历史记录缺少快照时保持“未记录”，不会读取后来改过的设置或新会话 ID 来补写。

界面只在用户展开后读取，切换运行时隔离迟到响应。后端只取所选运行最近的身份、错误和问题事件，不载入完整模型正文或媒体历史。

## Stop That Shit 首版支持范围

首版读取 Codex 独立 home 中的已知格式：

- `config.toml` 中 `plugins."stop-that-shit@stop-that-shit".enabled` 的明确布尔配置；不把配置等同于原生加载/信任。
- `plugins/data/stop-that-shit-stop-that-shit/sessions/<原生会话 ID 的 SHA-256 前 24 位>.json` 中 schema 4 的合同字段。
- 同一插件目录 `runtime/<相同摘要>.jsonl` 中 schema 1 的有限日志尾部，按同一原生会话及运行起止时间筛选调用与政策拒绝/询问。

合同是当前原生会话的持久记录，可能晚于所选运行；界面会标注文件时间。插件日志的 `hostEffect` 未观测时，不能据此声称宿主已阻止工具。没有日志也不能推断 Hook 已停用。

目录缺失、合同锁定、文件损坏或不支持的格式都显示未确认。不会修改、迁移或执行插件代码，不回退读取桌面端 home。其他执行端的合同查询暂未接入。

逐消息 Skill 的“未选择”与原生插件“已启用”可以同时成立。技能冻结记录不代表原生没有自行加载其他技能；取消 Skill 勾选不负责停用 Hook。

## 提示边界回归

现有 `userFirstPrompt`、引用包装和独立 Hook 诊断指令逻辑保留。普通测试覆盖首行用户指令、技能正文引用和诊断指令独立发送。可显式设置 `HIVELAB_STS_PLUGIN_ROOT`，在隔离测试目录用本机已安装插件验证旧误触发样例、明确 review 的拒绝、change 的切换和 status 查询。该测试不调用模型，也不改真实会话合同。

```powershell
node --import ./scripts/test-bootstrap.mjs --import tsx --test tests/runtime-diagnostics.test.ts tests/prompt-framing.test.ts tests/message-skills.test.ts
node --import ./scripts/test-bootstrap.mjs --import tsx tests/ui/runtime-diagnostics-smoke.mjs
# 可选：填写自己安装的插件目录后运行离线插件回归。
$env:HIVELAB_STS_PLUGIN_ROOT = 'D:\path\to\stop-that-shit'
node --import ./scripts/test-bootstrap.mjs --import tsx --test tests/prompt-hook-integration.test.ts
Remove-Item Env:HIVELAB_STS_PLUGIN_ROOT
```

## 开发接口

`run.diagnostics({runId})` 与 `provider.diagnostics({provider})` 已加入窗口 RPC 白名单，复用现有界面到后端通信。两者是读取操作，不触发快照刷新。诊断结果通过已有 `redact` 脱敏。

本项的合同诊断只读取本地记录，不连接外部系统。

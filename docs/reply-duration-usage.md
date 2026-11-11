# 回复耗时与订阅 Token 用量

2026-10-24：每条关联运行记录的成员回复显示“已用”或“本轮耗时”。工位、茶歇室、会议聊天、结构化汇报与成员活动详情共用同一计算方式。

- 耗时从运行 `createdAt` 到 `completedAt`，包含准备、排队、工具执行和等待确认，不表示纯模型推理时长。
- 运行结束后数值固定；失败和停止也按实际结束时间计算。历史记录已有起止时间即可显示，不做数据库迁移。结束时间缺失的旧记录显示“耗时未记录”。
- Token 活动的总量继续包含 API、Codex 订阅及其他执行端实际回报的 token；新增过去一年的订阅子项、执行端明细和所选日期的订阅子项。子项不再加到总量上。
- 认证归类读取该次运行保存的 `status` / `usage` 认证回执；Codex 适配器只允许订阅认证，所以旧 Codex 记录也可归类。Claude 同时支持订阅和 API，不能根据当前设置给旧记录归类。其他没有认证证据的执行端仍计入总量，但不擅自标为订阅。
- Codex 的 token 通知和订阅额度通知分别处理。额度百分比不会覆盖适配器已取得的 token 数据，也不换算成 token 数。
- 统计范围是 HiveLab 留存的运行记录，不包括在其他客户端发生的账号用量。未回报 token 的历史无法推算。

协议依据：[OpenAI Codex App Server 官方文档](https://learn.chatgpt.com/docs/app-server)，`thread/tokenUsage/updated` 提供线程用量更新，`account/rateLimits/updated` 提供额度更新。

验证入口：`tests/run-duration-usage.test.ts`、`tests/ui/activity-smoke.mjs`、`tests/ui/token-calendar-smoke.mjs`。完整验证使用 `npm run verify`，均不发送真实模型请求。

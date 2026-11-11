# Renderer P0 结构与样式

2026-10-29。对应《HiveLab-综合优化清单》的三项“新发现 P0”。

入口继续使用 `App.tsx`、`room.tsx`、`project-room.tsx`、`settings.tsx`，原调用方无需更换导入路径。

| 模块 | 职责 |
| --- | --- |
| `app/store.ts`、`store-context.tsx` | 每个 App 实例独立的 Zustand 状态、稳定 actions、选择器与开发环境 DevTools |
| `app/use-app-backend.ts` | RPC、完整快照、增量快照和后端连接事件 |
| `app/use-app-controller.tsx` | 页面导航、项目操作、成员状态和工作区协调 |
| `app/AppSidebar.tsx`、`AppDialogs.tsx` | 侧栏、菜单与弹窗界面 |
| `room/use-room-controller.tsx` | 当前房间、草稿、发送、讨论控制和消息操作 |
| `room/use-room-timeline.ts` | 历史分页、滚动位置、定位消息、流式预览及稳定活动切片 |
| `room/MessageLine.tsx` | memo 消息行、回应和完成消息折叠 |
| `room/RoomToolbar.tsx`、`RoomComposer*.tsx` | 话题工具栏、输入区、工具按钮与讨论模式 |
| `room/RoomMessages.tsx`、`RoomDialogs.tsx` | 消息列表与房间弹窗 |
| `project-room/` | 方案/验收/决策卡、任务看板、流程待办、成果与回执 |
| `settings/VersionPanel.tsx` | 执行端版本查询、安装进度与切换 |
| `styles/tokens/` | 字号、间距、圆角、阴影、交互主色 |
| `styles/components/` | 通用按钮与表单样式 |

新增状态从 `useAppStore(state => state.field)` 读取，通过 `useAppActions()` 修改。更新支持函数形式；返回原值时保持状态引用。导航只保存 view、projectId、deskMemberId、reportMemberId，后两项用于重启后恢复正确的成员页面。快照、审批、终端请求和弹窗状态不写入存储；连续快照更新不会重复写入相同的导航内容。已有主题、侧栏和项目树偏好保留原有键名。

样式通过 `styles.css` 引入令牌。正文使用 `--fs-body`（16–17px），工具与元信息使用较小的流动字号。主动作使用品牌色和 pill 圆角；工具按钮和输入框使用 `--r-sm`，内容卡片使用 `--r-lg`。成员色继续表示身份和消息来源，状态色用于状态及危险操作。光学对齐尺寸（例如头像与审批内容的 46px 缩进）保留实测值。

液态玻璃的模糊、折射、亮度、饱和度和光效继续由现有外观设置控制。右下角消息气泡与输入栏使用相同的页面颜色/透明度及全局玻璃参数；审批卡保持回复宽度、圆角和额外 8% 不透明度。普通玻璃阴影改用统一浮层档，审批阅读阴影及头像状态光晕保留。

验证入口：`tests/app-store.test.ts`、`tests/ui/design-system-smoke.mjs`、`tests/ui/p0-smoke.mjs`、`tests/ui/approval-glass-smoke.mjs` 及现有桌面冒烟。运行完整检查使用 `node scripts/verify.mjs`。

2026-10-29 后续 CSS 整理：`styles/tokens/material.css` 统一玻璃基础参数；`styles/components/shared-surfaces.css` 合并原 styles.css / team.css 中的 16 个重复选择器。气泡、输入框、菜单、导航的透明度仍使用各自已有设置。新增任务上下文和技能来源组件使用 CSS Modules，保留常显操作、系统减少透明效果与键盘焦点。按钮冒烟依据本轮初始 CSS 的复现结果校正：普通控件沿用父面板材质，独立 glass-action 保留自身底色和阴影。

/** Subagents a member's main agent sends out through the shared HiveLab tool bridge.
 *  A subagent receives only the main agent's task text, never the member card, covenant or chat history. */
export type SubagentStatus = 'running' | 'stopping' | 'completed' | 'failed' | 'stopped';
export interface SubagentEntry { at: string; kind: 'text' | 'reasoning' | 'tool' | 'status' | 'warning' | 'error'; text: string }
export interface SubagentRecord {
  id: string;
  /** 1-based order within the parent run, shown as 子代理 #n. */
  index: number;
  parentRunId: string; parentSessionId: string; provider: string;
  title: string; task: string; write: boolean;
  model?: string; effort?: string;
  status: SubagentStatus;
  createdAt: string; updatedAt: string; completedAt?: string;
  /** The subagent's final answer, which the main agent receives. */
  result?: string; error?: string;
  /** Bounded activity log for the detail panel. */
  entries: SubagentEntry[];
  /** Latest activity in one line, for the card. */
  activity?: string;
  /** The main agent has received this outcome through subagent_wait. */
  delivered?: boolean;
}

/** The first line of a subagent's instructions. Adapters pass text that starts with it through unchanged
 *  instead of wrapping it as a member card update. */
export const SUBAGENT_BRIEF_MARK = '[HiveLab 合屋 子代理]';
export const SUBAGENT_BRIEF = `${SUBAGENT_BRIEF_MARK}
你是主代理派出的子代理，独立完成主代理交给你的一项任务。你没有人物设定，也看不到主代理与用户的对话；任务说明就是你得到的全部背景。
- 只做任务说明要求的事，不扩大范围，不主动申请更高权限。
- 不要向用户提问；信息不足时按最合理的理解继续，并在最终回答里写明假设。
- 主代理只能看到你的最终回答。最终回答要完整、可直接使用：写明结论、依据（文件路径与行号、命令及其结果）和未确认的事项。
- 没有实际检查过的内容不得声称已验证。`;

/** Executors whose main agent may send subagents. Other executors join after their own verification. */
export const SUBAGENT_EXECUTORS = ['claude', 'codex', 'dsh'] as const;
/** Added ACP connections that may send subagents, by catalogue entry: an added Claude account and Antigravity (Gemini). */
export const SUBAGENT_ACP_CATALOGS = ['claude', 'antigravity'] as const;
export const SUBAGENT_SESSION_PREFIX = 'subagent:';
export const isSubagentSession = (sessionId: string | undefined) => !!sessionId?.startsWith(SUBAGENT_SESSION_PREFIX);
/** Approval category of a command a read-only subagent asks to run: always the user's call, never automatic. */
export const SUBAGENT_READONLY_COMMAND = 'subagent-readonly-command';
export const SUBAGENT_LIMITS = { running: 4, writing: 1, taskChars: 20000, resultChars: 24000, entries: 400, entryChars: 4000 };
/** DSH's MCP client gives up on a tool call after 60 seconds; Antigravity's limit is unpublished, so it gets the same
 *  short wait. The others allow long calls. */
export const subagentWaitCap = (provider: string, catalogId?: string) => provider === 'dsh' || catalogId === 'antigravity' ? 50 : 600;

export const SUBAGENT_TOOLS = [
  {name:'subagent_models',description:'列出派出子代理时可选的模型和思考程度（与你同一执行端、同一账号），以及你当前使用的模型。派出前按任务种类选择：简单检索、批量阅读选轻快的模型或较低思考程度，复杂设计、疑难排查选能力强的模型或较高思考程度。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'subagent_start',description:'派出一个子代理并立即返回编号，不等待完成；可连续派出多个并行工作（同时最多 4 个，可写入的最多 1 个）。子代理与你使用同一执行端、同一工作目录和同一权限，但不带人物设定和对话记录，只收到 task 的内容，所以 task 必须写清目标、相关路径、已知线索、要交回的结果格式。model/effort 可省略（沿用你当前的设置），可选值见 subagent_models。write=true 允许子代理修改工作目录中的文件（仅当本会话允许写入）；默认只读。之后用 subagent_wait 取结果。',inputSchema:{type:'object',properties:{task:{type:'string',description:'完整任务说明'},title:{type:'string',description:'简短标题，显示在界面上'},model:{type:'string'},effort:{type:'string'},write:{type:'boolean'}},required:['task'],additionalProperties:false}},
  {name:'subagent_wait',description:'等待子代理完成并取回结果。ids 省略时等待本轮派出且尚未取回结果的全部子代理；any=true 时任一完成即返回。seconds 为本次最长等待秒数（DSH 和 Antigravity 最多 50，其他最多 600）；超时返回仍在运行的子代理，可再次调用继续等待。返回每个子代理的状态、最终回答 result 或错误。',inputSchema:{type:'object',properties:{ids:{type:'array',items:{type:'string'}},any:{type:'boolean'},seconds:{type:'number'}},additionalProperties:false}},
  {name:'subagent_stop',description:'停止一个仍在运行的子代理。',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}},
] as const;
export const SUBAGENT_TOOL_NAMES: readonly string[] = SUBAGENT_TOOLS.map(tool => tool.name);
/** HiveLab tools a subagent itself may call; it cannot send subagents, ask the user or change cards. */
export const SUBAGENT_ALLOWED_TOOLS: readonly string[] = ['read_file', 'skills', 'read_skill', 'read_skill_asset'];

export const subagentActive = (status: SubagentStatus) => status === 'running' || status === 'stopping';
export const SUBAGENT_STATUS_LABEL: Record<SubagentStatus, string> = { running: '运行中', stopping: '正在停止', completed: '已完成', failed: '失败', stopped: '已停止' };

import {t} from './i18n';
/** The context system: how full each topic's native conversation is, what fills it, and the user's own lower limit. */

/** What HiveLab itself adds to every turn, estimated from the text it sends (tokens). */
export interface ContextParts {
  persona: number; skills: number; notes: number; tools: number;
  mcpTools: { count: number; tokens: number; names: string[] };
  memoryFiles: { name: string; tokens: number }[];
}
/** The latest context reading of one topic (one HiveLab session). */
export interface ContextUsage {
  sessionId: string; runId: string; provider: string; model?: string; at: string;
  /** Tokens the native conversation holds after the latest request. */
  used: number;
  /** The model's own context window, when the executor reports it. */
  window?: number;
  /** `used` at the end of the previous turn: the part added since then is shown separately. */
  previous?: number;
  /** The first reading of this native conversation: system prompt, tools and the first message. */
  baseline?: number; nativeId?: string;
  input?: number; cached?: number; output?: number;
  parts?: ContextParts;
}
/** The user's own budget: a lower limit than the model's window, and where automatic compaction starts. */
export interface ContextConfig { contextLimit?: number; contextPercent?: number }

export const CONTEXT_DEFAULT_PERCENT = 85;
export const CONTEXT_PERCENTS = [60, 70, 80, 85, 90] as const;
/** The compaction point must clear the topic's fixed part (system prompt, tools, member card) by half again,
 *  or the executor would compact on every turn without ever getting below it. */
export const contextFloor = (baseline: number | undefined) => baseline ? Math.ceil(baseline * 1.5) : 0;
/** Claude Code accepts an auto-compact window of 100k to 1M tokens. */
export const contextMinimum = (provider: string) => provider === 'claude' ? 100_000 : 16_000;

/** Rough token count: CJK characters count one each, other text about four characters per token. */
export function estimateTokens(text: string | undefined) {
  if (!text) return 0;
  let wide = 0;
  for (const char of text) if (/[⺀-鿿가-힯＀-￯]/.test(char)) wide++;
  return Math.round(wide + (text.length - wide) / 4);
}

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
const obj = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

/** One usage event → how full the context is. Only executors that report the request size are read. */
export function contextReading(provider: string, raw: unknown): Pick<ContextUsage, 'used' | 'window' | 'input' | 'cached' | 'output' | 'model'> | undefined {
  const data = obj(raw);
  // ACP standard (DSH, Antigravity, Kimi…): usage_update carries used and size.
  if (data.sessionUpdate === 'usage_update' && num(data.used) !== undefined) return { used: num(data.used)!, window: num(data.size) || undefined };
  // Codex: the last request's tokens and the model window.
  if (data.tokenUsage) {
    const last = obj(data.tokenUsage.last), used = num(last.totalTokens) ?? num(last.inputTokens);
    if (used === undefined) return;
    return { used, window: num(data.tokenUsage.modelContextWindow) || undefined, input: num(last.inputTokens), cached: num(last.cachedInputTokens), output: num(last.outputTokens) };
  }
  // Claude: the last request of the turn, including cache reads and writes; the window comes per model.
  if (provider === 'claude' || data.modelUsage) {
    const usage = obj(data.usage), iterations = Array.isArray(usage.iterations) ? usage.iterations : [], last = obj(iterations.at(-1) ?? usage);
    const input = (num(last.input_tokens) ?? 0) + (num(last.cache_read_input_tokens) ?? 0) + (num(last.cache_creation_input_tokens) ?? 0);
    if (!input) return;
    const output = num(last.output_tokens) ?? 0, models = Object.entries(obj(data.modelUsage));
    const main = models.sort(([, a], [, b]) => (num(obj(b).outputTokens) ?? 0) - (num(obj(a).outputTokens) ?? 0))[0];
    return { used: input + output, window: num(obj(main?.[1]).contextWindow) || undefined, input, cached: num(last.cache_read_input_tokens), output, model: main?.[0] };
  }
  // OpenAI-style APIs (ZCode, DeepSeek…): the prompt size of the last request; no window.
  const usage = obj(data.usage ?? data.hivelabTokenUsage);
  const prompt = num(usage.prompt_tokens) ?? num(usage.inputTokens);
  if (prompt === undefined) return;
  const cached = num(obj(usage.prompt_tokens_details).cached_tokens) ?? num(usage.cacheReadTokens) ?? 0;
  const output = num(usage.completion_tokens) ?? num(usage.outputTokens) ?? 0;
  // DSH reports cache reads apart from the input; OpenAI counts them inside prompt_tokens.
  const used = usage.prompt_tokens !== undefined ? prompt + output : prompt + cached + output;
  return { used, input: used - output, cached: cached || undefined, output };
}

/** The limit HiveLab works with: the user's own value, never above the model's window. */
export function contextBudget(usage: Pick<ContextUsage, 'window' | 'provider'> | undefined, config: ContextConfig = {}) {
  const window = usage?.window;
  const custom = config.contextLimit && (!window || config.contextLimit <= window) ? config.contextLimit : undefined;
  const limit = custom ?? window;
  const percent = config.contextPercent ?? CONTEXT_DEFAULT_PERCENT;
  return { limit, window, custom, percent, threshold: limit ? Math.floor(limit * percent / 100) : undefined };
}

export type ContextRow = { key: string; label: string; tokens: number; tone: string; hint?: string };
/** The panel's breakdown: parts of `used`, then the compaction buffer and free space, all against the limit. */
export function contextRows(usage: ContextUsage, config: ContextConfig = {}): { rows: ContextRow[]; limit?: number; percent: number; left?: number } {
  const budget = contextBudget(usage, config), parts = usage.parts;
  const hivelab = parts ? parts.persona + parts.skills + parts.notes + parts.mcpTools.tokens + parts.memoryFiles.reduce((sum, file) => sum + file.tokens, 0) : 0;
  const since = usage.previous !== undefined && usage.used > usage.previous ? usage.used - usage.previous : 0;
  const settled = usage.used - since;
  // Without a first reading the executor's own share cannot be told apart from the conversation.
  const native = usage.baseline !== undefined ? Math.max(0, Math.min(settled, usage.baseline) - hivelab) : 0;
  const messages = Math.max(0, settled - native - hivelab);
  const rows: ContextRow[] = [
    { key: 'messages', label: t("对话消息"), tokens: messages, tone: 'messages', hint: usage.baseline === undefined ? t("含执行端自带部分：这个会话没有首轮读数，无法单独拆出") : undefined },
    { key: 'native', label: t("执行端系统提示与工具"), tokens: native, tone: 'native', hint: t("执行端自带的系统提示和内置工具，由首轮读数推算") },
    { key: 'mcp', label: t("HiveLab 工具（MCP）"), tokens: parts?.mcpTools.tokens ?? 0, tone: 'mcp' },
    { key: 'persona', label: t("人物设定与工作公约"), tokens: parts?.persona ?? 0, tone: 'persona' },
    { key: 'notes', label: t("HiveLab 工作说明"), tokens: parts?.notes ?? 0, tone: 'notes' },
    { key: 'skills', label: t("Skills 索引"), tokens: parts?.skills ?? 0, tone: 'skills' },
    { key: 'memory', label: t("记忆文件"), tokens: parts?.memoryFiles.reduce((sum, file) => sum + file.tokens, 0) ?? 0, tone: 'memory' },
    { key: 'since', label: t("自上次更新以来"), tokens: since, tone: 'since' },
  ];
  if (budget.limit) {
    const buffer = budget.limit - (budget.threshold ?? budget.limit);
    rows.push({ key: 'buffer', label: t("自动压缩缓冲"), tokens: buffer, tone: 'buffer' });
    rows.push({ key: 'free', label: t("剩余空间"), tokens: Math.max(0, budget.limit - usage.used - buffer), tone: 'free' });
  }
  return { rows, limit: budget.limit, percent: budget.percent, left: budget.threshold !== undefined ? Math.max(0, budget.threshold - usage.used) : undefined };
}

/** "576.8k", "1M": the panel's compact token numbers. */
export function contextTokens(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value % 1_000_000 ? 2 : 0))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 100_000 ? 1 : 1))}k`;
  return String(value);
}
/** Accepts "400k", "1M", "200000" or "200" (thousands). */
export function parseContextTokens(text: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kKmM万]?)\s*$/.exec(text);
  if (!match) return;
  const value = Number(match[1]), unit = match[2].toLowerCase();
  const tokens = unit === 'm' ? value * 1_000_000 : unit === 'k' ? value * 1_000 : unit === '万' ? value * 10_000 : value < 10_000 ? value * 1_000 : value;
  return Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : undefined;
}

import type { RunSummary, TimelineEvent } from './types';

type ToolActivity = { runId: string; computer: boolean };
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

/** Native tool lifecycles, shared by Codex, Claude, DSH and arbitrary ACP executors. */
export class ComputerActivityTracker {
  private tools = new Map<string, ToolActivity>();
  private finished = new Set<string>();
  event(event: TimelineEvent) {
    if (event.kind !== 'tool') return;
    const data = record(event.data);
    const id = data.toolCallId ?? data.tool_use_id ?? data.id;
    if (typeof id !== 'string' || !id) return;
    const key = JSON.stringify([event.runId, id]);
    const phase = data.hivelabPhase ?? data.phase ?? data.status;
    const completed = data.type === 'tool_result' || ['completed', 'failed', 'cancelled', 'canceled', 'interrupted'].includes(phase);
    if (completed) { this.tools.delete(key); this.finished.add(key); return; }
    // A late duplicate tool_use must not revive an already finished operation.
    if (this.finished.has(key)) return;
    const name = [data.name, data.tool, data.title, data.server, data.type, data.kind].filter(item => typeof item === 'string').join(' ');
    const input = JSON.stringify(data.arguments ?? data.rawInput ?? data.input ?? data.command ?? '').slice(0, 128_000);
    const computer = data.computerUse === true || /computer|browser|playwright|selenium|puppeteer|pyautogui|sendinput|uiautomation|@oai\/sky|sky\.(?:click|type_text|press_key|drag)|cua\.|mcp__cua|屏幕操作|操作电脑/i.test(name + ' ' + input)
      || /(?:^|[_:.\s-])(?:click|double_click|mouse_move|key_press|type_text|screenshot|screen_capture)(?:$|[_:.\s-])/i.test(name);
    // Shells and generic MCP tools can operate the desktop through scripts. Keep an honest
    // "executing tools" indicator even when their exact GUI effect cannot be inferred.
    const executable = /commandExecution|mcpToolCall|dynamicToolCall|tool_use|execute|terminal|bash|pwsh|powershell|exec_command|node_repl/i.test(name) || computer;
    if (!executable && !this.tools.has(key)) return;
    if (phase === 'pending') return;
    this.tools.set(key, { runId: event.runId, computer: computer || this.tools.get(key)?.computer === true });
  }
  reconcile(runs: Pick<RunSummary, 'id' | 'status'>[]) {
    const active = new Set(runs.filter(run => ['running', 'waiting_user', 'stopping'].includes(run.status)).map(run => run.id));
    for (const [key, tool] of this.tools) if (!active.has(tool.runId)) this.tools.delete(key);
    for (const key of this.finished) if (!active.has(JSON.parse(key)[0])) this.finished.delete(key);
  }
  clear() { this.tools.clear(); this.finished.clear(); }
  current() {
    const entries = [...this.tools.values()], runIds = [...new Set(entries.map(item => item.runId))];
    return { runIds, computer: entries.some(item => item.computer), active: runIds.length > 0 };
  }
}

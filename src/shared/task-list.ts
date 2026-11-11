import {t} from './i18n';
/** One normalized task-list shape for Claude (Task* / TodoWrite), Codex (turn plan) and DSH (todo_write). */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export interface TodoItem { content: string; status: TodoStatus }
export const TODO_LIMITS = { items: 60, chars: 240 };

export function todoStatus(value: unknown): TodoStatus {
  const text = String(value ?? '').replace(/[\s_-]/g, '').toLowerCase();
  return text === 'completed' || text === 'done' || text === 'complete' ? 'completed'
    : text === 'inprogress' || text === 'active' || text === 'running' ? 'in_progress' : 'pending';
}
const clip = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, TODO_LIMITS.chars);

/** A whole list from any executor's payload; entries without text are dropped. */
export function normalizeTodos(entries: unknown): TodoItem[] | undefined {
  if (!Array.isArray(entries)) return undefined;
  const items: TodoItem[] = [];
  for (const entry of entries.slice(0, TODO_LIMITS.items)) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const content = clip(value.content ?? value.step ?? value.subject ?? value.title ?? value.text);
    if (content) items.push({ content, status: todoStatus(value.status) });
  }
  return items;
}

/** Claude's Task tools change one task at a time; this keeps the list a turn has built so far. */
export class ClaudeTaskTracker {
  private tasks = new Map<string, { content: string; status: TodoStatus }>();
  private pending = new Map<string, { content: string; status: TodoStatus }>();
  /** Returns the whole list when this tool call changed it. */
  use(name: string, id: string | undefined, input: any): TodoItem[] | undefined {
    if (name === 'TodoWrite') {
      const list = normalizeTodos(input?.todos);
      if (!list) return undefined;
      this.tasks = new Map(list.map((item, index) => [String(index + 1), item]));
      return list;
    }
    if (name === 'TaskCreate' && id) {
      const content = clip(input?.subject ?? input?.description);
      if (content) this.pending.set(id, { content, status: 'pending' });
      return undefined;
    }
    if (name === 'TaskUpdate') {
      const key = String(input?.taskId ?? input?.id ?? '').replace(/^#/, '');
      if (!key) return undefined;
      if (input?.status === 'deleted') { this.tasks.delete(key); return this.list(); }
      const current = this.tasks.get(key) ?? { content: clip(input?.subject) || t("任务 #{0}", key), status: 'pending' as TodoStatus };
      this.tasks.set(key, { content: clip(input?.subject) || current.content, status: input?.status ? todoStatus(input.status) : current.status });
      return this.list();
    }
    return undefined;
  }
  /** TaskCreate reports its id only in the result, e.g. "Task #3 created successfully". */
  result(id: string | undefined, content: unknown): TodoItem[] | undefined {
    const created = id ? this.pending.get(id) : undefined;
    if (!created) return undefined;
    this.pending.delete(id!);
    const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
    const key = text.match(/#\s*(\d+)/)?.[1] ?? text.match(/"id"\s*:\s*"?(\d+)/)?.[1] ?? String(this.tasks.size + 1);
    this.tasks.set(key, created);
    return this.list();
  }
  list(): TodoItem[] { return [...this.tasks.values()].slice(0, TODO_LIMITS.items); }
}

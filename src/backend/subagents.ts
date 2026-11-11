import {randomUUID} from 'node:crypto';
import type {ChildProcess} from 'node:child_process';
import type {AcpExecutor, Adapter, AdapterContext, ProviderId, ProviderInfo, Run, Session, TimelineEvent} from '../shared/types';
import {SUBAGENT_ACP_CATALOGS, SUBAGENT_SESSION_PREFIX, SUBAGENT_BRIEF, SUBAGENT_EXECUTORS, SUBAGENT_LIMITS, subagentActive, subagentWaitCap, type SubagentEntry, type SubagentRecord} from '../shared/subagents';
import type {RunExecutionActive} from './run-execution';
import {stopOwned} from './process-supervisor';
import {redact} from './security';
import type {Store} from './store';

const now = () => new Date().toISOString();
const SESSION_PREFIX = SUBAGENT_SESSION_PREFIX;
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
const clip = (value: string, max: number) => value.length > max ? value.slice(0, max) + '\n[内容较长，后续已省略]' : value;

export interface SubagentHost {
  readonly store: Store;
  readonly active: Map<string, RunExecutionActive>;
  readonly providers: ProviderInfo[];
  readonly alive: boolean;
  adapter(provider: ProviderId): Adapter;
  credentials(sessionId: string): Promise<Record<string, string>>;
  owned(child: ChildProcess): void;
  broadcast(): void;
}

/** The final answer is the text after the last top-level tool call; earlier text is commentary. */
class AnswerCollector {
  private segment = ''; private last = '';
  add(kind: TimelineEvent['kind'], value: string, data: any) {
    if (data?.parent_tool_use_id) return;
    if (kind === 'delta') this.segment += value;
    else if (kind === 'message' && data?.source === 'assistant' && data?.role !== 'user') {
      if (data.final && (this.segment.trim() || this.last.trim())) return;
      this.segment = this.segment ? `${this.segment}\n${value}` : value;
    } else if (kind === 'tool') { if (this.segment.trim()) this.last = this.segment; this.segment = ''; }
  }
  get answer() { return (this.segment.trim() || this.last.trim()); }
}

interface Live {
  record: SubagentRecord; adapter: Adapter; children: ChildProcess[]; finished: boolean;
  collector: AnswerCollector; watcher?: NodeJS.Timeout; done: Promise<void>;
}

/** Runs subagents outside the run queue: the main agent is waiting on them, so queueing behind it would deadlock. */
export class Subagents {
  private live = new Map<string, Live>();
  private flushTimer?: NodeJS.Timeout;
  private dirty = new Set<string>();
  private waiters = new Set<() => void>();
  constructor(private host: SubagentHost) {
    // A restart ends every subagent process; keep the record, never resume it.
    for (const record of host.store.list<SubagentRecord>('subagents'))
      if (subagentActive(record.status)) host.store.put('subagents', record.id, {...record, status: 'stopped', error: '应用重启，子代理已停止', completedAt: now(), updatedAt: now()});
  }

  static sessionId(id: string) { return SESSION_PREFIX + id; }
  /** The subagent behind a tool-bridge session id, while it runs. */
  bySession(sessionId: string) {
    if (!sessionId.startsWith(SESSION_PREFIX)) return undefined;
    const live = this.live.get(sessionId.slice(SESSION_PREFIX.length));
    return live && !live.finished ? live : undefined;
  }
  isSubagentSession(sessionId: string) { return sessionId.startsWith(SESSION_PREFIX); }

  private parent(sessionId: string) {
    return [...this.host.active.values()].find(a => a.ctx.session.id === sessionId && !a.stopping);
  }
  /** Main agents of the three verified executors in desk and task work; chat rooms stay conversation-only. */
  eligible(active: RunExecutionActive | undefined) {
    if (!active || active.stopping || active.ctx.conversation === 'room' || active.ctx.session.purpose?.startsWith('room-')) return false;
    const provider = active.ctx.run.provider;
    if ((SUBAGENT_EXECUTORS as readonly string[]).includes(provider)) return true;
    return (SUBAGENT_ACP_CATALOGS as readonly string[]).includes(this.host.store.get<AcpExecutor>('executors', provider)?.catalogId ?? '');
  }
  eligibleSession(sessionId: string) { return this.eligible(this.parent(sessionId)); }

  list(parentRunId?: string) {
    return this.host.store.list<SubagentRecord>('subagents').filter(r => !parentRunId || r.parentRunId === parentRunId);
  }
  /** Recent records for the window; activity logs are bounded when written. */
  snapshot() { return this.host.store.list<SubagentRecord>('subagents').slice(-120); }

  private save(record: SubagentRecord, immediate = false) {
    record.updatedAt = now();
    if (immediate) { this.host.store.put('subagents', record.id, record); this.dirty.delete(record.id); this.host.broadcast(); return; }
    this.dirty.add(record.id);
    // Streaming text arrives many times a second; the window only needs a steady refresh.
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined;
      for (const id of this.dirty) { const live = this.live.get(id); if (live) this.host.store.put('subagents', id, live.record); }
      this.dirty.clear();
      if (this.host.alive) this.host.broadcast();
    }, 400);
  }
  private notify() { for (const wake of [...this.waiters]) wake(); }

  private entry(record: SubagentRecord, kind: SubagentEntry['kind'], value: string) {
    if (!value) return;
    const last = record.entries.at(-1);
    if (last && last.kind === kind && (kind === 'text' || kind === 'reasoning')) {
      if (last.text.length < SUBAGENT_LIMITS.entryChars) last.text = clip(last.text + value, SUBAGENT_LIMITS.entryChars);
      return;
    }
    if (kind !== 'text' && kind !== 'reasoning' && !value.trim()) return;
    record.entries.push({at: now(), kind, text: clip(kind === 'tool' ? value.split('\n').slice(0, 6).join('\n') : value, kind === 'tool' ? 600 : SUBAGENT_LIMITS.entryChars)});
    if (record.entries.length > SUBAGENT_LIMITS.entries) record.entries.splice(0, record.entries.length - SUBAGENT_LIMITS.entries);
  }

  models(sessionId: string) {
    const parent = this.parent(sessionId);
    if (!this.eligible(parent)) throw Error('当前任务不能派出子代理');
    const provider = parent!.ctx.run.provider, info = this.host.providers.find(p => p.id === provider);
    return {
      executor: info?.name ?? provider,
      current: {model: parent!.ctx.settings.models[provider] || undefined, effort: parent!.ctx.settings.efforts[provider] || undefined},
      models: (info?.modelOptions ?? []).map(({id, label, efforts, defaultEffort, isDefault, description}) => ({id, label, efforts, defaultEffort, isDefault, description})),
      note: info?.modelOptions?.length ? '省略 model/effort 时沿用当前设置。' : '这个执行端没有报告模型列表；可省略 model 沿用当前设置。',
    };
  }

  private chooseModel(provider: ProviderId, parent: RunExecutionActive, model?: string, effort?: string) {
    const options = this.host.providers.find(p => p.id === provider)?.modelOptions ?? [];
    let chosen = model ?? parent.ctx.settings.models[provider] ?? undefined;
    let option = chosen ? options.find(o => o.id === chosen || o.aliases?.includes(chosen!)) : options.find(o => o.isDefault);
    if (model && options.length && !option) throw Error(`没有模型 ${model}；可选：${options.map(o => o.id).join('、')}`);
    if (model && option) chosen = option.id;
    let chosenEffort = effort ?? (model ? undefined : parent.ctx.settings.efforts[provider] ?? undefined);
    if (chosenEffort && option?.efforts.length && !option.efforts.includes(chosenEffort)) {
      if (effort) throw Error(`${option.label} 不支持思考程度 ${effort}；可选：${option.efforts.join('、')}`);
      chosenEffort = undefined;
    }
    return {model: chosen || undefined, effort: chosenEffort || undefined};
  }

  async start(sessionId: string, args: any) {
    const parent = this.parent(sessionId);
    if (!this.eligible(parent)) throw Error('当前任务不能派出子代理（只在 Claude、Codex、DSH 的工位与任务中可用）');
    const pctx = parent!.ctx, provider = pctx.run.provider;
    const task = text(args?.task, SUBAGENT_LIMITS.taskChars + 1);
    if (!task) throw Error('task 不能为空');
    if (task.length > SUBAGENT_LIMITS.taskChars) throw Error(`task 超过 ${SUBAGENT_LIMITS.taskChars} 字，请精简或改为指明文件路径`);
    const write = args?.write === true;
    if (write && !pctx.session.writeMode) throw Error('本会话只读，不能派出可写入的子代理');
    if (write && pctx.run.planMode && this.host.store.get<Run>('runs', pctx.run.id)?.planProposal?.status !== 'approved') throw Error('计划还没有批准，现在只能派出只读的子代理');
    const siblings = this.list(pctx.run.id), running = siblings.filter(r => subagentActive(r.status));
    if (running.length >= SUBAGENT_LIMITS.running) throw Error(`本轮已有 ${running.length} 个子代理在运行，请先用 subagent_wait 取回结果`);
    if (write && running.some(r => r.write)) throw Error('已有一个可写入的子代理在运行；同时只允许一个，避免互相改写');
    const {model, effort} = this.chooseModel(provider, parent!, text(args?.model, 120), text(args?.effort, 40));
    const id = randomUUID(), index = siblings.length + 1;
    const record: SubagentRecord = {
      id, index, parentRunId: pctx.run.id, parentSessionId: sessionId, provider,
      title: text(args?.title, 60) ?? task.split('\n')[0].slice(0, 40),
      task, write, model, effort, status: 'running', createdAt: now(), updatedAt: now(), entries: [],
    };
    const adapter = this.host.adapter(provider as ProviderId);
    let finishedResolve!: () => void;
    const live: Live = {record, adapter, children: [], finished: false, collector: new AnswerCollector(), done: new Promise<void>(resolve => { finishedResolve = resolve; })};
    this.live.set(id, live);
    this.save(record, true);
    pctx.emit('status', `已派出子代理 #${index}：${record.title}`, {hivelabSubagent: {id, phase: 'started'}}, 'derived');
    void this.execute(live, parent!).finally(() => {
      live.finished = true; clearInterval(live.watcher); finishedResolve();
      this.save(record, true); this.notify();
      const still = this.host.active.get(record.parentRunId);
      if (still && !still.stopping) still.ctx.emit('status', `子代理 #${index} ${record.status === 'completed' ? '已完成' : record.status === 'stopped' ? '已停止' : '失败'}：${record.title}`, {hivelabSubagent: {id, phase: record.status}}, 'derived');
      void this.reap(live);
    });
    return {id, index, title: record.title, model: model ?? '执行端默认', effort: effort ?? '模型默认', write, status: 'running', next: '用 subagent_wait 取回结果'};
  }

  private async execute(live: Live, parent: RunExecutionActive) {
    const {record, adapter} = live, pctx = parent.ctx, provider = pctx.run.provider;
    const subSession = Subagents.sessionId(record.id);
    // The watcher ends a subagent with its main turn: no orphan keeps working after the answer.
    live.watcher = setInterval(() => {
      const active = this.host.active.get(record.parentRunId);
      if (!this.host.alive || !active || active.stopping) void this.stop(record.id, '主代理本轮已结束，子代理随之停止');
    }, 1000);
    try {
      const session: Session = {
        id: subSession, projectId: pctx.session.projectId, provider: provider as ProviderId,
        title: record.title, createdAt: record.createdAt, updatedAt: record.createdAt, revision: 1,
        writeMode: record.write, workspace: pctx.cwd, workspaceKind: pctx.session.workspaceKind,
        memberId: pctx.session.memberId,
      } as Session;
      const run: Run = {
        id: record.id, sessionId: subSession, projectId: pctx.run.projectId, provider: provider as ProviderId, revision: 1,
        status: 'running', input: record.task, createdAt: record.createdAt, updatedAt: record.createdAt, bootId: pctx.run.bootId, delivery: 'prepared',
        requestedConfig: {model: record.model, effort: record.effort, modelSource: 'session', effortSource: 'session', capturedAt: record.createdAt},
      } as Run;
      const credentials = await this.host.credentials(subSession);
      const ctx: AdapterContext = {
        run, session, cwd: pctx.cwd,
        settings: {...pctx.settings, models: {...pctx.settings.models, [provider]: record.model}, efforts: {...pctx.settings.efforts, [provider]: record.effort}},
        env: {...pctx.env, ...credentials},
        persona: SUBAGENT_BRIEF,
        emit: (kind, value, data) => {
          if (live.finished) return;
          live.collector.add(kind, value, data);
          const shown = kind === 'delta' || (kind === 'message' && (data as any)?.source === 'assistant') ? 'text'
            : kind === 'reasoning' ? 'reasoning' : kind === 'tool' ? 'tool' : kind === 'warning' ? 'warning' : kind === 'error' ? 'error'
            : kind === 'status' || kind === 'progress' || kind === 'plan' ? 'status' : undefined;
          if (!shown || (data as any)?.parent_tool_use_id) return;
          if (shown === 'text' && kind === 'message' && record.entries.at(-1)?.kind === 'text' && (data as any)?.final) return;
          this.entry(record, shown, redact(value));
          record.activity = shown === 'tool' ? value.split('\n')[0].slice(0, 120) : shown === 'text' ? '正在撰写回答' : shown === 'reasoning' ? '正在思考' : value.split('\n')[0].slice(0, 120) || record.activity;
          this.save(record);
        },
        approve: (request) => {
          if (live.finished) return Promise.reject(Error('子代理已结束'));
          return pctx.approve({...request, title: `子代理 #${record.index}「${record.title}」：${request.title}`});
        },
        persistNativeSession: () => {},
        markDelivery: () => {},
        registerProcess: (child) => {
          this.host.owned(child);
          if (live.finished || record.status === 'stopping') { void stopOwned(child, 1000).catch(() => {}); return; }
          live.children.push(child);
        },
        recordConfig: (value) => {
          if (value.model && !record.model) record.model = value.model;
          if (value.effort && !record.effort) record.effort = value.effort;
        },
      };
      const input = `${record.write ? '本任务允许修改工作目录中的文件；只改任务需要的部分。' : '本任务只读：不要修改文件，也不要运行会改变文件的命令。'}\n工作目录：${pctx.cwd}\n\n[任务]\n${record.task}`;
      if (record.status === 'stopping') { record.status = 'stopped'; record.completedAt = now(); return; }
      const result = await adapter.start(ctx, input);
      // Claude and Codex (and an added Claude account) return the final answer as the summary; DSH and other ACP
      // programs return a status line there, so their streamed answer comes first.
      const summaryIsAnswer = provider === 'claude' || provider === 'codex' || this.host.store.get<AcpExecutor>('executors', provider)?.catalogId === 'claude';
      const answer = (summaryIsAnswer ? text(result.summary, 1e6) : '') || live.collector.answer || (summaryIsAnswer ? '' : text(result.summary, 1e6) ?? '');
      if ((record.status as string) === 'stopping' || result.stopped) { record.status = 'stopped'; record.error ??= '已停止'; }
      else if (result.failure) { record.status = 'failed'; record.error = result.failure.message; }
      else if (!answer) { record.status = 'failed'; record.error = result.unknown ? (result.unknownReason ?? '执行结果未确认') : '子代理没有返回回答'; }
      else record.status = 'completed';
      if (answer) record.result = clip(answer, SUBAGENT_LIMITS.resultChars);
    } catch (error) {
      record.status = record.status === 'stopping' ? 'stopped' : 'failed';
      record.error = redact((error as Error).message);
    } finally {
      record.completedAt = now();
      if ((record.status as string) === 'stopping' || record.status === 'running') record.status = 'stopped';
      record.activity = undefined;
    }
  }

  private async reap(live: Live) {
    try { await live.adapter.stop(); } catch {}
    try { await live.adapter.dispose?.(); } catch {}
    await Promise.all(live.children.map(child => stopOwned(child, 2000).catch(() => {})));
    this.live.delete(live.record.id);
  }

  async stop(id: string, reason = '已停止', sessionId?: string) {
    const live = this.live.get(id);
    if (sessionId && live && live.record.parentSessionId !== sessionId) throw Error('只能停止自己派出的子代理');
    if (!live || live.finished) {
      const record = this.host.store.get<SubagentRecord>('subagents', id);
      if (!record) throw Error('子代理不存在');
      return {id, status: record.status};
    }
    if (live.record.status === 'running') {
      live.record.status = 'stopping'; live.record.error = reason; live.record.activity = '正在停止';
      this.save(live.record, true);
      try { await live.adapter.stop(); } catch {}
      await Promise.all(live.children.map(child => stopOwned(child, 2000).catch(() => {})));
    }
    await Promise.race([live.done, new Promise(resolve => setTimeout(resolve, 5000))]);
    return {id, status: live.record.status};
  }

  /** Stops every subagent of a run, for a stopped or finished main turn. */
  async stopRun(runId: string, reason: string) {
    await Promise.all([...this.live.values()].filter(l => l.record.parentRunId === runId && !l.finished).map(l => this.stop(l.record.id, reason)));
  }
  async close() { await Promise.all([...this.live.keys()].map(id => this.stop(id, '应用正在退出'))); }

  async wait(sessionId: string, args: any, signal?: AbortSignal) {
    const parent = this.parent(sessionId);
    if (!parent) throw Error('当前任务已结束');
    const ids: string[] = Array.isArray(args?.ids) && args.ids.length ? args.ids.map(String)
      : this.list(parent.ctx.run.id).filter(r => subagentActive(r.status) || !r.delivered).map(r => r.id);
    const records = () => ids.map(id => this.live.get(id)?.record ?? this.host.store.get<SubagentRecord>('subagents', id));
    const unknown = ids.filter((id, i) => { const r = records()[i]; return !r || r.parentSessionId !== sessionId; });
    if (unknown.length) throw Error(`不是本会话派出的子代理：${unknown.join('、')}`);
    if (!ids.length) return {subagents: [], note: '没有待取回的子代理'};
    const cap = subagentWaitCap(parent.ctx.run.provider, this.host.store.get<AcpExecutor>('executors', parent.ctx.run.provider)?.catalogId), seconds = Math.max(0, Math.min(cap, Number(args?.seconds ?? cap) || 0));
    const settled = () => { const list = records(); return args?.any ? list.some(r => r && !subagentActive(r.status)) : list.every(r => r && !subagentActive(r.status)); };
    if (!settled() && seconds > 0) await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); this.waiters.delete(check); signal?.removeEventListener('abort', finish); resolve(); };
      const check = () => { if (settled()) finish(); };
      const timer = setTimeout(finish, seconds * 1000);
      this.waiters.add(check); signal?.addEventListener('abort', finish, {once: true});
    });
    const result = records().map(r => {
      const record = r!;
      if (!subagentActive(record.status) && !record.delivered) {
        record.delivered = true;
        const live = this.live.get(record.id);
        if (live) live.record.delivered = true;
        this.host.store.put('subagents', record.id, {...this.host.store.get<SubagentRecord>('subagents', record.id) ?? record, delivered: true});
      }
      return subagentActive(record.status)
        ? {id: record.id, index: record.index, title: record.title, status: 'running', activity: record.activity}
        : {id: record.id, index: record.index, title: record.title, status: record.status, model: record.model, effort: record.effort, ...(record.result ? {result: record.result} : {}), ...(record.error && record.status !== 'completed' ? {error: record.error} : {})};
    });
    this.host.broadcast();
    const running = result.filter(r => r.status === 'running').length;
    return {subagents: result, ...(running ? {note: `${running} 个子代理仍在运行，可再次调用 subagent_wait 继续等待`} : {})};
  }
}

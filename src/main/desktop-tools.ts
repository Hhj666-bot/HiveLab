import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';

/** Pinned agent-desktop 1.2.0 Windows x64 build (build/third-party/agent-desktop). */
export const AGENT_DESKTOP_SHA256 = 'd274667031322e50b9c2b1ab81c2ca46835d52cc932769a5c34bd4d481fd94c3';

export const DESKTOP_ACTIONS = ['windows', 'snapshot', 'find', 'get', 'is', 'wait', 'click', 'set_value', 'clear', 'select', 'toggle', 'check', 'uncheck', 'expand', 'collapse', 'scroll', 'scroll_to', 'press'] as const;
export type DesktopAction = typeof DESKTOP_ACTIONS[number];
const READ_ACTIONS = new Set<string>(['windows', 'snapshot', 'find', 'get', 'is', 'wait']);
export const isDesktopRead = (action: unknown) => READ_ACTIONS.has(String(action));

const REF = /^@(s[a-z0-9]{4,40}):e(\d{1,6})$/;
const SHORT_REF = /^e(\d{1,6})$/;
const SNAPSHOT_ID = /^s[a-z0-9]{4,40}$/;
const WINDOW_ID = /^w-\d{1,20}$/;
const ROLE = /^[a-z_]{2,32}$/;
const SURFACES = ['window', 'focused', 'menu', 'sheet'];
const PROPERTIES = ['text', 'value', 'title', 'bounds', 'role', 'states'];
const STATES = ['visible', 'enabled', 'checked', 'focused', 'expanded', 'selected'];
const PREDICATES = ['exists', 'enabled', 'visible', 'actionable', 'value'];
const DIRECTIONS = ['up', 'down', 'left', 'right'];
const KEYS = new Set(['return', 'enter', 'escape', 'tab', 'space', 'delete', 'backspace', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', ...Array.from({length: 12}, (_, i) => 'f' + (i + 1)), ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')]);
const MODIFIERS = new Set(['ctrl', 'shift', 'alt']);
// Window and session shortcuts stay with the user even though agent-desktop refuses most of them itself.
const BLOCKED_COMBOS = new Set(['alt+f4', 'alt+tab', 'alt+escape', 'alt+space', 'ctrl+escape', 'ctrl+alt+delete', 'ctrl+shift+escape', 'ctrl+w', 'ctrl+f4', 'ctrl+q']);

const OUTPUT_LIMIT = 24_000;
const VALUE_LIMIT = 120;

type Args = Record<string, unknown>;
export type DesktopCommand = {argv: string[]; timeoutMs: number};

const text = (args: Args, key: string, max = 200, required = false): string | undefined => {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw Error(`缺少 ${key}`);
    return undefined;
  }
  if (typeof value !== 'string' || value.length > max || /[\0\r\n]/.test(value)) throw Error(`${key} 须为不超过 ${max} 字的单行文字`);
  return value;
};
const integer = (args: Args, key: string, min: number, max: number, fallback?: number): number | undefined => {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw Error(`${key} 须为 ${min} 到 ${max} 的整数`);
  return value as number;
};
const oneOf = (args: Args, key: string, list: string[], required = false): string | undefined => {
  const value = text(args, key, 40, required);
  if (value !== undefined && !list.includes(value)) throw Error(`${key} 只能是 ${list.join('/')}`);
  return value;
};

/** Resolves `e12` against the member's latest snapshot (never a find), or accepts a qualified `@s…:e12`. */
export function resolveRef(value: unknown, latest?: string): string {
  if (typeof value !== 'string') throw Error('缺少 ref：先用 snapshot 或 find 获取元素编号');
  if (REF.test(value)) return value;
  const short = SHORT_REF.exec(value);
  if (short) {
    if (!latest) throw Error('还没有快照，请先 snapshot 或 find');
    return `@${latest}:e${short[1]}`;
  }
  throw Error('ref 格式应为 e12 或 @s…:e12');
}

export function validateKeys(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40) throw Error('keys 无效');
  const keys = value.toLowerCase().replace(/\s+/g, '');
  const parts = keys.split('+');
  if (parts.length > 4 || parts.some(p => !p)) throw Error('keys 无效');
  const key = parts.at(-1)!, modifiers = parts.slice(0, -1);
  if (!KEYS.has(key) || modifiers.some(m => !MODIFIERS.has(m)) || new Set(modifiers).size !== modifiers.length)
    throw Error('只允许 ctrl/shift/alt 加普通按键；Windows 键和系统快捷键不开放');
  const canonical = [...['ctrl', 'alt', 'shift'].filter(m => modifiers.includes(m)), key].join('+');
  if (BLOCKED_COMBOS.has(canonical) || (modifiers.includes('ctrl') && modifiers.includes('alt'))) throw Error(`快捷键 ${canonical} 涉及窗口或系统操作，不开放`);
  return keys;
}

const scope = (args: Args, argv: string[]) => {
  const windowId = text(args, 'windowId', 30), app = text(args, 'app', 128);
  if (windowId !== undefined) {
    if (!WINDOW_ID.test(windowId)) throw Error('windowId 应来自 windows 结果，如 w-123');
    argv.push(`--window-id=${windowId}`);
  } else if (app !== undefined) argv.push(`--app=${app}`);
};

/** Builds argv for the pinned binary. Options are always `--name=value` and positionals follow `--`, so no input can become a flag. */
export function desktopCommand(args: Args, latest?: string): DesktopCommand {
  const action = args.action;
  if (typeof action !== 'string' || !(DESKTOP_ACTIONS as readonly string[]).includes(action)) throw Error(`action 只能是 ${DESKTOP_ACTIONS.join('/')}`);
  const argv: string[] = [];
  let timeoutMs = 15_000;
  const ref = () => resolveRef(args.ref, latest);
  switch (action as DesktopAction) {
    case 'windows': {
      argv.push('list-windows');
      const app = text(args, 'app', 128);
      if (app) argv.push(`--app=${app}`);
      break;
    }
    case 'snapshot': {
      argv.push('snapshot');
      scope(args, argv);
      if (args.root !== undefined) argv.push(`--root=${resolveRef(args.root, latest)}`);
      if (args.interactiveOnly !== false) argv.push('--interactive-only');
      argv.push('--compact');
      if (args.skeleton === true) argv.push('--skeleton');
      const depth = integer(args, 'maxDepth', 1, 30);
      if (depth) argv.push(`--max-depth=${depth}`);
      const surface = oneOf(args, 'surface', SURFACES);
      if (surface) argv.push(`--surface=${surface}`);
      const wait = integer(args, 'timeoutMs', 500, 20_000, 8000)!;
      argv.push(`--timeout-ms=${wait}`);
      timeoutMs = wait + 10_000;
      break;
    }
    case 'find': {
      if (!['role', 'name', 'text', 'value'].some(k => args[k] !== undefined && args[k] !== '')) throw Error('find 至少需要 role、name、text 或 value 之一');
      argv.push('find');
      scope(args, argv);
      const role = text(args, 'role', 32);
      if (role !== undefined) {
        if (!ROLE.test(role)) throw Error('role 用快照里显示的角色名，如 button、textfield');
        argv.push(`--role=${role}`);
      }
      for (const key of ['name', 'text', 'value'] as const) {
        const value = text(args, key, 200);
        if (value !== undefined) argv.push(`--${key}=${value}`);
      }
      if (args.exact === true) argv.push('--exact');
      if (args.root !== undefined) argv.push(`--root=${resolveRef(args.root, latest)}`);
      argv.push(`--limit=${integer(args, 'limit', 1, 100, 30)}`);
      const wait = integer(args, 'timeoutMs', 500, 20_000, 8000)!;
      argv.push(`--timeout-ms=${wait}`);
      timeoutMs = wait + 10_000;
      break;
    }
    case 'get':
      argv.push('get', `--property=${oneOf(args, 'property', PROPERTIES) ?? 'text'}`, '--', ref());
      break;
    case 'is':
      argv.push('is', `--property=${oneOf(args, 'state', STATES, true)}`, '--', ref());
      break;
    case 'wait': {
      argv.push('wait');
      const wait = integer(args, 'timeoutMs', 100, 25_000, 10_000)!;
      timeoutMs = wait + 10_000;
      if (args.ref !== undefined) {
        const predicate = oneOf(args, 'predicate', PREDICATES) ?? 'exists';
        argv.push(`--element=${ref()}`, `--predicate=${predicate}`, `--timeout=${wait}`);
        if (predicate === 'value') argv.push(`--value=${text(args, 'value', 2000, true)}`);
      } else if (args.text !== undefined) {
        argv.push(`--text=${text(args, 'text', 200, true)}`, `--timeout=${wait}`);
        const app = text(args, 'app', 128);
        if (app) argv.push(`--app=${app}`);
      } else if (args.window !== undefined) {
        argv.push(`--window=${text(args, 'window', 200, true)}`, `--timeout=${wait}`);
      } else if (args.ms !== undefined) {
        argv.push('--', String(integer(args, 'ms', 50, 10_000)));
      } else throw Error('wait 需要 ref、text、window 或 ms 之一');
      break;
    }
    case 'click': case 'clear': case 'toggle': case 'check': case 'uncheck': case 'expand': case 'collapse': case 'scroll_to':
      argv.push(action.replace('_', '-'), '--', ref());
      break;
    case 'set_value': {
      const value = args.value;
      if (typeof value !== 'string' || value.length > 8192) throw Error('value 须为不超过 8192 字的文字');
      argv.push('set-value', '--', ref(), value);
      break;
    }
    case 'select':
      argv.push('select', '--', ref(), text(args, 'value', 200, true)!);
      break;
    case 'scroll':
      argv.push('scroll', `--direction=${oneOf(args, 'direction', DIRECTIONS) ?? 'down'}`, `--amount=${integer(args, 'amount', 1, 20, 3)}`, '--', ref());
      break;
    case 'press': {
      const app = text(args, 'app', 128, true);
      argv.push('press', `--app=${app}`, '--', validateKeys(args.keys));
      break;
    }
  }
  return {argv, timeoutMs};
}

type Node = {role?: string; name?: string; value?: unknown; ref_id?: string | null; states?: string[]; children?: Node[]; children_count?: number};
const clip = (value: unknown, max = VALUE_LIMIT) => {
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
};
const NAMED_CONTAINERS = new Set(['window', 'dialog', 'document', 'group', 'list', 'tablist', 'menu', 'menubar', 'toolbar', 'status', 'tree', 'table', 'pane', 'sheet']);
const shortRef = (ref: string) => ref.replace(/^@s[a-z0-9]+:/, '');

function describe(node: Node) {
  const states = (node.states ?? []).filter(s => s !== 'readonly');
  let line = `${node.role ?? 'unknown'}`;
  if (node.name) line += ` ${clip(node.name, 80)}`;
  if (states.length) line += ` [${states.join(',')}]`;
  if (node.value !== undefined && node.value !== null && node.value !== '' && node.value !== node.name) line += ` =${clip(node.value)}`;
  return line;
}

/** One line per element, indented by nesting; ref-less named containers stay as context. */
export function formatTree(tree: Node): string[] {
  const lines: string[] = [];
  const walk = (node: Node, depth: number) => {
    let next = depth;
    if (node.ref_id) {
      lines.push(`${'  '.repeat(depth)}${shortRef(node.ref_id)} ${describe(node)}${node.children_count ? ` (+${node.children_count})` : ''}`);
      next++;
    } else if (node.name && NAMED_CONTAINERS.has(node.role ?? '')) {
      lines.push(`${'  '.repeat(depth)}· ${describe(node)}${node.children_count ? ` (+${node.children_count})` : ''}`);
      next++;
    } else if (node.children_count && !node.children?.length) {
      lines.push(`${'  '.repeat(depth)}· ${node.role ?? 'group'} (+${node.children_count})`);
    }
    for (const child of node.children ?? []) walk(child, next);
  };
  walk(tree, 0);
  return lines;
}

const limit = (body: string) => body.length > OUTPUT_LIMIT
  ? body.slice(0, OUTPUT_LIMIT) + '\n…（输出过长已截断：请用 skeleton、root 或 find 缩小范围）'
  : body;

/** Turns agent-desktop's JSON envelope into compact text for the model. */
export function formatResult(action: string, envelope: any): {text: string; snapshotId?: string} {
  if (!envelope || typeof envelope !== 'object') throw Error('界面工具返回了无法识别的结果');
  if (envelope.ok !== true) {
    const e = envelope.error ?? {};
    const parts = [`失败：${e.code ?? 'ERROR'} ${clip(e.message ?? '', 300)}`];
    if (e.suggestion) parts.push(`建议：${clip(e.suggestion, 300)}`);
    if (e.disposition?.retry) parts.push(`可否重试：${e.disposition.retry === 'safe' ? '可以' : '不要直接重试，先重新查看界面'}`);
    if (['STALE_REF', 'SNAPSHOT_NOT_FOUND', 'AMBIGUOUS_TARGET'].includes(e.code)) parts.push('请重新 snapshot 或 find，用新的编号再试。');
    throw Error(parts.join('\n'));
  }
  const data = envelope.data ?? {};
  if (action === 'windows') {
    const rows = (Array.isArray(data) ? data : []).map((w: any) => `${w.id} ${w.app_name} ${clip(w.title ?? '', 100)}${w.is_focused ? ' [前台]' : ''}${w.minimized ? ' [最小化，无法操作]' : ''}`);
    return {text: limit(rows.length ? rows.join('\n') : '没有可见窗口')};
  }
  if (action === 'snapshot') {
    const lines = data.tree ? formatTree(data.tree) : [];
    const head = `快照 ${data.snapshot_id}：${data.ref_count ?? 0} 个可操作元素${data.complete === false ? '，未加载完整（可调大 timeoutMs 再试）' : ''}。ref 用 e 编号，只对这次快照有效。`;
    return {text: limit([head, ...lines].join('\n')), snapshotId: SNAPSHOT_ID.test(data.snapshot_id ?? '') ? data.snapshot_id : undefined};
  }
  if (action === 'find') {
    const matches: any[] = data.matches ?? (data.match ? [data.match] : []);
    // Find results carry full refs: a short `eN` always means the latest snapshot, never a find, so numbers cannot be mixed up.
    const rows = matches.map(m => {
      const where = (m.path ?? []).filter((p: unknown) => typeof p === 'string' && /:./.test(p)).slice(-3).join(' › ');
      return `${m.ref_id ?? '（无编号）'} ${describe(m)}${where ? `  ← ${clip(where, 120)}` : ''}`;
    });
    const head = `查找：${data.total_matches ?? matches.length} 个结果${data.truncated ? '（只列出前一部分）' : ''}。ref 用完整编号。`;
    const roles = !matches.length && data.roles_present ? `\n此窗口里有这些角色：${data.roles_present.join('、')}` : '';
    return {text: limit([head, ...rows].join('\n') + roles)};
  }
  if (action === 'get') return {text: `${data.property}：${data.value === null || data.value === undefined ? '（空）' : clip(typeof data.value === 'string' ? data.value : JSON.stringify(data.value), 4000)}`};
  if (action === 'is') return {text: `${data.property ?? data.state ?? '状态'}：${JSON.stringify(data.value ?? data.result ?? data)}`};
  if (action === 'wait') return {text: data.found === false ? '等待结束，未满足条件' : `条件已满足（${data.elapsed_ms ?? '?'} 毫秒）`};
  const delivery = data.disposition?.delivery ?? 'unknown';
  const lines = [`已执行 ${action}：${delivery === 'delivered_verified' ? '已送达并核对一致' : delivery === 'delivered_unverified' ? '已送达，但程序没有确认效果' : delivery}`];
  if (data.post_state?.value !== undefined) lines.push(`当前值：${clip(data.post_state.value, 300)}`);
  if (delivery !== 'delivered_verified') lines.push('请重新 snapshot 或 find 核对界面是否真的变化；点击没生效时可以试 select，或改用 computer 截图操作。');
  return {text: lines.join('\n')};
}

const memberSession = (memberKey: string) => 'm-' + createHash('sha256').update(memberKey).digest('hex').slice(0, 24);

/** Runs the pinned agent-desktop binary headless, one member session per caller, with state kept under the data directory. */
export class DesktopTools {
  private verified?: {size: number; mtimeMs: number};
  private prepared = false;
  private latest = new Map<string, string>();
  private runs = new Map<string, Set<string>>();
  private busy = new Set<string>();
  constructor(private binary: string, private stateRoot: string, private active: (runId: string) => boolean, private platform: NodeJS.Platform = process.platform, private expectedHash = AGENT_DESKTOP_SHA256) {}

  private verify() {
    if (!existsSync(this.binary)) throw Error('界面操作程序缺失，请重新安装 HiveLab 合屋');
    const info = statSync(this.binary);
    if (this.verified && this.verified.size === info.size && this.verified.mtimeMs === info.mtimeMs) return;
    const digest = createHash('sha256').update(readFileSync(this.binary)).digest('hex');
    if (digest !== this.expectedHash) throw Error('界面操作程序校验失败，已停止运行');
    this.verified = {size: info.size, mtimeMs: info.mtimeMs};
  }

  /** The state root holds UI text from snapshots: create it readable by the current user only. */
  private async prepareState() {
    if (this.prepared) return;
    mkdirSync(this.stateRoot, {recursive: true});
    if (this.platform === 'win32') {
      const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
      const run = (file: string, argv: string[]) => new Promise<string>((resolve, reject) => execFile(path.join(system32, file), argv, {windowsHide: true, timeout: 10_000, encoding: 'utf8'}, (error, stdout) => error ? reject(error) : resolve(stdout)));
      // The SID is language independent; account names may be localized or non-ASCII.
      const sid = /"(S-1-5-[\d-]+)"/.exec(await run('whoami.exe', ['/user', '/fo', 'csv', '/nh']))?.[1];
      if (!sid) throw Error('无法确认当前用户，界面操作未执行');
      try { await run('icacls.exe', [this.stateRoot, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`]); }
      catch { throw Error('无法把界面操作状态目录设为仅本人可读，已停止'); }
    }
    this.prepared = true;
  }

  sessionDirectory(memberKey: string) { return path.join(this.stateRoot, 'sessions', memberSession(memberKey)); }

  /** Drops snapshot state of members whose runs ended. */
  reconcile() {
    const ended = new Set<string>();
    for (const [runId, members] of this.runs) {
      if (this.active(runId)) continue;
      this.runs.delete(runId);
      for (const member of members) ended.add(member);
    }
    const busy = new Set([...this.runs.values()].flatMap(members => [...members]));
    for (const memberKey of ended) {
      if (busy.has(memberKey)) continue;
      this.latest.delete(memberKey);
      rmSync(this.sessionDirectory(memberKey), {recursive: true, force: true});
    }
  }

  /** Removes all leftover snapshot state, e.g. after an unclean exit. */
  sweep() { rmSync(path.join(this.stateRoot, 'sessions'), {recursive: true, force: true}); }

  async call(runId: string, memberKey: string, args: Args): Promise<string> {
    if (this.platform !== 'win32') throw Error('界面元素操作目前只支持 Windows');
    if (!this.active(runId)) throw Error('本轮已结束，界面操作未执行');
    if (typeof memberKey !== 'string' || !memberKey) throw Error('缺少成员身份');
    if (this.busy.has(memberKey)) throw Error('上一项界面操作还没结束，请稍后重试');
    const command = desktopCommand(args ?? {}, this.latest.get(memberKey));
    this.busy.add(memberKey);
    try {
      this.verify();
      await this.prepareState();
      this.runs.set(runId, (this.runs.get(runId) ?? new Set()).add(memberKey));
      const agentId = 'r-' + createHash('sha256').update(runId).digest('hex').slice(0, 16);
      const env: NodeJS.ProcessEnv = {AGENT_DESKTOP_HOME: this.stateRoot};
      for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'USERNAME', 'USERDOMAIN']) if (process.env[key]) env[key] = process.env[key];
      const argv = [`--session=${memberSession(memberKey)}`, `--agent-id=${agentId}`, ...command.argv];
      const output = await new Promise<string>((resolve, reject) => {
        execFile(this.binary, argv, {windowsHide: true, timeout: command.timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', env}, (error, stdout) => {
          if (stdout && stdout.trim().startsWith('{')) resolve(stdout);
          else reject(error?.killed ? Error('界面操作超时') : Error('界面操作程序没有返回结果'));
        });
      });
      if (!this.active(runId)) throw Error('本轮已结束');
      let envelope: any;
      try { envelope = JSON.parse(output); } catch { throw Error('界面操作程序返回了无法解析的结果'); }
      const result = formatResult(String(args.action), envelope);
      if (result.snapshotId) this.latest.set(memberKey, result.snapshotId);
      return result.text;
    } finally {
      this.busy.delete(memberKey);
    }
  }
}

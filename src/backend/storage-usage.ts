import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { EXECUTOR_CATALOG, catalogEntry } from '../shared/executor-catalog';
import type { StorageCategory, StorageEntry, StorageUsage } from '../shared/storage';
import { PROVIDER_NAMES } from '../shared/defaults';
import { countStaleOwnedTemp } from './owned-temp';
import { catalogStatuses } from './executor-catalog';
import { installedVersions } from './member-versions';
import type { MemberWorkspaces } from './member-workspaces';
import type { Store } from './store';
import type { Settings } from '../shared/types';

/** Bytes under a path. Links and junctions are counted as themselves and never followed. */
export async function sizeOf(target: string): Promise<number> {
  let total = 0;
  const pending = [target];
  while (pending.length) {
    const batch = pending.splice(0, 32);
    await Promise.all(batch.map(async item => {
      const info = await lstat(item).catch(() => undefined);
      if (!info) return;
      if (info.isSymbolicLink() || !info.isDirectory()) { total += info.size; return; }
      const entries = await readdir(item).catch(() => [] as string[]);
      for (const entry of entries) pending.push(path.join(item, entry));
    }));
  }
  return total;
}

const LIVE_DATABASE = /^hivelab\.sqlite(-wal|-shm)?$/i;
/** Copies of the database left by earlier updates and migrations; the live database never matches. */
export const isDatabaseBackup = (name: string) => !LIVE_DATABASE.test(name) && /sqlite/i.test(name) && /\.bak/i.test(name);
const LOG_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

function categoryOf(name: string, directory: boolean): StorageCategory {
  if (isDatabaseBackup(name)) return 'backups';
  if (LIVE_DATABASE.test(name)) return 'database';
  if (!directory) return 'other';
  return ({ members: 'programs', desks: 'desks', native: 'native', backgrounds: 'media', 'startup-media': 'media', 'process-temp': 'temp', logs: 'logs', attachments: 'attachments', 'generated-files': 'attachments', browsers: 'runtime', runtimes: 'runtime', electron: 'runtime', 'native-plugins': 'runtime', extensions: 'runtime', 'plugin-bridge': 'runtime' } as Record<string, StorageCategory>)[name] ?? 'other';
}

/** Plain names for what sits at the top of the data folder. Anything else shows by its own name. */
const ENTRY_LABELS: Record<string, string> = {
  members: '执行端程序', desks: '工位文件夹', native: '登录与原生会话', backgrounds: '壁纸与背景视频', 'startup-media': '启动动画',
  'process-temp': '执行端临时目录', logs: '事件日志', attachments: '聊天附件', 'generated-files': '成员生成的文件',
  browsers: '内置浏览器', runtimes: '运行环境（Node.js 等）', electron: '应用浏览数据与缓存', 'native-plugins': '执行端原生插件',
  extensions: '扩展与 Skills', 'plugin-bridge': '插件连接配置', workspaces: '项目成果副本', lounge: '休息室资料', lounges: '各房间休息室资料',
  roundtable: '圆桌资料', assets: '头像与人物图片', 'browser-output': '内置浏览器下载与截图', 'account-balances': '账户余额缓存',
  'glm-api-history': 'GLM API 调用记录', secrets: '加密保存的密钥', 'hivelab.sqlite': '数据库主文件', 'hivelab.sqlite-wal': '数据库预写日志（WAL）',
  'hivelab.sqlite-shm': '数据库共享内存', 'startup.log': '启动日志', '人物设定.md': '人物设定文件', 'workspace-covenant.md': '工作公约文件',
  'desk-directory-layout.json': '工位目录布局', 'adaptive-text-colors.json': '自适应文字颜色缓存', 'claude-token.secret': 'Claude 登录凭据',
};
/** Folders shown one level deeper, because the folder itself says too little. */
const SPLIT: Record<string, (name: string) => string> = {
  native: name => name === 'acp' ? 'ACP 连接（Gemini、Kimi 等）' : (PROVIDER_NAMES as Record<string, string>)[name] ?? EXECUTOR_CATALOG.find(entry => entry.id === name)?.name ?? name,
  'process-temp': name => /^owned-/i.test(name) ? `任务临时目录 ${name.slice(6)}` : name,
};
const TEMP_ROWS = 8;
const countable = new Set(['attachments', 'generated-files', 'backgrounds', 'startup-media', 'assets', 'logs', 'workspaces', 'lounges']);

let cached: { at: number; value: Promise<StorageUsage> } | undefined;

export function storageUsage(store: Store, settings: Settings, workspaces: MemberWorkspaces, refresh = false): Promise<StorageUsage> {
  if (!refresh && cached && Date.now() - cached.at < 60_000) return cached.value;
  const value = measure(store, settings, workspaces);
  cached = { at: Date.now(), value };
  value.catch(() => { cached = undefined; });
  return value;
}
export const forgetStorageUsage = () => { cached = undefined; };

async function measure(store: Store, settings: Settings, workspaces: MemberWorkspaces): Promise<StorageUsage> {
  const root = store.dataDirectory;
  const categories: Partial<Record<StorageCategory, number>> = {};
  const backups: StorageUsage['backups'] = [];
  const breakdown: Partial<Record<StorageCategory, StorageEntry[]>> = {};
  const add = (category: StorageCategory, entry: StorageEntry) => { categories[category] = (categories[category] ?? 0) + entry.bytes; (breakdown[category] ??= []).push(entry); };
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async entry => {
    const directory = entry.isDirectory(), category = categoryOf(entry.name, directory), full = path.join(root, entry.name);
    const split = directory ? SPLIT[entry.name] : undefined;
    if (split) {
      const children = await readdir(full, { withFileTypes: true }).catch(() => []);
      await Promise.all(children.map(async child => add(category, { path: `${entry.name}/${child.name}`, label: split(child.name), bytes: await sizeOf(path.join(full, child.name)), directory: child.isDirectory() })));
      if (!children.length) add(category, { path: entry.name, label: ENTRY_LABELS[entry.name] ?? entry.name, bytes: 0, directory: true });
      return;
    }
    const bytes = await sizeOf(full);
    const items = directory && countable.has(entry.name) ? (await readdir(full).catch(() => [] as string[])).filter(name => !name.endsWith('.json') || entry.name !== 'generated-files').length : undefined;
    add(category, { path: entry.name, label: ENTRY_LABELS[entry.name] ?? entry.name, bytes, directory, ...(items === undefined ? {} : { items }) });
    if (category === 'backups') backups.push({ name: entry.name, bytes });
  }));
  for (const [category, list] of Object.entries(breakdown) as [StorageCategory, StorageEntry[]][]) {
    list.sort((a, b) => b.bytes - a.bytes || a.label.localeCompare(b.label));
    // Temp holds dozens of small leftovers; the largest few tell the story, the rest are summed.
    if (category === 'temp' && list.length > TEMP_ROWS + 1) {
      const rest = list.splice(TEMP_ROWS);
      list.push({ path: 'process-temp', label: `其余 ${rest.length} 项`, bytes: rest.reduce((sum, item) => sum + item.bytes, 0), directory: true, items: rest.length });
    }
  }
  const statuses = catalogStatuses(store, settings);
  const programs = await Promise.all(EXECUTOR_CATALOG.flatMap(entry => {
    const versions = installedVersions(root, entry.id);
    if (!versions.length) return [];
    const status = statuses.find(item => item.entry.id === entry.id);
    const connections = store.executors().filter(item => item.catalogId === entry.id).map(item => item.id);
    return [(async () => ({
      id: entry.id, name: catalogEntry(entry.id).name, selectedVersion: status?.selectedVersion,
      connections: [...(connections.length ? [] : [entry.id]), ...connections],
      versions: await Promise.all(versions.map(async item => ({ version: item.version, bytes: await sizeOf(path.join(root, 'members', entry.id, item.version)), inUse: inUse(store, settings, root, entry.id, item.version) }))),
    }))()];
  }));
  const activeMembers = store.members();
  const members = new Map([...store.historicalMembers(), ...activeMembers].map(member => [member.id, member]));
  const desks = await Promise.all([...members.values()].map(async member => {
    let folder = '';
    try { folder = workspaces.folder(member.id); } catch { /* A card whose id cannot name a folder has no desk files. */ }
    return { memberId: member.id, name: member.name, removed: !activeMembers.some(item => item.id === member.id), folder, bytes: folder ? await sizeOf(folder) : 0, topics: workspaces.topicsOf(member.id) };
  })).then(list => list.filter(desk => !desk.removed || desk.bytes > 0 || desk.topics.length > 0)); // A deleted card with nothing left behind has nothing to clean.
  const logs = (await readdir(path.join(root, 'logs')).catch(() => [] as string[])).filter(name => LOG_FILE.test(name));
  const total = Object.values(categories).reduce((sum, bytes) => sum + (bytes ?? 0), 0);
  return { directory: root, measuredAt: new Date().toISOString(), total, categories, programs, desks, backups: backups.sort((a, b) => a.name.localeCompare(b.name)), logFiles: logs.length, breakdown, staleTemp: await countStaleOwnedTemp(path.join(root, 'process-temp')) };
}

/** Same rule as version removal: a version a connection or a built-in path points into is in use. */
function inUse(store: Store, settings: Settings, root: string, id: string, version: string) {
  const base = path.resolve(root, 'members', id, version);
  const inside = (file?: string) => { if (!file) return false; const rel = path.relative(base, path.resolve(file)); return !rel || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
  return Object.values(settings.paths).some(inside) || store.executors().some(item => inside(item.command));
}

/** Delete database copies by name; only files that are database backups in the data folder itself qualify. */
export async function removeDatabaseBackups(root: string, names: unknown): Promise<number> {
  const list = Array.isArray(names) ? names.map(String) : [];
  let removed = 0;
  for (const name of list) {
    if (name !== path.basename(name) || !isDatabaseBackup(name)) throw new Error(`不能删除：${name}`);
    const file = path.join(root, name), info = await lstat(file).catch(() => undefined);
    if (!info?.isFile()) continue;
    await rm(file, { force: true }); removed++;
  }
  forgetStorageUsage();
  return removed;
}

/** Event logs are also kept in the database; daily files older than the cut-off are only a second copy. */
export async function removeOldLogs(root: string, days: number): Promise<number> {
  const cutoff = new Date(Date.now() - Math.max(7, days) * 86_400_000).toISOString().slice(0, 10);
  const directory = path.join(root, 'logs');
  let removed = 0;
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    const date = LOG_FILE.exec(name)?.[1];
    if (!date || date >= cutoff) continue;
    await rm(path.join(directory, name), { force: true }); removed++;
  }
  forgetStorageUsage();
  return removed;
}

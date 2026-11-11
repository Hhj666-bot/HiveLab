import {t} from './i18n';
/** Where the data folder's space goes, as the 存储 settings page shows it. */
export type StorageCategory = 'programs' | 'desks' | 'native' | 'database' | 'attachments' | 'media' | 'runtime' | 'temp' | 'logs' | 'backups' | 'other';

export const STORAGE_CATEGORIES: { id: StorageCategory; label: string; hint: string }[] = [
  { id: 'programs', get label(){return t("执行端程序")}, get hint(){return t("从清单下载的 CLI 程序本体，可按版本删除或整体卸载。")} },
  { id: 'desks', get label(){return t("工位文件")}, get hint(){return t("各成员个人文件夹里的工作文件。")} },
  { id: 'native', get label(){return t("登录与原生会话")}, get hint(){return t("各执行端的登录状态和它们自己的会话记录，删除会丢失登录。")} },
  { id: 'database', get label(){return t("聊天与设置数据库")}, get hint(){return t("聊天记录、人物卡和设置；删除话题会释放其中的记录。")} },
  { id: 'attachments', get label(){return t("附件与生成文件")}, get hint(){return t("聊天里的附件和成员生成的图片、文件。")} },
  { id: 'media', get label(){return t("背景与启动媒体")}, get hint(){return t("壁纸、背景视频和启动动画。")} },
  { id: 'runtime', get label(){return t("运行环境与插件")}, get hint(){return t("内置浏览器、运行环境、扩展和插件。")} },
  { id: 'temp', get label(){return t("临时文件")}, get hint(){return t("执行端运行时的临时目录，启动时自动清理残留。")} },
  { id: 'logs', get label(){return t("日志")}, get hint(){return t("按天保存的事件日志副本，数据库里另有一份。")} },
  { id: 'backups', get label(){return t("旧数据库备份")}, get hint(){return t("升级、迁移时留下的数据库副本，确认不再回退后可以删除。")} },
  { id: 'other', get label(){return t("其他")}, hint: '' },
];

/** One measured piece of a category: a folder or file under the data folder, by its path relative to it. */
export interface StorageEntry { path: string; label: string; bytes: number; directory: boolean; items?: number }
export interface StorageTopic { id: string; title: string; messages: number; directory: string; current: boolean; updatedAt: string }
export interface StorageUsage {
  directory: string; measuredAt: string; total: number;
  categories: Partial<Record<StorageCategory, number>>;
  programs: { id: string; name: string; selectedVersion?: string; connections: string[]; versions: { version: string; bytes: number; inUse: boolean }[] }[];
  desks: { memberId: string; name: string; removed?: boolean; folder: string; bytes: number; topics: StorageTopic[] }[];
  backups: { name: string; bytes: number }[];
  logFiles: number;
  /** What each category is made of, largest first. */
  breakdown: Partial<Record<StorageCategory, StorageEntry[]>>;
  /** Directories in process-temp left by HiveLab processes that have ended; safe to remove. */
  staleTemp: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

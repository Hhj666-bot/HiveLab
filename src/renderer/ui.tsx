import {t} from './i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { isAcpId } from '../shared/defaults';
import type {ProviderId, ProviderInfo, RunSummary, Session } from '../shared/types';

export type Invoke = <T = unknown>(method: string, params?: unknown, success?: string, options?:{background?:boolean}) => Promise<T>;
export type Notify = (text: string, error?: boolean) => void;
export type Perform = (method: string, params?: unknown, success?: string) => void;

/** Executors in team order. The DeepSeek API stand-in is retired: DSH runs on its own account. */
export const PROVIDERS: ProviderId[] = ['claude', 'codex', 'dsh'];
export const RUN_LABELS: Record<RunSummary['status'], string> = {
  get queued(){return t("排队中")}, get running(){return t("进行中")}, get waiting_user(){return t("等你回应")}, get rate_limited(){return t("额度受限")},
  get stopping(){return t("正在停止")}, get stopped(){return t("已停止")}, get ended(){return t("完成 · 待验收")}, get completed(){return t("已验收")},
  get interrupted(){return t("运行中断")}, get unknown(){return t("状态待核对")}, get failed(){return t("没能完成")},
};
/** A finished run awaits acceptance only when its file changes are still in place; an answer is simply done.
 * Project-flow runs are accepted per round on the project board, never run by run. */
export const runLabel = (run: Pick<RunSummary, 'status' | 'workspaceUndo'> & Partial<Pick<RunSummary, 'flowOperationId'>>) => run.status === 'ended' && (run.flowOperationId || run.workspaceUndo?.status !== 'available') ? t("已完成") : RUN_LABELS[run.status];
const ACTIVE_RUNS = new Set<RunSummary['status']>(['running', 'waiting_user', 'rate_limited', 'stopping']);
export const isActiveRun = (run: RunSummary) => ACTIVE_RUNS.has(run.status) && !run.completedAt;
export function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
/** Month, day and minute: enough to tell list rows apart without a full timestamp. */
export function shortDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
export function dateTime(value?: string) {
  if (!value) return t("尚未检查");
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}
export function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(1)} MB`;
}
/** A failure as shown to the user; backend messages are Chinese and go through the dictionary here. */
export function errorText(error: unknown) {
  return t(error instanceof Error ? error.message : String(error));
}
export function providerSummary(provider?: ProviderInfo) {
  if (!provider) return t("尚未检查");
  if(provider.installationRequired)return t("需要下载");
  if (provider.stale) return provider.available ? t("上次已连接 · 待复核") : t("上次未就绪 · 待复核");
  if (!provider.available) return provider.auth === 'none' ? t("需要登录") : t("未就绪");
  if (provider.auth === 'subscription') return t("订阅登录");
  if (provider.auth === 'account') return isAcpId(provider.id) ? t("已连接") : t("独立账号已登录");
  if (provider.auth === 'api') return provider.id === 'codex' ? t("需改为订阅") : t("API 计费");
  if (provider.auth === 'none') return t("需要登录");
  return t("认证待确认");
}
/** A member program's version for display: DSH reports a bare number, so its name is added. */
export function versionText(provider?: ProviderInfo) {
  const version = provider?.version?.trim();
  if (!version) return '';
  return provider!.id === 'dsh' && !/harness/i.test(version) ? `DeepSeek Harness ${version}` : version;
}
export function runnable(provider?: ProviderInfo) {
  if (!provider?.available || provider.stale) return false;
  // External programs may use a saved API key as well as a browser account/subscription.
  if (isAcpId(provider.id)) return ['account', 'subscription', 'api'].includes(provider.auth);
  return provider.id === 'claude' ? ['subscription','api'].includes(provider.auth) : provider.id === 'codex' ? provider.auth === 'subscription' : provider.id === 'dsh' ? provider.auth === 'account' : provider.auth === 'api';
}

const DEFAULT_TITLE = /^(Codex|Claude|DeepSeek Harness|DeepSeek · DSH|DeepSeek API|DeepSeek)\s*(对话|会话)$/;
/** Sessions created without a name take the first task as their title. */
export function sessionTitle(session: Session, firstInput?: string) {
  if (!(session.autoTitle || DEFAULT_TITLE.test(session.title)) || !firstInput?.trim()) return session.title;
  const line = firstInput.trim().split('\n')[0].replace(/\s+/g, ' ');
  return line.length > 22 ? `${line.slice(0, 22)}…` : line;
}


export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return t("夜深了");
  if (hour < 11) return t("早上好");
  if (hour < 13) return t("中午好");
  if (hour < 18) return t("下午好");
  if (hour < 23) return t("晚上好");
  return t("夜深了");
}

/** Re-render every `ms` while `active`; used for live timers. */
export function useTicker(active: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [active, ms]);
  return now;
}

export function IconButton({ label, children, onClick, disabled, className = '' }: {
  label: string; children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string;
}) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return <div className="small-empty"><span className="empty-symbol">{icon}</span><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

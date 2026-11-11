import {t} from './i18n';
import { useEffect, useState } from 'react';
import type { RunSummary, Snapshot } from '../shared/types';
import type { Invoke } from './ui';

/** A reminder only: time passing never cancels or resends work. */
export function RunProgress({ run, invoke, label = t("当前阶段"), canNudge = false, thresholdSeconds = 180 }: {
  run: Pick<RunSummary, 'id' | 'status' | 'createdAt'>; invoke: Invoke; label?: string; canNudge?: boolean; thresholdSeconds?: number;
}) {
  const [clock, setClock] = useState(Date.now), [remindAt, setRemindAt] = useState(0);
  const [busy, setBusy] = useState(false), [delivery, setDelivery] = useState(''), [error, setError] = useState('');
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!['queued', 'running', 'waiting_user', 'stopping'].includes(run.status)) return null;
  const elapsed = Math.max(0, Math.floor((clock - Date.parse(run.createdAt)) / 1000));
  const overdue = elapsed >= thresholdSeconds && clock >= remindAt;
  async function nudge() {
    setBusy(true); setError('');
    try {
      const result = await invoke<{ delivery: string }>('run.nudge', { runId: run.id });
      setDelivery(result.delivery);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function stop() {
    if (!window.confirm(t("停止这一份？其他成员继续工作，已保存的记录和工作副本保留。"))) return;
    setBusy(true); setError('');
    try { await invoke('run.stop', { runId: run.id }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section aria-label={t("{0}运行进度", label)}>
    <p role="status">{label} {t(" · 已用 {0} 分 {1} 秒", Math.floor(elapsed / 60), elapsed % 60)}{run.status === 'stopping' && t(" · 正在停止")}</p>
    {overdue && <><p>{t("这一份用时较长，可以继续等待、补充收尾要求或停止这一份。")}</p>
      <button className="button small secondary" onClick={() => setRemindAt(Date.now() + thresholdSeconds * 1000)}>{t("再等等")}</button>
      <button className="button small secondary" disabled={busy || !canNudge || Boolean(delivery) || run.status !== 'running'} title={!canNudge ? t("此执行端不支持中途补充，可以继续等待或停止这一份。") : undefined} onClick={() => void nudge()}>{t("催一下")}</button>
      <button className="button small stop-button" disabled={busy || run.status === 'stopping'} onClick={() => void stop()}>{t("停止这一份")}</button>
    </>}
    {delivery && <p role="status">{delivery === 'current' ? t("已补充收尾要求，本轮不会重新发送。") : delivery === 'unknown' ? t("收尾要求是否送达待核对，未重复发送。") : t("此时无法补充，请继续等待或停止这一份。")}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function ActiveRunProgress({ snapshot, invoke, sessionIds, label }: {
  snapshot: Snapshot; invoke: Invoke; sessionIds: string[]; label: string;
}) {
  return <>{snapshot.runs.filter(run => sessionIds.includes(run.sessionId) && ['queued', 'running', 'waiting_user', 'stopping'].includes(run.status)).map(run =>
    <RunProgress key={run.id} run={run} invoke={invoke} label={`${label} · ${snapshot.members?.find(member => member.id === snapshot.sessions.find(session => session.id === run.sessionId)?.memberId)?.name ?? run.provider}`} canNudge={snapshot.providers.find(provider => provider.id === run.provider)?.capabilities.steer === true} />,
  )}</>;
}

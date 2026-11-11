import {t} from './i18n';
import type {Snapshot} from '../shared/types';
import type {Invoke} from './ui';

// 不再显示设置队列，改为在保存时弹出提示
export function PendingSettings({snapshot,invoke}:{snapshot:Snapshot;invoke:Invoke}){
  // 只有失败或冲突时才显示提示
  const failed = snapshot.pendingChanges?.filter(job => job.state === 'failed' || job.state === 'unknown');
  if (!failed?.length) return null;

  return <section className="settings-group" aria-label={t("设置应用失败")}><h3>{t("需要处理的设置")}</h3><p className="settings-description">{t("成员工作时保存的设置会排队，等成员空闲后再应用。下面这些没能应用：排队期间同一项设置又被改过，为避免覆盖较新的内容而放弃。请核对当前设置，需要的话重新保存，然后点“忽略”。")}</p>{failed.map(job=><div key={job.id} className="provider-settings"><strong>{job.label}</strong><p className="task-meta bad">{job.error || t("应用失败，请重试")}</p><p className="task-meta">{t("提交于 {0}", new Date(job.createdAt).toLocaleString())}</p><button className="button small quiet" onClick={()=>void invoke('member.change.cancel',{id:job.id}).catch(()=>{})}>{t("忽略")}</button></div>)}</section>;
}

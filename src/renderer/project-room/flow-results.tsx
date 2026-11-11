import {t} from '../i18n';
import {joinClauses, readableContent} from "../../shared/content-presentation";
import {useState} from "react";
import type {Task, TaskSupplement, FlowCompletionReport} from "../../shared/project-flow";
import {Markdown} from "../Markdown";
import {time} from "../ui";

const SUPPLEMENT_STATUS: Record<TaskSupplement['status'], string> = { get pending(){return t("等待送达")}, get delivering(){return t("正在送达")}, get delivered(){return t("已送达，成员正在处理")}, get submitted(){return t("已随提交交回")}, get applied(){return t("已纳入")}, get unknown(){return t("是否送达待核对")}, get awaiting_scope(){return t("超出范围，等你决定")}, get dismissed(){return t("已撤回")}, get replanned(){return t("已转入新方案")} };
export function CompletionReport({ report }: { report: FlowCompletionReport }) {
  const fixes = report.corrections.length, returns = report.userReturns.length;
  return <details className="completion-report"><summary>{t("整段工作总结 · {0} 轮{1}{2}{3}", report.rounds.length, fixes ? t(" · {0} 次修正", fixes) : '', returns ? t(" · 你驳回 {0} 次", returns) : '', report.roundtables.length ? t(" · 引用圆桌 {0} 次", report.roundtables.length) : '')}</summary>
    <ol>{report.rounds.map(round => <li key={round.roundId}><strong>{round.title}</strong><Markdown text={readableContent(round.summary)} />{round.deliverables.length > 0 && <p className="task-meta">{t("成果：{0}", joinClauses(round.deliverables, '、'))}</p>}</li>)}</ol>
    {fixes > 0 && <p className="task-meta">{t("修正：{0}", report.corrections.map(item => item.title).join('；'))}</p>}
    {report.remainingIssues.length > 0 && <div className="completion-remaining"><strong>{t("遗留")}</strong><ul>{report.remainingIssues.map(item => <li key={item}>{item}</li>)}</ul></div>}
  </details>;
}

export function SupplementReceipts({ task }: { task: Task }) {
  if (!task.supplements?.length) return null;
  return <div className="supplement-receipts" aria-label={t("「{0}」的补充要求", task.title)}><strong>{t("补充要求 · {0}", task.title)}</strong><ul>{task.supplements.map(item => <li key={item.id}><span>{item.text}</span><small className={`supplement-${item.status}`}>{SUPPLEMENT_STATUS[item.status] ?? item.status} · {time(item.createdAt)}</small></li>)}</ul></div>;
}

export function GiveUp({ unknown, supplement = false, task = false, busy, onConfirm,onContinue }: { unknown: boolean; supplement?: boolean; task?: boolean; busy: boolean; onConfirm: (evidence: string) => Promise<boolean>;onContinue?:(evidence:string)=>Promise<boolean> }) {
  const [reason, setReason] = useState<string | null>(null),[continuing,setContinuing]=useState(false);
  if (reason === null) return <div className="round-actions">{onContinue&&<button type="button" className="button small secondary" disabled={busy} onClick={()=>{setContinuing(true);setReason('');}}>{t("接着做")}</button>}<button type="button" className="button small danger-outline" disabled={busy} onClick={() => {setContinuing(false);setReason('');}}>{unknown ? t("放弃旧尝试") : t("放弃这次尝试，重新安排")}</button></div>;
  return <div className="task-giveup" role="group" aria-label={t("放弃这次尝试")}>
    <p>{continuing?t("先查看原工作记录，确认旧运行已经结束，可选填核对情况。接着做会沿用原会话，作者保留原副本；复核会重新核对同一成果版本。"):supplement ? t("本次补充是否送达尚未核对。查看工作记录后，可以直接放弃旧尝试；补充要求会保留，点“继续”后重新执行。") : unknown ? t("这一次的结果未知。看过工作记录后，可以直接放弃这次旧尝试；核对情况可选填。") : task ? t("放弃后由同一位成员开新会话，从本轮起点重新做这项任务；上次副本里的改动不保留，原因会记录下来。要换人，请在任务卡上选“换人…”。流程运行中会立即重新开始；暂停时需点“继续”。") : t("放弃这次没通过检查的尝试，原因会记录下来，再按同一成果版本重新安排。流程运行中会继续安排；暂停时需点“继续”。")}</p>
    <textarea rows={2} aria-label={t("放弃的原因")} placeholder={t("补充原因（可选）")} value={reason} onChange={event => setReason(event.target.value)} />
    <div className="round-actions"><button type="button" className="button small primary" disabled={busy} onClick={() => void (continuing?onContinue!:onConfirm)(reason.trim()).then(ok => { if (ok) setReason(null); })}>{continuing?t("确定接着做"):t("确定放弃")}</button><button type="button" className="button small quiet" disabled={busy} onClick={() => setReason(null)}>{t("取消")}</button></div>
  </div>;
}

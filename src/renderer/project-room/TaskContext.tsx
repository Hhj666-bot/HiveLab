import {t} from '../i18n';
import type {Task} from '../../shared/project-flow';
import {DELIVERY_LABELS} from '../../shared/task-context';
import {dateTime} from '../ui';
import styles from './TaskContext.module.css';
import {MemberName} from './people';

export function TaskContext({task}: {task:Task}) {
  const context = task.context;
  if (!context) return null;
  const receipt = context.receipts.find(r => r.current);
  return <section className={styles.context} aria-label={t("任务进展与确认依据")}>
    <h4>{t("当前进展")}</h4>
    <dl className={styles.facts}>
      <dt>{t("生效要求")}</dt><dd>{t("方案第 {0} 版 · 要求第 {1} 版", context.planVersion ?? '—', context.requirementsRevision)}{context.replacedBy && t(" · 已由方案第 {0} 版替代", context.replacedBy.version)}</dd>
      <dt>{t("执行回执")}</dt><dd>{receipt ? DELIVERY_LABELS[receipt.delivery] : t("尚无当前负责人的运行回执")}{receipt?.nativeTurnId && <small>{t("原生回合：{0}", receipt.nativeTurnId)}</small>}</dd>
      <dt>{t("成果")}</dt><dd>{context.submission ? <>{t("任务结果已提交 · 第 {0} 次提交", context.submission.sequence)}<small>{t("版本：{0}", context.submission.version.fingerprint)}</small></> : t("尚未提交成果")}</dd>
      <dt>{t("复核版本")}</dt><dd>{context.review ? `${context.review.current ? t("当前成果") : t("历史成果")} · ${context.review.version.fingerprint}` : t("尚无复核记录")}</dd>
      <dt>{t("验收")}</dt><dd>{task.status === 'accepted' ? t("已验收") : t("尚未验收")}</dd>
      <dt>{t("下一步")}</dt><dd>{context.nextAction}</dd>
    </dl>
    {Boolean(task.handovers?.length)&&<details><summary>{t("负责人交接 · {0}", task.handovers!.length)}</summary>{task.handovers!.map((h,i)=><p className={styles.receipt} key={i}><MemberName id={h.fromMemberId}/> → <MemberName id={h.memberId}/><small>{t("{0} · 要求第 {1} 版", dateTime(h.at), h.requirementsRevision)}</small>{h.reason&&<span>{h.reason}</span>}{h.fromRunId&&<small>{t("原运行：{0}", h.fromRunId)}</small>}{h.submissionId&&<small>{t("交接成果：{0}", h.submissionId)}</small>}</p>)}</details>}
    {context.decisions.length > 0 && <details><summary>{t("决定与用户确认 · {0}", context.decisions.length)}</summary>{context.decisions.map(d => <article className={styles.decision} key={d.id}>
      <strong>{d.title}</strong><p>{d.answer ? t("用户选择：{0}", d.answer.choice) : d.status === 'open' ? t("等待用户决定") : t("决定已失效")} · {d.effective ? t("适用于当前版本") : t("历史或待处理记录")}</p>
      <p>{d.scope} · {d.reason}</p>{d.answer?.opinion && <p>{d.answer.opinion}</p>}
      {d.sourceVersions.map(v => <small key={v.artifactId}>{t("依据版本：{0}", v.fingerprint)}</small>)}
      {d.source ? <details><summary>{t("原始用户记录 · {0}", dateTime(d.source.at))}</summary><blockquote>{d.source.text}</blockquote><small>{t("话题：")}{d.source.threadId} {t(" · 记录：")}{d.source.messageId}</small></details> : <small>{t("来源：已保存的决定 {0}，尚无会话投递记录", d.id)}</small>}
    </article>)}</details>}
    {context.receipts.length > 0 && <details><summary>{t("执行记录 · {0}", context.receipts.length)}</summary>{context.receipts.map(r => <p className={styles.receipt} key={r.runId}>{r.current ? t("当前会话") : t("历史会话")} · {DELIVERY_LABELS[r.delivery]}<small>{dateTime(r.createdAt)} · {r.runId}</small></p>)}</details>}
  </section>;
}

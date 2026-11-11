import {t,useLanguage} from './i18n';
import {memo,useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,ClipboardList,LoaderCircle,PencilLine} from 'lucide-react';
import type {Approval,RunSummary,Session} from '../shared/types';
import {PLAN_FEEDBACK_LIMIT,PLAN_STATUS_LABEL,type PlanStatus} from '../shared/plan-mode';
import {Markdown} from './Markdown';
import type {Invoke} from './ui';
import './plan-card.css';

/** The plan a desk turn proposed, shared by Claude (reviewed inside the turn), Codex and DSH (reviewed after it). */
export const PlanCard=memo(function PlanCard({run,review,active,invoke}:{run:RunSummary;review?:{approval?:Approval;latest:boolean};active:boolean;invoke:Invoke}){useLanguage();
  const proposal=run.planProposal;
  const status:PlanStatus|undefined=!proposal?undefined
    :proposal.status==='pending'?(review?.approval?'pending':'expired')
    :proposal.status==='ready'?(review?.latest&&!active?'ready':'expired')
    :proposal.status;
  const actionable=status==='pending'||status==='ready';
  const [open,setOpen]=useState(()=>actionable||status==='drafting');
  const [revising,setRevising]=useState(false),[feedback,setFeedback]=useState(''),[busy,setBusy]=useState<'execute'|'revise'|null>(null),[error,setError]=useState('');
  const field=useRef<HTMLTextAreaElement>(null);
  // A plan that becomes reviewable opens; one that is settled folds away, leaving its outcome in the header.
  useEffect(()=>{if(actionable)setOpen(true);else if(status==='approved'||status==='revising')setOpen(false);if(!actionable)setRevising(false);},[actionable,status]);
  useEffect(()=>{if(revising)field.current?.focus();},[revising]);
  if(!proposal||!status)return null;
  async function act(choice:'execute'|'revise'){
    const text=feedback.trim();
    if(choice==='revise'&&!text){setError(t("请写下要怎么改。"));field.current?.focus();return;}
    setBusy(choice);setError('');
    try{
      if(status==='pending'&&review?.approval)await invoke('approval.answer',{id:review.approval.id,choice,...(choice==='revise'?{answers:{feedback:text}}:{})});
      else await invoke(choice==='execute'?'plan.execute':'plan.revise',{runId:run.id,...(choice==='revise'?{text}:{})});
      setRevising(false);setFeedback('');
    }catch(cause){setError((cause as Error).message||t("操作没有完成，请重试。"));}
    finally{setBusy(null);}
  }
  const note=status==='pending'?t("成员已暂停，等你决定后继续。"):status==='ready'?t("批准后会开始新的一轮，按计划动手。"):status==='approved'?t("已按这份计划执行。"):status==='revising'?t("修改意见已发给成员，正在重新拟定。"):status==='expired'?t("这份计划已失效，不能再批准。"):t("计划还在拟定中。");
  return <details className="plan-card" data-status={status} open={open} onToggle={event=>setOpen((event.currentTarget as HTMLDetailsElement).open)}>
    <summary>
      <ClipboardList size={15} aria-hidden="true"/><strong>{t("计划")}</strong>
      <span className="plan-card-status">{status==='approved'&&<Check size={12} aria-hidden="true"/>}{status==='drafting'&&<LoaderCircle size={12} className="plan-card-spin" aria-hidden="true"/>}{PLAN_STATUS_LABEL[status]}</span>
      <ChevronDown size={14} aria-hidden="true"/>
    </summary>
    <div className="plan-card-body">
      {proposal.text?<div className="plan-card-text"><Markdown text={proposal.text} sessionId={run.sessionId}/></div>:<p className="plan-card-inline">{t("计划写在上面的回复里。")}</p>}
      <p className="plan-card-note">{note}</p>
      {actionable&&!revising&&<div className="plan-card-actions">
        <button type="button" className="button small primary" disabled={!!busy} onClick={()=>void act('execute')}>{busy==='execute'?<LoaderCircle size={14} className="plan-card-spin" aria-hidden="true"/>:<Check size={14} aria-hidden="true"/>}{t("按计划执行")}</button>
        <button type="button" className="button small secondary" disabled={!!busy} onClick={()=>{setRevising(true);setError('');}}><PencilLine size={14} aria-hidden="true"/>{t("修改计划")}</button>
      </div>}
      {actionable&&revising&&<form className="plan-card-revise" onSubmit={event=>{event.preventDefault();void act('revise');}}>
        <label className="plan-card-field"><span>{t("修改意见")}</span>
          <textarea ref={field} value={feedback} maxLength={PLAN_FEEDBACK_LIMIT} rows={3} placeholder={t("写下要怎么改，成员会按意见重新拟定计划")} disabled={!!busy}
            onChange={event=>setFeedback(event.target.value)}
            onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setRevising(false);}else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void act('revise');}}}/>
        </label>
        <div className="plan-card-actions">
          <button type="submit" className="button small primary" disabled={!!busy||!feedback.trim()}>{busy==='revise'?<LoaderCircle size={14} className="plan-card-spin" aria-hidden="true"/>:<PencilLine size={14} aria-hidden="true"/>}{t("发送修改意见")}</button>
          <button type="button" className="button small quiet" disabled={!!busy} onClick={()=>setRevising(false)}>{t("取消")}</button>
        </div>
      </form>}
      {error&&<p className="plan-card-error" role="alert">{error}</p>}
    </div>
  </details>;
});

/** The composer's plan switch for one desk topic; the mode stays on until a plan is approved or it is switched off. */
export function PlanModeSwitch({session,invoke}:{session:Pick<Session,'id'|'planMode'>;invoke:Invoke}){
  const on=!!session.planMode;
  return <button type="button" className="composer-plan composer-config glass-action" aria-pressed={on} aria-label={t("计划模式")}
    title={on?t("计划模式已打开：成员先拟定计划，你批准后再动手。点击关闭"):t("打开计划模式：下一轮先拟定计划，你批准后再动手")}
    onClick={()=>void invoke('session.planMode',{sessionId:session.id,on:!on},on?t("已关闭计划模式。"):t("已打开计划模式，下一轮先拟定计划。")).catch(()=>{})}>
    <ClipboardList size={14} aria-hidden="true"/>{t("计划")}</button>;
}

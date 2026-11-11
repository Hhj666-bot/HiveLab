import {t} from './i18n';
import { useEffect, useState } from 'react';
import { CalendarClock, Clock, Pause, Play, Trash2 } from 'lucide-react';
import type { Snapshot } from '../shared/types';
import { AUTOMATIC_FEATURES, AUTOMATION_TIME_ZONE, dailyLifeOptions, policiesOf, type AutomaticFeature, type TimedJob, type TimedSchedule } from '../shared/automation';
import { Modal } from './modals';
import { useTeam } from './members';
import { errorText, type Invoke, type Notify } from './ui';

const labels={get running(){return t("正在执行")},get done(){return t("已完成")},get skipped(){return t("已跳过")},get failed(){return t("失败")},get unknown(){return t("待核对")}};
const time=(at?:string)=>at?new Date(at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):t("没有后续触发");
const onceDefault=()=>{const date=new Date(Date.now()+120_000);return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);};
export function AutomationPanel({snapshot,invoke,notify,onClose}:{snapshot:Snapshot;invoke:Invoke;notify:Notify;onClose:()=>void}){
  const team=useTeam(),state=snapshot.automation;
  const policyKey=JSON.stringify(policiesOf(snapshot.settings.automationPolicies));
  const [policies,setPolicies]=useState(()=>policiesOf(snapshot.settings.automationPolicies));
  useEffect(()=>setPolicies(JSON.parse(policyKey)),[policyKey]);
  const savedInterval=dailyLifeOptions(snapshot.settings.dailyLife).memberChatMinutes;
  const [chatInterval,setChatInterval]=useState(savedInterval);
  useEffect(()=>setChatInterval(savedInterval),[savedInterval]);
  const jobs=state?.jobs.filter(job=>!job.managed)??[],lifeJobs=state?.jobs.filter(job=>job.managed)??[],recent=state?.recent.filter(item=>!item.system&&!item.parentOccurrenceId)??[];
  const [editing,setEditing]=useState<string>(),[name,setName]=useState(''),[text,setText]=useState(''),[action,setAction]=useState<'notice'|'member-message'>('notice'),[memberId,setMemberId]=useState(team.members[0]?.id??'claude');
  const [kind,setKind]=useState<TimedSchedule['kind']>('daily'),[daily,setDaily]=useState('09:00'),[zone,setZone]=useState(AUTOMATION_TIME_ZONE),[once,setOnce]=useState(onceDefault),[minutes,setMinutes]=useState(60),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function perform(work:()=>Promise<unknown>,message?:string){if(busy)return;setBusy(true);setError('');try{await work();if(message)notify(message);}catch(error){setError(errorText(error));}finally{setBusy(false);}}
  function edit(job:TimedJob){if(job.managed||job.action.kind!=='notice'&&job.action.kind!=='member-message')return;setEditing(job.id);setName(job.name);setText(job.action.text);setAction(job.action.kind);setEnabled(job.enabled);if(job.action.kind==='member-message')setMemberId(job.action.memberId);setKind(job.schedule.kind);if(job.schedule.kind==='daily'){setDaily(job.schedule.time);setZone(job.schedule.timeZone);}else if(job.schedule.kind==='interval')setMinutes(job.schedule.minutes);else{const date=new Date(job.schedule.at);setOnce(new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16));}}
  function reset(){setEditing(undefined);setName('');setText('');setEnabled(false);setAction('notice');}
  function acknowledge(job?:TimedJob){return !job?.pausedReason||window.confirm(t("请先核对上次触发和活动记录。确认后只启用未来的触发，不会重发上次任务。"));}
  async function save(){
    const previous=state?.jobs.find(job=>job.id===editing);if(enabled&&!acknowledge(previous))return;
    const jobAction=action==='notice'?{kind:action,text,threadId:snapshot.room.currentThreadId}:{kind:action,text,memberId,feature:'scheduled-message' as const,threadId:snapshot.room.currentThreadId??'room-main'};
    await perform(async()=>{const schedule:TimedSchedule=kind==='daily'?{kind,time:daily,timeZone:zone}:kind==='interval'?{kind,minutes}:{kind,at:new Date(once).toISOString()};await invoke('automation.save',{id:editing,name,enabled,schedule,action:jobAction,acknowledgeUnknown:Boolean(previous?.pausedReason&&enabled)});reset();},t("定时任务已保存。"));
  }
  async function toggle(job:TimedJob){if(!job.enabled||job.pausedReason){if(!acknowledge(job))return;}await perform(()=>invoke('automation.save',{...job,enabled:job.pausedReason?true:!job.enabled,acknowledgeUnknown:Boolean(job.pausedReason)}));}
  return <Modal title={t("自动功能与定时任务")} subtitle={t("HiveLab 合屋 开着时按时间触发；关闭、重启或休眠时错过的不会补发。")} onClose={onClose} className="automation-modal">
    <div className="modal-body">
      {!state?<p className="inline-notice">{t("当前后端尚未支持定时任务，请更新应用后使用。")}</p>:<>
        <div className="automation-toolbar"><span>{state.paused?t("定时任务已人工暂停"):t("定时任务运行中")}</span><button type="button" className="button small secondary" disabled={busy} onClick={()=>void perform(()=>invoke(state.paused?'automation.resume':'automation.pause'))}>{state.paused?<Play size={13}/>:<Pause size={13}/>} {state.paused?t("恢复定时任务"):t("暂停定时任务")}</button></div>
        <section className="automation-budget"><h3>{t("自动发言的每日预算")}</h3><p className="panel-muted">{t("各类功能独立开启。开启后，只有已启用的任务会使用额度；手动对话和自由讨论沿用原来的预算。")}</p>
          {(Object.keys(AUTOMATIC_FEATURES) as AutomaticFeature[]).map(id=>{const usage=state.usage?.find(item=>item.feature===id);return <div className="automation-policy" key={id}><label><input type="checkbox" aria-label={t("开启{0}", AUTOMATIC_FEATURES[id].label)} checked={policies[id].enabled} onChange={event=>setPolicies({...policies,[id]:{...policies[id],enabled:event.target.checked}})} />{AUTOMATIC_FEATURES[id].label}</label><label>{t("每日上限")}<input type="number" min={0} max={1000} aria-label={t("{0}每日上限", AUTOMATIC_FEATURES[id].label)} value={policies[id].dailyLimit} onChange={event=>setPolicies({...policies,[id]:{...policies[id],dailyLimit:Number(event.target.value)}})} />{t("次")}</label><span>{t("今日 {0} / {1} 次", usage?.used??0, usage?.limit??policies[id].dailyLimit)}</span></div>;})}
          <div className="automation-life"><p>{t("每日开场：北京时间当天第一次打开窗口时，由可用成员轮流问候，最多一次。刚开启时等下一天首次打开；错过或暂停时不补发。")}</p><p>{t("成员闲聊：窗口可见、聊天室空闲时，两位成员简短接话后结束。每段最多两次调用，都计入上限；作息和小动作只作为角色设定。")}</p><label className="automation-interval">{t("成员闲聊间隔")}<input type="number" min={5} max={1440} aria-label={t("成员闲聊间隔分钟")} value={chatInterval} onChange={event=>setChatInterval(Number(event.target.value))}/>{t("分钟")}</label>
          {lifeJobs.map(job=><div key={job.id}>{job.pausedReason?<p className="inline-notice">{job.name} · {job.pausedReason}<button type="button" className="button small secondary" disabled={busy} onClick={()=>{if(acknowledge(job))void perform(()=>invoke('automation.life.acknowledge',{feature:job.managed,acknowledgeUnknown:true}));}}>{t("核对后恢复{0}", job.name)}</button></p>:job.managed==='member-chat'&&job.enabled&&<small>{t("下次检查闲聊：{0}", time(job.nextAt))}</small>}</div>)}
          </div><p className="panel-muted">{t("按北京时间每日零点更新预算。失败或结果未知的调用也计数；明确限流时停止自动调用。手动发言不受这里的每日预算限制。")}</p><button type="button" className="button small secondary" disabled={busy} onClick={()=>void perform(()=>invoke('automation.policy.save',{policies,dailyLife:{memberChatMinutes:chatInterval}}),t("每日预算已保存。"))}>{t("保存每日预算")}</button>
        </section>
        <section className="automation-form"><h3>{editing?t("编辑定时任务"):t("新增定时任务")}</h3><label className="field">{t("任务名称")}<input aria-label={t("定时任务名称")} value={name} maxLength={120} onChange={event=>setName(event.target.value)} /></label>
          <div className="automation-form-row"><label className="field">{t("动作")}<select aria-label={t("定时任务动作")} value={action} onChange={event=>setAction(event.target.value as typeof action)}><option value="notice">{t("本地提醒 · 不用成员额度")}</option><option value="member-message">{t("成员发言 · 使用每日预算")}</option></select></label>{action==='member-message'&&<label className="field">{t("成员")}<select aria-label={t("定时发言成员")} value={memberId} onChange={event=>setMemberId(event.target.value)}>{team.members.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}</div>
          <label className="field">{t("内容")}<textarea aria-label={t("定时任务内容")} rows={2} maxLength={4000} value={text} onChange={event=>setText(event.target.value)} placeholder={action==='notice'?t("提醒你要做的事"):t("请这位成员到时说什么")} /></label>
          <div className="automation-form-row"><label className="field">{t("触发方式")}<select aria-label={t("定时触发方式")} value={kind} onChange={event=>setKind(event.target.value as typeof kind)}><option value="daily">{t("每天")}</option><option value="once">{t("一次")}</option><option value="interval">{t("固定间隔")}</option></select></label>{kind==='daily'?<label className="field">{t("时间 · {0}", zone)}<input type="time" aria-label={t("每天触发时间")} value={daily} onChange={event=>setDaily(event.target.value)} /></label>:kind==='once'?<label className="field">{t("时间 · 本机时区")}<input type="datetime-local" aria-label={t("一次性触发时间")} value={once} onChange={event=>setOnce(event.target.value)} /></label>:<label className="field">{t("间隔分钟")}<input type="number" min={1} max={43200} aria-label={t("定时间隔分钟")} value={minutes} onChange={event=>setMinutes(Number(event.target.value))} /></label>}</div>
          <label className="automation-enable"><input type="checkbox" checked={enabled} aria-label={t("启用此定时任务")} onChange={event=>setEnabled(event.target.checked)} />{t("启用此任务")}</label>
          {action==='member-message'&&!state.policies?.['scheduled-message']?.enabled&&<p className="inline-notice">{t("定时发言的额度开关当前关闭。请先保存每日预算；只启用任务不会调用成员。")}</p>}
          <div className="automation-form-row"><button type="button" className="button small secondary" disabled={busy||!name.trim()||!text.trim()||kind==='once'&&!once||kind==='daily'&&!daily} onClick={()=>void save()}><CalendarClock size={14}/>{editing?t("保存修改"):t("保存定时任务")}</button>{editing&&<button type="button" className="button small quiet" onClick={reset}>{t("取消编辑")}</button>}</div>
        </section>
        <section className="automation-jobs"><h3>{t("已保存的任务")}</h3>{!jobs.length?<p className="panel-muted">{t("还没有定时任务。新任务默认关闭。")}</p>:jobs.map(job=><article className="automation-job" key={job.id}><div><strong>{job.name}</strong><small>{t("{0} · 下次 {1}", job.pausedReason?t("待核对"):job.enabled?t("已启用"):t("未启用"), time(job.nextAt))}</small>{job.pausedReason&&<p className="inline-notice">{job.pausedReason}</p>}</div><div className="automation-job-actions">{job.action.kind!=='local-event'&&<button type="button" className="button small quiet" disabled={busy} onClick={()=>edit(job)}>{t("编辑")}</button>}<button type="button" className="button small secondary" disabled={busy||!job.nextAt} onClick={()=>void toggle(job)}>{job.pausedReason?t("核对后启用"):job.enabled?t("停用"):t("启用")}</button><button type="button" className="icon-button danger" aria-label={t("删除定时任务 {0}", job.name)} title={t("删除定时任务 {0}", job.name)} disabled={busy} onClick={()=>void perform(()=>invoke('automation.remove',{id:job.id}))}><Trash2 size={14}/></button></div></article>)}</section>
        <section className="automation-history"><h3>{t("最近触发")}</h3>{recent.length?recent.slice(0,10).map(item=><p key={item.id}><Clock size={12}/><strong>{state.jobs.find(job=>job.id===item.jobId)?.name??t("已删除的任务")}</strong><span>{time(item.startedAt)} · {labels[item.status]}{item.reason?` · ${item.reason}`:''}</span></p>):<p className="panel-muted">{t("暂无触发记录。")}</p>}</section>
      </>}
      {error&&<p className="inline-notice error" role="alert">{error}</p>}
    </div><div className="modal-footer"><button type="button" className="button secondary" onClick={onClose}>{t("关闭")}</button></div>
  </Modal>;
}

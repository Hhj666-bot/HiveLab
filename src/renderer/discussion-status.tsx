import {t} from './i18n';
import { Check, Hand, Users, X } from 'lucide-react';
import type { RoomDiscussion } from '../shared/discussion';
import { DISCUSSION_LABELS, pendingDiscussionQuestion } from '../shared/discussion';
import type { RoomState } from '../shared/types';
import { Avatar, useTeam, type TeamMember } from './members';
import { useTicker } from './ui';
import {callUsageLabel} from '../shared/call-usage';

const LIVE = ['talking', 'raising', 'closing', 'summarizing'];
const BALLOT: Record<string, string> = { get pending(){return t("正在举手")}, get invalid(){return t("举手格式无效")}, get stopped(){return t("已撤回")}, get failed(){return t("举手需核对")} };

function phaseLabel(d: RoomDiscussion) {
  if (d.phase === 'idle') return d.endedBy === 'user' ? t("本次讨论已由你结束") : d.style === 'chat' ? t("大家先聊到这儿") : DISCUSSION_LABELS.idle;
  if (d.phase === 'talking') return d.style === 'chat' ? t("正在闲聊") : t("正在开会");
  return DISCUSSION_LABELS[d.phase];
}

/** Who is in the room and how the conversation stands, in one bar: the invite chips double as the speakers' status. */
export function RoomPresence({ discussion: d, state, invited, ready, locked, busy, onToggle, onPause, onResume, onEnd, onConfigure,onHost,showNextStep=true,flowNextStep=false }: {
  discussion?: RoomDiscussion; state: RoomState; invited: string[]; ready: (member: TeamMember) => boolean; locked: boolean; busy: boolean;
  onToggle: (id: string) => void; onPause: () => void; onResume: () => void; onEnd: () => void;
  onConfigure?:(id:string)=>void;
  onHost?:(id:string)=>void;
  showNextStep?:boolean;
  /** A project flow step is already offered; skip the minutes suggestion so only one 下一步 shows. */
  flowNextStep?:boolean;
}) {
  const team = useTeam(), tick = useTicker(state.active, 15000), now = Math.max(tick, Date.now());
  const running = Boolean(d && d.phase !== 'idle');
  const handActive = Boolean(running && d?.handRaise && ['collecting','waiting', 'done'].includes(d.handRound?.status ?? ''));
  const name = (id: string) => team.get(id)?.name ?? t("成员");
  const speechBudget=d?.budgetKind==='speech';
  const available = d?.limit ? Math.max(0, d.limit - (speechBudget?d.speechCalls??0:d.calls)) : undefined;
  const roundCost = !speechBudget&&d?.handRaise && d.members.length > 1 ? d.members.length + 1 : 1;
  const details = d ? [
    ...(d.phase !== 'idle' && d.reason ? [d.reason] : []),
    ...(d.phase === 'closing' ? [t("正在确认每位成员是否还有遗漏或异议。")] : []),
    ...(handActive && d.handRound?.status === 'done' ? [d.handRound.fallback ? t("没有人需要补充，等你说话") : t("本轮补充：{0}", name(d.handRound.selected ?? ''))] : []),
  ] : [];
  const questions = d && running ? d.questions.filter(question => pendingDiscussionQuestion(question) && question.to === 'user').slice(d.style==='chat'?-3:0) : [];
  const nextStep=!showNextStep?undefined:d?.style!=='chat'&&questions.length?t("下一步：在输入框回答上方问题。"):d?.phase==='awaiting-host'?t("下一步：点名一位已举手的成员继续发言。"):d?.style!=='chat'&&d?.phase==='waiting_user'&&!flowNextStep?t("下一步：整理会议纪要，核对本轮结论。"):undefined;
  const budget = Boolean(d && running && (available !== undefined || d.minutes > 0));
  const tone = !d ? '' : LIVE.includes(d.phase) ? 'live' : ['blocked', 'budget'].includes(d.phase) ? 'warn' : ['paused', 'waiting_user','awaiting-host'].includes(d.phase) ? 'hold' : 'rest';
  return <section role="region" className={`room-presence ${d ? `phase-${d.phase}` : ''}`} aria-label={t("在场与讨论状态")} aria-live="polite">
    <div className="room-presence-row">
      <span className="room-presence-label"><Users size={13} />{t("在场")}</span>
      <div className="room-presence-members" role="group" aria-label={t("邀请谁加入")} tabIndex={0}>{team.members.map(member => {
        const on = invited.includes(member.id), ok = ready(member);
        const speaking = state.active && state.speaking === member.id;
        const ballot = handActive && on ? d?.handRound?.ballots[member.id] : undefined;
        const raised = ballot?.status === 'done' && (ballot.want ?? 0) > 0;
        const skipped=on&&running?d?.skippedMembers?.[member.id]:undefined;
        const awaiting=d?.phase==='awaiting-host',pick=(awaiting||d?.phase==='raising'&&d.hostPick&&d.handRound?.status==='collecting')&&raised&&!skipped&&Boolean(onHost);
        const tag = skipped ? t("已跳过") : speaking ? t("发言中") : ballot?.status === 'done' ? (ballot.want ? t("举手 {0}/3", ballot.want) : t("不补充")) : ballot ? BALLOT[ballot.status] : undefined;
        const title = skipped?.reason || ballot?.why || ballot?.error || (!ok ? t("{0} 还没准备好", t(member.product)) : locked ? on ? t("正在参与本次讨论") : t("讨论进行中，结束后可以邀请") : on ? t("点一下请 TA 离开") : t("点一下邀请 TA"));
        return <span key={member.id} className="guest-chip-group"><button type="button" className={`guest-chip member-${member.id} ${on ? 'on' : ''} ${locked ? 'locked' : ''} ${speaking ? 'speaking' : ''} ${ok ? '' : 'unready'}`}
          aria-pressed={on} aria-label={pick?t("请 {0} 发言", member.name):undefined} disabled={pick?!ok||busy:awaiting?true:onConfigure&&on?busy:!ok||locked||busy} title={pick?ballot?.why:onConfigure&&on?t("调整 {0} 的项目配置", member.name):title} onClick={() => pick?onHost!(member.id):onConfigure&&on?onConfigure(member.id):onToggle(member.id)}>
          <span className="guest-chip-avatar"><Avatar member={member} size={24} ring={false} mood={speaking ? 'working' : undefined} />{raised && <Hand size={11} className="guest-chip-hand" role="img" aria-label={t("{0} 已举手", member.name)} />}</span>
          <span className="guest-chip-name">{member.name}</span>
          {tag ? <small className="guest-chip-tag">{tag}</small> : on && !locked && <Check size={12} />}{on&&running&&d?.replyBudget&&Object.hasOwn(d.replyBudget.limits,member.id)&&<small className="guest-chip-count" aria-label={t("{0} 本次回复次数", member.name)} title={t("本次已安排 {0} 次，上限 {1}", (d.replyBudget.used[member.id]??0), (d.replyBudget.limits[member.id]===null?t("不限"):d.replyBudget.limits[member.id]))}>{d.replyBudget.used[member.id]??0}/{d.replyBudget.limits[member.id]===null?'∞':d.replyBudget.limits[member.id]}</small>}
          {pick&&ballot?.why&&<small className="guest-chip-reason">{ballot.why}</small>}
        </button>{onConfigure&&on&&<button type="button" className="guest-chip-leave" aria-label={t("请 {0} 离开", member.name)} title={t("请 {0} 离开会议室", member.name)} disabled={locked||busy} onClick={()=>onToggle(member.id)}><X size={11}/></button>}</span>;
      })}</div>
      {d && <div className="room-presence-status">
        {d.callUsage&&<small className="room-presence-usage" aria-label={t("本次讨论调用次数")} title={t("{0}{1}\n按实际运行记录计数；发言、举手、纪要、补正、重试均计入，未发出失败单列。", callUsageLabel(d.callUsage), speechBudget?t(" · 正式发言 {0} 次 · 辅助调用 {1} 次", d.speechCalls??0, Math.max(0,d.calls-(d.speechCalls??0))):'')}>{t("已发出 {0} 次 · 完成 {1} 次", d.callUsage.delivered, d.callUsage.completed)}{d.callUsage.unknown?<span className="room-presence-unknown"> {t(" · 结果未知 {0} 次", d.callUsage.unknown)}</span>:null}</small>}
        {budget && <small className="room-presence-usage room-presence-budget">{available !== undefined && <span aria-label={t("讨论剩余轮次")} title={speechBudget?t("只限制正式发言；举手、补正、重试和纪要另记。"):t("按普通接话每轮 {0} 次调用估算。", roundCost)}>{speechBudget?t("剩余 {0} 次正式发言", available):t("剩余 {0} 次调用", available)}{!speechBudget&&t(" · 普通接话约 {0} 轮", Math.floor(available / roundCost))}</span>}{d!.minutes > 0 && <span>{state.active && d!.deadline ? t("剩余约 {0} 分钟", Math.max(0, Math.ceil((d!.deadline - now) / 60000))) : t("时长预算 {0} 分钟", d!.minutes)}</span>}</small>}
        <span className={`room-phase ${tone}`} title={d.phase === 'idle' ? d.reason : undefined}>{phaseLabel(d)}</span>
        {!state.active && ['paused', 'blocked', 'budget'].includes(d.phase) && <button type="button" className="button small primary" disabled={busy} onClick={onResume}>{d.unknownRunId || d.unknownRunIds?.length ? t("核对后继续") : t("继续讨论")}</button>}
        {!state.active && d.endedBy!=='user' && ['waiting_user','idle'].includes(d.phase) && Object.keys(d.skippedMembers??{}).length>0 && <button type="button" className="button small secondary" disabled={busy} onClick={onResume}>{d.unknownRunId||d.unknownRunIds?.length?t("核对后重新加入异常成员"):t("重新加入异常成员")}</button>}
      </div>}
    </div>
    {d && (details.length > 0 || questions.length > 0 || nextStep) && <div className="room-presence-detail">
      {nextStep&&<p className="room-next-step">{nextStep}</p>}
      {details.map(text => <p key={text}>{text}</p>)}
      {d.style==='chat'&&questions.length>0&&<p>{t("这些问题可以稍后回答，大家会继续聊天。")}</p>}
      {questions.map(question => <p key={question.id} className="room-presence-question"><strong>{t("{0} 问你：", name(question.from))}</strong>{question.text}</p>)}
    </div>}
  </section>;
}

import {t} from '../i18n';
import {RoomComposerTools} from "./RoomComposerTools";
import {isSendKey} from "../composer-keys";
import {Avatar} from "../members";
import {AttachmentTray} from "../attachments";
import {MessageSkillChips} from "../message-skills";
import type {RoomController} from "./use-room-controller";
export function RoomComposer({controller}:{controller:RoomController}){
  const {
    personalLoading, room, personalSession, setImageDialog, team, state, historyOnly, ready, imagesEnabled, canGenerateImage, invited, usable, mode,
    setMode, discussion, handRaise, setHandRaise, hostPick, setHostPick, style, replyLimits, minutesBusy, minutesMembers, openMinutes, sendFeedback,
    sending, busy, stopping, panel, noTopic, messageSkills, archived, composer, draft, setDraft, replyTo, setReplyTo, workIntent, setWorkIntent,
    attach, list, textarea, anchor, messages, mention, setMention, mentionIndex, setMentionIndex, mentionedWorker, candidates, named, participants,
    speaking, compressing, updateMention, chooseMention, send, terminateSpeech, chooseHand, name, snapshot, roomId, project, personal, surface
  }=controller;
  if(archived)return null;
  const roomHint = personal ? '' : compressing && !state.active ? t("{0} 正在整理话题摘要…", compressing.name) : discussion?.phase==='awaiting-host' ? t("等你点名") : state.active ? speaking ? t("{0} 正在说话…", speaking.name) : t("正在安排发言…") : candidates.length ? t("选择要点名的成员") : named.unknown.length ? t("未识别点名：{0}", named.unknown.join('、')) : named.ids.length ? mode==='meeting'?t("只请被 @ 的成员回答，之后等你继续"):t("优先请 {0} 接话，其他在场成员仍可参与", participants.map(member => member.name).join('、')) : usable.length ? mode === 'chat' ? t("大家自由接话，聊到自然告一段落为止") : handRaise ? t("每轮轮流发言后先举手，想补充的再发言") : t("每人回答一次后等你，点击整理会议纪要结束") : t("先邀请至少一位已准备好的成员"); return <div className="room-composer">
      {(project?.dock ?? surface?.dock) && <div className="room-dock-anchor">{project?.dock ?? surface?.dock}</div>}
      {replyTo && <div className="room-reply-note">{t("回复：{0} ", messages.find(m => m.id === replyTo)?.text.slice(0,80) ?? t("较早消息"))}<button type="button" className="link-button" onClick={() => setReplyTo(undefined)}>{t("取消回复")}</button></div>}
      <div className={`composer room-input ${attach.dragging ? 'dragging' : ''}`} {...attach.dropTarget}>
        {attach.dragging && <div className="drop-hint">{t("松开即可附上文件")}</div>}
        <AttachmentTray error={attach.error} items={attach.items} onRemove={attach.remove} invoke={controller.invoke} /><MessageSkillChips control={messageSkills}/>
        {composer.error&&<p role="status" className="composer-draft-error">{composer.error} <button type="button" className="link-button" onClick={composer.retry}>{t("重试保存草稿")}</button></p>}
        {discussion?.handRound&&(discussion.phase==='awaiting-host'||discussion.phase==='raising'&&discussion.hostPick&&discussion.handRound.status==='collecting')&&<section className="room-host-choice" aria-label={t("举手点名")}>
          <p>{discussion.phase==='raising'?t("正在收集举手（{0}/{1} 已完成）。已举手的成员可先点名，未完成的举手会撤回。", Object.values(discussion.handRound.ballots).filter(b=>!['pending','running'].includes(b.status)).length, Object.keys(discussion.handRound.ballots).length):t("举手已收集，请选谁接着说。")}</p>
          {Object.entries(discussion.handRound.ballots).some(([,b])=>b.status==='failed'||b.status==='invalid')&&<p className="panel-muted">{t("{0} 的举手未完成，可查看活动记录。", Object.entries(discussion.handRound.ballots).filter(([,b])=>b.status==='failed'||b.status==='invalid').map(([id])=>team.get(id)?.name??t("成员")).join('、'))}</p>}
          <div className="room-host-actions">{discussion.members.filter(id=>discussion.handRound!.ballots[id]?.status==='done'&&(discussion.handRound!.ballots[id].want??0)>0).map(id=><button type="button" className="button small secondary" key={id} disabled={busy||!snapshot.backendReady||!ready(team.get(id)?.executor??'')} onClick={()=>void chooseHand('member',id)}>{t("请 {0} 发言 · {1}/3", team.get(id)?.name??t("成员"), discussion.handRound!.ballots[id].want)}</button>)}<button type="button" className="button small quiet" disabled={busy||!snapshot.backendReady||!Object.values(discussion.handRound.ballots).some(b=>b.status==='done'&&(b.want??0)>0)} onClick={()=>void chooseHand('auto')}>{t("按举手自动选")}</button><button type="button" className="button small quiet" disabled={busy||!snapshot.backendReady} onClick={()=>void chooseHand('skip')}>{t("都不用补充，下一轮")}</button></div>
        </section>}
        {mentionedWorker&&project?.onTaskRequest&&<label className="room-work-intent">@{mentionedWorker.name}<select aria-label={t("点名用途")} value={workIntent} onChange={e=>setWorkIntent(e.target.value as typeof workIntent)}><option value="ask">{t("只是问问")}</option><option value="add">{t("安排新任务")}</option><option value="supplement">{t("补充到 TA 当前的任务")}</option></select></label>}
        {candidates.length > 0 && <div className="room-mentions" role="listbox" id="room-mentions" aria-label={t("点名成员")}>{candidates.map((member, index) => <button type="button" role="option" id={`room-mention-${index}`} key={member.id} aria-selected={index === mentionIndex % candidates.length} className={index === mentionIndex % candidates.length ? 'selected' : ''} onMouseDown={event => event.preventDefault()} onClick={() => chooseMention(member)}><Avatar member={member} size={24} ring={false} /><span>@{member.name}</span></button>)}</div>}
        {sendFeedback&&<p className="composer-delivery" role="status">{sendFeedback}</p>}
        <textarea ref={textarea} value={draft} aria-label={personal?personal.kind==='desk'?t("在工位里说话"):t("在汇报里说话"):project ? t("在会议室里说话") : t("在聊天室里说话")} aria-autocomplete="list" aria-controls={candidates.length ? 'room-mentions' : undefined} aria-activedescendant={candidates.length ? `room-mention-${mentionIndex % candidates.length}` : undefined} placeholder={personal?state.active&&personal.kind==='desk'?t("可继续补充要求… Enter 发送，当前工作继续"):t("写下问题或要求… Enter 发送，Shift + Enter 换行"):mode === 'meeting' ? t("写下会议议题或随时补充… Enter 发送，Shift + Enter 换行，@ 谁就只请谁回答") : t("说点什么… Enter 发送，Shift + Enter 换行，@ 可指定优先接话者")} onChange={event => { setDraft(event.target.value); if(!personal)updateMention(event.target.value, event.target.selectionStart); }} onClick={event => {if(!personal)updateMention(event.currentTarget.value, event.currentTarget.selectionStart);}} onKeyDown={event => {
          if (candidates.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setMentionIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length); }
          else if (candidates.length && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); chooseMention(candidates[mentionIndex % candidates.length]); }
          else if (isSendKey(event)) { event.preventDefault(); void send(); }
          else if (event.key === 'Escape') setMention(null);
        }} disabled={!snapshot.backendReady || busy || historyOnly || personalLoading || noTopic || !composer.ready} />
        {historyOnly&&<p className="panel-muted" role="status">{surface?.readOnly?surface.hint:personal?.kind==='report'?t("原成员已删除，汇报事实保留。"):t("这份话题只供阅读；继续工作请新开话题。")}</p>}<RoomComposerTools controller={controller} roomHint={roomHint}/>
      </div>
    </div>;
}

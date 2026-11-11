import {t,useLanguage} from '../i18n';
import {liveWorkLabel} from "../../shared/run-activity";
import {readableContent} from "../../shared/content-presentation";
import {memo, useEffect, useRef, useState, type ReactNode} from "react";
import {ChevronDown, ChevronUp, MoreHorizontal, Reply, SmilePlus} from "lucide-react";
import type {Attachment, RoomMessage, RunSummary, UserProfile} from "../../shared/types";
import {ROOM_REACTIONS, ROOM_PREVIEW_CHARACTERS,roomMessageIsLong, isRoomPass, roomMarkerPending, roomReaction} from "../../shared/room";
import {HighlightText} from "../search-highlight";
import {Markdown, plainText} from "../Markdown";
import {ExportAnswer, FileCards} from "../file-output";
import {RunActivity, type ActivitySnapshot} from "../run-activity";
import {SubagentCards} from "../subagents";
import {TaskListCard} from "../task-list";
import {PlanCard} from "../plan-card";
import {activeActivityRun} from "../../shared/run-activity";
import {RunElapsed} from "../run-duration";
import {Avatar, UserAvatar, useTeam} from "../members";
import {time, type Invoke} from "../ui";
import {AttachmentList} from "../attachments";
import {GeneratedImages} from "../generated-images";
import {ErrorBoundary} from "../ErrorBoundary";
import {effectiveConfigText} from "../../shared/executor-config";

function Reactions({ message, name, onToggle }: { message: RoomMessage; name: (author: string) => string; onToggle?: (emoji: string) => void }) {
  const team = useTeam();
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!picker.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const entries = Object.entries(message.reactions ?? {});
  if (!entries.length && !onToggle) return null;
  const pick = (emoji: string) => { setOpen(false); onToggle?.(emoji); };
  return <div className={`room-reactions ${entries.length ? '' : 'empty'}`}>
    {entries.map(([emoji, authors]) => {
      const who = authors.map(name).join('、'), mine = authors.includes('user');
      return <button type="button" key={emoji} className={`reaction-chip ${mine ? 'mine' : ''}`} disabled={!onToggle} title={who} aria-label={`${emoji} ${who}`} aria-pressed={onToggle ? mine : undefined} onClick={() => onToggle?.(emoji)}>
        <span className="reaction-emoji">{emoji}</span>
        <span className="reaction-faces">{authors.slice(0, 3).map(author => author === 'user' ? <span key={author} className="reaction-user">{[...name('user')][0]}</span> : <Avatar key={author} member={team.get(author)} id={author} size={16} ring={false} />)}</span>
        {authors.length > 3 && <small>{authors.length}</small>}
      </button>;
    })}
    {onToggle && <span className="reaction-add-wrap" ref={picker}>
      <button type="button" className="reaction-add glass-action" aria-label={t("添加表情回应")} aria-expanded={open} title={t("添加表情回应")} onClick={() => setOpen(value => !value)}><SmilePlus size={14} /></button>
      {open && <span className="reaction-picker" role="menu" aria-label={t("选择表情")}>{ROOM_REACTIONS.map(item => <button type="button" role="menuitem" key={item.emoji} title={item.label} aria-label={t("回应 {0} {1}", item.emoji, item.label)} onClick={() => pick(item.emoji)}>{item.emoji}</button>)}</span>}
    </span>}
  </div>;
}

export const messageText=(message:RoomMessage,streamed:string)=>message.status==='speaking'?message.discussionId?streamed:isRoomPass(streamed)||roomMarkerPending(streamed)||roomReaction(streamed)?'':streamed||message.text:message.author==='user'?message.text:readableContent(message.text);

type MessageMenuEvent={clientX:number;clientY:number;preventDefault():void;stopPropagation():void};

export type MessageActions={menu:(event:MessageMenuEvent,message:RoomMessage,reply:boolean)=>void;reply:(id:string)=>void;expand:(id:string)=>void;react:(message:RoomMessage,emoji:string)=>void;editImage:(image:Attachment)=>void};

type MessageLineProps={message:RoomMessage;streamed:string;run?:RunSummary;snapshot:ActivitySnapshot;showActivity:boolean;card?:ReactNode;extraActions?:ReactNode;profile:UserProfile;personal:boolean;sessionId?:string;replyName:string;delivery:string;archived:boolean;backendReady:boolean;expanded:boolean;enterClass:string;canEditImage:boolean;invoke:Invoke;actions:MessageActions};

export const MessageLine=memo(function MessageLine({message,streamed,run,snapshot,showActivity:activity,card,extraActions,profile,personal,sessionId,replyName,delivery,archived,backendReady,expanded,enterClass,canEditImage,invoke,actions}:MessageLineProps){useLanguage();
  const team=useTeam();
  const showActivity=run&&activity;
  const text=messageText(message,streamed);
  const name=message.authorName??(message.author==='user'?(profile.name&&profile.name!=='你'?profile.name:t("你")):team.get(message.author)?.name??t("成员"));
  const authorName=(author:string)=>author==='user'?(profile.name&&profile.name!=='你'?profile.name:t("你")):team.get(author)?.name??t("成员");
  const moreButton=(message:RoomMessage,canReply:boolean)=><button type="button" className="icon-button room-more-button" aria-label={t("{0} 的消息操作", name)} title={t("更多操作")} onClick={event=>actions.menu(event,message,canReply)}><MoreHorizontal size={14}/></button>;
  if (card) return <div key={message.id} className={`room-line flow-line member-${message.author}${enterClass}`} data-message-id={message.id}>{message.author === 'user' ? <UserAvatar name={name} avatar={profile.avatar} size={30} /> : <Avatar member={team.get(message.author)} id={message.author} size={30} />}<div className="flow-line-body"><span className="room-meta"><strong>{name}</strong><time>{time(message.at)}</time>{run&&message.author!=='user'&&<RunElapsed run={run}/>}</span>{showActivity&&<RunActivity run={run} snapshot={snapshot} invoke={invoke}/>}{run&&<TaskListCard todos={run.todos} active={activeActivityRun(run)}/>}{run&&<SubagentCards records={snapshot.subagents} invoke={invoke}/>}<ErrorBoundary area={t("汇报消息")} compact>{card}</ErrorBoundary>{text&&message.status!=='speaking'&&<ExportAnswer text={text}/>} {showActivity&&<FileCards runId={run.id} revision={run.status} invoke={invoke}/>}</div></div>;
  // A reaction-only turn shows on the message it answered, not as a line of its own.
  if (message.status === 'passed' && message.reaction) return null;
  if (message.status === 'passed') return <details key={message.id} className="room-passed" data-message-id={message.id}><summary>{t("{0} 选择不发言 ", name)}<time>{time(message.at)}</time>{run&&<RunElapsed run={run}/>}</summary><p>{t("这次没有需要补充的内容。判断是否发言仍会使用额度。")}</p></details>;
  if (message.author === 'user') return <div key={message.id} className={`room-line mine${enterClass}`} data-message-id={message.id}>
    <div className="room-bubble-wrap"><span className="room-meta"><time>{time(message.at)}</time><strong>{name}</strong></span><div className="room-bubble" onContextMenu={event => actions.menu(event,message,false)}><HighlightText text={message.text}/></div>{Boolean(message.skills?.length)&&<div className="message-skill-history" aria-label={t("消息指定的 Skills")}>{message.skills!.map(s=><span key={s.source+s.id} title={s.source}>{t("已指定 · {0}", s.name)}</span>)}</div>}{delivery&&<small className="composer-delivery">{delivery}</small>}<AttachmentList items={message.attachments} invoke={invoke} align="end" /><Reactions message={message} name={authorName} /><span className="room-tools">{moreButton(message, false)}</span>{extraActions}</div>
    <UserAvatar name={name} avatar={profile.avatar} size={36} />
  </div>;
  const member = team.get(message.author);
  const reactable = !archived && backendReady && ['done', 'failed', 'stopped'].includes(message.status ?? 'done');
  const long = message.status !== 'speaking' && roomMessageIsLong(text), folded = long && !expanded;
  const canReply = !archived && message.status === 'done';
  const unknown = run?.status === 'unknown' && message.status !== 'speaking';
  const actual = run?.effectiveConfig?.modelStatus === 'reported' ? [run.effectiveConfig.model, run.effectiveConfig.effortStatus === 'reported' ? run.effectiveConfig.effort : undefined].filter(Boolean).join(' · ') : '';
  const silent = message.error ?? (unknown ? t("成员程序结束了这一轮，但没有返回内容，结果待核对。可能是登录失效或连接中断，可在“设置与连接”检查这位成员。工作台不会自动重发。") : run?.error ?? (run?.planProposal ? t("计划见下方卡片。") : t("（没有说话）")));
  return <div key={message.id} className={`room-line member-${member?.id ?? 'claude'}${enterClass}`} data-message-id={message.id}>
    {member ? <Avatar member={member} size={36} mood={message.status === 'speaking' ? 'working' : undefined} /> : <span className="room-retired-avatar" aria-hidden="true">{[...name][0]}</span>}
    <div className="room-bubble-wrap"><span className="room-meta"><strong>{name}</strong><time title={run ? effectiveConfigText(run.requestedConfig, run.effectiveConfig) : undefined}>{time(message.at)}</time>{run&&<RunElapsed run={run}/>} {personal && actual && <span className="room-model" title={t("这一轮实际使用的模型与思考程度")}>{actual}</span>}{Boolean(run?.messageSkills?.length)&&<span className="room-model" title={run!.messageSkills!.map(s=>s.name).join('、')}>{['sent','confirmed'].includes(run!.delivery)?t("Skills 正文已提供"):t("Skills 待发送")}</span>}{message.inReplyTo && <span className="room-reply-to">{t("回复 {0}", replyName)}</span>}{message.kind === 'summary' && <em>{t("会议总结")}</em>}{message.status === 'failed' && <em className="room-failed">{unknown ? t("结果待核对") : run?.delivery==='prepared' ? t("未发送") : t("回复失败")}</em>}{message.status === 'stopped' && <em>{t("已停止")}</em>}</span>
      {showActivity&&<RunActivity run={run} snapshot={snapshot} invoke={invoke}/>}
      {run&&<TaskListCard todos={run.todos} active={activeActivityRun(run)}/>}{run&&<SubagentCards records={snapshot.subagents} invoke={invoke}/>}
      <div className={`room-bubble ${message.status === 'speaking' && !text ? 'typing' : ''} ${folded ? 'folded' : ''}`} onContextMenu={message.status === 'speaking' ? undefined : event => actions.menu(event,message,canReply)}>{text ? folded?<span className="room-message-preview">{plainText(text).slice(0,ROOM_PREVIEW_CHARACTERS)}…</span>:<Markdown text={text} sessionId={run?.sessionId??sessionId} /> : message.status === 'speaking' ? <span className="room-live-work" role="status">{liveWorkLabel(run,snapshot.events)}</span> : <span className="room-silent">{silent}</span>}</div>
      {long && <button type="button" className="room-fold-button glass-action" aria-label={folded?t("展开全文"):t("收起")} title={folded?t("展开全文"):t("收起")} aria-expanded={!folded} onClick={() => actions.expand(message.id)}>{folded?<ChevronDown size={14}/>:<ChevronUp size={14}/>}</button>}
      {message.imageGeneration&&message.status==='speaking'&&!message.generatedImages?.length&&<small className="room-reply-note">{t("正在生成图片，可以随时停止。")}</small>}
      <GeneratedImages images={message.generatedImages} invoke={invoke} onEdit={canEditImage?image=>actions.editImage(image):undefined}/>
      {run?.planProposal&&message.author!=='user'&&<ErrorBoundary area={t("计划卡片")} compact><PlanCard run={run} review={snapshot.planReview} active={activeActivityRun(run)} invoke={invoke}/></ErrorBoundary>}
      {showActivity&&<FileCards runId={run.id} revision={run.status} invoke={invoke}/>}
      {message.status === 'failed' && message.error && text && <small className="room-error">{message.error}</small>}
      {message.status !== 'speaking' ? <ExportAnswer text={text}>
        <Reactions message={message} name={authorName} onToggle={reactable ? emoji => actions.react(message,emoji) : undefined} />
        <span className="room-tools">{canReply && <button type="button" className="room-reply-button glass-action" title={t("回复这条消息")} aria-label={t("回复 {0} 的消息", name)} onClick={() => actions.reply(message.id)}><Reply size={14}/></button>}</span>
      </ExportAnswer> : <Reactions message={message} name={authorName}/>}
      {extraActions}
    </div>
  </div>;

});


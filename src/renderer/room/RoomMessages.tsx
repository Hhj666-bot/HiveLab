import {t} from '../i18n';
import {messageDelivery} from "../../shared/delivery";
import {screenStart} from "../../shared/room";
import {LoaderCircle} from "lucide-react";
import {Fragment, startTransition, useEffect, useLayoutEffect, useRef, useState} from "react";
import {SearchHighlight, markedText} from "../search-highlight";
import {ApprovalCard} from "../panels";
import {Avatar} from "../members";
import {RoomNote} from "../handoff";
import type {RoomController} from "./use-room-controller";
import {MessageLine, messageText} from "./MessageLine";
/** Starter prompts; a meeting starter fills the composer with its topic instead of sending. */
const SUGGESTIONS:{text:string;meeting?:string}[]=[{text:'大家今天过得怎么样？'},{text:'互相做个自我介绍吧'},{text:'开个会：下周我们一起做点什么？',meeting:'下周我们一起做点什么？'}];
const TURN_PATIENCE=900;
/** Rendering a whole history takes longer than a page turn, so a page arrives with one screen of it
 *  and gathers the rest afterwards, a little at a time. */
function useWholeHistory(wanted:boolean){
  const [whole,setWhole]=useState(wanted);
  useEffect(()=>{
    if(whole)return;
    const join=()=>startTransition(()=>setWhole(true));
    if(!document.querySelector('.page-turn-ghost')){const frame=requestAnimationFrame(join);return()=>cancelAnimationFrame(frame);}
    const timer=setTimeout(join,TURN_PATIENCE);window.addEventListener('hivelab:page-turned',join,{once:true});
    return()=>{clearTimeout(timer);window.removeEventListener('hivelab:page-turned',join);};
  },[whole]);
  return whole||wanted;
}
export function RoomMessages({controller}:{controller:RoomController}){
  const {
    searchFocus, focus, invoke, room, personalSession, team, state, profile, canGenerateImage, setMode, busy, selectedId, archived, setDraft, enter,
    loading, loadingRef, list, textarea, pinned, unseen, setUnseen, expanded, markSeen, messages, activityMessages, hasMore, acknowledge, loadHistory,
    live, runsById, messagesById, emptyActivitySnapshot, activitySnapshots, messageContent, dividerIndex, current, send, authorName, messageActions,
    deskCapabilities, snapshot, onOpenSession, roomId, project, personal, surface, roomLoading
  }=controller;
  const first=useWholeHistory(!!focus||archived)?0:screenStart(messages);
  const previousFirst=useRef(first);
  useLayoutEffect(()=>{
    // Prepending deferred history must restore the bottom before the browser paints,
    // not one ResizeObserver frame after the newly inserted rows become visible.
    if(first<previousFirst.current&&pinned.current&&list.current)list.current.scrollTop=list.current.scrollHeight;
    previousFirst.current=first;
  },[first]);
  return <>
    <div className={'room-messages'+(!messages.length&&!archived?' room-messages-empty':'')} role="log" aria-label={surface?t("圆桌消息"):personal?personal.kind==='desk'?t("个人工位消息"):t("个人汇报消息"):project?t("项目会议室消息"):t("茶歇室消息")} ref={list} onScroll={event => { const node = event.currentTarget; pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; if (pinned.current && !archived) { if (unseen) setUnseen(0); markSeen();acknowledge(); } if (node.scrollTop < 40 && hasMore && !loadingRef.current) void loadHistory(true); }}>
      <div className="room-message-content" ref={messageContent}>
      {hasMore && <button type="button" className="button small quiet room-load-more" disabled={loading} onClick={() => void loadHistory(true)}>{loading ? t("正在加载…") : t("加载更早的消息")}</button>}
      {loading && !messages.length && <div className="room-system">{t("正在加载历史…")}</div>}
      {!messages.length && !archived && !roomLoading && project?.empty}
      {!messages.length && !archived && !roomLoading && personal?.empty}
      {!messages.length && !archived && !roomLoading && !project && !personal && <div className="room-empty">
        <div className="room-empty-team">{team.members.map(member => <Avatar key={member.id} member={member} size={56} />)}</div>
        <h2>{t("大家都在，聊点什么？")}</h2><p>{deskCapabilities?t("已启用工位能力，可以按你的要求使用工具、处理文件和执行任务。"):t("成员只会说话，不会执行命令或修改文件。")}</p>
        <div className="room-suggestions">{SUGGESTIONS.map(suggestion => <button type="button" key={suggestion.text} disabled={busy || state.active} onClick={() => { if (suggestion.meeting) { setMode('meeting'); setDraft(t(suggestion.meeting)); textarea.current?.focus(); } else void send(t(suggestion.text)); }}>{t(suggestion.text)}</button>)}</div>
      </div>}
      {messages.slice(first).map((message, index) => <Fragment key={message.id}>{index+first === dividerIndex && <div className="room-new-divider" role="separator"><span>{t("以下是新消息")}</span></div>}{(() => {
        if (message.contextOnly) return null;
        const query=searchFocus?.threadId===selectedId&&(message.id===searchFocus.messageId||message.memberReportVersions?.some(version=>version.messageId===searchFocus.messageId))?searchFocus.query:'';
        if (message.system || message.author === 'system') return message.link ? <RoomNote key={message.id} message={message} snapshot={snapshot} invoke={invoke} archived={archived} onOpen={(projectId, sessionId) => onOpenSession?.(projectId, sessionId)} /> : <div key={message.id} className="room-system" data-message-id={message.id}>{markedText(message.text,query)}</div>;
        if (message.discussionControl) return null;
        const streamed=live.get(message.id)??'';
        const run=message.runId?runsById.get(message.runId):undefined;
        const card=surface?.renderMessage?.(message,messageText(message,streamed))??personal?.renderMessage?.(message)??(project?.renderFlow&&(message.flowPlan||message.flowDecision||message.flowReport||message.jointReview||message.roundtable)?project.renderFlow(message):undefined);
        return <SearchHighlight.Provider value={query}><MessageLine message={message} streamed={streamed} run={run} snapshot={activitySnapshots.get(message.runId??'')??emptyActivitySnapshot} showActivity={!!run&&activityMessages.has(message.id)} card={card} extraActions={personal?.messageActions?.(message,messages)} profile={profile} personal={!!personal} sessionId={personalSession?.id} replyName={messagesById.get(message.inReplyTo??'')?.authorName??t("较早的消息")} delivery={messageDelivery(message,snapshot)} archived={archived} backendReady={snapshot.backendReady} expanded={expanded.has(message.id)} enterClass={enter(message)} canEditImage={!archived&&!state.active&&canGenerateImage} invoke={invoke} actions={messageActions}/></SearchHighlight.Provider>;
      })()}</Fragment>)}
      {!personal&&snapshot.approvals.filter(a=>a.state==='pending'&&snapshot.sessions.find(s=>s.id===a.sessionId)?.roomId===roomId).map(a=><ApprovalCard key={a.id} approval={a} invoke={invoke} member={team.get(snapshot.sessions.find(s=>s.id===a.sessionId)?.memberId??a.provider)}/>)}
      {!archived&&state.compressing&&<div className={`room-line room-compression-progress member-${state.compressing}`} role="status" aria-label={t("正在进行上下文压缩")}><Avatar id={state.compressing} size={30} mood="working"/><div className="room-bubble-wrap"><span className="room-meta"><strong>{team.get(state.compressing)?.name??t("成员")}</strong></span><div className="room-bubble"><LoaderCircle size={15} className="spin"/>{t("正在进行上下文压缩")}</div></div></div>}
      {personal?.dock}{archived && surface?.dock}
      </div>
    </div>

  </>;
}

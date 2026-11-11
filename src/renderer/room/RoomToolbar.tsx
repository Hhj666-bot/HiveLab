import {t} from '../i18n';
import {createPortal} from "react-dom";
import {BookmarkPlus, Columns2, Download, MoreHorizontal, Plus, Unlink, Eraser, FileStack, Layers, MessageSquarePlus, MessagesSquare, Sparkles, Trash2} from "lucide-react";
import {RoomPresence} from "../discussion-status";
import {RoomHeader} from "../room-header";
import {shortDateTime} from "../ui";
import {RoomSummaryDrawer} from "./RoomSummaryDrawer";
import {Briefcase} from "lucide-react";
import type {RoomController} from "./use-room-controller";
export function RoomToolbar({controller}:{controller:RoomController}){
  const {
    global, invoke, personalLoading, room, handoff, setHandoff, menu, setMenu, setProposing, state, historyOnly, ready, invited, mode, discussion,
    sending, busy, setBusy, stopping, capabilitySaving, setCapabilitySaving, setArchiveId, panel, setPanel, setNewTopic, summarizer, noTopic,
    selectedId, archived, threads, thread, messages, compressing, toggle, resumeDiscussion, chooseHand, endDiscussion, afterTopicChange, manage,
    compressCurrent, uninherit, exportTopic, recordItems, compactHeader, deskToolbar, deskCapabilities, selectTopic, snapshot, split, project,
    personal, surface
  }=controller;
  const capabilityControl=global&&!personal&&!project&&!surface?<button type="button" className="button small secondary room-capability-button" aria-label={t("茶歇室工位能力")} aria-pressed={deskCapabilities} disabled={capabilitySaving||busy||sending||state.active||Boolean(compressing)||state.generatingImage||archived||!snapshot.backendReady} title={state.active?t("先暂停讨论并等待当前发言结束，再切换能力"):deskCapabilities?t("工位能力已启用：沿用各成员的工具与权限设置，工作文件默认保存到茶歇室文件夹。点击切回受限聊天。"):t("受限聊天：成员主要进行对话。点击启用与个人工位相同的工具和权限。")} onClick={async()=>{setCapabilitySaving(true);try{await invoke('room.capabilities',{mode:deskCapabilities?'limited':'desk'});}catch{}finally{setCapabilitySaving(false);}}}><Briefcase size={14}/>{capabilitySaving?t("保存中…"):deskCapabilities?t("能力：工位"):t("能力：受限")}</button>:undefined;
  
  const topicPicker=<label className="topic-picker"><select aria-label={t("话题记录")} title={thread?.title} value={selectedId} disabled={busy||noTopic||personalLoading} onChange={event => void selectTopic(event.target.value)}>{noTopic&&<option value="">{t("当前文件夹暂无话题")}</option>}{threads.map(item => <option key={item.id} value={item.id}>{item.archivedAt ? t("归档 · ") : t("当前 · ")}{item.lastMessageAt?shortDateTime(item.lastMessageAt):t("暂无对话")} · {item.title}</option>)}</select></label>;
  const topicCreation=archived ? <span className="topic-archived">{t("归档记录 · 只读 ")}<button type="button" className="link-button" onClick={() => setArchiveId(undefined)}>{t("回到当前话题")}</button><button type="button" className="link-button" disabled={busy || state.active || Boolean(compressing)} onClick={() => thread && setNewTopic({ from: thread })}><FileStack size={12} />{t("接着聊")}</button></span>
        : <button type="button" className={compactHeader?'button small quiet desk-new-topic':'button small secondary'} aria-label={t("开新话题")} title={t("开新话题")} disabled={busy || personalLoading || (personal?.kind!=='desk'&&(state.active||Boolean(compressing)||!messages.length)) || !snapshot.backendReady} onClick={()=>{if(personal?.kind==='desk'){setBusy(true);void invoke('room.archive',{inherit:false},t("新话题已创建，发送第一条消息后会自动命名。")).then(()=>{setPanel(false);afterTopicChange();}).catch(()=>{}).finally(()=>setBusy(false));}else setNewTopic({});}}>{compactHeader?<Plus size={17}/>:<><MessageSquarePlus size={14} />{t("开新话题")}</>}</button>;
  const presence=!archived&&!personal&&!surface?.readOnly?<RoomPresence discussion={discussion} state={state} invited={invited} ready={member=>ready(member.executor)}
    locked={state.active||Boolean(discussion&&discussion.phase!=='idle')} busy={busy||stopping||Boolean(compressing)||!snapshot.backendReady} onToggle={toggle}
    showNextStep={!surface} flowNextStep={Boolean(project?.flowNextStep)} onConfigure={project?.onConfigureMember}
    onHost={id=>void chooseHand('member',id)} onPause={()=>void invoke('room.pause').catch(()=>{})} onResume={()=>void resumeDiscussion()} onEnd={()=>void endDiscussion()}/>:null;
  const header=<RoomHeader toolbar={compactHeader} className={personal?.kind==='desk'?'desk-room-header':''}>
    {project ? surface?.recordActions ? null : <div className="room-tool-row">
      <span className="room-tool-title">{surface?.title??t("会议聊天")}<small>{surface?.hint??t("成员可查看项目文件，但不改文件；正在工作的成员只回答 @ 点名")}</small></span>
      <button type="button" className="icon-button topic-more" aria-label={t("会议记录操作")} aria-haspopup="menu" title={t("压缩、导出和清空会议记录")} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 6, items: recordItems }); }}><MoreHorizontal size={16} /></button>
    </div> : <>
    <header className="room-head">
      <div className="room-identity"><span className="room-icon"><MessagesSquare size={20} /></span>
      <div className="room-title"><h1>{personal?.title??t("茶歇室")}</h1><p title={personal?.hint}>{personal?.hint??t("闲聊时自由接话，开会时轮流发言，随时都可以插话。")}</p></div></div>
      <div className="room-actions">
        {capabilityControl}
        {!deskToolbar&&personal?.headerActions}
        {split && <button type="button" className={`button small secondary ${split.active ? 'pressed' : ''}`} aria-pressed={split.active} title={split.active ? t("回到单独的聊天室") : t("聊天室和当前项目会话左右并排")} onClick={split.toggle}><Columns2 size={14} />{split.active ? t("取消并排") : t("并排显示")}</button>}
        {personal?.kind==='report'&&<button type="button" className="icon-button" title={t("导出完整话题")} aria-label={t("导出当前话题")} disabled={busy || state.active || !messages.length || !snapshot.backendReady} onClick={() => void exportTopic()}><Download size={16} /></button>}
      </div>
    </header>
    {personal?.kind==='report'&&personal.subbar&&<div className="room-topic-bar">{personal.subbar}</div>}
    {personal?.kind!=='report'&&<div className="room-topic-bar">{topicPicker}
      {topicCreation}
      <button type="button" className={`icon-button topic-more ${panel ? 'pressed' : ''}`} aria-label={t("话题操作")} aria-haspopup="menu" title={t("话题管理、压缩、导出和清空")} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 6, items: [
        { label: panel ? t("收起话题管理") : t("话题管理"), icon: <Layers size={14} />, onSelect: () => setPanel(value => !value) },
        ...(personal?.kind==='desk'&&!archived?[{label:t("新话题选项"),icon:<MessageSquarePlus size={14}/>,disabled:busy||personalLoading||!snapshot.backendReady,onSelect:()=>setNewTopic({})}]:[]),
        ...(!archived && messages.length > 0 ? [{ label: t("压缩上下文"), icon: <Sparkles size={14} />, disabled: busy || state.active || Boolean(compressing) || !summarizer.member || !snapshot.backendReady || historyOnly, onSelect: () => void compressCurrent() }] : []),
        { label: personal ? t("导出当前话题") : t("导出聊天室"), icon: <Download size={14} />, disabled: busy || state.active || !messages.length || !snapshot.backendReady, onSelect: () => void exportTopic() },
        'separator' as const,
        archived ? { label: t("删除归档话题"), icon: <Trash2 size={14} />, danger: true, disabled: busy || state.active, onSelect: () => void manage('delete') }
          : { label: t("清空当前话题"), icon: <Eraser size={14} />, danger: true, disabled: busy || state.active || !messages.length || !snapshot.backendReady, onSelect: () => void manage('clear') },
      ] }); }}><MoreHorizontal size={16} /></button>
      {thread && (thread.summary || thread.inherited) && <RoomSummaryDrawer thread={thread}><span className="topic-bar-links">{thread.summary?.proposals?.length ? <button type="button" className="link-button topic-memory" onClick={() => setProposing(true)}><BookmarkPlus size={12} />{t("有 {0} 条可以记住的事", thread.summary.proposals.length)}</button> : null}{thread.inherited && !archived && <button type="button" className="link-button topic-uninherit" disabled={busy || state.active || Boolean(compressing) || !snapshot.backendReady} title={t("当前话题不再带着之前话题的摘要")} onClick={() => void uninherit()}><Unlink size={12} />{t("不再延续")}</button>}{global&&thread.summary && <button type="button" className="link-button topic-handoff" onClick={() => setHandoff({ threadId: thread.id, text: t("请根据团队聊天室话题「{0}」的讨论摘要完成任务。\n\n{1}", thread.title, thread.summary!.text) })}><Briefcase size={12} />{t("把摘要交给项目")}</button>}</span></RoomSummaryDrawer>}
    </div>}</>}
    {project && thread?.summary && <RoomSummaryDrawer thread={thread}/>}
    {!compactHeader&&presence}
    </RoomHeader>;
  return <>{deskToolbar&&createPortal(<div className="room-actions desk-toolbar-actions">{personal?.headerActions}</div>,deskToolbar)}{header}{compactHeader&&presence&&<RoomHeader className="room-presence-header">{presence}</RoomHeader>}</>;
}

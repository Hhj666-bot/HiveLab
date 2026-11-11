import {t} from '../i18n';
import {WorkspaceToolbarSecondary} from "../workspace-toolbar";
import {useReplyLimits} from "../reply-limits";
import {useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {Copy, Download, Reply, Eraser, Sparkles} from "lucide-react";
import type {Attachment, RoomMessage, RoomThread} from "../../shared/types";
import {DEFAULT_ROOM_THREAD} from "../../shared/room";
import {type DiscussionStyle} from "../../shared/discussion";
import {ConversationScope} from "../conversation-search";
import {useTeam, type TeamMember} from "../members";
import {runnable, type Invoke} from "../ui";
import {useSummarizer} from "../topics";
import {type HandoffSource} from "../handoff";
import {type MenuItem, type MenuState} from "../interactions";
import {useAttachments} from "../attachments";
import {Briefcase} from "lucide-react";
import {useExtensionFeature} from "../extensions";
import {useComposerDraft} from "../composer-draft";
import {useMessageSkills} from "../message-skills";
import type {RoomViewProps, RoomData} from "./types";
import {useRoomTimeline} from "./use-room-timeline";
import type {MessageActions} from "./MessageLine";
const INVITED_KEY = 'hivelab.room.invited';
const handoffText = (speaker: string, text: string) => t("请根据茶歇室的讨论完成下面的任务。\n\n{0}：{1}", speaker, text);
/** The last reading of each room. A page opens with it and is corrected by the fresh read that follows. */
const roomCache=new Map<string,RoomData>();
export function warmRoom(roomId:string){
  if(roomCache.has(roomId))return;
  void window.hivelab.invoke('room.get',{roomId}).then(result=>{if((result as RoomData|undefined)?.state)roomCache.set(roomId,result as RoomData);}).catch(()=>{});
}
export function useRoomController({snapshot,invoke:rawInvoke,onOpenSession,split,focus:ownFocus,roomId="global",project,personal,surface}:RoomViewProps){
  const global = roomId === 'global';
  const conversationScope=useContext(ConversationScope),searchFocus=conversationScope?.focus?.roomId===roomId?conversationScope.focus:undefined;
  const focus=searchFocus&&(!ownFocus||searchFocus.nonce>ownFocus.nonce)?searchFocus:ownFocus;
  // Every room call names its room; the tea room keeps the old unscoped form.
  const invoke = useCallback(<T,>(method: string, params?: unknown, success?: string, options?:{background?:boolean}) => rawInvoke<T>(method, global || !method.startsWith('room.') ? params : { ...(params as Record<string, unknown> | undefined), roomId }, success,options), [rawInvoke, global, roomId]) as Invoke;
  // The snapshot carries the tea room; another room is read on its own and re-read when its revision moves.
  const [loaded, setLoaded] = useState<RoomData | null>(()=>global?null:roomCache.get(roomId)??null);
  const revision = snapshot.rooms?.find(item => item.roomId === roomId)?.revision;
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    if (global) return; let cancelled = false;
    void rawInvoke<RoomData>('room.get', { roomId }).then(result => { if (!result?.state) return; roomCache.set(roomId,result); if (!cancelled) setLoaded(result); }).catch(() => {});
    return () => { cancelled = true; };
  }, [global, roomId, revision, reloads]);
  useEffect(() => { if (!global) setLoaded(current => current?.roomId===roomId?current:null); }, [roomId]);
  const expectedTopic=snapshot.rooms?.find(r=>r.roomId===roomId)?.currentThreadId;
  const expectedFolder=snapshot.rooms?.find(r=>r.roomId===roomId)?.folderKey;
  const personalLoading=Boolean(personal&&(!loaded||loaded.roomId!==roomId||expectedTopic!==undefined&&loaded.currentThreadId!==expectedTopic||expectedFolder!==undefined&&loaded.folderKey!==expectedFolder));
  const roomLoading=personalLoading||!global&&!loaded;
  const room: RoomData = global ? snapshot.room : (personalLoading?undefined:loaded) ?? { state: { active: false, mode: 'chat' }, messages: [], threads: [], hasMore: false } as unknown as RoomData;
  const personalSession=personal?.kind==='desk'?snapshot.sessions.find(s=>s.id===room.sessionId):undefined;
  const [handoff, setHandoff] = useState<HandoffSource | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [proposing, setProposing] = useState(false);
  const [imageDialog,setImageDialog]=useState<{text:string;attachments:Attachment[];draftVersion:number}|null>(null);
  const team = useTeam(), { state } = room, profile = snapshot.profile;
  const historyOnly=Boolean(surface?.readOnly||personalSession?.restoredHistoryOnly||personal&&!snapshot.members.some(member=>member.id===personal.memberId));
  const ready = (executor: string) => runnable(snapshot.providers.find(item => item.id === executor));
  const imageProvider=snapshot.providers.find(info=>info.id==='codex');
  const imagesEnabled=useExtensionFeature('imageGeneration');
  const canGenerateImage=imagesEnabled&&ready('codex')&&imageProvider?.capabilities.imageGeneration===true;
  const [ownInvited, setOwnInvited] = useState<string[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(INVITED_KEY) ?? 'null'); if (Array.isArray(saved)) return saved.filter(id => typeof id === 'string'); } catch {}
    return team.members.filter(member => ready(member.executor)).map(member => member.id);
  });
  // A project room's people are the project's roster; the tea room remembers its own invitation.
  const invited = personal ? [personal.memberId] : project ? project.roster : ownInvited;
  const setInvited = (next: string[] | ((previous: string[]) => string[])) => { const value = typeof next === 'function' ? next(invited) : next; if (project) project.onRoster(value); else setOwnInvited(value); };
  const usable = invited.map(id => team.members.find(member => member.id === id)).filter((member): member is TeamMember => Boolean(member && ready(member.executor)));
  const [mode, setMode] = useState<'chat' | 'meeting'>('chat');
  const discussion = state.mode === 'discuss' ? state.discussion : undefined;
  const [handRaise, setHandRaise] = useState(false);
  const [hostPick,setHostPick]=useState(true);
  // 闲聊 is an open-ended chat without a budget; 开会 is a discussion that closes once the topic is handled.
  const style: DiscussionStyle = mode === 'chat' ? 'chat' : 'work';
  const replyLimits=useReplyLimits(snapshot.dataDirectory+':'+roomId+':'+style);
  const [minutesDialog,setMinutesDialog]=useState<{discussionId:string;revision:number;memberId:string;interrupt:boolean}>(),[minutesBusy,setMinutesBusy]=useState(false),[minutesError,setMinutesError]=useState('');
  const minutesMembers=team.members.filter(m=>discussion?.members.includes(m.id)&&ready(m.executor));
  async function openMinutes(){if(!discussion)return;const saved=discussion;setMinutesBusy(true);setMinutesError('');try{let lead:string|undefined;if(roomId.startsWith('project:')){const data=await rawInvoke<{flow?:{leadMemberId:string};overview?:{stage?:{leadMemberId?:string}}}>('projectFlow.get',{projectId:roomId.slice(8)});lead=data.overview?.stage?.leadMemberId??data.flow?.leadMemberId;}const candidates=saved.members.filter(id=>minutesMembers.some(m=>m.id===id));setMinutesDialog({discussionId:saved.id,revision:saved.revision,memberId:lead&&candidates.includes(lead)?lead:candidates[0]??'',interrupt:state.active});}catch{}finally{setMinutesBusy(false);}}
  async function confirmMinutes(){if(!minutesDialog)return;setMinutesBusy(true);setMinutesError('');try{await invoke('room.minutes',{discussionId:minutesDialog.discussionId,revision:minutesDialog.revision,memberId:minutesDialog.memberId});setMinutesDialog(undefined);}catch(e){setMinutesError((e as Error).message);}finally{setMinutesBusy(false);}}
  useEffect(() => { if (discussion) { const chat = discussion.style === 'chat'; setMode(chat ? 'chat' : 'meeting'); setInvited(discussion.members); setHandRaise(Boolean(discussion.handRaise));setHostPick(discussion.hostPick!==false); } }, [discussion?.id]);
  const [sendFeedback,setSendFeedback]=useState('');
  useEffect(()=>setSendFeedback(''),[roomId]);
  const [sending, setSending] = useState(false), [busy, setBusy] = useState(false),[stopping,setStopping]=useState(false);
  const [capabilitySaving,setCapabilitySaving]=useState(false);
  const [archiveId, setArchiveId] = useState<string>();
  const [panel, setPanel] = useState(false), [newTopic, setNewTopic] = useState<{ from?: RoomThread } | null>(null);
  // Anyone ready may write a summary, even if they are not invited to the current conversation.
  const writers = team.members.filter(member => ready(member.executor)&&(!personal||member.id===personal.memberId));
  const summarizer = useSummarizer(writers);
  const currentId = room.currentThreadId ?? (global ? DEFAULT_ROOM_THREAD : '');
  const noTopic=personal?.kind==='desk'&&!currentId;
  const skillScope=snapshot.dataDirectory+':'+roomId+':'+currentId;
  const messageSkills=useMessageSkills(skillScope,usable.map(m=>m.executor),rawInvoke);
  const selectedId = archiveId ?? currentId, archived = selectedId !== currentId;
  const setSearchCurrent=conversationScope?.setCurrent;
  useEffect(()=>{setSearchCurrent?.(selectedId&&!personalLoading?{roomId,threadId:selectedId}:undefined);return()=>setSearchCurrent?.(undefined);},[setSearchCurrent,roomId,selectedId,personalLoading]);
  const composer=useComposerDraft(snapshot.dataDirectory,currentId&&!personalLoading?{roomId,threadId:currentId,restoreEpoch:snapshot.restoreEpoch}:undefined,rawInvoke);
  const draft=composer.value.text,setDraft=(text:string)=>composer.update(value=>({...value,text}));
  const replyTo=composer.value.replyTo,setReplyTo=(id:string|undefined)=>composer.update(value=>({...value,replyTo:id}));
  const workIntent=composer.value.workIntent??'ask',setWorkIntent=(value:'ask'|'add'|'supplement')=>composer.update(previous=>({...previous,workIntent:value}));
  const attach=useAttachments(invoke,[],{items:composer.value.attachments,update:change=>composer.update(value=>({...value,attachments:change(value.attachments)}))});
  // Only messages that arrive while a topic is open animate in; opening a room or paging history does not.
  useEffect(() => { if (global&&!personal) try { localStorage.setItem(INVITED_KEY, JSON.stringify(ownInvited)); } catch {} }, [ownInvited, global, Boolean(personal)]);
  const timeline=useRoomTimeline({snapshot,room,roomId,personal,personalLoading,expectedFolder,global,selectedId,currentId,archived,focus,archiveId,noTopic,setArchiveId,setNewTopic,usable,draft,project,team,invoke});
  const {
    enterAfter, enter, threads, thread, history, setHistory, loading, setLoading, request, loadingRef, list, textarea, pinned, floatingChat, anchor,
    seenKey, readSeen, unseen, setUnseen, expanded, setExpanded, dividerAt, setDividerAt, newest, jumped, markSeen, page, messages, activityMessages,
    hasMore, before, acknowledged, acknowledge, mention, setMention, mentionIndex, setMentionIndex, mentionedWorker, candidates, named, participants,
    loadHistory, openedAtBottom, streamedBodies, live, runsById, messagesById, previousActivity, emptyActivitySnapshot, activitySnapshots,
    messageContent, shownThread, dividerIndex, jumpToLatest, focusing, appliedFocus, focusThreadReady
  }=timeline;
  const speaking = state.active ? team.get(state.speaking) : undefined;
  const compressing = state.compressing ? team.get(state.compressing) : undefined;
  const current = threads.find(item => item.id === currentId) ?? { id: currentId, title: t("当前话题"), createdAt: '' };

  function toggle(id: string) { setInvited(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]); }
  function updateMention(value: string, caret: number) {
    const prefix = value.slice(0, caret), start = Math.max(prefix.lastIndexOf('@'), prefix.lastIndexOf('＠'));
    const query = prefix.slice(start + 1);
    setMention(start >= 0 && query.length <= 40 && !/[\n@＠，。！？,:;：；!?()[\]{}]/.test(query) ? { start, end: caret, query } : null);
    setMentionIndex(0);
  }
  function chooseMention(member: TeamMember) {
    if (!mention) return;
    const value = `${draft.slice(0, mention.start)}@${member.name} ${draft.slice(mention.end)}`;
    const caret = mention.start + member.name.length + 2;
    setDraft(value); setMention(null);
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(caret, caret); });
  }
  async function send(text = draft) {
    const body = text.trim();
    if((!body&&!attach.items.length)||sending||stopping||busy||attach.busy||archived||historyOnly||personalLoading||noTopic)return;
    if(!messageSkills.ready)return;
    if(messageSkills.incompatible){setSendFeedback(t("所选 Skills 与当前参与成员不兼容，请点击 Skills 调整。"));return;}
    messageSkills.setOpen(false);
    const chosenSkills=messageSkills.selected.map(s=>({...s}));
    const sentVersion=composer.version,submitted={...composer.value,text};
    if(project?.onTaskRequest&&mentionedWorker&&workIntent!=='ask'){if(await project.onTaskRequest(mentionedWorker.id,body.replace('@'+mentionedWorker.name,'').replace('＠'+mentionedWorker.name,'').trim(),workIntent,chosenSkills)){composer.sent(submitted,sentVersion);messageSkills.sent(chosenSkills);setMention(null);}return;}
    if ((!body && !attach.items.length) || sending || stopping || busy || attach.busy || compressing || (state.active && state.mode !== 'discuss' && personal?.kind !== 'desk') || archived || historyOnly || personalLoading || noTopic) return;
    setSending(true); pinned.current = true; setDividerAt(undefined);
    try { const result=await invoke<{delivery?:string}>('room.send', { text: body, skills:chosenSkills.map(({source,id})=>({source,id})), memberIds: usable.map(member => member.id), mode: 'discuss', style, ...(!personal&&!surface?{replyLimits:{...replyLimits.value,overrides:Object.fromEntries(Object.entries(replyLimits.value.overrides).filter(([id])=>team.members.some(m=>m.id===id)))}}:{}), maxMinutes: 0, handRaise: mode === 'meeting' && handRaise,hostPick, replyTo, ...(attach.items.length ? { attachments: attach.items } : {}) }); setSendFeedback(result?.delivery==='current'?t("执行端已接收补充，采用情况请核对回复。"):result?.delivery==='queued'?t("已排到下一轮，当前工作继续；本次补充不会中断成员。"):''); composer.sent(submitted,sentVersion); messageSkills.sent(chosenSkills); setMention(null); } catch(e) { setSendFeedback((e as Error).message); } finally { setSending(false); }
  }
  async function terminateSpeech(){
    if(stopping||!snapshot.backendReady)return;
    setStopping(true);
    try{const endDiscussion=!personal&&!surface;await invoke('room.stop',{endDiscussion});setSendFeedback(endDiscussion?t("本轮发言已终止，可以调整在场成员后重新发送。"):t("已发出中止要求，后续排队发言已撤回。"));}
    catch(e){setSendFeedback((e as Error).message);}
    finally{setStopping(false);}
  }
  async function resumeDiscussion() {
    const acknowledgeUnknown = Boolean(discussion?.unknownRunId || discussion?.unknownRunIds?.length);
    if (acknowledgeUnknown && !window.confirm(t("上次执行结果未知。请先核对已收到的内容和活动记录。确认后将按当前讨论继续，不会重发原轮次。"))) return;
    try { await invoke('room.resume', { acknowledgeUnknown, maxMinutes: 0, handRaise: mode === 'meeting' && handRaise,hostPick }); } catch {}
  }
  async function chooseHand(choice:'member'|'auto'|'skip',memberId?:string){
    if(busy||!discussion?.handRound||!(discussion.phase==='awaiting-host'||discussion.phase==='raising'&&discussion.hostPick&&discussion.handRound.status==='collecting'))return;
    setBusy(true);try{await invoke('room.host',{discussionId:discussion.id,revision:discussion.revision,handRoundId:discussion.handRound.id,choice,memberId});}catch{}finally{setBusy(false);}
  }
  async function endDiscussion() {
    if(!discussion||busy)return;
    const acknowledgeUnknown=Boolean(discussion.unknownRunId||discussion.unknownRunIds?.length);
    if(acknowledgeUnknown&&!window.confirm(t("上次执行结果未知。请先核对已收到的内容和活动记录。确认后结束本次讨论，不会重发原轮次。")))return;
    setBusy(true);
    try{await invoke('room.end',{discussionId:discussion.id,acknowledgeUnknown},t("本次讨论已由你结束。"));}catch{}finally{setBusy(false);}
  }
  const afterTopicChange = () => { setReloads(n => n + 1); ++request.current; loadingRef.current = false; setLoading(false); setHistory(null); setArchiveId(undefined); setMention(null); pinned.current = true; };
  async function manage(action: 'clear' | 'delete') {
    const question = action === 'delete' ? t("删除归档话题「{0}」？这段记录将永久删除，当前话题不受影响。", thread?.title)
      : t("清空当前话题？消息会删除，成员也会忘掉本话题。归档记录和项目会话保留。");
    if (!window.confirm(question)) return;
    setBusy(true);
    try { await invoke(`room.${action}`, action === 'delete' ? { threadId: selectedId } : undefined, action === 'delete' ? t("归档话题已删除。") : t("当前话题已清空。")); if(action==='clear')composer.clear(); afterTopicChange(); } catch {} finally { setBusy(false); }
  }
  async function compressCurrent() {
    if (!summarizer.member || !window.confirm(t("让 {0} 把当前话题压缩成摘要？之后成员从摘要继续，消息仍然保留。这会使用一次成员额度。", summarizer.member.name))) return;
    setBusy(true);
    try { await invoke('room.compress', { threadId: currentId, memberId: summarizer.member.id }, t("已压缩，成员接下来从摘要继续。")); pinned.current = true; } catch {} finally { setBusy(false); }
  }
  async function uninherit() {
    if (!thread?.inherited || !window.confirm(t("不再延续「{0}」？成员会只从本话题自己的内容继续，原来的话题记录不受影响。", thread.inherited.title))) return;
    setBusy(true);
    try { await invoke('room.uninherit', { threadId: thread.id }, t("已不再延续之前的话题。")); } catch {} finally { setBusy(false); }
  }
  async function exportTopic(threadId = selectedId) {
    setBusy(true);
    try {
      const result = await invoke<{ title: string; content: string }>('room.export', { threadId });
      await invoke('file.save', { name: t("HiveLab 合屋 {0} - {1}.md", personal?personal.kind==='desk'?t("工位"):t("汇报"):t("聊天室"), result.title), content: result.content });
    } catch {} finally { setBusy(false); }
  }
  const name = (message: RoomMessage) => message.authorName ?? (message.author === 'user' ? (profile.name && profile.name !== '你' ? profile.name : t("你")) : team.get(message.author)?.name ?? t("成员"));
  const authorName = (author: string) => author === 'user' ? (profile.name && profile.name !== '你' ? profile.name : t("你")) : team.get(author)?.name ?? t("成员");
  // Less frequent message actions live in one menu, opened from "…" or by right-clicking the message.
  function messageMenu(message: RoomMessage, canReply: boolean, selection?:string): MenuItem[] {
    const text = message.text, copyText=selection||text, finished = message.author === 'user' || message.status === 'done';
    return [
      { label: selection?t("复制选中文字"):t("复制文字"), icon: <Copy size={14} />, disabled: !copyText, onSelect: () => { void navigator.clipboard.writeText(copyText).catch(() => {}); } },
      ...(canReply ? [{ label: t("回复这条"), icon: <Reply size={14} />, onSelect: () => { setReplyTo(message.id); textarea.current?.focus(); } }] : []),
      ...(global ? [{ label: t("交给项目"), icon: <Briefcase size={14} />, disabled: !text || !finished, onSelect: () => setHandoff({ threadId: selectedId, messageId: message.id, text: handoffText(name(message), text) }) }] : []),
    ];
  }
  const openMessageMenu = (event: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, items: MenuItem[]) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, items }); };
  async function react(message: RoomMessage, emoji: string) { try { await invoke('room.react', { messageId: message.id, emoji }); } catch {} }

  const actionHandlers=useRef<MessageActions|null>(null);
  useLayoutEffect(()=>{actionHandlers.current={
    menu:(event,message,reply)=>openMessageMenu(event,messageMenu(message,reply,window.getSelection()?.toString())),
    reply:id=>{setReplyTo(id);textarea.current?.focus();},
    expand:id=>setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;}),
    react:(message,emoji)=>void react(message,emoji),
    editImage:image=>setImageDialog({text:draft,draftVersion:composer.version,attachments:[image]}),
  };});
  const messageActions=useMemo<MessageActions>(()=>({menu:(...args)=>actionHandlers.current!.menu(...args),reply:id=>actionHandlers.current!.reply(id),expand:id=>actionHandlers.current!.expand(id),react:(...args)=>actionHandlers.current!.react(...args),editImage:image=>actionHandlers.current!.editImage(image)}),[]);

  const recordItems: MenuItem[] = [
    ...(messages.length > 0 ? [{ label: t("压缩上下文"), icon: <Sparkles size={14} />, disabled: busy || state.active || Boolean(compressing) || !summarizer.member || !snapshot.backendReady || Boolean(surface?.readOnly), onSelect: () => void compressCurrent() }] : []),
    { label: t("导出会议记录"), icon: <Download size={14} />, disabled: busy || state.active || !messages.length || !snapshot.backendReady, onSelect: () => void exportTopic() },
    ...(surface ? [] : ['separator' as const, { label: t("清空会议记录"), icon: <Eraser size={14} />, danger: true, disabled: busy || state.active || !messages.length || !snapshot.backendReady, onSelect: () => void manage('clear') }]),
  ];
  useLayoutEffect(()=>{if(surface?.recordActions)surface.recordActions.current=recordItems;});
  const secondaryToolbar=useContext(WorkspaceToolbarSecondary);
  const compactHeader=personal?.kind==='desk'||(!project&&!personal);
  const deskToolbar=personal?.kind==='desk'&&secondaryToolbar;

  const deskCapabilities=state.capabilityMode==='desk';
  async function selectTopic(id:string){if(personal){try{await invoke('room.select',{threadId:id});afterTopicChange();}catch{}}else setArchiveId(id===currentId?undefined:id);}
  return {
    snapshot, rawInvoke, onOpenSession, split, ownFocus, roomId, project, personal, surface, global, conversationScope, searchFocus, focus, invoke,
    loaded, setLoaded, revision, reloads, setReloads, expectedTopic, expectedFolder, personalLoading, room, personalSession, handoff, setHandoff,
    menu, setMenu, proposing, setProposing, imageDialog, setImageDialog, team, state, profile, historyOnly, ready, imageProvider, imagesEnabled,
    canGenerateImage, ownInvited, setOwnInvited, invited, setInvited, usable, mode, setMode, discussion, handRaise, setHandRaise, hostPick,
    setHostPick, style, replyLimits, minutesDialog, setMinutesDialog, minutesBusy, setMinutesBusy, minutesError, setMinutesError, minutesMembers,
    openMinutes, confirmMinutes, sendFeedback, setSendFeedback, sending, setSending, busy, setBusy, stopping, setStopping, capabilitySaving,
    setCapabilitySaving, archiveId, setArchiveId, panel, setPanel, newTopic, setNewTopic, writers, summarizer, currentId, noTopic, skillScope,
    messageSkills, selectedId, archived, setSearchCurrent, composer, draft, setDraft, replyTo, setReplyTo, workIntent, setWorkIntent, attach,
    speaking, compressing, current, toggle, updateMention, chooseMention, send, terminateSpeech, resumeDiscussion, chooseHand, endDiscussion,
    afterTopicChange, manage, compressCurrent, uninherit, exportTopic, name, authorName, messageMenu, openMessageMenu, react, actionHandlers,
    messageActions, recordItems, secondaryToolbar, compactHeader, deskToolbar, deskCapabilities, selectTopic, enterAfter, enter, threads, thread,
    history, setHistory, loading, setLoading, request, loadingRef, list, textarea, pinned, floatingChat, anchor, seenKey, readSeen, unseen, setUnseen,
    expanded, setExpanded, dividerAt, setDividerAt, newest, jumped, markSeen, page, messages, activityMessages, hasMore, before, acknowledged,
    acknowledge, mention, setMention, mentionIndex, setMentionIndex, mentionedWorker, candidates, named, participants, loadHistory, openedAtBottom,
    roomLoading, streamedBodies, live, runsById, messagesById, previousActivity, emptyActivitySnapshot, activitySnapshots, messageContent, shownThread,
    dividerIndex, jumpToLatest, focusing, appliedFocus, focusThreadReady
  };
}
export type RoomController=ReturnType<typeof useRoomController>;

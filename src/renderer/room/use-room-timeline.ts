import {t} from '../i18n';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import type {RoomHistory, RoomId, RoomMessage, RoomThread, Snapshot} from "../../shared/types";
import {roomMentions} from "../../shared/room";
import {streamDiscussionBody} from "../../shared/discussion-format";
import {useFloatingChatLayout} from "../liquid-chat-layout";
import {type ActivitySnapshot} from "../run-activity";
import {type TeamMember} from "../members";
import {type Invoke} from "../ui";
import {mergeMemberReports} from "../../shared/member-report-history";
import type {Dispatch, SetStateAction} from "react";
import type {Team} from "../members";
import type {RoomData, PersonalRoomChat, ProjectRoomChat, RoomFocus} from "./types";
const SEEN_KEY='hivelab.room.seen';
const mergeMessages=(...groups:RoomMessage[][])=>[...new Map(groups.flat().map(message=>[message.id,message])).values()];
export function useRoomTimeline({snapshot,room,roomId,personal,personalLoading,expectedFolder,global,selectedId,currentId,archived,focus,archiveId,noTopic,setArchiveId,setNewTopic,usable,draft,project,team,invoke}:{
 snapshot:Snapshot;room:RoomData;roomId:RoomId;personal?:PersonalRoomChat;personalLoading:boolean;expectedFolder?:string;
 global:boolean;selectedId:string;currentId:string;archived:boolean;focus?:RoomFocus;archiveId?:string;noTopic:boolean;
 setArchiveId:Dispatch<SetStateAction<string|undefined>>;setNewTopic:Dispatch<SetStateAction<{from?:RoomThread}|null>>;
 usable:TeamMember[];draft:string;project?:ProjectRoomChat;team:Team;invoke:Invoke;
}){
  const enterAfter = useMemo(() => new Date().toISOString(), [roomId, selectedId]);
  const enter = (message: RoomMessage) => message.at > enterAfter ? ' enter' : '';
  const threads = room.threads?.length ? room.threads : noTopic?[]:[{ id: currentId, title: t("当前话题"), createdAt: '' }];
  const thread = threads.find(item => item.id === selectedId);
  const [history, setHistory] = useState<RoomHistory | null>(null), [loading, setLoading] = useState(false);
  const request = useRef(0), loadingRef = useRef(false);
  useEffect(()=>{if(personal){++request.current;setHistory(null);setArchiveId(undefined);setNewTopic(null);}},[expectedFolder]);
  const list = useRef<HTMLDivElement>(null), textarea = useRef<HTMLTextAreaElement>(null), pinned = useRef(true);
  const floatingChat=useFloatingChatLayout(list,pinned);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  // Reading position: arrivals while scrolled up are counted, and on return a divider marks where the user left off.
  const seenKey = `${SEEN_KEY}:${currentId}`;
  const readSeen = () => { try { return localStorage.getItem(seenKey) ?? undefined; } catch { return undefined; } };
  const [unseen, setUnseen] = useState(0), [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [dividerAt, setDividerAt] = useState<string | undefined>(readSeen);
  const newest = useRef<string | undefined>(undefined), jumped = useRef(false);
  const markSeen = () => { if (newest.current) try { localStorage.setItem(seenKey, newest.current); } catch {} };
  const page = history?.threadId === selectedId ? history : null;
  const messages = useMemo(() => {const result=archived ? page?.messages ?? [] : mergeMessages(page?.messages ?? [], room.messages);return personal?.kind==='report'?mergeMemberReports(result):personal?result.sort((a,b)=>a.at.localeCompare(b.at)||Number(a.author!=='user')-Number(b.author!=='user')||a.id.localeCompare(b.id)):result;}, [archived, page, room.messages, personal?.kind]);
  const activityMessages = useMemo(()=>{const seen=new Set<string>(),ids=new Set<string>();for(const message of messages)if(message.runId&&message.author!=='user'&&!message.system&&!message.contextOnly&&!message.discussionControl&&message.status!=='passed'&&!seen.has(message.runId)){seen.add(message.runId);ids.add(message.id);}return ids;},[messages]);
  const hasMore = page?.hasMore ?? (!archived && Boolean(room.hasMore));
  const before = page ? page.before : archived ? undefined : room.before;
  const acknowledged=useRef<string|undefined>(undefined);
  const acknowledge=()=>{const token=room.readToken;if(personal&&token&&pinned.current&&!archived&&acknowledged.current!==token){acknowledged.current=token;void invoke('room.read',{readToken:token}).catch(()=>{acknowledged.current=undefined;});}};
  useEffect(()=>{acknowledge();},[room.readToken,archived]);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null), [mentionIndex, setMentionIndex] = useState(0);
  const mentionedWorker=project&&usable.find(m=>draft.includes('@'+m.name)||draft.includes('＠'+m.name));
  const candidates = mention ? usable.filter(member => member.name.toLowerCase().startsWith(mention.query.toLowerCase())) : [];
  const named = roomMentions(draft, team.members);
  const participants = named.ids.length ? named.ids.map(id => usable.find(member => member.id === id)).filter((member): member is TeamMember => Boolean(member)) : usable;

  async function loadHistory(older: boolean) {
    if (loadingRef.current || (older && (!hasMore || !before))) return;
    const revision = ++request.current;
    loadingRef.current = true; setLoading(true);
    if (older && list.current) { pinned.current = false; anchor.current = { height: list.current.scrollHeight, top: list.current.scrollTop }; }
    try {
      const result = await invoke<RoomHistory>('room.history', { threadId: selectedId, before: older ? before : undefined, limit: 100 });
      if (revision === request.current) setHistory(previous => ({ ...result, messages: older ? mergeMessages(result.messages, previous?.threadId === selectedId ? previous.messages : [], archived ? [] : room.messages) : result.messages }));
    } catch { if (revision === request.current) {anchor.current = null;focusing.current=undefined;} } finally { if (revision === request.current) { loadingRef.current = false; setLoading(false); } }
  }
  useEffect(() => {
    ++request.current; loadingRef.current = false; setLoading(false); setHistory(null); setMention(null); anchor.current = null; pinned.current = true;
    if (archived) void loadHistory(false);
    return () => { ++request.current; };
  }, [selectedId]);
  useEffect(() => { if (archiveId && !threads.some(item => item.id === archiveId)) setArchiveId(undefined); }, [archiveId, threads]);
  useEffect(() => {
    if (archived) return;
    if (!room.messages.length) { ++request.current; loadingRef.current = false; setLoading(false); setHistory(null); }
    else setHistory(previous => previous?.threadId === currentId ? { ...previous, messages: mergeMessages(previous.messages, room.messages) } : previous);
  }, [archived, currentId, room.messages]);
  useLayoutEffect(() => {
    if (anchor.current && list.current) { list.current.scrollTop = anchor.current.top + list.current.scrollHeight - anchor.current.height; anchor.current = null; }
  }, [messages]);
  const openedAtBottom=useRef('');
  useLayoutEffect(()=>{const key=roomId+':'+selectedId;if(personal&&messages.length&&list.current&&openedAtBottom.current!==key){openedAtBottom.current=key;pinned.current=true;list.current.scrollTop=list.current.scrollHeight;}},[roomId,selectedId,messages,Boolean(personal)]);

  const streamedBodies = useRef(new Map<string,{key:string;text:string}>());
  const live = useMemo(() => {
    const map = new Map<string, string>();
    const retained = new Map<string,{key:string;text:string}>();
    for (const message of messages) if (message.status === 'speaking' && message.runId) {
      const events = snapshot.events.filter(event => event.runId === message.runId);
      const deltas = events.filter(event => event.kind === 'delta').map(event => event.text).join('');
      const raw = message.discussionId ? deltas || events.filter(event => event.kind === 'message' && (event.data as any)?.role !== 'user').at(-1)?.text || '' : deltas;
      const status = snapshot.runs.find(run => run.id === message.runId)?.status;
      const key = `${message.runId}:${message.discussionTurn??''}:${message.discussionRevision??''}`;
      const previous = streamedBodies.current.get(message.id);
      // Other rooms load messages separately. A completed snapshot can arrive before room.get's final message.
      // Carry only this exact turn's validated preview across that gap, never across a failure or a new run.
      const carry = !global && !raw && (status === 'ended' || status === 'completed') && previous?.key === key ? previous.text : '';
      const hidden = !global && status && ['stopping','stopped','interrupted','unknown','failed'].includes(status);
      const text = hidden ? '' : raw ? message.discussionId ? streamDiscussionBody(raw,message.discussionTurn,message.discussionRevision) : raw : carry;
      map.set(message.id,text);
      if (!global) retained.set(message.id,{key,text});
    }
    streamedBodies.current = retained;
    return map;
  }, [global, messages, snapshot.events, snapshot.runs]);
  const runsById=useMemo(()=>new Map(snapshot.runs.map(run=>[run.id,run])),[snapshot.runs]);
  const messagesById=useMemo(()=>new Map(messages.map(message=>[message.id,message])),[messages]);
  const previousActivity=useRef(new Map<string,ActivitySnapshot>());
  const emptyActivitySnapshot=useMemo<ActivitySnapshot>(()=>({events:[],backendReady:snapshot.backendReady,restoreEpoch:snapshot.restoreEpoch}),[snapshot.backendReady,snapshot.restoreEpoch]);
  const activitySnapshots=useMemo(()=>{
    const events=new Map<string,Snapshot['events']>(),agents=new Map<string,NonNullable<Snapshot['subagents']>>();
    for(const event of snapshot.events){const list=events.get(event.runId)??[];list.push(event);events.set(event.runId,list);}
    // Subagents belong to the main agent's run; finished runs keep them after their events are pruned.
    for(const agent of snapshot.subagents??[]){const list=agents.get(agent.parentRunId)??[];list.push(agent);agents.set(agent.parentRunId,list);}
    const same=<T,>(a:readonly T[]|undefined,b:readonly T[]|undefined)=>(a?.length??0)===(b?.length??0)&&(a??[]).every((item,index)=>item===b![index]);
    // Plan cards need the pending review (Claude) and whether a newer turn has replaced the plan.
    const plans=new Map<string,NonNullable<ActivitySnapshot['planReview']>>(),newest=new Map<string,string>();
    for(const run of snapshot.runs){const top=newest.get(run.sessionId);if(!top||runsById.get(top)!.createdAt<run.createdAt)newest.set(run.sessionId,run.id);}
    for(const run of snapshot.runs)if(run.planProposal){const approval=run.planProposal.approvalId?snapshot.approvals.find(a=>a.id===run.planProposal!.approvalId&&a.state==='pending'):undefined;plans.set(run.id,{latest:newest.get(run.sessionId)===run.id,...(approval?{approval}:{})});}
    const next=new Map<string,ActivitySnapshot>();
    for(const id of new Set([...events.keys(),...agents.keys(),...plans.keys()])){const items=events.get(id)??[],subagents=agents.get(id),plan=plans.get(id),old=previousActivity.current.get(id);next.set(id,old&&old.backendReady===snapshot.backendReady&&old.restoreEpoch===snapshot.restoreEpoch&&same(old.events,items)&&same(old.subagents,subagents)&&old.planReview?.latest===plan?.latest&&old.planReview?.approval===plan?.approval?old:{...emptyActivitySnapshot,events:items,...(subagents?{subagents}:{}),...(plan?{planReview:plan}:{})});}
    return next;
  },[snapshot.events,snapshot.subagents,snapshot.runs,snapshot.approvals,runsById,snapshot.backendReady,snapshot.restoreEpoch,emptyActivitySnapshot]);
  useLayoutEffect(()=>{previousActivity.current=activitySnapshots;},[activitySnapshots]);
  const messageContent=useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = list.current; if (!node) return;
    const toBottom = () => { if (pinned.current) node.scrollTop = node.scrollHeight; };
    const observer = new ResizeObserver(toBottom);
    observer.observe(node);
    if(messageContent.current)observer.observe(messageContent.current);
    toBottom(); return () => observer.disconnect();
  }, [selectedId]);
  // Only a real topic change re-reads the position; a repeated mount must not pick up what this view just stored.
  const shownThread = useRef(currentId);
  useEffect(() => {
    if (shownThread.current === currentId) return;
    shownThread.current = currentId; newest.current = undefined; jumped.current = false; setUnseen(0); setDividerAt(readSeen());
  }, [currentId]);
  useEffect(() => {
    if (archived || !messages.length) return;
    const latest = messages.reduce((top, message) => message.at > top ? message.at : top, ''), before = newest.current;
    if (!before || latest > before) newest.current = latest;
    if (before && !pinned.current) {
      const arrived = messages.filter(message => message.at > before && message.author !== 'user' && !message.discussionControl).length;
      if (arrived) setUnseen(count => count + arrived);
    }
    if (pinned.current) markSeen();
  }, [archived, messages]);
  const dividerIndex = !archived && dividerAt ? messages.findIndex(message => message.at > dividerAt && message.author !== 'user' && !message.discussionControl) : -1;
  // Opening the room with unread messages starts at the divider rather than the bottom.
  useLayoutEffect(() => {
    const node = list.current, divider = node?.querySelector<HTMLElement>('.room-new-divider');
    if (personal || jumped.current || !node || !divider) return;
    jumped.current = true;
    if (node.scrollHeight > node.clientHeight) { pinned.current = false; const inset=parseFloat(getComputedStyle(node).scrollPaddingTop)||0;node.scrollTop += divider.getBoundingClientRect().top - node.getBoundingClientRect().top - inset - 12; }
  }, [dividerIndex]);
  function jumpToLatest() {
    const node = list.current; if (!node) return;
    pinned.current = true; node.scrollTop = node.scrollHeight; setUnseen(0); markSeen();acknowledge();
  }
  // Opening a pending item: switch to its topic, then bring the message into view once it is loaded.
  const focusing = useRef<string | undefined>(undefined);
  const appliedFocus=useRef<number|undefined>(undefined),focusThreadReady=!focus?.threadId||threads.some(item=>item.id===focus.threadId);
  useLayoutEffect(() => {
    if(!focus){focusing.current=undefined;return;}
    if (personalLoading||!focusThreadReady||appliedFocus.current!==undefined&&appliedFocus.current>=focus.nonce) return;
    appliedFocus.current=focus.nonce;
    setArchiveId(focus.threadId && focus.threadId !== currentId && threads.some(item => item.id === focus.threadId) ? focus.threadId : undefined);
    focusing.current = focus.messageId;
  }, [focus?.nonce,personalLoading,focusThreadReady,currentId]);
  useLayoutEffect(() => {
    const id = focusing.current, node = list.current; if (!id || !node) return;
    if(focus?.threadId&&selectedId!==focus.threadId)return;
    const report=messages.find(message=>message.memberReportVersions?.some(version=>version.messageId===id));
    const target = node.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(report?.id??id)}"]`);
    if(!target){if(hasMore&&!loading)void loadHistory(true);return;}
    setExpanded(previous=>new Set([...previous,id]));
    if(report){const versions=target.querySelector('details');if(versions)versions.open=true;}
    focusing.current = undefined; pinned.current = false; jumped.current = true;
    target.scrollIntoView({ block: 'center' }); target.classList.remove('focus-flash'); void target.offsetWidth; target.classList.add('focus-flash');
  }, [messages, focus?.nonce,loading,selectedId]);
  return {
    enterAfter, enter, threads, thread, history, setHistory, loading, setLoading, request, loadingRef, list, textarea, pinned, floatingChat, anchor,
    seenKey, readSeen, unseen, setUnseen, expanded, setExpanded, dividerAt, setDividerAt, newest, jumped, markSeen, page, messages, activityMessages,
    hasMore, before, acknowledged, acknowledge, mention, setMention, mentionIndex, setMentionIndex, mentionedWorker, candidates, named, participants,
    loadHistory, openedAtBottom, streamedBodies, live, runsById, messagesById, previousActivity, emptyActivitySnapshot, activitySnapshots,
    messageContent, shownThread, dividerIndex, jumpToLatest, focusing, appliedFocus, focusThreadReady
  };
}

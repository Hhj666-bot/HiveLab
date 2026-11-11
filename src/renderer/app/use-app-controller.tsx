import {t as tr} from '../i18n';
import type {ReportEntry} from "../report-switcher";
import type {MemberReportPage} from "../../shared/project-workbench";
import {isConversationSession} from "../../shared/session-classification";
import {idleActivity} from "../life-status";
import {MemberNoticeStack, useFocusedMemberNotices} from "../member-notifications";
import {type MemberNotice} from "../../shared/member-notifications";
import type {AttentionItem} from "../../shared/attention";
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef} from "react";
import {useThemeAccent} from '../theme-accent';
import {useAdaptiveTextPage} from "../adaptive-text";
import {Plus, Trash2, GitMerge, Pencil} from "lucide-react";
import type {Project, ProviderId, Session} from "../../shared/types";
import {MOOD_TEXT, makeTeam, memberIdOf, moodOf, type Mood, type Team} from "../members";
import {descendantIds} from "../../shared/project-tree";
import {needsMembers, saveProjectMembers} from "../project-members";
import {type MemberStatus} from "../member-card";
import {type SettingsTab} from "../settings";
import type {ConversationMatch} from "../../shared/conversation-search";
import {useWorkspaceRoots} from "../workspace-explorer";
import type {WorkspaceRoot} from "../../shared/workspace-files";
import {useHomeBackground} from "../home-background";
import {backgroundPage} from "../../shared/background";
import {isBusy, useMemberNotifications, type MenuItem} from "../interactions";
import {errorText, isActiveRun, providerSummary, runnable, sessionTitle, useTicker} from "../ui";
import {useSegmentedIndicator} from "../segmented-indicator";
import {useAppStore, useAppActions} from "./store-context";
import {useAppBackend} from "./use-app-backend";
export function useAppController(){
  const state=useAppStore(state=>state),actions=useAppActions();
  const {
    snapshot, memberStop, memberStopping, memberStopError, loaded, backendMessage, projectId, sessionId, sidebarTab, terminalShown, terminalRequest,
    modal, hierarchy, collapsedProjects, quotaOpen, activityOpen, automationOpen, settingsTab, settingsEditing, settingsFocus, view, deskMemberId,
    reportMemberId, reportRosterState, roomFocus, searchCurrent, searchFocus, roundtableRequest, inviteProject, toast, memberToasts, probing,
    restarting, installs, theme, menu, renaming, confirm, switcher, memberCard
  }=state;
  const {
    setReportRoster, setSnapshot, setMemberStop, setMemberStopping, setMemberStopError, setLoaded, setBackendMessage, setProjectId, setSessionId,
    setSidebarTab, setTerminalShown, setTerminalRequest, setModal, setHierarchy, setCollapsedProjects, setQuotaOpen, setActivityOpen,
    setAutomationOpen, setSettingsTab, setSettingsEditing, setSettingsFocus, setView, setDeskMemberId, setReportMemberId, setRoomFocus,
    setSearchCurrent, setSearchFocus, setRoundtableRequest, setInviteProject, setToast, setMemberToasts, setProbing, setRestarting, setInstalls,
    setTheme, setMenu, setRenaming, setConfirm, setSwitcher, setMemberCard
  }=actions;

  // Snapshots carry only live events; the open session's full record is fetched and kept current here.

  const terminalNonce=useRef(0);
  useEffect(()=>{try{localStorage.setItem('hivelab.sidebar.tab',sidebarTab);}catch{}},[sidebarTab]);

  useEffect(()=>{try{localStorage.setItem('hivelab.project-tree.collapsed',JSON.stringify([...collapsedProjects]));}catch{}},[collapsedProjects]);
  useEffect(()=>{const byId=new Map(snapshot.projects.map(p=>[p.id,p])),ancestors=new Set<string>();let p=byId.get(projectId);while(p?.parentId&&!ancestors.has(p.parentId)){ancestors.add(p.parentId);p=byId.get(p.parentId);}setCollapsedProjects(old=>{if(![...ancestors].some(id=>old.has(id)))return old;return new Set([...old].filter(id=>!ancestors.has(id)));});},[projectId,snapshot.projects.map(p=>p.id+':'+p.parentId).join('|')]);

  const reportRoster=reportRosterState.projectId===projectId?reportRosterState.members:[];
  const reportEntries:ReportEntry[]=reportRoster.map(m=>({...m,unread:snapshot.rooms?.some(r=>r.roomId===`report:${projectId}:${m.id}`&&r.unread)}));
  const openReport=(memberId:string)=>{setReportMemberId(memberId);setView('reports');setSessionId('');};

  const cancelSearch=useCallback(()=>setSearchFocus(undefined),[]);

  const showMemberNotice=useCallback((notice:MemberNotice,open:()=>void)=>setMemberToasts(items=>[...items.filter(item=>item.notice.id!==notice.id),{notice,open}]),[]);
  const dismissMemberNotice=useCallback((id:string)=>setMemberToasts(items=>items.filter(item=>item.notice.id!==id)),[]);
  const readMemberNotices=useCallback((ids:string[])=>setMemberToasts(items=>items.filter(item=>!ids.includes(item.notice.id))),[]);
  const notificationIsland=<MemberNoticeStack snapshot={snapshot} items={memberToasts} onDismiss={dismissMemberNotice} toast={toast} onDismissToast={()=>setToast(null)}/>;

  useSegmentedIndicator();
  const toastCounter = useRef(0);

  useLayoutEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('hivelab.theme', theme); } catch {}
  }, [theme]);

  const notify = useCallback((text: string, error = false) => {
    setToast({ id: ++toastCounter.current, text, error });
  }, []);
  const seenChanges=useRef<Map<string,string>|undefined>(undefined);
  useEffect(()=>{
    const jobs=snapshot.pendingChanges??[],previous=seenChanges.current;
    if(previous)for(const job of jobs)if(previous.has(job.id)&&previous.get(job.id)!==job.state&&['applied','failed','unknown'].includes(job.state))notify(job.state==='applied'?tr("{0} 已生效。", job.label):`${job.label}：${job.error??tr("结果待核对")}`,job.state!=='applied');
    if(snapshot.backendReady)seenChanges.current=new Map(jobs.map(job=>[job.id,job.state]));
  },[snapshot.pendingChanges,snapshot.backendReady,notify]);
  const {refresh,invoke,perform}=useAppBackend(notify);
  function openCollaboration() {openInvite(project?.id);}
  function openInvite(projectId?: string) { setInviteProject(projectId); setModal('invite'); }
  /** A project without chosen members starts at 请大家一起来; one with people opens its meeting room. */
  // The window waits a moment so a double-click (rename) on the same row can cancel it.
  const inviteTimer = useRef<number | undefined>(undefined);
  function openProject(target: Project) { window.clearTimeout(inviteTimer.current); if (needsMembers(snapshot, target)) { inviteTimer.current = window.setTimeout(() => openInvite(target.id), 260); return; } setView('project'); setProjectId(target.id); setSessionId(''); }
  async function enterMeeting(targetId: string, memberIds: string[]) { await saveProjectMembers(invoke, targetId, memberIds); setModal(null); setView('project'); setProjectId(targetId); setSessionId(''); }
  function openSettings(tab: SettingsTab = 'members', editing: string | null = null, focus: string | null = null) { setSettingsTab(tab); setSettingsEditing(editing); setSettingsFocus(focus); setModal('settings'); }
  useEffect(()=>{const open=()=>openSettings('appearance');window.addEventListener('hivelab:open-appearance',open);return()=>window.removeEventListener('hivelab:open-appearance',open);},[]);
  /** A pending item opens where it can be handled; opening never answers, resends, accepts or applies anything. */
  function openAttention(item: AttentionItem) {
    if(item.jointReviewId){const topic=snapshot.roundtable?.topics.find(t=>t.reviewId===item.jointReviewId);if(topic){setRoundtableRequest({topicId:topic.id,nonce:Date.now()});setView('roundtable');setSessionId('');return;}if(item.projectId){setProjectId(item.projectId);setView('project');setSessionId('');return;}}
    if(item.action.view==='member-settings'){openSettings('members',null,item.provider??item.memberId??null);return;}
    if(item.action.view==='room'){setView('room');setSessionId('');setRoomFocus({threadId:item.threadId,messageId:item.messageId,nonce:Date.now()});return;}
    if(item.action.view==='project-room'&&item.kind==='acceptance'&&item.roomId?.startsWith('project:')){setProjectId(item.roomId.slice(8));setView('project');setSessionId('');return;}
    const target=item.sessionId&&snapshot.sessions.find(s=>s.id===item.sessionId);
    if(target){openRecordedSession(target);return;}
    // The item's session no longer exists: open its project instead.
    if (item.action.view === 'project-room') { setView('project'); if (item.projectId) setProjectId(item.projectId); setSessionId(''); }
    else { setView('work'); if (item.projectId) setProjectId(item.projectId); setSessionId(''); }
  }
  function openSession(memberId?: string) { const id=memberId??deskMemberId;openDesk(id);perform('desk.topic',{memberId:id},tr("已开始新的工位话题。")); }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.error ? 9000 : 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const team: Team = useMemo(() => makeTeam(snapshot.members,snapshot.removedMembers), [snapshot.members,snapshot.removedMembers]);
  // The chat room lives in a hidden project; project lists and pickers only show real work.
  const loungeId = snapshot.projects.find(project => project.kind === 'lounge')?.id;
  const workProjects = useMemo(() => snapshot.projects.filter(project => !project.kind), [snapshot.projects]);
  useEffect(() => {
    if (loaded && !workProjects.some(project => project.id === projectId)) setProjectId(workProjects[0]?.id ?? '');
  }, [workProjects, projectId, loaded]);
  useEffect(() => {
    const choices = snapshot.sessions.filter(session => session.projectId === projectId);
    if (sessionId && !choices.some(session => session.id === sessionId)) setSessionId('');
  }, [snapshot.sessions, projectId, sessionId]);

  const project = snapshot.projects.find(item => item.id === projectId);
  const reportsStamp=JSON.stringify([snapshot.projectFlows?.filter(f=>f.projectId===projectId),snapshot.runs.filter(r=>r.projectId===projectId).map(r=>[r.id,r.status,r.updatedAt]),project?.memberIds]);
  useEffect(()=>{let current=true;if(snapshot.backendReady&&projectId)void invoke<MemberReportPage>('projectFlow.memberReports',{projectId,limit:1}).then(p=>{if(current&&p?.members)setReportRoster({projectId,members:p.members});}).catch(()=>{});return()=>{current=false;};},[projectId,reportsStamp,snapshot.backendReady,invoke]);
  function openDesk(memberId:string){setDeskMemberId(memberId);setView('desk');setSessionId('');perform('desk.open',{memberId});}
  async function openSearchMatch(match:ConversationMatch,query:string,signal:AbortSignal){
    const {roomId}=match;
    if(roomId.startsWith('desk:')){
      const memberId=roomId.slice(5);
      if(match.directory)await invoke('desk.switchFolder',{memberId,directory:match.directory});
      else await invoke('desk.open',{memberId});
      if(signal.aborted)return;
      await invoke('room.select',{roomId,threadId:match.threadId});
      if(signal.aborted)return;
      setDeskMemberId(memberId);setView('desk');
    }else if(roomId.startsWith('report:')){
      const [,targetProject,memberId]=roomId.split(':');setProjectId(targetProject);setReportMemberId(memberId);setView('reports');
    }else if(roomId.startsWith('project:')){setProjectId(roomId.slice(8));setView('project');}
    else if(roomId.startsWith('roundtable:')){setRoundtableRequest({topicId:roomId.slice(11),nonce:Date.now()});setView('roundtable');}
    else setView('room');
    if(signal.aborted)return;
    setSessionId('');setSearchFocus({roomId,threadId:match.threadId,messageId:match.messageId,nonce:Date.now(),query});
  }
  function openRecordedSession(target:Session){
    const personal=snapshot.rooms?.find(r=>r.roomId===target.roomId);
    if(target.roomId?.startsWith('report:')){if(personal?.projectId)setProjectId(personal.projectId);setReportMemberId(personal?.memberId??memberIdOf(target));setView('reports');setSessionId('');return;}
    if(target.roomId?.startsWith('project:')){setProjectId(target.roomId.slice(8));setView('project');setSessionId('');return;}
    if(target.roomId==='global'||target.roomThreadId&&!target.flowId){setView('room');setSessionId('');return;}
    if(!isConversationSession(target,snapshot.runs)){setProjectId(target.projectId);setReportMemberId(memberIdOf(target));setView('reports');setSessionId('');return;}
    const id=memberIdOf(target);openDesk(id);const folder=snapshot.projects.find(p=>p.id===target.projectId)?.directory;
    if(folder)void invoke('desk.switchFolder',{memberId:id,directory:folder}).then(()=>invoke('room.select',{roomId:`desk:${id}`,threadId:`desk-topic-${target.id}`})).catch(()=>{});
  }
  const firstInput = useCallback((id: string) => snapshot.runs.filter(run => run.sessionId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.inputPreview, [snapshot.runs]);
  const pendingApprovals = useMemo(() => snapshot.approvals.filter(approval => approval.state === 'pending'), [snapshot.approvals]);
  const allRunning = snapshot.runs.filter(run => isActiveRun(run) || run.status === 'queued');
  // Each member's mood comes from the runs of their own sessions (custom members included).
  const memberOfSession = useMemo(() => new Map(snapshot.sessions.map(item => [item.id, memberIdOf(item)])), [snapshot.sessions]);
  const moods = useMemo(() => Object.fromEntries(team.members.map(member => {
    const info = snapshot.providers.find(item => item.id === member.executor);
    const memberRuns = snapshot.runs.filter(run => memberOfSession.get(run.sessionId) === member.id);
    const waiting = pendingApprovals.some(approval => memberOfSession.get(approval.sessionId) === member.id) || memberRuns.some(run => run.status === 'waiting_user' && !run.completedAt);
    return [member.id, moodOf(info, memberRuns, waiting, runnable(info))];
  })) as Record<string, Mood>, [team, snapshot.providers, snapshot.runs, pendingApprovals, memberOfSession]);

  async function probe() {
    setProbing(true);
    try { await invoke('provider.probe'); } catch {} finally { setProbing(false); }
  }
  async function restartBackend() {
    if (!window.hivelab || restarting) return;
    setRestarting(true);
    try {
      const result = await window.hivelab.invoke<{ detail?: string; message?: string }>('backend.restart');
      notify(result?.detail ?? result?.message ?? tr("已请求重启工作台后端。"));
      await refresh();
    } catch (error) { notify(errorText(error), true); }
    finally { setRestarting(false); }
  }
  async function createdProject(params: { name: string; directory: string }) {
    const result = await invoke<Project>('project.create', params);
    const next = await refresh();
    const id = result?.id ?? next.projects.find(item => item.directory === params.directory)?.id ?? '';
    setProjectId(id);
    if (id) openInvite(id); else setModal(null);
    notify(tr("项目已加入工作室，请选择参加的成员。"));
  }
  async function createdInviteProject(params: { name: string; directory: string }) {
    const result = await invoke<Project>('project.create', params);
    const next = await refresh();
    notify(tr("项目已加入工作室。"));
    return result ?? next.projects.find(item => item.directory === params.directory);
  }
  async function commitRename() {
    if (!renaming) return;
    const value = renaming.value.trim(); const target = renaming; setRenaming(null);
    if (!value) return;
    if (target.kind === 'session') await invoke('session.update', { sessionId: target.id, title: value }).catch(() => {});
    else await invoke('project.update', { projectId: target.id, name: value }).catch(() => {});
  }
  async function runConfirm() {
    if (!confirm) return;
    const target = confirm; setConfirm(null);
    try {
      if (target.kind === 'delete-session') { await invoke('session.delete', { sessionId: target.id, discardWorkspace: target.discard, deleteFiles: target.deleteFiles === true }, tr("会话已删除。")); if (target.id === sessionId) setSessionId(''); }
      else if (target.kind === 'remove-project') { await invoke('project.remove', { projectId: target.id, discardWorkspaces: target.discard }, tr("项目已从工作室移除，文件夹没有改动。")); if (target.id === projectId) { setProjectId(''); setSessionId(''); } }
      else await invoke('workspace.discard', { sessionId: target.id }, tr("工作副本已丢弃，下一轮会从项目重新建立。"));
    } catch {}
  }
  function projectMenuItems(target: Project): MenuItem[] {
    const busy = snapshot.sessions.some(item => item.projectId === target.id && isBusy(snapshot, item.id)),hasChildren=descendantIds(snapshot.projects,target.id).length>1;
    return [
      {label:tr("添加子项目…"),icon:<Plus size={14}/>,onSelect:()=>setHierarchy({mode:'child',target})},
      {label:tr("归属与修改范围…"),icon:<GitMerge size={14}/>,onSelect:()=>setHierarchy({mode:'move',target})},
      { label: tr("重命名"), icon: <Pencil size={14} />, onSelect: () => setRenaming({ kind: 'project', id: target.id, value: target.name }) },
      'separator',
      { label: hasChildren?tr("移除（先移出子项目）"):busy ? tr("移除（先停止任务）") : tr("从工作室移除…"), icon: <Trash2 size={14} />, danger: true, disabled: busy||hasChildren, onSelect: () => setConfirm({ kind: 'remove-project', id: target.id, discard: true }) },
    ];
  }
  const openMenu = (event: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }, items: MenuItem[]) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, items }); };

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'k') { event.preventDefault(); setSwitcher(value => !value); }
      else if (key === 'n' && !modal && snapshot.backendReady) { event.preventDefault(); openSession(); }
      else if (key === ',' && !modal) { event.preventDefault(); openSettings('connections'); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  });
  function onInstall(provider: ProviderId, version: string | null) {
    setInstalls(previous => { const next = { ...previous }; if (version) next[provider] = { version, startedAt: Date.now() }; else delete next[provider]; return next; });
  }

  /** What a member is doing now, for the roster and the member card. */
  // Idle members go about their day: the sidebar line follows the time of day, refreshed each minute.
  const clock = useTicker(true, 60_000);
  function memberStatus(id: string): MemberStatus {
    const member = team.get(id), info = member && snapshot.providers.find(item => item.id === member.executor), mood = moods[id];
    const install = member && installs[member.executor];
    const workingRun = snapshot.runs.find(run => memberOfSession.get(run.sessionId) === id && (isActiveRun(run) || run.status === 'queued'));
    const working = workingRun && snapshot.sessions.find(item => item.id === workingRun.sessionId), inRoom = working?.projectId === loungeId;
    const text = install ? tr("正在安装 {0}…", install.version) : mood === 'working' && working ? inRoom ? tr("正在聊天室说话") : tr("正在做：{0}", sessionTitle(working, firstInput(working.id))) : mood === 'offline' || mood === 'away' ? providerSummary(info) : mood === 'resting' && member ? tr("空闲 · {0}", idleActivity(member.card, new Date(clock)).text) : MOOD_TEXT[mood];
    return { mood, text, session: mood === 'working' ? working : undefined, inRoom };
  }
  async function prepareMemberStop(memberId:string){setMemberStopError('');try{setMemberStop(await invoke('member.stop.preview',{memberId}));}catch(e){notify(errorText(e));}}
  async function confirmMemberStop(){if(!memberStop)return;setMemberStopping(true);setMemberStopError('');try{const r=await invoke<{remaining:unknown[]}>('member.stop',{memberId:memberStop.memberId,token:memberStop.token,confirm:true});if(r.remaining.length)setMemberStopError(tr("停止要求已发送，仍有运行正在核对退出。请等待并查看实际记录。"));else setMemberStop(undefined);}catch(e){setMemberStopError(errorText(e));try{setMemberStop(await invoke('member.stop.preview',{memberId:memberStop.memberId}));}catch{}}finally{setMemberStopping(false);}}
  
  const closeMemberCard = useCallback(() => setMemberCard(null), []);
  const openMemberCard = (memberId: string, anchor: Element) => setMemberCard(current => current?.memberId === memberId ? null : { memberId, rect: anchor.getBoundingClientRect() });
  const openFromNotice = useCallback((target:Session)=>{setModal(null);closeMemberCard();openRecordedSession(target);},[snapshot.sessions,snapshot.rooms,snapshot.runs,closeMemberCard]);
  useMemberNotifications(snapshot,firstInput,openFromNotice,team,item=>{setModal(null);closeMemberCard();openAttention(item);},showMemberNotice);
  const memberNoticeFocus=useCallback(()=>modal==='settings'?{settingsMemberId:settingsTab==='members'?settingsEditing??settingsFocus??undefined:undefined}:modal?undefined:sessionId?{sessionId}:view!=='work'?searchCurrent:undefined,[searchCurrent,sessionId,view,modal,settingsTab,settingsEditing,settingsFocus]);
  useFocusedMemberNotices(snapshot,memberToasts,memberNoticeFocus,readMemberNotices);

  const backgroundId=backgroundPage(view,project?.id,view==='reports'?reportMemberId:deskMemberId);
  const themeAccent=useThemeAccent(view==='desk'?team.get(deskMemberId)?.color:view==='reports'?team.get(reportMemberId)?.color:undefined);
  useAdaptiveTextPage(backgroundId,theme,themeAccent);
  const shellBackground=useHomeBackground(backgroundId);
  const deskSessionId=snapshot.rooms?.find(r=>r.roomId==='desk:'+deskMemberId)?.sessionId;
  const workspaceRoots=useWorkspaceRoots(snapshot,invoke,view==='desk'?(deskSessionId?'session:'+deskSessionId:'desk:'+deskMemberId):projectId?'project:'+projectId:'');
  useEffect(()=>{const open=(event:Event)=>{const id=(event as CustomEvent<string>).detail;if(id){workspaceRoots.setRootId(id);setSidebarTab('files');setModal(null);window.dispatchEvent(new Event('hivelab:sidebar-expand'));}};window.addEventListener('hivelab:explorer-root',open);return()=>window.removeEventListener('hivelab:explorer-root',open);},[]);
  const openTerminal=(rootId=workspaceRoots.rootId,path='',reuse=true)=>{if(!rootId){setSidebarTab('files');notify(tr("请先选择工作区文件夹。"));return;}setTerminalShown(true);setTerminalRequest({rootId,path,reuse,nonce:++terminalNonce.current});};
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.ctrlKey&&e.code==='Backquote'){e.preventDefault();if(terminalShown)setTerminalShown(false);else openTerminal();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[terminalShown,workspaceRoots.rootId]);
  const fileMemberId=snapshot.members.find(m=>m.id===(workspaceRoots.root?.memberId||deskMemberId))?.id??snapshot.members[0]?.id;
  async function pickWorkspaceFolder(){try{const picked=await invoke<WorkspaceRoot|null>('explorer.pick',{},undefined,{background:true});if(picked){await workspaceRoots.refresh();workspaceRoots.setRootId(picked.id);setSidebarTab('files');window.dispatchEvent(new Event('hivelab:sidebar-expand'));}}catch(e){notify(errorText(e),true);}}
  const backgroundTitle=view==='desk'?tr("{0} 的工位", team.get(deskMemberId)?.name??tr("成员")):view==='reports'?tr("{0} · {1} 的汇报", project?.name??'', team.get(reportMemberId)?.name??tr("成员")):view==='project'?tr("{0} 的会议室", project?.name??''):view==='roundtable'?tr("圆桌"):view==='room'?tr("茶歇室"):tr("首页");
  return {
    ...state, ...actions, terminalNonce, reportRoster, reportEntries, openReport, cancelSearch, showMemberNotice, dismissMemberNotice,
    readMemberNotices, notificationIsland, toastCounter, notify, seenChanges, openCollaboration, openInvite, inviteTimer, openProject, enterMeeting,
    openSettings, openAttention, openSession, team, loungeId, workProjects, project, reportsStamp, openDesk, openSearchMatch, openRecordedSession,
    firstInput, pendingApprovals, allRunning, memberOfSession, moods, probe, restartBackend, createdProject, createdInviteProject, commitRename,
    runConfirm, projectMenuItems, openMenu, onInstall, clock, memberStatus, prepareMemberStop, confirmMemberStop, closeMemberCard, openMemberCard,
    openFromNotice, memberNoticeFocus, backgroundId, shellBackground, deskSessionId, workspaceRoots, openTerminal, fileMemberId, pickWorkspaceFolder,
    backgroundTitle, refresh, invoke, perform
  };
}
export type AppController=ReturnType<typeof useAppController>;

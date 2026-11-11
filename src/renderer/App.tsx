import {applyLanguage,t} from './i18n';
import {ProjectRoom} from "./project-room";
import {useEffect,useRef} from 'react';
import {MemberReports} from "./member-reports";
import {MemberDesk} from "./member-desk";
import {AttentionBubble} from "./attention";
import {Terminal, AlertCircle} from "lucide-react";
import {ErrorBoundary} from "./ErrorBoundary";
import {TeamColors, TeamProvider} from "./members";
import {RoomView} from "./room";
import {RoundtableView} from "./roundtable";
import {RoundtableNavigation} from "./roundtable-navigation";
import {ExtensionFeatures} from "./extensions";
import {StandeeHome} from "./standee-home";
import {SidebarLayout} from "./sidebar-layout";
import {FilePreviewWorkspace} from "./file-preview-panel";
import {ConversationScope, ConversationSearch} from "./conversation-search";
import {WorkspaceTerminal} from "./workspace-terminal";
import {WorkspaceFileActions} from "./workspace-file-actions";
import {WorkspaceBackground, HomeBackground, warmPageBackground} from "./home-background";
import {errorText} from "./ui";
import './project-workbench.css';

import {AppStoreProvider} from "./app/store-context";
import {useAppController} from "./app/use-app-controller";
import {AppSidebar} from "./app/AppSidebar";
import {PageTurn,useTurnDirection} from "./app/page-turn";
import {warmRoom} from "./room/use-room-controller";
import {pageRank} from "../shared/background";
import {AppDialogs} from "./app/AppDialogs";
import {StartupSceneSync} from "./startup-scene";
export default function App(){return <AppStoreProvider><AppContent/></AppStoreProvider>;}

function AppContent(){
  const controller=useAppController();
  const {snapshot,loaded,backendMessage,projectId,setProjectId,setSessionId,terminalShown,setTerminalShown,terminalRequest,setModal,view,setView,deskMemberId,reportMemberId,reportEntries,openReport,roomFocus,searchCurrent,setSearchCurrent,searchFocus,cancelSearch,roundtableRequest,setRoundtableRequest,notificationIsland,restarting,notify,refresh,invoke,openCollaboration,openSettings,openAttention,team,project,openDesk,openSearchMatch,openRecordedSession,moods,restartBackend,openMemberCard,backgroundId,shellBackground,workspaceRoots,openTerminal,fileMemberId,pickWorkspaceFolder,backgroundTitle}=controller;
  useEffect(()=>{
    if(!loaded||!snapshot.backendReady)return;
    let paint=0;const frame=requestAnimationFrame(()=>{paint=requestAnimationFrame(()=>window.hivelabStartup?.ready());});
    return()=>{cancelAnimationFrame(frame);cancelAnimationFrame(paint);};
  },[loaded,snapshot.backendReady]);
  // The saved language wins over the copy kept for the boot screen; the first one applies without a fade.
  const languageApplied=useRef(false);
  useEffect(()=>{
    if(!loaded||!snapshot.backendReady)return;
    applyLanguage(snapshot.settings.language,{animate:languageApplied.current});languageApplied.current=true;
  },[loaded,snapshot.backendReady,snapshot.settings.language]);
  const memberIds=team.members.map(member=>member.id).join('\0');
  useEffect(()=>{for(const page of [...team.members.map(member=>'desk:'+member.id),'lounge','roundtable'])void warmPageBackground(page);for(const member of team.members)warmRoom('desk:'+member.id);},[memberIds]);
  const turnDirection=useTurnDirection(backgroundId,pageRank(backgroundId,team.members.toSorted((a,b)=>(a.card.sidebarOrder??Infinity)-(b.card.sidebarOrder??Infinity)).map(member=>member.id),controller.workProjects.map(item=>item.id)));
  return <ExtensionFeatures.Provider value={snapshot.extensionFeatures??{}}><TeamProvider value={team}><RoundtableNavigation.Provider value={source=>{const {projectId,...ref}=source;setRoundtableRequest({projectId,source:ref,nonce:Date.now()});setView('roundtable');setSessionId('');}}><TeamColors team={team} /><StartupSceneSync/><SidebarLayout transparency={shellBackground.preferences.sidebarTransparency} wallpaper={<HomeBackground preferences={shellBackground.preferences} settled={!!shellBackground.fetched} direction={turnDirection} onError={notify}/>}>
    <AppSidebar controller={controller}/>

    <div className="workspace">
      <ConversationScope.Provider value={{setCurrent:setSearchCurrent,focus:searchFocus}}><FilePreviewWorkspace notifications={notificationIsland} search={view!=='work'?<ConversationSearch current={searchCurrent} invoke={invoke} onOpen={openSearchMatch} onCancel={cancelSearch}/>:undefined} title={view==='work'||view==='desk'?undefined:backgroundTitle} fileTools={view==='desk'?undefined:<WorkspaceFileActions snapshot={snapshot} invoke={invoke} memberId={fileMemberId} rootId={workspaceRoots.rootId} onPick={()=>void pickWorkspaceFolder()}/>} headerTransparency={shellBackground.preferences.headerTransparency} previewTransparency={shellBackground.preferences.previewTransparency} terminalTransparency={shellBackground.preferences.terminalTransparency} terminal={<WorkspaceTerminal shown={terminalShown} onHide={()=>setTerminalShown(false)} request={terminalRequest} root={workspaceRoots.root} invoke={invoke}/>} tools={<button type="button" className="button quiet small" aria-label={t("切换工作区终端")} title={t("终端")} aria-pressed={terminalShown} onClick={()=>terminalShown?setTerminalShown(false):openTerminal()}><Terminal size={15}/></button>}>
      {!snapshot.backendReady && loaded && <div className="backend-banner" role="status"><AlertCircle size={16} /><span>{backendMessage || t("后端尚未就绪，连接恢复前不会发送任务。")}</span><button onClick={() => void refresh().catch(error => notify(errorText(error), true))}>{t("重新连接")}</button>{window.hivelab && <button disabled={restarting} onClick={() => void restartBackend()}>{restarting ? t("正在重启…") : t("重启后端")}</button>}</div>}
      <PageTurn page={backgroundId} direction={turnDirection} backgroundReady={!!shellBackground.fetched}><WorkspaceBackground page={backgroundId} title={backgroundTitle}>
      {view==='roundtable'?<ErrorBoundary area={t("圆桌")} resetKey={snapshot.roundtable?.currentTopicId}><RoundtableView snapshot={snapshot} invoke={invoke} request={roundtableRequest} onHandled={()=>setRoundtableRequest(undefined)} onProject={id=>{setProjectId(id);setView('project');setSessionId('');}}/></ErrorBoundary>:view==='reports'&&project?<ErrorBoundary area={t("个人汇报")} resetKey={project.id+reportMemberId}><MemberReports key={project.id+':'+reportMemberId} project={project} memberId={reportMemberId} snapshot={snapshot} invoke={invoke} reports={reportEntries} onOpenReport={openReport} onMeeting={()=>setView('project')} onDesk={team.get(reportMemberId)?()=>openDesk(reportMemberId):undefined}/></ErrorBoundary>:view==='desk'?<ErrorBoundary area={t("个人工位")} resetKey={deskMemberId}><MemberDesk key={deskMemberId} memberId={deskMemberId} snapshot={snapshot} invoke={invoke} onSettings={()=>openSettings('connections',null,snapshot.members.find(member=>member.id===deskMemberId)?.executor??null)}/></ErrorBoundary>:view === 'project' && project ? <ErrorBoundary area={t("项目会议室")} resetKey={project.id}><ProjectRoom key={project.id} snapshot={snapshot} project={project} invoke={invoke} reports={reportEntries} onOpenReport={openReport}onRoundtable={source=>{setRoundtableRequest('topicId' in source?{topicId:source.topicId,nonce:Date.now()}:{projectId:project.id,source,nonce:Date.now()});setView('roundtable');setSessionId('');}} onOpenSession={id => {const target=snapshot.sessions.find(s=>s.id===id);if(target)openRecordedSession(target);}} /></ErrorBoundary>
        : view === 'room' ? <ErrorBoundary area={t("聊天室")} resetKey={snapshot.room.currentThreadId}><RoomView snapshot={snapshot} invoke={invoke} focus={roomFocus} onOpenSession={(target, id) => { const recorded=snapshot.sessions.find(s=>s.id===id);if(recorded)openRecordedSession(recorded); }} /></ErrorBoundary> : <ErrorBoundary area={t("主页")} resetKey={projectId}><StandeeHome onDesk={openDesk} project={project} snapshot={snapshot} team={team} moods={moods} invoke={invoke} onSettingsTab={(tab, focus) => openSettings(tab, null, focus ?? null)} onProject={() => setModal('project')} onCard={openMemberCard} onCollaboration={() => openCollaboration()} /></ErrorBoundary>}
      </WorkspaceBackground></PageTurn>
      </FilePreviewWorkspace></ConversationScope.Provider>
    </div>
    <AppDialogs controller={controller}/>
  </SidebarLayout>
  {/* 右下角待处理气泡 */}
  <AttentionBubble page={backgroundId} summary={snapshot.attention} onOpen={openAttention} onIgnore={item=>invoke('attention.dismiss',{id:item.id,fingerprint:item.fingerprint})} />
  </RoundtableNavigation.Provider></TeamProvider></ExtensionFeatures.Provider>;
}

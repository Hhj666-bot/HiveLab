import {t} from '../i18n';
import {useRef} from "react";
import "../project-tree.css";
import {useRosterArrange} from './use-roster-arrange';
import {useTabBubble} from './use-tab-bubble';
import {useRosterBubble} from './use-roster-bubble';
import {useSidebarPointer} from './use-sidebar-pointer';
import {memberSignal} from "../../shared/member-notifications";
import {Activity, Terminal, CalendarClock, ChevronDown, ChevronRight, Folder, FolderOpen, Plus, RefreshCw, Settings2, StopCircle, Users, MoreHorizontal, MessagesSquare} from "lucide-react";
import {ErrorBoundary} from "../ErrorBoundary";
import {Avatar} from "../members";
import {projectRows} from "../../shared/project-tree";
import {QuotaBadge} from "../quota";
import {WorkspaceExplorer} from "../workspace-explorer";
import {Brand} from "../brand";
import {IconButton} from "../ui";
import type {AppController} from "./use-app-controller";
export function AppSidebar({controller}:{controller:AppController}){
  const {
    snapshot, memberStopping, loaded, projectId, sessionId, setSessionId, sidebarTab, setSidebarTab, setModal, collapsedProjects,
    setCollapsedProjects, setQuotaOpen, setActivityOpen, setAutomationOpen, view, setView, deskMemberId, memberToasts, probing, renaming, setRenaming,
    refresh, invoke, inviteTimer, openProject, openSettings, team, workProjects, project, openDesk, allRunning, memberOfSession, probe, commitRename,
    projectMenuItems, openMenu, memberStatus, prepareMemberStop, memberCard, closeMemberCard, openMemberCard, workspaceRoots, openTerminal
  }=controller;
  const arrange=useRosterArrange(team.members,snapshot.backendReady,invoke),tabBubble=useTabBubble(sidebarTab);
  const rosterOrder=arrange.shown.map(member=>member.id).join('\0'),openMember=view==='desk'?deskMemberId:undefined;
  const rosterBubble=useRosterBubble(openMember,rosterOrder,arrange.container);
  // The open project and the open room carry the same bubble, in the theme's colour.
  const projectTree=projectRows(workProjects,collapsedProjects),projectList=useRef<HTMLDivElement>(null),placeList=useRef<HTMLElement>(null);
  const projectBubble=useRosterBubble(view==='project'?projectId:undefined,projectTree.map(row=>row.project.id).join('\0'),projectList,'data-project-id');
  const placeBubble=useRosterBubble(view==='room'||view==='roundtable'?view:undefined,'',placeList,'data-place-id');
  const side=useRef<HTMLElement>(null),pointer=useSidebarPointer(side,[sidebarTab,openMember,rosterOrder,view,projectId].join('\0'));
  return <>
<aside className="sidebar" ref={side}>
      <div className="sidebar-pointer" ref={pointer} aria-hidden="true"/>
      <Brand onHome={() => { setView('work'); setSessionId(''); }}/>
      <nav className="sidebar-workspace-tabs" data-tab={sidebarTab} aria-label={t("侧栏内容")}><div className="sidebar-tab-bubble" ref={tabBubble} aria-hidden="true"/><button type="button" className="glass-content-action" aria-label={t("工作台侧栏")} title={t("工作台")} aria-pressed={sidebarTab==='work'} onClick={()=>{setSidebarTab('work');window.dispatchEvent(new Event('hivelab:sidebar-expand'));}}><Users size={15}/><span>{t("工作台")}</span></button><button type="button" className="glass-content-action" aria-label={t("文件侧栏")} title={t("文件")} aria-pressed={sidebarTab==='files'} onClick={()=>{setSidebarTab('files');window.dispatchEvent(new Event('hivelab:sidebar-expand'));}}><FolderOpen size={15}/><span>{t("文件")}</span></button></nav>

      <div className="sidebar-scroll">
      <div className={`sidebar-page sidebar-work-pane ${sidebarTab==='work'?'current':''}`} inert={sidebarTab!=='work'}>
      <div className="sidebar-work-lists">
      <section className="sidebar-team-section" aria-label={t("团队区域")}>
      <div className="sidebar-section-label"><span>{t("团队")}</span><span className="team-header-actions"><IconButton label={t("成员活动：思考与操作")} onClick={()=>setActivityOpen(true)}><Terminal size={14}/></IconButton><IconButton label={t("自动功能与定时任务")} onClick={()=>setAutomationOpen(true)}><CalendarClock size={14}/></IconButton><IconButton label={t("用量与额度")} onClick={()=>setQuotaOpen(true)}><Activity size={14}/></IconButton><IconButton label={t("检查所有成员")} onClick={() => void probe()} disabled={probing || !snapshot.backendReady}><RefreshCw size={14} className={probing ? 'spin' : ''} /></IconButton></span></div>
      <div className="sidebar-section-scroll sidebar-roster-scroll"><ErrorBoundary area={t("团队列表")} compact><div className="team-roster" ref={arrange.container} onPointerMove={arrange.move} onPointerUp={arrange.up} onPointerCancel={arrange.cancel} onLostPointerCapture={arrange.cancel}>
        <div className={`roster-bubble member-${rosterBubble.member??''}`} ref={rosterBubble.bubble} aria-hidden="true" style={arrange.moving&&arrange.moving===rosterBubble.member?{translate:`0 ${arrange.offset}px`}:undefined}/>
        {arrange.shown.map(member => {
          const id = member.id;
          const status = memberStatus(id);
          const running = allRunning.some(run=>memberOfSession.get(run.sessionId)===id);
          const signal=memberSignal(snapshot,id,memberToasts.map(item=>item.notice));
          const deskOpen = view==='desk' && deskMemberId===id;
          return <div className={`roster-with-desk action-card member-${id} ${deskOpen?'selected':''}`} data-member-signal={signal} data-roster-id={id} data-arrange-id={id} data-roster-moving={arrange.moving===id||undefined} data-roster-target={arrange.target?.id===id?arrange.target.edge:undefined} key={id} style={arrange.moving===id?{translate:`0 ${arrange.offset}px`}:undefined} onPointerDown={event=>arrange.down(event,id)}>{signal!=='idle'&&<span className="roster-signal" aria-hidden="true"/>}<button type="button" className={`roster-row action-card-main glass-content-action member-${id} mood-${status.mood} ${memberCard?.memberId === id ? 'open' : ''}`} key={id} title={t("{0} · 点击进入工位，长按拖动排序，右键查看介绍", member.name)} aria-label={t("{0} · 进入工位", member.name)} aria-current={deskOpen?'page':undefined} onClick={()=>{if(arrange.suppressClick())return;closeMemberCard();openDesk(id);}} onContextMenu={event=>{event.preventDefault();arrange.cancel();openMemberCard(id,event.currentTarget);}} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();openMemberCard(id,event.currentTarget);}}}>
            <span className="member-signal-avatar" role="img" aria-label={member.name+(signal==='working'?t(" 正在思考"):signal==='attention'?t(" 等待回应"):signal==='unread'?t(" 有新消息"):'')}><Avatar member={member} size={28} mood={status.mood} signal={signal}/></span>
            <span className="roster-text"><span className="roster-name"><strong>{member.name}</strong><QuotaBadge provider={member.executor} quota={snapshot.quotas?.[member.executor]}/></span><small title={status.text}>{status.text}</small></span>
          </button>{running&&<span className="roster-actions"><button type="button" className="icon-button roster-member-stop glass-content-action" aria-label={t("中止 {0}", member.name)} title={t("中止 {0} 当前所有运行", member.name)} disabled={memberStopping||!snapshot.backendReady} onClick={()=>void prepareMemberStop(id)}><StopCircle size={14}/></button></span>}</div>;
        })}
      </div></ErrorBoundary></div>
      </section>
      <section className="sidebar-project-section" aria-label={t("项目区域")}>
      <div className="sidebar-section-label"><span>{t("项目")}</span></div>
      <div className="sidebar-section-scroll sidebar-project-scroll"><ErrorBoundary area={t("项目和会话列表")} compact resetKey={projectId}><div className="project-list" role="tree" aria-label={t("项目树")} ref={projectList}>
        <div className="roster-bubble theme-bubble" ref={projectBubble.bubble} aria-hidden="true"/>
        {workProjects.length === 0 ? <div className="sidebar-empty">{t("还没有项目，先添加一个吧")}</div> : projectTree.map(({project:item,depth,hasChildren,path:treePath}) => renaming?.kind === 'project' && renaming.id === item.id
          ? <RenameInput key={item.id} value={renaming.value} label={t("项目名称")} onChange={value => setRenaming({ ...renaming, value })} onCommit={() => void commitRename()} onCancel={() => setRenaming(null)} />
          : <div className={`list-row project-item project-tree-row action-card ${item.id === projectId ? (view === 'project' ? 'selected current' : 'current') : ''}`} key={item.id} data-project-id={item.id} role="treeitem" aria-level={depth+1} aria-selected={item.id===projectId} aria-expanded={hasChildren?!collapsedProjects.has(item.id):undefined} style={{paddingLeft:Math.min(depth,6)*13}} onContextMenu={event => openMenu(event, projectMenuItems(item))}>
            {hasChildren?<button type="button" className="project-tree-toggle glass-content-action" aria-label={t("{0} {1} 的子项目", (collapsedProjects.has(item.id)?t("展开"):t("收起")), item.name)} onClick={()=>setCollapsedProjects(old=>{const next=new Set(old);if(next.has(item.id))next.delete(item.id);else next.add(item.id);return next;})}>{collapsedProjects.has(item.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>:<span className="project-tree-spacer"/>}
            <button type="button" className="list-row-main action-card-main glass-content-action" onClick={() => openProject(item)} onDoubleClick={() => { window.clearTimeout(inviteTimer.current); setRenaming({ kind: 'project', id: item.id, value: item.name }); }} title={treePath.join(' / ')+' · '+item.directory}>{item.id === projectId ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{item.name}</span></button>
            <button type="button" className="row-more glass-content-action" aria-label={t("{0} 的更多操作", item.name)} onClick={event => openMenu(event, projectMenuItems(item))}><MoreHorizontal size={15} /></button>
          </div>)}
      </div>
      <button type="button" className="project-add" aria-label={t("添加项目")} title={t("添加项目")} onClick={() => setModal('project')} disabled={!snapshot.backendReady}><Plus size={15}/></button>
      </ErrorBoundary></div>
      </section>
      </div>
      <nav className="place-list" aria-label={t("房间")} ref={placeList}>
      <div className="roster-bubble theme-bubble" ref={placeBubble.bubble} aria-hidden="true"/>
      <button type="button" className={`room-entry ${view === 'room' ? 'selected' : ''} ${snapshot.room.state.active ? 'active' : ''}`} aria-current={view==='room'?'page':undefined} data-place-id="room" title={t("茶歇室")} aria-label={t("茶歇室")} onClick={() => setView('room')}>
        <MessagesSquare size={16} /><span><strong>{t("茶歇室")}</strong></span>
        {snapshot.room.state.active && <span className="status-dot active" />}
      </button>
      <button type="button" className={'room-entry '+(view==='roundtable'?'selected':'')} aria-current={view==='roundtable'?'page':undefined} data-place-id="roundtable" title={t("圆桌")} aria-label={t("圆桌")} onClick={()=>{setView('roundtable');setSessionId('');}}><Users size={16}/><span><strong>{t("圆桌")}</strong></span></button>
      </nav>
      </div>
      <div className={`sidebar-page sidebar-file-pane ${sidebarTab==='files'?'current':''}`} inert={sidebarTab!=='files'}><ErrorBoundary area={t("文件资源管理器")}><WorkspaceExplorer snapshot={snapshot} roots={workspaceRoots.roots} rootId={workspaceRoots.rootId} onRoot={workspaceRoots.setRootId} refreshRoots={workspaceRoots.refresh} invoke={invoke} onTerminal={openTerminal}/></ErrorBoundary></div>
      </div>

      <div className="sidebar-bottom">
      <div className="sidebar-footer">
        <span className={`backend-state ${snapshot.backendReady ? 'ready' : ''}`} title={snapshot.backendReady ? t("本机工作台已连接") : loaded ? t("后端未连接") : t("正在连接")}><span className="status-dot" /><span>{snapshot.backendReady ? t("本机工作台已连接") : loaded ? t("后端未连接") : t("正在连接")}</span></span>
        <button className="sidebar-settings" title={t("终端 · Ctrl+`")} aria-label={t("打开工作区终端")} onClick={()=>openTerminal()}><Terminal size={15}/><span>{t("终端")}</span></button>
        <button className="sidebar-settings" title={t("设置")} aria-label={t("设置")} onClick={() => openSettings('connections')}><Settings2 size={15} /><span>{t("设置")}</span></button>
      </div>
      </div>
    </aside>
  </>;
}
function RenameInput({ value, label, onChange, onCommit, onCancel }: { value: string; label: string; onChange: (value: string) => void; onCommit: () => void; onCancel: () => void }) {
  return <input className="rename-input" aria-label={label} value={value} autoFocus maxLength={120} onFocus={event => event.target.select()} onChange={event => onChange(event.target.value)} onBlur={onCommit}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onCommit(); } else if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }} />;
}


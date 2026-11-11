import {t} from './i18n';
import { ActiveRunProgress } from './run-progress';
import { useEffect, useRef, useState } from 'react';
import { FolderOpen, MoreHorizontal, Settings2, Files, ShieldCheck } from 'lucide-react';
import {planCapable} from '../shared/plan-mode';
import {PlanModeSwitch} from './plan-card';
import {ContextMeter} from './context-meter';
import {DeskFileManager,openDeskFileRoot} from './desk-file-manager';
import type { Session, Snapshot } from '../shared/types';
import { RoomView } from './room';
import { Avatar, useTeam } from './members';
import { ApprovalCard } from './panels';
import { ContextMenu, ModelPopover, EFFORT_NAMES, isBusy, type MenuState } from './interactions';
import { modelListLoader } from './api-model-picker';
import { WorkspaceUndoDialog } from './workspace-undo';
import { Modal } from './modals';
import type { Invoke } from './ui';
import type { ApplyResult } from '../backend/workspace';
import { ErrorBoundary } from './ErrorBoundary';
import { requestedConfig,displayModelId } from '../shared/executor-config';
import type { PersonalRoomData } from '../shared/member-workspaces';
import './desk-folders.css';
import {workspaceLocation} from './workspace-location';
import {memberPermissions} from '../shared/permissions';
import {PERMISSION_MODES} from '../shared/permission-modes';

/** The personal desk has the shared chat, its own approvals and model picker. Project panels live in reports. */
export function MemberDesk({memberId,snapshot,invoke,onSettings}:{memberId:string;snapshot:Snapshot;invoke:Invoke;onSettings:()=>void}){
  const [filesOpen,setFilesOpen]=useState(false);
  const team=useTeam(),member=team.get(memberId),roomId=`desk:${memberId}` as const;
  const overview=snapshot.rooms?.find(r=>r.roomId===roomId),session=snapshot.sessions.find(s=>s.id===overview?.sessionId);
  const location=workspaceLocation(session,overview?.folder);
  const [model,setModel]=useState<{anchor:DOMRect;session:Session}|null>(null),[menu,setMenu]=useState<MenuState>(null),[undo,setUndo]=useState<Session|null>(null),[apply,setApply]=useState<ApplyResult|null>(null);
  const [folders,setFolders]=useState<PersonalRoomData|null>(null),[switching,setSwitching]=useState(false);
  const folderRead=useRef(0),folderOpen=useRef(false);
  function closeFolders(){folderOpen.current=false;folderRead.current++;setFolders(null);}
  async function openFolders(){const ticket=++folderRead.current;try{const value=await invoke<PersonalRoomData>('room.get',{roomId});if(ticket===folderRead.current){folderOpen.current=true;setFolders(value);}}catch{}}
  useEffect(()=>{if(!folders||!folderOpen.current)return;let current=true;const ticket=++folderRead.current;void invoke<PersonalRoomData>('room.get',{roomId}).then(value=>{if(current&&folderOpen.current&&ticket===folderRead.current)setFolders(value);}).catch(()=>{});return()=>{current=false;};},[Boolean(folders),overview?.revision]);
  async function switchFolder(directory:string){folderOpen.current=false;folderRead.current++;setSwitching(true);try{await invoke('desk.switchFolder',{memberId,directory});closeFolders();}catch{folderOpen.current=true;}finally{setSwitching(false);}}
  // A plan review is answered on the plan card under the reply, not in the approval dock.
  const approvals=snapshot.approvals.filter(a=>a.sessionId===session?.id&&a.state==='pending'&&a.type!=='plan');
  const latest=snapshot.runs.filter(r=>r.sessionId===session?.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
  async function applyCopy(target:Session){if(!window.confirm(t("把这个话题工作副本的改动应用到原文件夹？会先检查冲突。")))return;try{setApply(await invoke('workspace.apply',{sessionId:target.id}));}catch{}}
  /** Work-copy operations remain available separately from direct folder navigation. */
  function deskMenu(event:React.MouseEvent<HTMLButtonElement>,target?:Session){
    const rect=event.currentTarget.getBoundingClientRect(),busy=target?isBusy(snapshot,target.id):false,copy=target&&target.workspaceKind!=='original';
    setMenu({x:rect.left,y:rect.bottom+6,items:[
      ...(copy&&target?[
        {label:t("应用到原文件夹"),disabled:busy||!target.workspace,onSelect:()=>{void applyCopy(target);}},
        {label:t("撤销最近一轮"),disabled:busy||!target.workspace,onSelect:()=>setUndo(target)},
        {label:t("丢弃工作副本"),disabled:busy||!target.workspace,danger:true,onSelect:()=>{if(window.confirm(t("丢弃这个话题的工作副本？未应用的改动会丢失，原文件夹保留。")))void invoke('workspace.discard',{sessionId:target.id}).catch(()=>{});}}]:[]),
    ]});
  }
  const topicModel=(target:Session)=>displayModelId(target.model,snapshot.providers.find(provider=>provider.id===target.provider)?.model);
  const defaults=(target:Session)=>{const config=member&&requestedConfig(snapshot.projects.find(p=>p.id===target.projectId)??{},member.card,snapshot.settings,undefined,snapshot.executors?.find(e=>e.id===target.provider));return {model:displayModelId(config?.model,snapshot.providers.find(provider=>provider.id===target.provider)?.model),effort:config?.effort};};
  return <main className="member-desk" aria-label={t("个人工位")}>
    <RoomView snapshot={snapshot} invoke={invoke} roomId={roomId} personal={{kind:'desk',memberId,title:t("{0} 的工位", member?.name??memberId),hint:session?location.label+' · '+location.hint:overview?.folder?t("当前文件夹：{0} · 开新话题后开始工作", overview.folder):t("每个话题使用独立会话，默认在个人文件夹工作。"),
      headerActions:<><button type="button" className="button small quiet" aria-label={t("查看当前会话文件")} onClick={()=>openDeskFileRoot(session?'session:'+session.id:'desk:'+memberId)}><Files size={14}/>{t("会话文件")}</button><button type="button" className="button small quiet" aria-label={t("管理工位文件")} onClick={()=>setFilesOpen(true)}><Files size={14}/>{t("文件管理")}</button><button type="button" className="button small quiet" aria-label={t("个人文件夹")} disabled={!member} onClick={()=>void invoke('desk.folder',{memberId}).catch(()=>{})}><FolderOpen size={14}/>{t("个人文件夹")}</button><button type="button" className="button small quiet" aria-label={t("切换工位文件夹")} onClick={()=>void openFolders()}><FolderOpen size={14}/>{t("切换文件夹")}</button>{session&&session.workspaceKind!=='original'&&<button type="button" className="icon-button desk-copy-menu" aria-label={t("话题工作副本操作")} aria-haspopup="menu" title={t("处理话题工作副本")} onClick={e=>deskMenu(e,session)}><MoreHorizontal size={16}/></button>}</>,
      composerControls:room=>{
        const target=snapshot.sessions.find(s=>s.id===room.sessionId),permission=member&&memberPermissions(snapshot.settings,member.card,snapshot.executors?.find(e=>e.id===member.executor));
        const inherited=target?defaults(target):undefined;
        const modelName=target?(topicModel(target)||inherited?.model||snapshot.providers.find(provider=>provider.id===target.provider)?.model||t("成员默认")):'';
        const effort=target?.effort||inherited?.effort,effortName=effort?(EFFORT_NAMES[effort]??effort):t("默认");
        const planReady=target&&planCapable(target.provider,snapshot.executors?.find(e=>e.id===target.provider)?.catalogId)&&!target.restoredHistoryOnly;
        return <>{planReady&&target&&<PlanModeSwitch session={target} invoke={invoke}/>}{target&&<button type="button" className="composer-model composer-config glass-action" aria-label={t("选择话题模型和思考程度")} title={t("模型：{0} · 思考程度：{1}；点击调整，立即应用到下一轮", modelName, effortName)} onClick={e=>setModel({anchor:e.currentTarget.getBoundingClientRect(),session:target})}><Settings2 size={14}/><span className="composer-model-name">{modelName}</span><span className="composer-effort">{t("· 思考：{0}", effortName)}</span></button>}{target&&<ContextMeter session={target} member={member?.card} usage={snapshot.contextUsage?.find(u=>u.sessionId===target.id)} invoke={invoke} roomId={roomId} threadId={room.currentThreadId||undefined} compressing={!!room.state?.compressing}/>}{permission&&<label className="composer-permission composer-config glass-action" title={t("权限：{0} · 保存后从下一轮任务生效", PERMISSION_MODES.find(mode=>mode.id===permission.mode)?.label??t("自定义"))}><ShieldCheck size={14}/><select aria-label={t("成员权限等级")} value={permission.mode??'custom'} onChange={e=>void invoke('member.permission',{memberId,mode:e.target.value},t("权限等级已保存，下一轮生效。")).catch(()=>{})}>{!permission.mode&&<option value="custom">{t("自定义权限")}</option>}{PERMISSION_MODES.map(mode=><option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label>}</>;
      },
      dock:<><ActiveRunProgress snapshot={snapshot} invoke={invoke} sessionIds={session?[session.id]:[]} label={t("工位工作")}/>{approvals.length?<div className="personal-approvals" aria-label={t("当前话题审批")}>{approvals.map(a=><ErrorBoundary key={a.id} compact area={t("话题审批")} resetKey={a.state}><ApprovalCard approval={a} invoke={invoke} member={member}/></ErrorBoundary>)}</div>:null}{latest?.workspaceUndo?.status==='undone'&&<p role="status" className="panel-muted">{t("本轮文件改动已撤销，消息和原始记录保留。")}</p>}</>,
      empty:<div className="room-empty">{member&&<div className="room-empty-team"><Avatar member={member} size={64}/></div>}<h2>{overview?.currentThreadId?t("和 {0} 单独聊聊", member?.name??t("成员")):t("当前文件夹还没有话题")}</h2><p>{overview?.currentThreadId?t("起草、整理资料或试做一个小任务，成果保存在本话题的工作文件夹。"):t("点击“开新话题”开始，也可以切换文件夹查看旧话题。")}</p></div>,
    }}/>
    {folders&&<Modal title={t("切换工位文件夹")} subtitle={t("只切换话题展示。各文件夹保留最近话题，正在运行的工作继续。")} onClose={()=>{if(!switching)closeFolders();}}><div className="modal-body desk-folder-list">{folders.folders?.map(folder=><button key={folder.key} type="button" className={`desk-folder-option ${folder.key===folders.folderKey?'selected':''}`} aria-label={t("切换到 {0}", folder.label)} aria-pressed={folder.key===folders.folderKey} disabled={switching} onClick={()=>void switchFolder(folder.directory)}><FolderOpen size={17}/><span><strong>{folder.label}{folder.personal?t(" · 直接读写"):''}</strong><small>{folder.directory}</small></span><span className="desk-folder-status">{t("{0} 个话题{1}{2}", folder.topicCount, folder.pending?t(" · 待回应"):folder.active?t(" · 运行中"):'', folder.unread?t(" · 未读"):'')}</span></button>)}</div><div className="modal-footer"><button className="button secondary" disabled={switching||!member} onClick={()=>void invoke<string|null>('dialog.directory').then(directory=>{if(directory)return switchFolder(directory);}).catch(()=>{})}>{t("选择其他文件夹")}</button><button className="button quiet" disabled={switching} onClick={closeFolders}>{t("关闭")}</button></div></Modal>}
    {model&&<ModelPopover invoke={invoke} listModels={modelListLoader(snapshot,invoke,model.session.provider)} anchor={model.anchor} session={model.session} info={snapshot.providers.find(p=>p.id===model.session.provider)} defaults={defaults(model.session)} onSettings={onSettings} onClose={()=>setModel(null)} onSave={async change=>{await invoke('session.update',{sessionId:model.session.id,...change});await invoke('member.config',{memberId,...change});}}/>}
    {filesOpen&&<DeskFileManager snapshot={snapshot} invoke={invoke} memberId={memberId} onClose={()=>setFilesOpen(false)}/>}
    <ContextMenu menu={menu} onClose={()=>setMenu(null)}/>
    {undo&&<WorkspaceUndoDialog session={undo} invoke={invoke} notify={()=>{}} onClose={()=>setUndo(null)} onDone={()=>setUndo(null)}/>}
    {apply&&<Modal title={apply.conflicts.length?t("有冲突，未应用改动"):t("改动已应用到原文件夹")} onClose={()=>setApply(null)}><div className="modal-body">{apply.conflicts.length?<ul>{apply.conflicts.map(c=><li key={c.path}>{c.path}：{c.reason}</li>)}</ul>:<p>{t("已应用 {0} 项改动。", apply.applied.length)}</p>}</div><div className="modal-footer"><button className="button primary" onClick={()=>setApply(null)}>{t("关闭")}</button></div></Modal>}
  </main>;
}

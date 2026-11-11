import {t} from '../i18n';
import {Trash2} from "lucide-react";
import {ErrorBoundary} from "../ErrorBoundary";
import {InviteModal, Modal, ProjectModal} from "../modals";
import {ProjectHierarchyModal} from "../project-tree";
import {MemberCard} from "../member-card";
import {SettingsModal} from "../settings";
import {QuotaOverview} from "../quota";
import {MemberActivityDialog} from "../run-activity";
import {backgroundPage} from "../../shared/background";
import {AutomationPanel} from "../automation";
import {ContextMenu, QuickSwitcher} from "../interactions";
import {sessionTitle} from "../ui";
import type {AppController} from "./use-app-controller";
export function AppDialogs({controller}:{controller:AppController}){
  const {
    snapshot, memberStop, setMemberStop, memberStopping, memberStopError, projectId, modal, setModal, hierarchy, setHierarchy, quotaOpen,
    setQuotaOpen, activityOpen, setActivityOpen, automationOpen, setAutomationOpen, settingsTab, settingsEditing, settingsFocus, setView,
    inviteProject, installs, theme, setTheme, menu, setMenu, confirm, setConfirm, switcher, setSwitcher, notify, refresh, invoke, enterMeeting,
    openSettings, team, project, openDesk, openRecordedSession, firstInput, createdProject, createdInviteProject, runConfirm, onInstall, memberStatus,
    confirmMemberStop, memberCard, closeMemberCard, backgroundId, backgroundTitle
  }=controller;
  return <>
{hierarchy&&<ProjectHierarchyModal key={hierarchy.mode+hierarchy.target.id} {...hierarchy} snapshot={snapshot} invoke={invoke} onClose={()=>setHierarchy(undefined)} onCreate={createdProject} onSaved={async()=>{await refresh();notify(t("项目归属与修改范围已保存。"));}}/>}
    {modal && <ErrorBoundary area={modal === 'settings' ? t("设置") : modal === 'project' ? t("添加项目") : modal === 'session' ? t("新建会话") : modal === 'invite' ? t("请大家一起来") : t("协作")} onDismiss={() => setModal(null)}>
      {modal === 'project' && <ProjectModal invoke={invoke} onClose={() => setModal(null)} onCreate={createdProject} />}
      {modal === 'settings' && <SettingsModal backgroundPage={backgroundId} backgroundTitle={backgroundTitle} snapshot={snapshot} invoke={invoke} onClose={() => setModal(null)} notify={notify} installs={installs} onInstall={onInstall} theme={theme} onTheme={setTheme} initialTab={settingsTab} initialFocus={settingsFocus} initialEditing={settingsEditing} />}
      {modal === 'invite' && <InviteModal snapshot={snapshot} invoke={invoke} initialProjectId={inviteProject} onClose={() => setModal(null)} onCreateProject={createdInviteProject} onDone={enterMeeting} />}

    </ErrorBoundary>}
    {memberStop&&<Modal title={t("中止 {0}", (team.get(memberStop.memberId)?.name??t("这位成员")))} subtitle={t("将停止 {0} 项当前运行，其他成员保留。", memberStop.runs.length)} onClose={()=>{if(!memberStopping)setMemberStop(undefined);}}><div className="modal-body"><ul>{memberStop.runs.map(run=><li key={run.runId}><strong>{run.location}{run.projectName?' · '+run.projectName:''}</strong><p>{run.title}</p></li>)}</ul><p>{t("已保存的发言和文件版本保留；结果未知的请求不会自动重发。")}</p>{memberStopError&&<p role="alert" className="task-meta bad">{memberStopError}</p>}</div><div className="modal-footer"><button className="button quiet" disabled={memberStopping} onClick={()=>setMemberStop(undefined)}>{t("取消")}</button><button className="button danger" disabled={memberStopping||!memberStop.runs.length} onClick={()=>void confirmMemberStop()}>{t("确认中止这位成员")}</button></div></Modal>}
    {quotaOpen&&<QuotaOverview snapshot={snapshot} invoke={invoke} onClose={()=>setQuotaOpen(false)}/>}
    {activityOpen&&<MemberActivityDialog snapshot={snapshot} invoke={invoke} onClose={()=>setActivityOpen(false)}/>}
    {automationOpen&&<AutomationPanel snapshot={snapshot} invoke={invoke} notify={notify} onClose={()=>setAutomationOpen(false)}/>}
    <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    {memberCard && (() => {
      const target = memberCard, status = memberStatus(target.memberId), executor = team.get(target.memberId)?.executor;
      const go = (action: () => void) => () => { closeMemberCard(); action(); };
      return <MemberCard target={target} snapshot={snapshot} status={status} onClose={closeMemberCard}
        onOpenWork={go(() => { if (status.inRoom) setView('room'); else if (status.session) openRecordedSession(status.session); })}
        onDesk={go(()=>openDesk(target.memberId))} onConnect={go(() => openSettings('members', null, executor ?? null))}
        onEdit={go(() => openSettings('members', target.memberId))} />;
    })()}
    {switcher && <QuickSwitcher snapshot={snapshot} firstInput={firstInput} onClose={() => setSwitcher(false)} onPick={target => { setSwitcher(false);openRecordedSession(target); }} />}
    {confirm && (() => {
      const target = confirm.kind === 'remove-project' ? undefined : snapshot.sessions.find(item => item.id === confirm.id);
      const targetProject = confirm.kind === 'remove-project' ? snapshot.projects.find(item => item.id === confirm.id) : undefined;
      const copies = confirm.kind === 'remove-project' ? snapshot.sessions.filter(item => item.projectId === confirm.id && item.workspaceKind && item.workspaceKind !== 'original' && item.workspace).length : target?.workspace && target.workspaceKind !== 'original' ? 1 : 0;
      const name = target ? sessionTitle(target, firstInput(target.id)) : targetProject?.name ?? '';
      const heading = confirm.kind === 'delete-session' ? t("删除这个会话？") : confirm.kind === 'remove-project' ? t("把项目从工作室移除？") : t("丢弃这个工作副本？");
      return <Modal title={heading} subtitle={name} onClose={() => setConfirm(null)}>
        <div className="modal-body">
          {confirm.kind === 'delete-session' && <p className="confirm-text">{t("对话记录、任务记录和待回应的请求会一起删除，不能恢复。如果只是不想看到它，可以改用“归档”。")}</p>}
          {confirm.kind === 'remove-project' && <p className="confirm-text">{t("这个项目里的 {0} 个会话会一起删除。", snapshot.sessions.filter(item => item.projectId === confirm.id).length)}<strong>{t("你电脑上的项目文件夹不会被改动。")}</strong></p>}
          {confirm.kind === 'discard' && <p className="confirm-text">{t("工作副本里还没应用到项目的改动会丢失。项目本身不受影响；下一轮任务会从项目当前的样子重新建立副本。如果需要保留改动，请先“应用到项目”。")}</p>}
          {confirm.kind === 'delete-session' && <label className="toggle-row"><span><strong>{t("是否同步删除对话内文件")}</strong><small>{t("默认保留文件与附件。勾选后删除此会话的专用工位目录及独占附件，共享目录和外部项目保留。")}</small></span><input type="checkbox" checked={confirm.deleteFiles??false} onChange={event=>setConfirm({...confirm,deleteFiles:event.target.checked})}/></label>}
          {confirm.kind !== 'discard' && copies > 0 && <label className="toggle-row"><span><strong>{t("同时删除工作副本（{0} 个）", copies)}</strong><small>{t("未应用到项目的改动会丢失。不勾选则保留在 HiveLab 合屋 的数据目录里。")}</small></span><input type="checkbox" checked={confirm.discard} onChange={event => setConfirm({ ...confirm, discard: event.target.checked })} /></label>}
        </div>
        <div className="modal-footer"><button className="button quiet" onClick={() => setConfirm(null)}>{t("取消")}</button><button className="button danger-solid" onClick={() => void runConfirm()}><Trash2 size={14} />{confirm.kind === 'delete-session' ? t("删除会话") : confirm.kind === 'remove-project' ? t("移除项目") : t("丢弃副本")}</button></div>
      </Modal>;
    })()}
  </>;
}

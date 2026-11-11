import {t} from './i18n';
import type {Settings,Snapshot} from '../shared/types';
import {memberPermissions} from '../shared/permissions';
import {PERMISSION_MODES} from '../shared/permission-modes';
import {PermissionModePicker} from './permission-mode';
import {useTeam} from './members';
import {ConnectionCard} from './settings';

export function PermissionSettings({snapshot,settings,setSettings}:{snapshot:Snapshot;settings:Settings;setSettings:(update:(previous:Settings)=>Settings)=>void}){
 const team=useTeam();
 return <><div className="settings-section-heading"><h3>{t("人物权限")}</h3><small>{t("保存后从下一轮任务生效")}</small></div>
  <div className="connection-grid">{team.members.map(member=>{
   const value=memberPermissions(settings,member.card,snapshot.executors?.find(e=>e.id===member.executor));
   const mode=PERMISSION_MODES.find(item=>item.id===value.mode);
   return <ConnectionCard key={member.id} name={member.name} members={[member]} status={mode?.label??t("自定义权限")}>
    <PermissionModePicker label={t("{0} 权限等级", member.name)} value={value} onChange={next=>setSettings(old=>({...old,memberPermissions:{...old.memberPermissions,[member.id]:next}}))}/>
   </ConnectionCard>;
  })}</div>
  <small className="settings-description">{t("用户选择问题始终等待回答；会议聊天与只读会话保留各自限制。Codex 的“帮我批准”使用原生自动审查，其他程序仅自动通过可确定的低风险请求。")}</small>
 </>;
}

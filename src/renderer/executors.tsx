import {t} from './i18n';
import {PermissionModePicker} from './permission-mode';
import { connectionLabel } from '../shared/executor-connection';
import { executorPermissions } from '../shared/permissions';
import { CatalogConnectionCreator, CatalogLogin, CatalogVersionPanel } from './executor-catalog';
import { CompatibilityDetails } from './compatibility';
import { useState } from 'react';
import { FolderOpen, Info, KeyRound, LoaderCircle, Plug, RefreshCw, Save, Trash2 } from 'lucide-react';
import { SECRET_PLACEHOLDER, joinArgs } from '../shared/defaults';
import type { AcpExecutor, MemberPermissions, ProviderInfo, Settings, Snapshot } from '../shared/types';
import { Avatar, useTeam } from './members';
import { dateTime, providerSummary, runnable, type Invoke, type Notify } from './ui';
import { Modal } from './modals';

/** What the user edits; arguments and environment stay as typed until saved. */
export interface AcpDraft { name: string; command: string; args: string; env: string }
export const emptyAcpDraft: AcpDraft = { name: '', command: '', args: '', env: '' };
export const acpDraftOf = (executor: AcpExecutor): AcpDraft => ({ name: executor.name, command: executor.command, args: joinArgs(executor.args), env: [...Object.entries(executor.env).map(([key, value]) => `${key}=${value}`), ...(executor.secretKeys ?? []).map(key => `${key}=${SECRET_PLACEHOLDER}`)].join('\n') });

/** Program, arguments and environment for an ACP connection. */
export function AcpFields({ value, onChange, invoke, nameHint, managed=false }: { value: AcpDraft; onChange: (value: AcpDraft) => void; invoke: Invoke; nameHint?: string;managed?:boolean }) {
  const set = (patch: Partial<AcpDraft>) => onChange({ ...value, ...patch });
  async function browse() { try { const file = await invoke<string | null>('dialog.program'); if (file) set({ command: file }); } catch {} }
  return <div className="acp-fields">
    <label className="field">{t("程序名称")}<input aria-label={t("程序名称")} value={value.name} maxLength={40} onChange={event => set({ name: event.target.value })} placeholder={nameHint || t("例如：Gemini CLI")} /><small>{t("显示在成员卡和会话里，就像 Claude、Codex 一样。")}</small></label>
    <div className="field">{t("程序路径")}<span className="input-with-button"><input readOnly={managed} aria-label={t("程序路径")} value={value.command} onChange={event => set({ command: event.target.value })} placeholder={t("例如：gemini，或 C:\\…\\agent.exe")} spellCheck={false} /><button type="button" className="button small secondary" disabled={managed} onClick={() => void browse()}><FolderOpen size={13} />{t("浏览")}</button></span>
      <small>{t("可以填程序名（在系统 PATH 里查找）、.exe，或 Node 脚本；npm 安装的 .cmd 会自动换成它指向的脚本，不经过命令行解释器。")}</small></div>
    <label className="field">{t("启动参数")}<input readOnly={managed} aria-label={t("启动参数")} value={value.args} onChange={event => set({ args: event.target.value })} placeholder={t("让程序进入 ACP 模式的参数，例如 --experimental-acp")} spellCheck={false} /><small>{t("含空格的参数用双引号括起来。")}</small></label>
    <label className="field">{t("环境变量 ")}<span className="optional">{t("可选，每行一个 名称=值")}</span><textarea aria-label={t("环境变量")} rows={2} value={value.env} onChange={event => set({ env: event.target.value })} placeholder={t("例如：给它单独的配置目录\nGEMINI_CLI_HOME=D:\\hivelab-gemini")} spellCheck={false} /><small>{t("只传给这个程序。名称里带 KEY、TOKEN、SECRET、PASSWORD 的变量（例如 GEMINI_API_KEY）会用系统加密单独保存，之后只显示“{0}”；不改这一项就保留原值，删掉这一行就删除密钥。", SECRET_PLACEHOLDER)}</small></label>
    <div className="info-card"><Info size={17} /><p>{t("HiveLab 合屋 通过 ACP（Agent Client Protocol）和程序对话：它在标准输入输出里收发消息。程序需要支持 ACP，例如 Gemini CLI（参数 --experimental-acp）。登录由程序自己完成，HiveLab 合屋 不接收你的账号密码。")}</p></div>
  </div>;
}



/** A connected program in settings: checked, signed in and configured like the built-in executors. */
export function AcpConnection({ executor, info, snapshot, invoke, notify, settings, setSettings }: { settings: Settings; setSettings: (update: (previous: Settings) => Settings) => void; executor: AcpExecutor; info?: ProviderInfo; snapshot: Snapshot; invoke: Invoke; notify: Notify }) {
  const team = useTeam();
  const users = team.members.filter(member => member.executor === executor.id);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState<AcpDraft>(() => acpDraftOf(executor));
  const [permissions, setPermissions] = useState<MemberPermissions>(() => executorPermissions(settings, executor.id, executor));
  const [busy, setBusy] = useState<'save' | 'check' | 'login' | 'delete' | null>(null);
  const ready = runnable(info);
  // A manual program only has something to sign in to when its check says so; otherwise the button would do nothing.
  const needsLogin = Boolean(info?.runtimeReady && info.auth === 'none');
  async function act(kind: NonNullable<typeof busy>, action: () => Promise<unknown>) { setBusy(kind); try { await action(); } catch {} finally { setBusy(null); } }
  const save = () => act('save', async () => { const params={executor:{id:executor.id,...draft,permissions,model:Object.hasOwn(settings.models,executor.id)?settings.models[executor.id]:executor.model}};if(snapshot.runs.some(run=>['running','waiting_user','stopping'].includes(run.status)&&!run.completedAt)){await invoke('member.change.queue',{method:'executor.save',params,label:t("{0} 的连接", draft.name||executor.name)},t("连接设置已排队，将在成员空闲后应用。"));setEditing(false);return;}await invoke('executor.save',params,t("{0} 的连接已保存，正在重新检测。", draft.name||executor.name)); setSettings(previous => ({ ...previous, permissions: { ...previous.permissions, [executor.id]: permissions } })); setEditing(false); });
  const check = () => act('check', () => invoke('provider.probe', { provider: executor.id }));
  const login = () => act('login', async () => { notify(t("已请 {0} 发起登录；如果打开了浏览器，请在那里完成。", executor.name)); try { const result = await invoke<{ detail: string }>('executor.authenticate', { id: executor.id }); notify(result.detail); void invoke('provider.probe', { provider: executor.id }).catch(() => {}); } catch (error) { notify((error as Error).message || t("登录没有完成。"), true); } });
  const removed = () => { setSettings(previous=>{const paths={...previous.paths},models={...previous.models},efforts={...previous.efforts},permissions={...previous.permissions};delete paths[executor.id];delete models[executor.id];delete efforts[executor.id];delete permissions[executor.id];return {...previous,paths,models,efforts,permissions};});setDeleting(false); };
  return <section className="provider-settings acp-connection" aria-label={t("{0} 的连接", executor.name)}>
    <div className="provider-settings-heading">
      {users[0] ? <Avatar member={users[0]} size={42} mood={ready ? 'resting' : info ? 'offline' : 'away'} /> : <span className="acp-icon"><Plug size={20} /></span>}
      <div><strong>{executor.name} <em className="acp-badge">{connectionLabel(executor.id, executor)}</em> <small>{users.map(member => member.name).join('、') || t("还没有成员使用")}</small></strong><span className={ready ? 'ready-text' : ''}>{providerSummary(info)}{info?.version ? ` · ${info.version}` : ''}</span></div>
      <button type="button" className="button small quiet" disabled={Boolean(busy) || !snapshot.backendReady} onClick={() => void check()}>{busy === 'check' ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}{t("检查")}</button>
      {!executor.catalogId&&(needsLogin||busy==='login')&&<button type="button" className="button small secondary" disabled={Boolean(busy) || !snapshot.backendReady} onClick={() => void login()}>{busy === 'login' ? <LoaderCircle size={12} className="spin" /> : <KeyRound size={12} />}{busy === 'login' ? t("等待登录完成…") : t("登录")}</button>}
      {!executor.catalogId&&busy==='login'&&<button type="button" className="button small quiet" onClick={()=>void invoke('executor.cancelLogin',{id:executor.id}).catch(()=>{})}>{t("取消登录")}</button>}
      <button type="button" className="button small quiet danger" disabled={Boolean(busy)||!snapshot.backendReady} onClick={()=>setDeleting(true)}><Trash2 size={12}/>{t("删除连接")}</button>
    </div>
    <p className="provider-detail">{info?.detail ?? t("尚未检查。")}</p>
    {!executor.catalogId&&!needsLogin&&info?.runtimeReady&&<p className="provider-detail">{t("这个程序不需要在这里登录（密钥通过环境变量提供，或已在它自己的命令行里登录）。更换账号后点击“检查”即可。")}</p>}
    {executor.catalogId&&<><p className="provider-detail">{t("{0}需要使用另一种登录方式时，新增独立连接，再到人物卡选择。", users.length?t("使用此连接：{0}。修改登录会影响这些人物卡。", users.map(member=>member.name).join('、')):t("此连接尚未绑定人物卡。"))}</p><CatalogConnectionCreator executor={executor} snapshot={snapshot} invoke={invoke} notify={notify}/></>}
    {executor.catalogId&&<CatalogLogin executor={executor} snapshot={snapshot} invoke={invoke} notify={notify}/>}
    {executor.catalogId&&<CatalogVersionPanel executor={executor} snapshot={snapshot} invoke={invoke}/>}
    <CompatibilityDetails provider={executor.id} info={info} available={snapshot.backendReady} load={provider=>invoke('provider.compatibility',{provider})} invoke={invoke}/>
    {!editing && <p className="provider-detail acp-command"><code>{info?.path ?? executor.command}{executor.args.length ? ` ${joinArgs(executor.args)}` : ''}</code></p>}
    <details className="acp-editor" open={editing} onToggle={event=>setEditing(event.currentTarget.open)}><summary>{t("编辑连接信息")}</summary>
      <AcpFields value={draft} onChange={setDraft} invoke={invoke} managed={!!executor.catalogId}/>{executor.catalogId&&<p className="provider-detail">{t("程序与启动参数由清单版本管理维护。要修改它们，可以手动添加另一个连接。")}</p>}
      <PermissionModePicker label={t("{0} 权限等级", executor.name)} value={permissions} onChange={setPermissions}/>
      <div className="acp-editor-actions">
        <span className="spacer" />
        <button type="button" className="button small quiet" onClick={() => { setDraft(acpDraftOf(executor)); setPermissions(executorPermissions(settings, executor.id, executor)); setEditing(false); }}>{t("取消")}</button>
        <button type="button" className="button small primary" disabled={Boolean(busy) || !draft.name.trim() || !draft.command.trim() || !snapshot.backendReady} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle size={12} className="spin" /> : <Save size={12} />}{t("保存连接")}</button>
      </div>
    </details>
    <div className="provider-check-time">{t("上次确认：{0}{1}", dateTime(info?.checkedAt), info?.stale ? t(" · 等待重新检测") : '')}</div>
    {deleting&&<DeleteConnectionDialog executor={executor} users={users.map(member=>member.name)} invoke={invoke} onClose={()=>setDeleting(false)} onDeleted={removed}/>}
  </section>;
}

export function DeleteConnectionDialog({executor,users,invoke,onClose,onDeleted,builtin=false}:{executor:{id:string;name:string};users:string[];invoke:Invoke;onClose:()=>void;onDeleted:()=>void;builtin?:boolean}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function remove(){if(busy)return;setBusy(true);setError('');try{await invoke('executor.delete',{id:executor.id,detachMembers:users.length>0},t("连接已删除，人物卡和历史对话已保留。"));onDeleted();}catch(error){setError((error as Error).message);}finally{setBusy(false);}}
  return <Modal title={t("删除连接「{0}」？", executor.name)} onClose={()=>{if(!busy)onClose();}}><div className="modal-body"><p>{builtin?t("将断开这个执行端连接。人物卡、历史对话、登录资料和已下载程序会保留，可以从清单或手动配置重新添加。"):t("将删除这个连接及其保存的 API 密钥。人物卡、历史对话、登录目录和已下载程序会保留。")}</p>{users.length>0&&<><p>{t("使用此连接的人物卡：")}<strong>{users.join('、')}</strong>。</p><p>{t("这些人物卡将显示“未连接”。可以在人物卡中选择其他连接，保存后新建话题继续聊天；旧话题保留原连接，{0}", builtin?t("连接恢复前仅供查看和导出。"):t("仅供查看和导出。"))}</p></>}{error&&<p className="provider-detail" role="alert">{error}</p>}</div><div className="modal-footer"><button type="button" className="button quiet" disabled={busy} onClick={onClose}>{t("取消")}</button><button type="button" className="button danger-solid" disabled={busy} onClick={()=>void remove()}>{busy?<LoaderCircle size={14} className="spin"/>:<Trash2 size={14}/>}{t("确认删除连接")}</button></div></Modal>;
}

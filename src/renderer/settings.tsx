import {t} from './i18n';
import {connectionLabel} from "../shared/executor-connection";
import {ProviderLogin} from "./provider-login";
import {ModelPicker} from "./model-picker";
import {PermissionSettings} from "./permission-settings";
import {ExecutorCatalog, NativeConnectionCreator, ThirdPartyLicenses} from "./executor-catalog";
import type {NodeRuntimeInfo} from "../shared/executor-catalog";
import {CompatibilityDetails} from "./compatibility";
import {DiscussionCallSettings} from "./discussion-call-settings";
import {CovenantEditor} from "./covenant-editor";
import {PersonaEditor} from "./persona-editor";
import {StorageSettings} from "./storage-settings";
import {useEffect, useRef, useState, type ReactNode} from "react";
import {Cable, Check, ChevronDown, ChevronRight, Download, FileText, Folder, Globe2, HardDrive, Info, KeyRound, Languages, LoaderCircle, LockKeyhole, Network, Palette, RefreshCw, ShieldCheck, Trash2, UserRound, Users} from "lucide-react";
import {PROVIDER_NAMES, normalizePermissions} from "../shared/defaults";
import type {PermissionMember, ProviderId, Settings, Snapshot} from "../shared/types";
import {Avatar, useTeam, type TeamMember} from "./members";
import {CardEditor, MemberGallery, ProfileSettings} from "./cards";
import {Modal} from "./modals";
import {AcpConnection, DeleteConnectionDialog} from "./executors";
import {NOTIFY_KEY, notificationsEnabled} from "./interactions";
import {PROVIDERS, dateTime, providerSummary, runnable, type Invoke, type Notify, versionText} from "./ui";
import {RunningVersionCard} from "./version";
import {PendingSettings} from "./pending-settings";
import {AppearanceSettings} from "./appearance-settings";
import {LanguageSettings} from "./language-settings";
import {ExtensionSettings} from "./extensions";
import {VersionPanel} from "./settings/VersionPanel";
export {VersionPanel} from './settings/VersionPanel';
export { ModelPicker } from './model-picker';

export type Installs = Partial<Record<ProviderId, { version: string; startedAt: number }>>;

/** One connection as a card: whose accounts it serves and how it stands; details open on click. */
export function ConnectionCard({name, members, status, subtitle, ready, children, icon, provider, focused}: {name: string; members: TeamMember[]; status: string; subtitle?: string; ready?: boolean; children?: ReactNode; icon?: ReactNode; provider?: string; focused?: boolean}) {
  // A card someone was sent to (e.g. from the composer's model button) opens with its details showing.
  const [open, setOpen] = useState(Boolean(focused));
  return <section className={`connection-card${open ? ' open' : ''}`} data-provider={provider}>
    <button type="button" className="connection-card-head" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="connection-card-avatars">
        {members.length
          ? <>{members.slice(0, 3).map(member => <Avatar key={member.id} member={member} size={30} />)}{members.length > 3 && <span className="connection-card-more">+{members.length - 3}</span>}</>
          : <span className="connection-card-icon">{icon ?? <Cable size={19} />}</span>}
      </span>
      <span className="connection-card-text">
        <strong>{name}</strong>
        <small className={ready ? 'ready-text' : ''}>{status}</small>
        {subtitle && <small className="connection-card-sub">{subtitle}</small>}
      </span>
      <ChevronDown size={15} className={open ? 'rot' : undefined} />
    </button>
    {open && <div className="connection-card-body">{children}</div>}
  </section>;
}

export type ThemeChoice = 'system' | 'light' | 'dark';

export type SettingsTab = 'members' | 'connections' | 'profile' | 'permissions' | 'network' | 'workspace' | 'appearance' | 'language' | 'extensions' | 'skills' | 'covenant' | 'personas' | 'storage';
const SETTINGS_GROUPS=[['工作室',['members','personas','profile','appearance','language','workspace','storage','covenant']],['执行端',['connections','permissions','network']],['扩展',['extensions','skills']]] as const;
const groupOfTab=(tab:SettingsTab)=>SETTINGS_GROUPS.find(([,pages])=>(pages as readonly SettingsTab[]).includes(tab))![0];

export function SettingsModal({ snapshot, invoke, onClose, notify, installs, onInstall, theme, onTheme, initialTab = 'members', initialEditing, initialFocus, backgroundPage='home', backgroundTitle=t("首页") }: {
  backgroundPage?:string; backgroundTitle?:string;
  snapshot: Snapshot; invoke: Invoke; onClose: () => void; notify: Notify;
  installs: Installs; onInstall: (provider: ProviderId, version: string | null) => void;
  theme: ThemeChoice; onTheme: (theme: ThemeChoice) => void; initialTab?: SettingsTab; initialEditing?: string | null;
  /** A program whose connection section is scrolled into view and highlighted on open. */
  initialFocus?: string | null;
}) {
  const team = useTeam();
  const [editing, setEditing] = useState<string | null>(initialEditing ?? null);
  useEffect(() => {
    if (!initialFocus) return;
    const frame = requestAnimationFrame(() => {
      const section = document.querySelector<HTMLElement>(`[data-provider="${CSS.escape(initialFocus)}"]`);
      section?.scrollIntoView({ block: 'center' }); section?.classList.add('focus-flash');
    });
    return () => cancelAnimationFrame(frame);
  }, [initialFocus]);
  const [cardActions, setCardActions] = useState<HTMLDivElement | null>(null);
  const [settings, setSettings] = useState<Settings>(() => ({ ...snapshot.settings, paths: { ...snapshot.settings.paths }, models: { ...Object.fromEntries((snapshot.executors ?? []).filter(executor => executor.model).map(executor => [executor.id, executor.model!])), ...snapshot.settings.models }, efforts: { ...snapshot.settings.efforts }, permissions: normalizePermissions(snapshot.settings.permissions) }));
  const committedSettings=useRef(snapshot.settings);
  // Login saves commit model defaults immediately; the dialog must not restore an older default on Save.
  useEffect(()=>{
    const before=committedSettings.current;committedSettings.current=snapshot.settings;
    setSettings(previous=>{
      let next=previous;
      for(const field of ['models','efforts'] as const){
        const changed=[...new Set([...Object.keys(before[field]),...Object.keys(snapshot.settings[field])])].filter(id=>before[field][id as ProviderId]!==snapshot.settings[field][id as ProviderId]);
        if(changed.length){const values={...previous[field]};for(const id of changed)if(Object.hasOwn(snapshot.settings[field],id))values[id as ProviderId]=snapshot.settings[field][id as ProviderId];else delete values[id as ProviderId];next={...next,[field]:values};}
      }
      return next;
    });
  },[snapshot.settings]);
  useEffect(() => {
    const ids = new Set(snapshot.members?.map(member => member.id));
    setSettings(previous => {
      const values = previous.memberPermissions;
      if (!values || Object.keys(values).every(id => ids.has(id))) return previous;
      return { ...previous, memberPermissions: Object.fromEntries(Object.entries(values).filter(([id]) => ids.has(id))) };
    });
  }, [snapshot.members]);
  // Requests that point at a program (its id, or the download catalog) belong to 连接与版本.
  const [tab, setTab] = useState<SettingsTab>(initialTab === 'members' && initialFocus && !initialEditing ? 'connections' : initialTab);
  // Every group starts closed except the one holding the page on show.
  const [openGroups,setOpenGroups]=useState<ReadonlySet<string>>(()=>new Set([groupOfTab(tab)]));
  useEffect(()=>{setOpenGroups(previous=>previous.has(groupOfTab(tab))?previous:new Set([...previous,groupOfTab(tab)]));},[tab]);
  const [newExecutor,setNewExecutor]=useState<PermissionMember>();
  const [manualProvider,setManualProvider]=useState<ProviderId>();
  const [deletingProvider,setDeletingProvider]=useState<ProviderId>();
  // Cancelling a card started from the download catalog returns to the catalog, not the gallery.
  const [editOrigin,setEditOrigin]=useState<SettingsTab>('members');
  const [nodeInfo,setNodeInfo]=useState<NodeRuntimeInfo>();
  useEffect(()=>{void invoke<{node:NodeRuntimeInfo}>('catalog.list').then(value=>setNodeInfo(value.node)).catch(()=>{});},[invoke]);
  const [claudeApi,setClaudeApi]=useState('');
  async function saveClaudeApi(value:string){setClaudeApi('');try{await saveConfiguration();await invoke('claudeApiKey.set',{value},value?t("Claude API Key 已加密保存。"):t("Claude API Key 已清除。"));}catch{}}
  const [busy, setBusy] = useState(false); const [checking, setChecking] = useState<ProviderId | 'all' | null>(null);
  const [backupBusy,setBackupBusy]=useState(false);
  const [loginMessages, setLoginMessages] = useState<Partial<Record<ProviderId, string>>>({});
  const [claudeLoginCode, setClaudeLoginCode] = useState('');
  const [sendingLoginCode, setSendingLoginCode] = useState(false);
  const [claudeToken, setClaudeToken] = useState(''), [savingToken, setSavingToken] = useState(false);
  const [notify_, setNotify] = useState(notificationsEnabled);
  function toggleNotifications(on: boolean) {
    setNotify(on);
    try { localStorage.setItem(NOTIFY_KEY, on ? 'on' : 'off'); } catch {}
  }
  async function sendClaudeLoginCode() {
    const code = claudeLoginCode; setClaudeLoginCode(''); setSendingLoginCode(true);
    try { await invoke('provider.loginCode', { provider: 'claude', code }); notify(t("授权码已提交，等待官方登录完成。")); } catch {} finally { setSendingLoginCode(false); }
  }
  async function openTokenWindow() {
    try { const result = await invoke<{ detail?: string }>('provider.tokenLogin', { provider: 'claude' }); setLoginMessages(previous => ({ ...previous, claude: result?.detail ?? t("已打开令牌窗口。") })); } catch {}
  }
  /** The token goes straight to the desktop process for encryption; the field is cleared at once either way. */
  async function saveClaudeToken(value: string) {
    setClaudeToken(''); setSavingToken(true);
    try { await invoke('secret.set', { provider: 'claude', value }, value ? t("Claude 长期令牌已加密保存，正在重新检查。") : t("已清除 Claude 长期令牌。")); } catch {} finally { setSavingToken(false); }
  }
  async function saveConfiguration() {
    await invoke('settings.save', { settings });
  }
  async function save() {
    setBusy(true);
    try {
      // 检查是否有运行中的任务
      const hasRunningTasks = snapshot.runs.some(run=>['running','waiting_user','stopping'].includes(run.status)&&!run.completedAt);

      if(hasRunningTasks){
        // 弹出提示卡片，询问是否等待任务完成后应用
        const confirmed = window.confirm(t("当前有任务正在运行。\n\n点击「确定」将设置排队，等任务结束后自动应用；\n点击「取消」可继续编辑。"));
        if(!confirmed) {
          setBusy(false);
          return;
        }
        await invoke('member.change.queue',{method:'settings.save',params:{settings},label:t("工作台设置")},t("设置已排队，等成员空闲后应用。"));
        onClose();
        return;
      }

      // 没有运行任务，直接保存
      await saveConfiguration();
      notify(t("设置已保存。新任务会使用当前配置。"));
      onClose();
    } catch {} finally { setBusy(false); }
  }
  async function probe(provider?: ProviderId) { setChecking(provider ?? 'all'); try { await saveConfiguration(); await invoke('provider.probe', provider ? { provider } : {}); } catch {} finally { setChecking(null); } }
  async function selectManualProvider(provider?: ProviderId) {
    try {
      if (provider && snapshot.removedProviders?.includes(provider)) await invoke('executor.restore',{id:provider});
      setManualProvider(provider);
    } catch {}
  }
  async function exportDiagnostics() {
    try {
      const result = await invoke<{ path?: string } | string>('diagnostics.export');
      const path = typeof result === 'string' ? result : result?.path;
      notify(path ? t("诊断记录已导出：{0}", path) : t("诊断记录已导出。"));
    } catch {}
  }
  const tabs = [['members', t("团队成员"), <Users size={15} />], ['personas', t("人物设定"), <FileText size={15} />], ['connections', t("连接与版本"), <Cable size={15} />], ['profile', t("个人资料"), <UserRound size={15} />], ['appearance',t("外观"),<Palette size={15}/>], ['language', t("语言 · Language"), <Languages size={15} />], ['permissions', t("权限"), <ShieldCheck size={15} />], ['network', t("网络"), <Globe2 size={15} />], ['workspace', t("工作台"), <Folder size={15} />], ['storage', t("存储"), <HardDrive size={15} />], ['covenant', t("工作公约"), <FileText size={15} />], ['extensions', t("插件"), <Download size={15} />], ['skills', 'Skills', <Folder size={15} />]] as const;
  return <Modal title={t("设置与成员连接")} subtitle={t("工作室设置、执行端连接及扩展管理。")} onClose={backupBusy?()=>{}:onClose} className="settings-modal">
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t("设置分类")}>
        {SETTINGS_GROUPS.map(([group,pages])=><details className="settings-nav-group" key={group} open={openGroups.has(group)} onToggle={event=>{const open=event.currentTarget.open;setOpenGroups(previous=>{if(previous.has(group)===open)return previous;const next=new Set(previous);if(open)next.add(group);else next.delete(group);return next;});}}><summary className="settings-nav-heading"><ChevronRight size={13} aria-hidden="true"/>{t(group)}</summary>{tabs.filter(([id])=>(pages as readonly string[]).includes(id)).map(([id,label,icon])=><button disabled={backupBusy} className={tab===id?'selected':''} key={id} onClick={()=>{setTab(id);setEditing(null);}}>{icon}{label}</button>)}</details>)}
        <div className="settings-nav-team" aria-hidden="true">{team.members.slice(0, 4).map(member => <Avatar key={member.id} member={member} size={30} />)}</div>
        <div className="settings-nav-note"><ShieldCheck size={16} /><span>{t("登录由官方程序完成，工作台不复制订阅令牌。")}</span></div>
      </nav>
      <div className="settings-content">
        {tab==='language'&&<LanguageSettings snapshot={snapshot} invoke={invoke}/>}
        {tab==='appearance'&&<AppearanceSettings snapshot={snapshot} theme={theme} onTheme={onTheme} page={backgroundPage} title={backgroundTitle}/>}
        {tab === 'members' && editing && <CardEditor key={editing} snapshot={snapshot} memberId={editing} invoke={invoke} notify={notify} onBack={() => setEditing(null)} onCancel={() => { setEditing(null); setTab(editOrigin); }} actionContainer={cardActions} initialExecutor={newExecutor} />}
        {tab === 'members' && !editing && <>
          <div className="settings-section-heading"><h3>{t("团队成员")}</h3></div>
          <p className="settings-description">{t("每位成员是一张人物卡：名字、怎么称呼你、人设、长期记忆和形象都可以改。成员使用的 AI 程序在“连接与版本”里下载和登录。")}</p>
          <MemberGallery snapshot={snapshot} invoke={invoke} onEdit={id => {setEditOrigin('members');setEditing(id);}} onAdd={() => {setNewExecutor(undefined);setEditOrigin('members');setEditing('new');}} />
        </>}
        {tab === 'connections' && <>
          <ExecutorCatalog snapshot={snapshot} invoke={invoke} notify={notify} beforeOperation={saveConfiguration} onSelected={item=>{if(!item.provider.startsWith('acp-'))setSettings(previous=>({...previous,paths:{...previous.paths,[item.provider]:item.selectedPath}}));}} onNewMember={provider=>{setNewExecutor(provider);setEditOrigin('connections');setEditing('new');setTab('members');}}/>
          <div className="settings-section-heading"><h3>{t("连接、模型与版本")}</h3><button className="button small secondary" disabled={Boolean(checking) || !snapshot.backendReady} onClick={() => void probe()}><RefreshCw size={13} className={checking ? 'spin' : ''} />{t("检查全部")}</button></div>
          <p className="settings-description">{t("按连接分别设置登录、模型和版本。同一程序可以新增独立连接，再由人物卡选择。")}</p>
          <label className="field compact">{t("手动配置本机执行端")}<select aria-label={t("手动配置本机执行端")} value={manualProvider??''} onChange={event=>void selectManualProvider(event.target.value as ProviderId||undefined)}><option value="">{t("选择要配置的程序")}</option>{PROVIDERS.map(provider=><option key={provider} value={provider}>{PROVIDER_NAMES[provider]}</option>)}</select></label>
          <div className="connection-grid">
          {PROVIDERS.filter(provider=>!snapshot.removedProviders?.includes(provider)&&(snapshot.settings.paths[provider]||team.members.some(member=>member.executor===provider)||manualProvider===provider||provider==='deepseek'&&snapshot.deepseekKeyConfigured)).map(provider => {
            const info = snapshot.providers.find(item => item.id === provider);
            const members = team.members.filter(member=>member.executor===provider);
            const p = members[0];
            return <ConnectionCard key={provider} provider={provider} focused={initialFocus===provider} name={PROVIDER_NAMES[provider]} members={members} status={providerSummary(info)} subtitle={connectionLabel(provider)} ready={runnable(info)}>
            <section className={`provider-settings member-${provider}`} data-provider={provider}>
              <div className="provider-settings-heading">
                {p?<Avatar member={p} size={42} mood={runnable(info) ? 'resting' : info ? 'offline' : 'away'} />:<Cable size={24}/>}
                <div><strong>{PROVIDER_NAMES[provider]} <small>{team.members.filter(member => member.executor === provider).map(member => member.name).join('、')}</small></strong><span className={runnable(info) ? 'ready-text' : ''}>{providerSummary(info)}{info?.version ? ` · ${versionText(info)}` : ''}</span></div>
                <button className="button small quiet" disabled={Boolean(checking) || !snapshot.backendReady} onClick={() => void probe(provider)}>{checking === provider || checking === 'all' ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}{t("检查")}</button>
                {provider!=='deepseek'&&<button className="button small quiet danger" aria-label={t("{0} 删除连接", PROVIDER_NAMES[provider])} disabled={Boolean(checking)||!snapshot.backendReady} onClick={()=>setDeletingProvider(provider)}><Trash2 size={12}/>{t("删除连接")}</button>}
              </div>
              <p className="provider-detail">{connectionLabel(provider)}</p><p className="provider-detail">{info?.detail ?? t("尚未检查本机可用性与认证方式。")}</p>
              {(provider==='codex'||provider==='dsh'||provider==='claude'&&settings.claudeAuthMode!=='api')&&<ProviderLogin provider={provider} available={snapshot.backendReady} invoke={invoke} notify={notify} beforeLogin={saveConfiguration}/>}
              <CompatibilityDetails provider={provider} info={info} available={snapshot.backendReady} load={provider=>invoke('provider.compatibility',{provider})} invoke={invoke}/>
              {loginMessages[provider] && <pre className="login-message">{loginMessages[provider]}</pre>}
              {provider !== 'deepseek' && <label className="field compact">{t("执行文件路径 ")}<span className="optional">{t("留空自动查找")}</span><input value={settings.paths[provider] ?? ''} onChange={event => setSettings(previous => ({ ...previous, paths: { ...previous.paths, [provider]: event.target.value } }))} placeholder={info?.path ?? (provider === 'claude' ? t("独立安装的 Claude Code CLI 路径") : t("使用本机默认路径"))} spellCheck={false} /></label>}
              <p className="provider-detail">{t("模型选择已移至「团队成员」中每位成员的人物卡。不同成员可以使用同一连接的不同模型。")}</p>
              {provider !== 'deepseek' && <VersionPanel provider={provider} info={info} available={snapshot.backendReady} invoke={invoke} installing={installs[provider]} onInstall={version => onInstall(provider, version)} onSelectedPath={path => setSettings(previous => ({ ...previous, paths: { ...previous.paths, [provider]: path ?? undefined} }))} />}
              {provider==='claude'&&<>
                <label className="field compact">{t("Claude 登录方式")}<select aria-label={t("Claude 登录方式")} value={settings.claudeAuthMode??'subscription'} onChange={event=>setSettings(previous=>({...previous,claudeAuthMode:event.target.value as 'subscription'|'api'}))}><option value="subscription">{t("订阅登录（官方 Claude Code）")}</option><option value="api">API Key</option></select></label>
                {settings.claudeAuthMode==='api'?<div className="catalog-login">
                  <p className="provider-detail">{t("用量按 API 服务方规则计费，与 Claude 订阅额度分开。{0}", snapshot.claudeApiKeyConfigured?t("密钥已加密保存。"):'')}</p>
                  <label className="field compact">Anthropic API Key<input type="password" autoComplete="off" value={claudeApi} aria-label="Anthropic API Key" onChange={event=>setClaudeApi(event.target.value)}/></label>
                  <label className="field compact">{t("API 地址（可选）")}<input type="url" aria-label={t("Claude API 地址")} value={settings.claudeBaseUrl??''} placeholder={t("留空走官方 https://api.anthropic.com")} spellCheck={false} onChange={event=>setSettings(previous=>({...previous,claudeBaseUrl:event.target.value}))}/></label>
                  <p className="provider-detail">{t("填写兼容 Anthropic Messages API 的 HTTPS 根地址，例如 https://yunbay.xyz；留空使用官方服务。Claude Code 会自动追加 /v1/messages。使用中转站时，对话内容和 API Key 会发送给该服务。")}</p>
                  <button className="button secondary" disabled={!claudeApi.trim()||!snapshot.backendReady} onClick={()=>void saveClaudeApi(claudeApi)}>{t("加密保存 API Key")}</button>{snapshot.claudeApiKeyConfigured&&<button className="button quiet danger" onClick={()=>void saveClaudeApi('')}>{t("清除 API Key")}</button>}
                </div>:<p className="provider-detail">{t("由你自己通过官方 Claude Code 登录，使用你自己的 Claude 订阅。HiveLab 合屋 只是启动官方程序，不经手你的账号；请遵守 Anthropic 的条款。")}</p>}
              </>}
              {provider==='claude'&&<div className="claude-accounts">
                <p className="provider-detail">{t("同一个已安装的 Claude Code 可以接入多个账号：每条独立连接分别保存登录方式、密钥、模型和额度，程序不需要重复下载。")}</p>
                <NativeConnectionCreator id="claude" snapshot={snapshot} invoke={invoke} notify={notify}/>
              </div>}
              {provider === 'claude' && settings.claudeAuthMode!=='api' && <div className="token-login"><div className="token-login-heading"><strong>{t("长期令牌")}</strong>{snapshot.claudeTokenConfigured&&<span className="ready-text">{t("已保存")}</span>}</div>
                <p className="provider-detail">{t("粘贴 claude setup-token 生成的令牌后，不再依赖每天续期的浏览器登录。令牌由系统加密保存，优先于浏览器登录；清除后回到浏览器登录。")}</p>
                <div className="token-login-row">{snapshot.claudeTokenConfigured&&<button type="button" className="button small secondary" disabled={!snapshot.backendReady} onClick={() => void openTokenWindow()}><KeyRound size={12} />{t("浏览器重新登录")}</button>}
                  <input type="password" autoComplete="off" aria-label={t("Claude 长期令牌")} value={claudeToken} onChange={event => setClaudeToken(event.target.value)} placeholder={t("粘贴 sk-ant- 开头的令牌")} spellCheck={false} />
                  <button type="button" className="button small primary" disabled={!claudeToken.trim() || savingToken || !snapshot.backendReady} onClick={() => void saveClaudeToken(claudeToken.trim())}>{t("保存令牌")}</button>
                  {snapshot.claudeTokenConfigured && <button type="button" className="button small quiet danger" disabled={savingToken || !snapshot.backendReady} onClick={() => { if (window.confirm(t("清除 Claude 长期令牌？之后需要重新登录 Claude。"))) void saveClaudeToken(''); }}>{t("清除令牌")}</button>}</div></div>}
              {provider === 'claude' && settings.claudeAuthMode!=='api' && <div className="login-code"><label className="field compact">{t("粘贴官方授权码")}<input type="password" autoComplete="off" aria-label={t("Claude 官方授权码")} value={claudeLoginCode} onChange={event => setClaudeLoginCode(event.target.value)} placeholder={t("仅在官方网页显示授权码时填写")} spellCheck={false} /></label><button className="button small secondary" disabled={!claudeLoginCode.trim() || sendingLoginCode || !snapshot.backendReady} onClick={() => void sendClaudeLoginCode()}>{t("提交授权码")}</button><p className="provider-detail">{t("先点击登录。如果网页给出授权码，在这里粘贴；提交后立即清空，不写入对话和日志。")}</p></div>}
              {provider === 'dsh' && <label className="field compact">{t("DSH 独立后台配置")}<input value={settings.dshProfile} onChange={event => setSettings(previous => ({ ...previous, dshProfile: event.target.value }))} /></label>}
              {provider === 'dsh' && <p className="provider-detail">{t("使用独立 DSH 后台和独立账号登录，不需要桌面客户端运行，也不读取桌面登录凭据。点击登录后在官方浏览器页面授权一次。")}</p>}
              <div className="provider-check-time">{t("上次确认：{0}{1}", dateTime(info?.checkedAt), info?.stale ? t(" · 等待重新检测") : '')}{info?.authDirectory && <span> {t(" · 账号目录：{0}", info.authDirectory)}</span>} {t(" · 额度：{0}", provider==='claude'&&settings.claudeAuthMode==='api'?t("API 按用量计费"):info?.quota == null ? t("未提供") : t("已收到服务端信息"))}</div>
              {!(provider==='claude'&&settings.claudeAuthMode==='api')&&info?.quota != null && <details className="quota-details"><summary>{t("查看服务端额度信息")}</summary><pre>{typeof info.quota === 'string' ? info.quota : JSON.stringify(info.quota, null, 2)}</pre></details>}
            </section>
            </ConnectionCard>;
          })}
          {(snapshot.executors ?? []).map(executor => {
            const info = snapshot.providers.find(item => item.id === executor.id);
            const members = team.members.filter(member=>member.executor===executor.id);
            return <ConnectionCard key={executor.id} provider={executor.id} focused={initialFocus===executor.id} name={executor.name} members={members} status={providerSummary(info)} subtitle={connectionLabel(executor.id, executor)} ready={runnable(info)}>
              <AcpConnection executor={executor} info={info} snapshot={snapshot} invoke={invoke} notify={notify} settings={settings} setSettings={setSettings} />
            </ConnectionCard>;
          })}
          </div>
        </>}
        {tab === 'extensions' && <ExtensionSettings key="plugins" invoke={invoke} kind="plugin"/>}
        {tab === 'skills' && <ExtensionSettings key="skills" invoke={invoke} kind="skill"/>}
        {tab === 'profile' && <ProfileSettings snapshot={snapshot} invoke={invoke} />}
        {tab === 'permissions' && <PermissionSettings snapshot={snapshot} settings={settings} setSettings={setSettings} />}
        {tab === 'network' && <>
          <div className="settings-section-heading"><h3>{t("使用当前网络出口")}</h3></div>
          <p className="settings-description">{t("默认沿用你已经开启的 TUN，独立 CLI 和本机客户端使用相同的网络环境。")}</p>
          <label className={`network-option ${settings.networkMode === 'tun' ? 'selected' : ''}`}><input type="radio" checked={settings.networkMode === 'tun'} onChange={() => setSettings(previous => ({ ...previous, networkMode: 'tun' }))} /><span><strong>{t("沿用系统 TUN")}</strong><small>{t("无需另设代理地址。任务运行时请保持 TUN 开启。")}</small></span><Globe2 size={20} /></label>
          <label className={`network-option ${settings.networkMode === 'proxy' ? 'selected' : ''}`}><input type="radio" checked={settings.networkMode === 'proxy'} onChange={() => setSettings(previous => ({ ...previous, networkMode: 'proxy' }))} /><span><strong>{t("使用显式代理")}</strong><small>{t("工作台启动的成员程序都走这个代理。")}</small></span><Network size={20} /></label>
          {settings.networkMode === 'proxy' && <label className="field">{t("代理地址")}<input value={settings.proxyUrl} onChange={event => setSettings(previous => ({ ...previous, proxyUrl: event.target.value }))} placeholder="http://127.0.0.1:7897" spellCheck={false} /></label>}
          <div className="info-card"><Info size={17} /><p>{t("本地通信会绕过网络代理。订阅登录和真实调用仍需单独验证；HTTP 状态码不能代替完整的接入检查。")}</p></div>
          <button className="button small secondary settings-inline-action" disabled={Boolean(checking)} onClick={() => void probe()}><RefreshCw size={14} className={checking ? 'spin' : ''} />{t("保存并检查成员连接")}</button>
          <div className="settings-section-heading"><h3>{t("下载源")}</h3></div>
          <label className="field">{t("npm 下载源")}<select aria-label={t("npm 下载源")} value={settings.npmRegistry??'official'} onChange={event=>setSettings(previous=>({...previous,npmRegistry:event.target.value as 'official'|'npmmirror'}))}><option value="official">{t("npm 官方源")}</option><option value="npmmirror">{t("npmmirror 国内镜像")}</option></select><small>{t("镜像下载仍与官方包名及完整性记录核对；连接设置同时用于下载。")}</small></label>
        </>}
        {tab === 'workspace' && <>
          <PendingSettings snapshot={snapshot} invoke={invoke}/>
          <div className="settings-section-heading"><h3>{t("工作台设置")}</h3></div>
          <section className="settings-group"><h3>{t("显示与外观")}</h3><button type="button" className="button secondary small" onClick={()=>setTab('appearance')}><Palette size={14}/>{t("打开外观设置")}</button><small>{t("主题、侧栏、各页面背景、聊天外观和首页立绘在“外观”中统一调整。")}</small></section>
          <section className="settings-group" aria-label={t("对话")}>
            <DiscussionCallSettings settings={settings} onChange={limits=>setSettings(previous=>({...previous,discussionCallLimits:limits}))}/>
          </section>
          <section className="settings-group" aria-label={t("提醒")}><h3>{t("提醒")}</h3>
            <label className="toggle-row"><span><strong>{t("成员完成或需要你时通知我")}</strong><small>{t("任务完成、等待回答或授权、发生错误时提醒。前台显示消息卡片，后台弹出系统通知并闪烁任务栏图标；点击可进入对应对话。只影响这台电脑，立即生效。")}</small></span><input type="checkbox" checked={notify_} onChange={event => toggleNotifications(event.target.checked)} /></label>
          </section>
          <section className="settings-group" aria-label={t("任务运行")}><h3>{t("任务运行")}</h3>
            <div className="settings-field-grid">
              <label className="field">{t("同时执行的任务数量")}<input type="number" min="1" max="8" value={settings.maxParallel} onChange={event => setSettings(previous => ({ ...previous, maxParallel: Number(event.target.value) || 1 }))} /><small>{t("并行任务会共用各成员账号的额度。")}</small></label>
              <label className="field">{t("单个任务最长运行时间（分钟）")}<input type="number" min="0" max="1440" value={settings.maxRunMinutes ?? 0} onChange={event => setSettings(previous => ({ ...previous, maxRunMinutes: Math.min(1440, Math.max(0, Number(event.target.value) || 0)) }))} /><small>{t("设为 0 表示不限时长（含等待审批）；正数则到期请求停止并核对执行状态。")}</small></label>
              <label className="field">{t("停止等待时间（秒）")}<input type="number" min="1" max="60" value={settings.stopTimeoutMs / 1000} onChange={event => setSettings(previous => ({ ...previous, stopTimeoutMs: (Number(event.target.value) || 10) * 1000 }))} /><small>{t("超时后工作台会停下这一轮并清理残留程序，结果标为待核对。")}</small></label>
            </div>
            <label className="toggle-row"><span><strong>{t("新会话默认允许修改文件")}</strong><small>{t("写入任务使用独立工作区。已有会话的权限保持不变。")}</small></span><input type="checkbox" checked={settings.defaultWriteMode} onChange={event => setSettings(previous => ({ ...previous, defaultWriteMode: event.target.checked }))} /></label>
          </section>
          <section className="settings-group" aria-label={t("执行端运行环境")}><h3>{t("执行端运行环境")}</h3>
            <p className="settings-description">{t("当前：{0}。npm 随工作台安装。", nodeInfo?.source==='local'?t("本机 Node.js {0}", nodeInfo.version):t("HiveLab 合屋 自带 Node.js {0}", nodeInfo?.version??t("检查中")))}</p>
            {nodeInfo?.local&&<label className="field">{t("运行环境")}<select aria-label={t("执行端运行环境")} value={settings.nodeRuntime??'bundled'} onChange={event=>setSettings(previous=>({...previous,nodeRuntime:event.target.value as 'bundled'|'local'}))}><option value="bundled">{t("HiveLab 合屋 自带（默认）")}</option><option value="local" disabled={!nodeInfo.local.available}>{t("本机 Node.js {0}", nodeInfo.local.version)}</option></select></label>}
            <small className="settings-note">{nodeInfo?.local?.detail??nodeInfo?.detail??t("无需另装 Node.js。DSH 原生加载器不兼容时才使用经校验的官方便携备用环境。")}</small>
            <ThirdPartyLicenses invoke={invoke}/>
          </section>
          <section className="settings-group" aria-label={t("版本与本地数据")}><h3>{t("版本与本地数据")}</h3>
            <RunningVersionCard invoke={invoke} notify={notify} />
            <div className="field">{t("本地记录位置")}<code className="data-directory">{snapshot.dataDirectory || t("后端连接后显示")}</code><small>{t("会话、任务状态和产物引用保存在本机。关闭窗口后可在托盘继续运行；退出应用会停止工作台任务。")}</small></div>
            <div><button className="button secondary small" onClick={() => void exportDiagnostics()}><Download size={14} />{t("导出诊断记录")}</button></div>
          </section>
          <section className="settings-group" aria-label={t("存储与备份")}><h3>{t("存储与备份")}</h3><button type="button" className="button secondary small" onClick={()=>setTab('storage')}><HardDrive size={14}/>{t("打开存储管理")}</button><small>{t("空间占用、执行端程序卸载、工位文件与话题清理、备份都在“存储”中。")}</small></section>
        </>}
        {tab === 'storage' && <>
          <div className="settings-section-heading"><h3>{t("存储")}</h3><small>{t("查看空间占用，清理程序、工位文件、话题和旧副本")}</small></div>
          <StorageSettings snapshot={snapshot} invoke={invoke} notify={notify} onBackupBusy={setBackupBusy} onRestored={onClose} onNavigate={next=>{setTab(next);setEditing(null);}} />
        </>}
        {tab === 'personas' && <>
          <div className="settings-section-heading"><h3>{t("人物设定")}</h3><small>{t("各位成员的性格、人设和说话风格，单独保存为 Markdown 文件")}</small></div>
          <PersonaEditor snapshot={snapshot} invoke={invoke} notify={notify} />
        </>}
        {tab === 'covenant' && <>
          <div className="settings-section-heading"><h3>{t("工作公约")}</h3><small>{t("全体成员遵守的协作规范，开始工作前自动加载")}</small></div>
          <CovenantEditor invoke={invoke} userTitle={settings.persona?.userTitle} />
        </>}
      </div>
    </div>
    {tab==='language'?<div className="modal-footer"><span className="save-note">{t("语言切换即时生效，已自动保存。")}</span><button type="button" className="button primary" onClick={onClose}>{t("完成")}</button></div>:tab==='appearance'?<div className="modal-footer"><span className="save-note">{t("外观修改即时生效，已自动保存在本机。")}</span><button type="button" className="button primary" onClick={onClose}>{t("完成")}</button></div>:tab === 'storage' ? <div className="modal-footer"><span className="save-note">{t("存储中的操作会立即执行，无需保存设置。")}</span><button type="button" className="button primary" onClick={onClose}>{t("完成")}</button></div>:tab === 'personas' ? <div className="modal-footer"><span className="save-note">{t("人物设定保存后，从下一轮对话开始生效。")}</span><button type="button" className="button primary" onClick={onClose}>{t("完成")}</button></div>:tab === 'covenant' ? <div className="modal-footer"><span className="save-note">{t("公约保存后，从下一轮任务开始时加载。")}</span><button type="button" className="button primary" onClick={onClose}>{t("完成")}</button></div> : tab === 'extensions' || tab === 'skills' ? <div className="modal-footer"><span className="save-note">{t("扩展更改独立保存，下次任务生效。")}</span><button className="button primary" onClick={onClose}>{t("关闭")}</button></div> : tab === 'members' && editing ? <div className="modal-footer card-editor-footer" ref={setCardActions} /> : <div className="modal-footer"><span className="save-note"><LockKeyhole size={12} />{t("人物卡和个人资料有各自的保存按钮")}</span><button className="button quiet" disabled={backupBusy} onClick={onClose}>{t("取消")}</button><button className="button primary" disabled={busy || backupBusy || !snapshot.backendReady} onClick={() => void save()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{snapshot.runs.some(run=>['running','waiting_user','stopping'].includes(run.status)&&!run.completedAt)?t("空闲后保存设置"):t("保存设置")}</button></div>}
    {deletingProvider&&<DeleteConnectionDialog builtin executor={{id:deletingProvider,name:PROVIDER_NAMES[deletingProvider]}} users={team.members.filter(member=>member.executor===deletingProvider).map(member=>member.name)} invoke={invoke} onClose={()=>setDeletingProvider(undefined)} onDeleted={()=>{setSettings(previous=>({...previous,paths:{...previous.paths,[deletingProvider]:undefined}}));if(manualProvider===deletingProvider)setManualProvider(undefined);setDeletingProvider(undefined);}}/>}
  </Modal>;
}

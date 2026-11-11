import {t} from '../i18n';
import {useCallback, useEffect, useRef, useState} from "react";
import {LoaderCircle, RefreshCw, Trash2} from "lucide-react";
import {PROVIDER_NAMES} from "../../shared/defaults";
import type {ProviderId, ProviderInfo} from "../../shared/types";
import {newerVersion, type MemberVersions, type MemberInstallation} from "../../shared/member-versions";
import {effectiveConfigText} from "../../shared/executor-config";
import {useTicker, type Invoke} from "../ui";
const SOURCE_LABELS: Record<MemberVersions['source'], string> = { get hivelab(){return t("HiveLab 合屋 管理的版本")}, get custom(){return t("设置中指定的程序路径")}, get global(){return t("全局安装（会随你在终端的更新而变化）")}, get bundled(){return t("HiveLab 合屋 内置版本")} };

const INSTALL_PHASES:Record<MemberInstallation['phase'],string>={get installing(){return t("下载并安装")},get files(){return t("检查安装文件")},get launch(){return t("检查程序启动")},get connection(){return t("检查账号与连接")}};

export function VersionPanel({ provider, info, available, invoke, installing, onInstall, onSelectedPath }: { provider: ProviderId; info?:ProviderInfo; available:boolean; invoke: Invoke; installing?: { version: string; startedAt: number }; onInstall: (version: string | null) => void; onSelectedPath: (path: string | null) => void }) {
  const [state, setState] = useState<MemberVersions>();
  const [progress,setProgress]=useState<MemberInstallation>();
  const [readError,setReadError]=useState('');
  const [busy, setBusy] = useState<'check' | 'switch' | 'remove' | null>(null);
  const request=useRef(0);
  const installation=progress??state?.installation;
  const ongoing=Boolean(installing||installation);
  const now = useTicker(ongoing);
  const load = useCallback(async (checkLatest = false) => {
    if(!available)return;
    const ticket=++request.current;
    try {
      const next=await invoke<MemberVersions>('member.versions', { provider, checkLatest },undefined,{background:!checkLatest});setReadError('');
      setState(previous=>ticket===request.current?{...next,...(!checkLatest?{latest:previous?.latest,latestError:previous?.latestError}:{})}:checkLatest&&previous?{...previous,latest:next.latest,latestError:next.latestError}:previous);
    } catch {setReadError(t("版本状态暂未更新，请稍后重试。"));}
  }, [invoke, provider,available]);
  useEffect(() => { void load(false); }, [load, installing?.version,info?.checkedAt,info?.stale,info?.compatibility?.id,info?.lastRunCompatibility?.id,info?.lastRunCompatibility?.completedAt]);
  useEffect(()=>{
    if(!available||!ongoing)return;
    let cancelled=false,pending=false;
    const poll=async()=>{
      if(pending)return;pending=true;
      try{
        const next=await invoke<MemberInstallation|undefined>('member.installation',{provider},undefined,{background:true});
        if(cancelled)return;
        setProgress(next);setState(previous=>previous?.installation?{...previous,installation:next}:previous);
        if(!next&&!installing)void load(false);
      }catch{}finally{pending=false;}
    };
    void poll();const timer=setInterval(()=>void poll(),2000);
    return()=>{cancelled=true;clearInterval(timer);};
  },[available,ongoing,Boolean(installing),invoke,provider,load]);
  useEffect(()=>()=>{request.current++;},[]);
  async function run(kind: 'check' | 'switch' | 'remove', action: () => Promise<unknown>) {
    setBusy(kind); try { await action(); } catch {} finally { setBusy(null); }
  }
  // Nothing to show until the backend reports an actual version state.
  if (!state || !Array.isArray(state.installed)) return readError?<p className="provider-detail" role="status">{readError}</p>:null;
  const currentVersion = state.current?.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/)?.[0];
  const offered = state.latest ?? info?.updateVersion;
  const newer = offered && newerVersion(offered, currentVersion) ? offered : undefined;
  const locked = Boolean(busy || ongoing || !available || info?.installationRequired);
  async function install(version: string) {
    onInstall(version);
    try {
      const next = await invoke<MemberVersions>('member.install', { provider, version });
      request.current++;setState(previous=>({...next,latest:previous?.latest,latestError:previous?.latestError}));
      if (!next.installedOnly) onSelectedPath(next.selectedPath);
    } catch {} finally { onInstall(null);setProgress(undefined);setState(previous=>previous?{...previous,installation:undefined}:previous);void load(false); }
  }
  const removable = state.installed.filter(version => version !== state.activeVersion);
  const elapsed = ongoing ? Math.max(0, Math.round((now - (installation?Date.parse(installation.startedAt):installing!.startedAt)) / 1000)) : 0;
  const phase=installation?.phase??'installing';
  const slow=installation?.phase==='installing'&&now-Date.parse(installation.lastProgressAt??installation.phaseStartedAt)>90_000;
  const connection=state.connection;
  const runProblem=state.lastRun&&['failed','unknown'].includes(state.lastRun.outcome);
  const status=connection.state==='failed'?t("连接检查未通过"):connection.state==='stale'?t("等待重新确认"):connection.state==='unchecked'?t("待检查连接"):runProblem?(state.lastRun!.outcome==='unknown'?t("运行结果待核对"):t("最近运行失败")):state.successfulUse?t("本版本已成功使用"):t("连接检查通过");
  const fixedVersion=currentVersion??state.baselineVersions.at(-1);
  return <div className="version-panel">
    {readError&&<p className="provider-detail" role="status">{readError}</p>}
    <div className="version-row"><span className="permission-label">{t("版本")}</span>
      <span className="version-current">{currentVersion ?? t("未检测")} <span className={`version-badge ${connection.state==='failed'||runProblem?'warn':connection.state==='connected'?'ok':'neutral'}`}>{status}</span></span>
      <button className="button small quiet" disabled={locked} onClick={() => void run('check', () => load(true))}>{busy === 'check' ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}{t("检查更新")}</button>
    </div>
    <small className="version-note">{t("{0}。HiveLab 合屋 会定期检查新版本，但不会自动更新成员，只在你点击后安装。", SOURCE_LABELS[state.source])}</small>
    {connection.state==='failed'&&<small className="version-note error">{connection.detail}</small>}
    {runProblem&&state.lastRun?.error&&<small className="version-note error">{t("最近运行：{0}", state.lastRun.error)}</small>}
    {ongoing && <div className="install-progress" role="status"><div className="install-progress-bar"><span /></div><span>{INSTALL_PHASES[phase]} {installation?.version??installing?.version} {t(" · 已用 {0} 分 {1} 秒", Math.floor(elapsed / 60), elapsed % 60)}{phase==='installing'&&installation?.writtenBytes?t(" · 已展开 {0} MB", (installation.writtenBytes/1024/1024).toFixed(1)):''}。{slow?t("文件暂时没有增长，正在等待下载或安装工具回应。"):''}{phase==='installing'?t("下载与安装最多等待 15 分钟。"):t("检查通过后切换版本。")}{t("关闭设置也会继续。")}</span></div>}
    {state.latestError && <small className="version-note error">{state.latestError}</small>}
    {state.detail && <small className="version-note">{state.detail}</small>}
    {state.latest && !newer && <small className="version-note">{t("已是最新版本（{0}）。", state.latest)}</small>}
    {newer && !ongoing && <div className="version-update">
      <span>{t("可更新到 ")}<strong>{newer}</strong></span>
      <button className="button small secondary" disabled={locked} onClick={() => void install(newer)}>{t("更新到 {0}", newer)}</button>
    </div>}
    {(state.installed.length > 0 || state.source !== 'bundled') && <div className="version-row">
      <span className="permission-label">{t("切换")}</span>
      <select value={state.activeVersion ?? ''} disabled={locked} onChange={event => { const version = event.target.value; void run('switch', async () => { const next = await invoke<MemberVersions>('member.use', { provider, version: version || null }, t("已切换版本。")); request.current++;setState(previous=>({...next,latest:previous?.latest,latestError:previous?.latestError})); onSelectedPath(next.selectedPath); }); }}>
        <option value="">{provider === 'claude' ? t("全局安装的 Claude") : t("内置版本")}</option>
        {state.installed.map(version => <option key={version} value={version}>{version}</option>)}
      </select>
    </div>}
    {removable.length > 0 && <details className="version-remove"><summary>{t("清理旧版本（{0}）", removable.length)}</summary>{removable.map(version => <div className="version-row" key={version}><span>{version}</span><button className="button small quiet danger" disabled={locked} onClick={() => { if (window.confirm(t("删除 HiveLab 合屋 管理的 {0} {1} 的程序目录及依赖？聊天记录和登录配置会保留，后续回复使用当前版本。", PROVIDER_NAMES[provider], version))) void run('remove', async () => setState(await invoke<MemberVersions>('member.remove', { provider, version }, t("已删除 {0}。", version)))); }}><Trash2 size={12} />{t("删除")}</button></div>)}</details>}
    {provider === 'claude' && state.source === 'global' && fixedVersion && !ongoing && <small className="version-note">{t("可以安装一份 HiveLab 合屋 管理的 Claude（{0}），之后终端里的更新不会影响 HiveLab 合屋。", fixedVersion)}<button className="link-button" disabled={locked} onClick={() => void install(fixedVersion)}>{t("安装并固定")}</button></small>}
    <details className="version-diagnostics"><summary>{t("版本诊断与使用记录")}</summary>
      <small className="version-note">{t("兼容基线：{0}。基线用于排查问题，当前状态以实际检查和运行记录为准。", state.baselineVersions.join('、')||t("暂无"))}</small>
      {connection.checkedAt&&<small className="version-note">{t("连接确认：{0}", new Date(connection.checkedAt).toLocaleString())}</small>}
      {state.successfulUse&&<><small className="version-note">{t("本版本最近成功使用：{0}。记录对应这一次任务。", new Date(state.successfulUse.completedAt).toLocaleString())}</small><small className="version-note">{effectiveConfigText(state.successfulUse.requestedConfig,state.successfulUse.effectiveConfig)}</small></>}
    </details>
  </div>;
}

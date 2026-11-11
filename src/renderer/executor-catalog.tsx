import {t} from './i18n';
import { useCallback, useEffect, useState } from 'react';
import { Download, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { CATALOG_REVISION, EXECUTOR_CATALOG, catalogEntry, catalogProvider, type CatalogId, type CatalogStatus, type NodeRuntimeInfo, type CatalogLoginState } from '../shared/executor-catalog';
import type { AcpExecutor, PermissionMember, Snapshot } from '../shared/types';
import { newerVersion, type MemberInstallation } from '../shared/member-versions';
import { AcpFields, emptyAcpDraft } from './executors';
import { ApiModelPicker } from './api-model-picker';
import type { Invoke, Notify } from './ui';

const PHASES={get installing(){return t("下载与安装")},get files(){return t("校验安装文件")},get launch(){return t("检查程序启动")},get connection(){return t("检查连接与登录状态")}};
type CatalogReply={revision:string;items:CatalogStatus[];node:NodeRuntimeInfo};
const catalogReads=new WeakMap<Invoke,Map<string,Promise<CatalogReply>>>();
function readCatalog(invoke:Invoke,executorId?:string){let reads=catalogReads.get(invoke);if(!reads){reads=new Map();catalogReads.set(invoke,reads);}const key=executorId??'',pending=reads.get(key);if(pending)return pending;const task=invoke<CatalogReply>('catalog.list',{executorId},undefined,{background:true}).finally(()=>{if(reads!.get(key)===task)reads!.delete(key);});reads.set(key,task);return task;}
const loginReads=new WeakMap<Invoke,Map<string,Promise<CatalogLoginState|undefined>>>();
function readLoginStatus(invoke:Invoke,id:string){
  let reads=loginReads.get(invoke);if(!reads){reads=new Map();loginReads.set(invoke,reads);}
  const existing=reads.get(id);if(existing)return existing;
  const task=invoke<CatalogLoginState|undefined>('executor.loginStatus',{id},undefined,{background:true}).finally(()=>{if(reads!.get(id)===task)reads!.delete(id);});reads.set(id,task);return task;
}
export function ExecutorCatalog({snapshot,invoke,notify,beforeOperation,onSelected,onNewMember}:{snapshot:Snapshot;invoke:Invoke;notify:Notify;beforeOperation:()=>Promise<void>;onSelected:(item:CatalogStatus)=>void;onNewMember:(provider:PermissionMember)=>void}){
  const [view,setView]=useState<'closed'|'catalog'|'manual'>(!snapshot.providers.some(item=>item.path)?'catalog':'closed'),[items,setItems]=useState<CatalogStatus[]>(()=>EXECUTOR_CATALOG.map(entry=>({entry,provider:catalogProvider(entry.id),installed:[],configured:false,consented:false}))),[selected,setSelected]=useState<CatalogId>(),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[progressError,setProgressError]=useState('');
  const [version,setVersion]=useState(''),[agree,setAgree]=useState(false),[busy,setBusy]=useState(''),[progress,setProgress]=useState<MemberInstallation>(),[result,setResult]=useState('');
  const [draft,setDraft]=useState(emptyAcpDraft);
  const reload=useCallback(async()=>{setLoading(true);setLoadError('');try{const value=await invoke<CatalogReply>('catalog.list',undefined,undefined,{background:true});if(!value||!Array.isArray(value.items))throw new Error(t("执行端清单暂未返回。"));setItems(value.items);return value.items;}catch(error){setLoadError((error as Error).message);throw error;}finally{setLoading(false);}},[invoke]);
  useEffect(()=>{if(view==='catalog')void reload().catch(()=>{});},[view,reload]);
  useEffect(()=>{
    if(!selected||busy!=='install')return;
    let live=true,pending=false;setProgressError('');const check=async()=>{if(pending)return;pending=true;try{const value=await invoke<MemberInstallation|undefined>('catalog.installation',{id:selected},undefined,{background:true});if(live){setProgress(value);setProgressError('');}}catch{if(live)setProgressError(t("暂时无法读取进度，下载可能仍在继续；正在等待下一次状态更新。"));}finally{pending=false;}};void check();const timer=setInterval(()=>void check(),1500);return()=>{live=false;clearInterval(timer);};
  },[selected,busy,invoke]);
  const item=items.find(item=>item.entry.id===selected),entry=item?.entry,provider=item?.provider;
  const choose=(id:CatalogId)=>{setSelected(id);setVersion(EXECUTOR_CATALOG.find(item=>item.id===id)!.recommendedVersion);setAgree(false);setResult('');setProgress(undefined);};
  async function action(kind:'install'|'use'|'remove'|'latest',chosen=version){
    if(!selected)return;setBusy(kind);setResult('');
    try{
      await beforeOperation();
      if(kind==='latest'){const latest=await invoke<{version:string}>('catalog.latest',{id:selected});setVersion(latest.version);setResult(t("最新版本 {0}，下载前仍会校验并检查连接。", latest.version));}
      else{
        const value=await invoke<CatalogStatus>(`catalog.${kind}`,{id:selected,version:chosen,agree,revision:CATALOG_REVISION});
        if(kind!=='remove')onSelected(value);
        await reload();setResult(kind==='remove'?t("该版本已删除。"):t("程序已配置。下一步请在下方连接卡片里登录；连接检查没有发送模型任务。"));
      }
    }catch(error){setResult((error as Error).message);}finally{setBusy('');setProgress(undefined);}
  }
  async function manual(){setBusy('manual');try{const saved=await invoke<AcpExecutor>('executor.save',{executor:draft});setDraft(emptyAcpDraft);setView('closed');notify(t("连接已添加，可以创建人物卡。"));onNewMember(saved.id);}catch{}finally{setBusy('');}}
  const info=snapshot.providers.find(info=>info.id===provider),executor=snapshot.executors?.find(executor=>executor.id===provider);
  return <section className="catalog-settings" data-provider="catalog" aria-label={t("添加执行端")}>
    <div className="settings-section-heading"><h3>{t("添加执行端")}</h3></div>
    <p className="settings-description">{t("选择官方程序，下载到 HiveLab 合屋 后再登录。已有安装可以继续使用。")}</p>
    <div className="catalog-actions"><button className="button secondary" onClick={()=>setView(view==='catalog'?'closed':'catalog')} disabled={!!busy}><Download size={14}/>{t("从清单添加")}</button><button className="button quiet" onClick={()=>setView(view==='manual'?'closed':'manual')} disabled={!!busy}><Plus size={14}/>{t("手动添加")}</button></div>
    {view==='manual'&&<div className="catalog-detail"><AcpFields value={draft} onChange={setDraft} invoke={invoke}/><button className="button primary" disabled={!!busy||!snapshot.backendReady||!draft.command.trim()||!draft.name.trim()} onClick={()=>void manual()}>{t("保存连接并创建人物卡")}</button></div>}
    {view==='catalog'&&<div className="catalog-detail">
      {loading&&<p className="provider-detail" role="status">{t("正在读取已安装版本…")}</p>}{loadError&&<p className="provider-detail" role="status">{loadError}<button className="link-button" onClick={()=>void reload().catch(()=>{})}>{t("重新读取清单")}</button></p>}
      <div className="catalog-grid" role="group" aria-label={t("官方执行端清单")}>{items.map(item=><button key={item.entry.id} className={`catalog-choice ${selected===item.entry.id?'selected':''}`} disabled={!!busy} onClick={()=>choose(item.entry.id)}><strong>{item.entry.name}</strong><small>{item.entry.vendor} · {item.entry.license}</small><small>{item.selectedVersion?t("正在使用 {0}", item.selectedVersion):item.configured?t("已有连接"):t("推荐 {0}", item.entry.recommendedVersion)}</small></button>)}</div>
      {entry&&item&&<>
        <h4>{entry.name} · {entry.vendor}</h4>
        <p><a href={entry.homepage} onClick={event=>{event.preventDefault();void invoke('catalog.openLink',{id:entry.id,kind:'homepage'}).catch(()=>{});}}>{t("官方主页")}</a> · <a href={entry.licenseUrl} onClick={event=>{event.preventDefault();void invoke('catalog.openLink',{id:entry.id,kind:'licenseUrl'}).catch(()=>{});}}>{t("{0} 许可证", entry.license)}</a> · <a href={entry.termsUrl} onClick={event=>{event.preventDefault();void invoke('catalog.openLink',{id:entry.id,kind:'termsUrl'}).catch(()=>{});}}>{t("厂商条款")}</a></p>
        <p className="provider-detail">{entry.capabilities.join(' · ')}。{entry.limitations.join(' ')}</p>
        <p className="provider-detail">{t("{0}；已通过隔离连接检查的版本：{1}。真实账号调用需另行验收。", entry.id==='antigravity'?t("运行环境：Google 官方原生程序，无需单独安装 Node.js"):entry.id==='cursor'?t("运行环境：官方包自带 Node.js"):t("最低 Node.js：{0}", entry.minimumNode), entry.verifiedVersions.join('、')||t("本版尚无记录"))}</p>
        <p className="provider-detail">{t("登录方式：{0}。{1}", entry.authentication.map(item=>item.label).join(' / '), entry.distribution==='antigravity-official'?t("安装来源：Google 官方 ACP 完整发行包；校验 SHA-256 与 Google 签名，登录状态按连接隔离。"):entry.distribution==='zcode-official'?t("安装来源：ZCode 官方 Windows 发行包；下载后核对官方 SHA-512。"):entry.distribution==='qoder-official'?t("安装来源：Qoder 官方原生 Windows 发行包；下载后核对官方 SHA-256。"):entry.distribution==='cursor-official'?t("安装来源：Cursor 官方 Windows 发行包；独立保存运行环境并核对安装文件清单。"):t("安装来源：{0}；当前下载源：{1}。", entry.packageName, snapshot.settings.npmRegistry==='npmmirror'?t("npmmirror（与官方完整性记录核对）"):t("npm 官方源")))}</p>
        <label className="catalog-consent"><input type="checkbox" checked={agree} onChange={event=>setAgree(event.target.checked)} disabled={!!busy}/>{t("我已了解并同意该厂商条款")}</label>
        <label className="field compact">{t("下载版本")}<input aria-label={t("执行端下载版本")} value={version} onChange={event=>setVersion(event.target.value)} disabled={!!busy}/></label>
        <div className="catalog-actions"><button className="button primary" disabled={loading||!!loadError||!!busy||!agree||!snapshot.backendReady||!version.trim()} onClick={()=>void action('install')}>{busy==='install'?<LoaderCircle className="spin" size={14}/>:<Download size={14}/>}{t("下载并自动配置")}</button><button className="button quiet" disabled={loading||!!loadError||!!busy||!snapshot.backendReady} onClick={()=>void action('latest')}><RefreshCw size={14}/>{t("检查新版本")}</button></div>
        {busy==='install'&&<div className="install-progress" role="status"><div className="install-progress-bar"><span/></div><p>{PHASES[progress?.phase??'installing']} {version}{progress?.writtenBytes?t(" · 已展开 {0} MB", (progress.writtenBytes/1048576).toFixed(1)):''}。{progress?.detail}{t("关闭设置也会继续，下载最多等待 15 分钟。")}</p></div>}
        {result&&<p role="status" className="provider-detail">{result}</p>}
        {busy==='install'&&progressError&&<p role="status" className="provider-detail">{progressError}</p>}
        {item.configured&&<>
          <p className="provider-detail" role="status">{t("程序已配置。下一步请在下方“连接、模型与版本”里这个程序的连接卡片中登录或填写密钥。{0}", info?.detail?t(" 当前状态：{0}", info.detail):'')}</p>
          {!executor&&entry.id==='claude'&&<NativeConnectionCreator id={entry.id} snapshot={snapshot} invoke={invoke} notify={notify} onCreated={connection=>onNewMember(connection.id as PermissionMember)}/>}
          <button className="button secondary" disabled={!!busy||!snapshot.backendReady} onClick={()=>onNewMember(provider as PermissionMember)}><Plus size={14}/>{t("用这个执行端创建人物卡")}</button>
        </>}
        <h4>{t("版本管理")}</h4>
        {item.installed.length?item.installed.map(installed=><div className="catalog-version" key={installed}><span>{installed}{item.selectedVersion===installed?t(" · 正在使用"):''}</span><button className="button small secondary" disabled={!!busy||installed===item.selectedVersion||!snapshot.backendReady||!agree&&!item.consented} onClick={()=>void action('use',installed)}>{t("切换 / 回退")}</button><button className="button small quiet danger" disabled={!!busy||installed===item.selectedVersion||!snapshot.backendReady} onClick={()=>{if(window.confirm(t("删除 {0} {1} 的程序文件？聊天记录和登录配置会保留，后续回复使用当前版本。", entry.name, installed)))void action('remove',installed);}}><Trash2 size={12}/>{t("删除版本")}</button></div>):<p className="provider-detail">{t("尚未下载托管版本。手动添加的连接保持原样。")}</p>}
        {item.installed.length>0&&<p className="provider-detail">{t("不再需要整个程序时，可在“设置 → 存储”中卸载。")}</p>}
      </>}
    </div>}
  </section>;
}
export function CatalogConnectionCreator({executor,snapshot,invoke,notify,onCreated}:{executor:AcpExecutor;snapshot:Snapshot;invoke:Invoke;notify:Notify;onCreated?:(executor:AcpExecutor)=>void}){
  const entry=catalogEntry(executor.catalogId),current=entry.authentication.find(item=>item.id===executor.authentication);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [authentication,setAuthentication]=useState(()=>entry.authentication.find(item=>item.kind!==current?.kind)?.id??entry.authentication[0].id);
  const [name,setName]=useState(()=>`${entry.name} · ${entry.authentication.find(item=>item.id===authentication)!.label}`.slice(0,40));
  async function create(){setBusy(true);setError('');try{
    const saved=await invoke<AcpExecutor>('catalog.connection.create',{id:entry.id,sourceId:executor.id,name,authentication});
    onCreated?.(saved);setOpen(false);
    notify(onCreated?t("独立连接已创建并选中，保存人物卡后生效；请在“连接与版本”中完成该连接的登录。"):t("独立连接已添加，请在新连接中完成登录，再在人物卡中选择它。"));
  }catch(error){setError((error as Error).message);}finally{setBusy(false);}}
  return <div className="catalog-connection-create">
    <button type="button" className="button small secondary" disabled={busy||!snapshot.backendReady} aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Plus size={13}/>{t("新增独立连接")}</button>
    {open&&<div className="catalog-detail" role="group" aria-label={t("新增独立连接")}>
      <p className="provider-detail">{t("共用已安装的程序，登录、密钥、模型和额度各自保存。已有连接继续保留。")}</p>
      <label className="field compact">{t("连接名称")}<input aria-label={t("独立连接名称")} maxLength={40} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label>
      <label className="field compact">{t("登录方式")}<select aria-label={t("独立连接登录方式")} value={authentication} disabled={busy} onChange={event=>{setAuthentication(event.target.value);setName(`${entry.name} · ${entry.authentication.find(item=>item.id===event.target.value)!.label}`.slice(0,40));}}>{entry.authentication.map(auth=><option key={auth.id} value={auth.id}>{auth.label}</option>)}</select></label>
      {error&&<p className="provider-detail" role="alert">{error}</p>}
      <div className="catalog-actions"><button type="button" className="button secondary" disabled={busy||!name.trim()||!snapshot.backendReady} onClick={()=>void create()}>{busy?<LoaderCircle className="spin" size={13}/>:<Plus size={13}/>}{t("保存独立连接")}</button><button type="button" className="button quiet" disabled={busy} onClick={()=>setOpen(false)}>{t("取消")}</button></div>
    </div>}
  </div>;
}
/** A built-in program (Claude, Codex, DSH) keeps its first connection in the workbench settings and has no
 *  executor row of its own. Additional accounts share the installed program and only their login and key differ. */
export function NativeConnectionCreator({id,snapshot,invoke,notify,onCreated}:{id:CatalogId;snapshot:Snapshot;invoke:Invoke;notify:Notify;onCreated?:(executor:AcpExecutor)=>void}){
  const entry=catalogEntry(id);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const existing=snapshot.settings.claudeAuthMode;
  const [authentication,setAuthentication]=useState(()=>entry.authentication.find(item=>item.id!==existing)?.id??entry.authentication[0].id);
  const [name,setName]=useState(()=>`${entry.name} · ${entry.authentication.find(item=>item.id===authentication)!.label}`.slice(0,40));
  async function create(){setBusy(true);setError('');try{
    const saved=await invoke<AcpExecutor>('catalog.connection.create',{id:entry.id,name,authentication});
    onCreated?.(saved);setOpen(false);
    notify(t("独立连接已添加，请在“连接与版本”中完成这个账号的登录；程序不需要重复下载。"));
  }catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  return <div className="catalog-connection-create">
    <button type="button" className="button small secondary" disabled={busy||!snapshot.backendReady} aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Plus size={13}/>{t("新增独立连接")}</button>
    {open&&<div className="catalog-detail" role="group" aria-label={t("新增独立连接")}>
      <p className="provider-detail">{t("共用已安装的 {0}，登录方式、密钥、模型和额度各自保存。原来的连接继续保留。", entry.name)}</p>
      <label className="field compact">{t("连接名称")}<input aria-label={t("独立连接名称")} maxLength={40} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label>
      <label className="field compact">{t("登录方式")}<select aria-label={t("独立连接登录方式")} value={authentication} disabled={busy} onChange={event=>{setAuthentication(event.target.value);setName(`${entry.name} · ${entry.authentication.find(item=>item.id===event.target.value)!.label}`.slice(0,40));}}>{entry.authentication.map(auth=><option key={auth.id} value={auth.id}>{auth.label}</option>)}</select></label>
      {error&&<p className="provider-detail" role="alert">{error}</p>}
      <div className="catalog-actions"><button type="button" className="button secondary" disabled={busy||!name.trim()||!snapshot.backendReady} onClick={()=>void create()}>{busy?<LoaderCircle className="spin" size={13}/>:<Plus size={13}/>}{t("保存独立连接")}</button><button type="button" className="button quiet" disabled={busy} onClick={()=>setOpen(false)}>{t("取消")}</button></div>
    </div>}
  </div>;
}
export function CatalogLogin({executor,snapshot,invoke,notify}:{executor:AcpExecutor;snapshot:Snapshot;invoke:Invoke;notify:Notify}){
  const entry=catalogEntry(executor.catalogId);
  const [authId,setAuthId]=useState(executor.authentication??(entry.id==='zcode'?'zai':entry.authentication[0].id)),[key,setKey]=useState(''),[model,setModel]=useState(executor.env.GLM_MODEL??executor.env.OPENAI_MODEL??executor.env.KIMI_MODEL_NAME??executor.model??''),[baseUrl,setBaseUrl]=useState(executor.env.OPENAI_BASE_URL??executor.env.ANTHROPIC_BASE_URL??''),[busy,setBusy]=useState(false);
  const auth=entry.authentication.find(item=>item.id===authId)!;
  const allModelOptions=authId===executor.authentication?snapshot.providers.find(info=>info.id===executor.id)?.modelOptions??[]:[];
  const modelOptions=entry.id==='opencode'?allModelOptions.filter(option=>option.id.startsWith(authId+'/')):allModelOptions;
  const [customModel,setCustomModel]=useState(false);
  // Connections that name a service address can be asked for their model list.
  const canListModels=auth.kind==='api'&&!!(entry.modelConfiguration?.baseUrlEnvironment||Object.keys(auth.environment??{}).some(name=>/BASE_URL$/.test(name)));
  useEffect(()=>{setAuthId(executor.authentication??(entry.id==='zcode'?'zai':entry.authentication[0].id));setModel(executor.env.GLM_MODEL??executor.env.OPENAI_MODEL??executor.env.KIMI_MODEL_NAME??executor.model??'');setBaseUrl(executor.env.OPENAI_BASE_URL??executor.env.ANTHROPIC_BASE_URL??'');setKey('');setCustomModel(false);},[executor.authentication,executor.env.GLM_MODEL,executor.env.OPENAI_MODEL,executor.env.KIMI_MODEL_NAME,executor.model,executor.env.OPENAI_BASE_URL,executor.env.ANTHROPIC_BASE_URL]);
  const [login,setLogin]=useState<CatalogLoginState>(),[statusError,setStatusError]=useState('');
  useEffect(()=>{let live=true,pending=false;const check=async()=>{if(pending)return;pending=true;try{const state=await readLoginStatus(invoke,executor.id);if(live){setLogin(state);setStatusError('');}}catch{if(live)setStatusError(t("登录状态暂未更新，稍后会再次检查。"));}finally{pending=false;}};void check();const timer=setInterval(()=>void check(),1500);return()=>{live=false;clearInterval(timer);};},[executor.id,invoke]);
  const loggingIn=login?.phase==='starting'||login?.phase==='waiting'||login?.phase==='checking';
  async function save(clear=false){const value=key;setKey('');setBusy(true);try{
    await invoke('catalog.credentials',{id:entry.id,executorId:executor.id,authentication:auth.id,...(value?{value}:{}),clear,model,baseUrl});
    if(entry.id==='zcode'&&auth.kind==='browser'&&!clear){const catalog=await readCatalog(invoke,executor.id),status=catalog.items.find(item=>item.entry.id==='zcode');if(status?.needsRepair&&status.selectedVersion){notify(t("正在补齐 ZCode 官方登录资源，下载校验完成后继续授权。"));await invoke('catalog.install',{id:'zcode',executorId:executor.id,version:status.selectedVersion,revision:CATALOG_REVISION});}}
    if(auth.kind==='browser'&&!clear){await invoke('executor.authenticate',{id:executor.id,methodId:auth.id});setLogin(await readLoginStatus(invoke,executor.id));}
    else await invoke('provider.probe',{provider:executor.id});
    notify(clear?t("已清除密钥。"):auth.kind==='api'?t("密钥已加密保存。真实模型调用仍需验证。"):t("官方登录流程已结束，请核对连接状态。"));
  }catch{}finally{setBusy(false);}}
  async function logout(){setBusy(true);try{await invoke('provider.logout',{provider:executor.id});setLogin(undefined);notify(t("已登出此执行端，聊天记录保留。"));}catch{}finally{setBusy(false);}}
  return <div className="catalog-login">
    <label className="field compact">{t("登录方式")}<select aria-label={t("登录方式")} value={authId} onChange={event=>{setAuthId(event.target.value);setKey('');setModel('');setCustomModel(false);}} disabled={busy||loggingIn}>{entry.authentication.map(auth=><option key={auth.id} value={auth.id}>{auth.label}</option>)}</select></label>
    {auth.kind==='api'&&<>
      <p className="provider-detail">{t("{0}密钥由系统加密保存，仅用于所选连接。{1}", auth.description??(auth.billing==='subscription'?t("使用所选账号的订阅额度。"):t("按所选厂商 API 用量计费。")), executor.secretKeys?.length?t("已有密钥；留空保留。"):'')}</p>
      {entry.id==='zcode'&&<p className="provider-detail">{t("API 地址：")}{auth.environment?.GLM_BASE_URL}{t("。支持文本与图片对话、读取文件和交付文档；不执行本机命令。保存与检查会只读查询账户余额，不发送模型请求；模型权限仍以实际消息调用为准。余额可在“用量与额度”中刷新。")}</p>}
      <label className="field compact">{auth.secretLabel??'API Key'}<input type="password" autoComplete="off" aria-label={`${entry.name} API Key`} value={key} onChange={event=>setKey(event.target.value)} disabled={busy||loggingIn}/><small>{auth.secretKeys?.join('、')}</small></label>
      {auth.kind==='api'&&entry.modelConfiguration?.baseUrlEnvironment&&<label className="field compact">{t("请求地址")}<input aria-label={t("{0} 请求地址", entry.name)} value={baseUrl} onChange={event=>setBaseUrl(event.target.value)} placeholder={entry.id==='claude'?t("留空走官方 https://api.anthropic.com；中转站填它的 HTTPS 根地址"):t("https://你的服务/v1")}/><small>{t("只对这条连接生效；中转站会收到对话内容和密钥。")}</small></label>}
      {(auth.modelRequired||entry.id==='opencode'||entry.id==='kimi'||entry.id==='zcode')&&<>
        <ApiModelPicker label={entry.id==='kimi'||entry.id==='zcode'?t("默认模型（可选）"):t("模型")} value={model} onChange={setModel} suggestions={modelOptions} disabled={busy||loggingIn}
          emptyLabel={entry.id==='kimi'||entry.id==='zcode'?t("在对话中选择"):auth.modelRequired?undefined:t("提供方默认")} placeholder={auth.modelRequired?t("选择模型（必填）"):t("选择模型")}
          load={canListModels?()=>invoke<{models:string[]}>('catalog.models',{id:entry.id,executorId:executor.id,authentication:authId,value:key||undefined,baseUrl:baseUrl||undefined},undefined,{background:true}):undefined}/>
        <small className="field-note">{canListModels?t("点开后用当前 Key 和请求地址读取这个服务的模型清单（不发送模型任务）；清单里没有的可以直接输入名称。"):entry.id==='opencode'?t("模型来自 OpenCode 上报的清单，也可以直接输入「提供方/模型」。"):t("模型来自执行端上报的清单，也可以直接输入名称。")}{(entry.id==='kimi'||entry.id==='zcode')?t(" 留空也可以保存密钥，进入对话后再为话题选择模型。"):''}</small>
      </>}
    </>}
    {entry.id==='kimi'&&!!executor.secretKeys?.length&&<button className="button secondary" disabled={busy||loggingIn||!snapshot.backendReady} onClick={()=>{setBusy(true);void invoke('catalog.kimiChina',{executorId:executor.id}).then(()=>notify(t("已保留已有 Key，切换至 Kimi 中国站和 kimi-k3；请检测连接。"))).catch(()=>{}).finally(()=>setBusy(false));}}>{t("修复中国站 K3（保留已有 Key）")}</button>}
    {auth.kind==='browser'&&auth.description&&<p className="provider-detail">{auth.description}</p>}
    {auth.kind==='browser'&&<button type="button" className="button small quiet danger" disabled={busy||loggingIn||!snapshot.backendReady} onClick={()=>{if(window.confirm(t("登出 {0} 在 HiveLab 合屋 中的账号？聊天记录会保留。", entry.name)))void logout();}}>{t("登出")}</button>}
    <div className="catalog-actions"><button className="button secondary" disabled={busy||loggingIn||!snapshot.backendReady||auth.kind==='api'&&!key&&(!executor.secretKeys?.length||authId!==executor.authentication)} onClick={()=>void save()}>{busy?<LoaderCircle className="spin" size={13}/>:<KeyRound size={13}/>}{auth.kind==='api'?t("保存密钥并检查"):t("官方浏览器登录")}</button>{auth.kind==='api'&&authId===executor.authentication&&!!executor.secretKeys?.length&&<button className="button quiet danger" disabled={busy||loggingIn||!snapshot.backendReady} onClick={()=>void save(true)}>{t("清除密钥")}</button>}</div>
    {entry.id==='opencode'&&<button className="button quiet" disabled={busy||loggingIn||!snapshot.backendReady||authId!==executor.authentication} onClick={()=>{setBusy(true);void invoke('provider.probe',{provider:executor.id}).then(()=>notify(t("模型清单已按当前提供方重新读取。"))).catch(()=>{}).finally(()=>setBusy(false));}}><RefreshCw size={13}/>{t("刷新模型清单")}</button>}
    {login&&<div className="provider-detail" role="status"><p>{login.message}</p>{login.code&&<p>{t("授权码：")}<strong>{login.code}</strong></p>}{login.phase==='waiting'&&login.url&&<button className="button secondary" onClick={()=>void invoke('executor.openLogin',{id:executor.id}).catch(()=>{})}>{t("打开官方授权页面")}</button>}{loggingIn&&<button className="button quiet" onClick={()=>void invoke('executor.cancelLogin',{id:executor.id}).catch(()=>{})}>{t("取消登录")}</button>}</div>}
    {statusError&&<p className="provider-detail" role="status">{statusError}</p>}
  </div>;
}

/** Installed catalog executors expose update checks where their connection is configured. */
export function CatalogVersionPanel({executor,snapshot,invoke}:{executor:AcpExecutor;snapshot:Snapshot;invoke:Invoke}) {
  const entry=catalogEntry(executor.catalogId);
  const [status,setStatus]=useState<CatalogStatus>(),[latest,setLatest]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(''),[agree,setAgree]=useState(false),[progress,setProgress]=useState<MemberInstallation>();
  const reload=useCallback(async()=>{const result=await readCatalog(invoke,executor.id);setStatus(result.items.find(item=>item.entry.id===entry.id));},[invoke,entry.id,executor.id]);
  useEffect(()=>{let live=true;void readCatalog(invoke,executor.id).then(result=>{if(live)setStatus(result.items.find(item=>item.entry.id===entry.id));}).catch(()=>{});return()=>{live=false;};},[invoke,entry.id,executor.id,executor.command,snapshot.backendReady]);
  useEffect(()=>{
    if(busy!=='install')return;let live=true,pending=false;
    const poll=async()=>{if(pending)return;pending=true;try{const value=await invoke<MemberInstallation|undefined>('catalog.installation',{id:entry.id,executorId:executor.id},undefined,{background:true});if(live)setProgress(value);}catch{}finally{pending=false;}};
    void poll();const timer=setInterval(()=>void poll(),1500);return()=>{live=false;clearInterval(timer);};
  },[busy,entry.id,executor.id,invoke]);
  async function action(kind:'latest'|'install'|'use'|'remove',version?:string){
    setBusy(kind);setMessage('');
    try{
      if(kind==='latest'){
        const result=await invoke<{version:string}>('catalog.latest',{id:entry.id});setLatest(result.version);
        setMessage(newerVersion(result.version,status?.selectedVersion)?t("最新版本 {0}，可下载后切换使用。", result.version):t("已是最新版本 {0}。", result.version));
      }else{
        await invoke(`catalog.${kind}`,{id:entry.id,executorId:executor.id,version,agree:agree||status?.consented,revision:CATALOG_REVISION});
        await reload();setMessage(kind==='remove'?t("旧版本程序目录已删除，聊天记录和登录配置已保留。"):kind==='use'?t("已切换版本，原聊天将使用当前版本继续。"):t("新版已安装并检查；原聊天使用当前版本，登录配置和记录保留。"));
      }
    }catch(error){setMessage((error as Error).message);}finally{setBusy('');setProgress(undefined);}
  }
  const locked=!!busy||!snapshot.backendReady,consented=agree||status?.consented;
  // The background check finds a release without this panel being asked; a manual check takes over once made.
  const offered=latest||snapshot.providers.find(item=>item.id===executor.id)?.updateVersion||'';
  return <div className="version-panel" aria-label={t("{0} 版本管理", executor.name)}>
    <div className="version-row"><span className="permission-label">{t("当前版本")}</span><strong>{status?.selectedVersion??t("手动指定的安装")}</strong><button className="button small quiet" aria-label={t("{0} 检查新版本", executor.name)} disabled={locked} onClick={()=>void action('latest')}><RefreshCw size={13} className={busy==='latest'?'spin':''}/>{t("检查新版本")}</button></div>
    {message&&<p className="version-note" role="status">{message}</p>}
    {!status?.consented&&offered&&<label className="catalog-consent"><input type="checkbox" checked={agree} disabled={locked} onChange={event=>setAgree(event.target.checked)}/>{t("我已了解并同意")}<a href={entry.termsUrl} onClick={event=>{event.preventDefault();void invoke('catalog.openLink',{id:entry.id,kind:'termsUrl'}).catch(()=>{});}}>{t("厂商条款")}</a></label>}
    {offered&&newerVersion(offered,status?.selectedVersion)&&<button className="button small secondary" disabled={locked||!consented} onClick={()=>void action('install',offered)}><Download size={13}/>{t("更新到 {0}", offered)}</button>}
    {busy==='install'&&<p className="version-note" role="status">{t("{0} {1}。关闭设置后仍会继续。", PHASES[progress?.phase??'installing'], offered)}</p>}
    {!!status?.installed.length&&<details className="version-remove" onToggle={event=>{if(event.currentTarget.open)void reload().catch(()=>{});}}><summary>{t("版本切换与清理（{0}）", status.installed.length)}</summary>
      <p className="version-note">{t("每个版本独立安装。删除旧版会删除其程序目录；聊天记录和登录配置另行保留。整体卸载与空间占用见“设置 → 存储”。")}</p>
      {status.installed.map(version=><div className="version-row" key={version}><span>{version}{version===status.selectedVersion?t(" · 正在使用"):''}</span><button className="button small secondary" disabled={locked||version===status.selectedVersion||!consented} onClick={()=>void action('use',version)}>{t("切换 / 回退")}</button><button className="button small quiet danger" aria-label={t("{0} 删除版本 {1}", executor.name, version)} disabled={locked||version===status.selectedVersion} onClick={()=>{if(window.confirm(t("删除 {0} {1} 的程序目录及依赖？聊天记录和登录配置会保留。", entry.name, version)))void action('remove',version);}}><Trash2 size={12}/>{t("删除版本")}</button></div>)}
    </details>}
  </div>;
}
export function ThirdPartyLicenses({invoke}:{invoke:Invoke}){const [text,setText]=useState('');return <details className="third-party-licenses"><summary>{t("第三方软件许可与条款")}</summary><p className="provider-detail">{t("执行端由用户从官方源下载，账号和服务条款由各厂商提供。HiveLab 合屋 附带 npm（Artistic-2.0）与 7-Zip 解压程序（LGPL-2.1-or-later）；7-Zip 对应源码和许可文本随安装包提供。Node.js / Electron 的许可文本随运行环境提供。")}</p>{EXECUTOR_CATALOG.map(entry=><p key={entry.id}>{entry.name} · <a href={entry.licenseUrl} onClick={event=>{event.preventDefault();void invoke('catalog.openLink',{id:entry.id,kind:'licenseUrl'}).catch(()=>{});}}>{entry.license}</a> · <a href={entry.termsUrl} onClick={event=>{event.preventDefault();void invoke('catalog.openLink',{id:entry.id,kind:'termsUrl'}).catch(()=>{});}}>{t("条款")}</a></p>)}<button className="button quiet" onClick={()=>void fetch('third-party-licenses.txt').then(response=>{if(!response.ok)throw new Error(t("许可证文件未找到"));return response.text();}).then(setText).catch(error=>setText(error.message))}>{t("查看随安装包附带的开源许可证全文")}</button>{text&&<pre className="license-full-text">{text}</pre>}</details>;}

import {deskDirectory} from '../backend/desk-directory-layout';
import {allowClipboardPermission} from './clipboard-permissions';
import {applySnapshotPatch,acceptSnapshot} from '../shared/snapshot-sync';
import {Notification} from 'electron';
import {MemberNotifications} from './member-notifications';
import {normalizeMemberNotice} from '../shared/member-notifications';
import { OPENABLE_DOCUMENT } from '../shared/round-results';
import { catalogEntry, catalogExecutor } from '../shared/executor-catalog';
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, shell, screen, utilityProcess, MessageChannelMain, safeStorage, Tray, Menu, nativeImage, nativeTheme, powerMonitor, protocol, net, type UtilityProcess } from 'electron';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { RENDERER_METHODS } from '../shared/rpc-methods';
import {BrowserSidebar} from './browser-sidebar';
import {createContrastFrameReader} from './text-contrast';
import {AdaptiveTextColorCache} from './adaptive-text-cache';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildEnvironment, redact, registerSecret, resolveSafePath } from '../backend/security';
import { getCodexBrowserLoginLaunch } from '../backend/adapters/codex';
import { CLAUDE_TOKEN_PATTERN, getClaudeLoginLaunch } from '../backend/adapters/claude';
import { DshAdapter } from '../backend/adapters/dsh';
import { createInterface } from 'node:readline';
import { spawnOwned, stopOwned, type Ownership } from '../backend/process-supervisor';
import {sweepOwnedTemp} from '../backend/owned-temp';
import { DEFAULT_SETTINGS, SECRET_PLACEHOLDER, isAcpId, isSecretName, parseEnv, splitSecretEnv } from '../shared/defaults';
import type { AcpExecutor, Project, ProviderInfo, Session, Snapshot, Settings } from '../shared/types';
type Lookup = { session?: Session; project?: Project };
import { assertNormalIntegrity } from './integrity';
import { loginOutput, submitClaudeLoginCode } from './login-output';
import {officialExecutorLoginUrl} from '../backend/official-login';
import {LoginBrowserGate} from './login-browser';
import {codexBrowserLogin} from './codex-login';
import {ProviderLoginState} from './provider-login-state';
import { rpcTimeout,rpcTimeoutMessage } from './rpc-timeouts';
import {BackendReadiness} from './backend-readiness';
import {ComputerIndicator} from './computer-indicator';
import {BackgroundLibrary} from './background-library';
import {FileOutputs} from './file-output';
import {previewFile,resolveFileReference} from './file-preview';
import {FilePreviewServer} from './file-preview-server';
import {WorkspaceFiles} from './workspace-files';
import {WorkspaceTerminals} from './workspace-terminal';
import type {WorkspaceRoot} from '../shared/workspace-files';
import {ComputerTools} from './computer-tools';
import {DesktopTools} from './desktop-tools';
import { isAttachmentId, safeAttachmentName } from '../shared/attachments';
import { AUTOMATION_PAUSE_FILE } from '../shared/automation';
import { BackupRestorer, recoverInterruptedRestore, RestoreFailure } from '../backend/backup-restore';
import type { BackupEntry } from '../shared/backup';
import { acceptRunningVersion, runningVersion } from './version';
import {desktopSearchPath,localNodeCandidates,localNpmCli} from '../backend/platform-runtime';
import {exportKimiBalance} from './kimi-account';
import {exportGlmBalance} from './glm-account';

app.setName('HiveLab 合屋');

// Check before touching user data, starting workers, or opening a login.
try { assertNormalIntegrity(); }
catch (error) {
  dialog.showErrorBox('HiveLab 合屋 运行权限不正确', String(error instanceof Error ? error.message : error));
  app.exit(1);
  throw error;
}

const dist = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(dist);
// Avoid Electron's lazy userData lookup before configuring a writable profile.
// User-profile storage avoids MSIX AppData redirection by desktop agent hosts.
const dailyData = path.join(process.env.USERPROFILE || app.getPath('home'), '.hivelab', 'data');
const dataDirectory = process.env.HIVELAB_DATA_DIR || (app.isPackaged ? dailyData : path.join(root, '.hivelab'));
// Electron's native instance lock is scoped to userData. Keep it stable across
// development, packaged copies and launchers with different HIVELAB_DATA_DIRs.
const instanceDirectory = path.join(dailyData, 'electron');
mkdirSync(dataDirectory, { recursive: true });
mkdirSync(instanceDirectory, { recursive: true });
const startupLog = path.join(dataDirectory, 'startup.log');
const backgrounds = new BackgroundLibrary(dataDirectory,path.join(dist,'wallpaper'));
const startupMedia = new BackgroundLibrary(path.join(dataDirectory,'startup-media'));
const fileOutputs=new FileOutputs(dataDirectory);
const filePreviews=new FilePreviewServer(reference=>resolveFileReference(dataDirectory,fileOutputs,reference,workspaceFileReference));
const computerTools=new ComputerTools(dist,id=>ready&&Boolean(lastSnapshot?.runs.some(r=>r.id===id&&r.status==='running'))&&!quitting);
const desktopTools=new DesktopTools(path.join(dist,'third-party','agent-desktop','agent-desktop.exe'),path.join(dataDirectory,'desktop-automation'),id=>ready&&Boolean(lastSnapshot?.runs.some(r=>r.id===id&&r.status==='running'))&&!quitting);
const rendererLog = path.join(dataDirectory, 'logs', 'renderer-errors.log');
/** Interface failures caught in the window; kept small, redacted, and included in diagnostics exports. */
function logRendererError(params: any) {
  const text = (value: unknown, max: number) => typeof value === 'string' ? redact(value).slice(0, max) : '';
  const entry = { at: new Date().toISOString(), area: text(params?.area, 80), message: text(params?.message, 2000), stack: text(params?.stack, 6000), componentStack: text(params?.componentStack, 4000) };
  try {
    mkdirSync(path.dirname(rendererLog), { recursive: true });
    // Keep the newest half once the file passes 1 MB.
    if (existsSync(rendererLog) && statSync(rendererLog).size > 1024 * 1024) writeFileSync(rendererLog, readFileSync(rendererLog, 'utf8').slice(-512 * 1024));
    appendFileSync(rendererLog, JSON.stringify(entry) + '\n');
  } catch { /* Logging must never break the window. */ }
  return { logged: true };
}
function logStartup(message: string) { try { appendFileSync(startupLog, `${new Date().toISOString()} ${redact(message)}\n`); } catch { /* stderr remains available to the launcher. */ } }
function startupFailed(error: unknown) {
  const message = redact(error instanceof Error ? error.stack || error.message : String(error));
  logStartup(message);
  dialog.showErrorBox('HiveLab 合屋 启动失败', `${message}\n\n启动日志：${startupLog}`);
  app.exit(1);
}
if(!process.argv.some(arg=>['--agentnest-kimi-balance','--agentnest-glm-balance'].includes(arg)))logStartup(`starting pid=${process.pid} packaged=${app.isPackaged} data=${dataDirectory}`);
mkdirSync(path.join(dataDirectory, 'electron', 'session'), { recursive: true });
const nativeTemp = path.join(dataDirectory, 'process-temp');
mkdirSync(nativeTemp, { recursive: true });
process.env.TEMP = nativeTemp;
process.env.TMP = nativeTemp;
process.env.HIVELAB_PROCESS_TEMP_ROOT = nativeTemp;
app.setPath('userData', instanceDirectory);
app.setPath('sessionData', path.join(dataDirectory, 'electron', 'session'));
app.setAppLogsPath(path.join(dataDirectory, 'logs'));
app.commandLine.appendSwitch('disable-http-cache');
// The Windows hardware video decoder disconnects on some 4K wallpapers.
// Software video decoding leaves WebGL and the interface's GPU rendering enabled.
if(process.platform==='win32')app.commandLine.appendSwitch('disable-accelerated-video-decode');
// Text never coasts: a wheel notch moves the page at once instead of easing over a few frames (2026-11-06, the user found the glide hard to read).
app.commandLine.appendSwitch('disable-smooth-scrolling');
process.env.HIVELAB_APP_ROOT = root;
process.env.HIVELAB_JOB_HELPER = path.join(dist, 'windows-job.ps1');
process.env.HIVELAB_CODEX_STATE_DIR = path.join(dataDirectory, 'native', 'codex', 'sqlite');
process.env.HIVELAB_CODEX_HOME = path.join(dataDirectory, 'native', 'codex', 'home');
process.env.HIVELAB_DSH_HOME = path.join(dataDirectory, 'native', 'dsh');
process.env.HIVELAB_CLAUDE_HOME = path.join(dataDirectory, 'native', 'claude');
process.env.HIVELAB_ACP_HOME = path.join(dataDirectory, 'native', 'acp');
if(process.platform==='darwin')process.env.PATH=desktopSearchPath(process.platform,process.env,app.getPath('home'));
const nodeCandidates = localNodeCandidates(process.platform,process.env);
process.env.HIVELAB_LOCAL_NODE_EXE = nodeCandidates.find(value => existsSync(value) && !!localNpmCli(value));
process.env.HIVELAB_BUNDLED_NODE_EXE=process.execPath;
process.env.HIVELAB_BUNDLED_NODE_VERSION=process.versions.node;
process.env.HIVELAB_NODE_EXE=process.execPath;
process.env.HIVELAB_DATA_DIRECTORY=dataDirectory;
process.env.HIVELAB_NATIVE_PLUGIN_DATA=dataDirectory;

let window: BrowserWindow | undefined;
const browserSidebar=new BrowserSidebar(()=>window,state=>push({type:'browser-state',state}));
const contrastFrame=createContrastFrameReader(()=>window);
const adaptiveTextColors=new AdaptiveTextColorCache(dataDirectory);
let worker: UtilityProcess | undefined;
let port: Electron.MessagePortMain | undefined;
let tray: Tray | undefined;
/** The tray menu follows the interface language saved in settings (Settings → Language). */
const TRAY_TEXT = {
  'zh-CN': { tip: 'HiveLab 合屋', open: '打开工作台', stop: '停止所有成员', quit: '退出 HiveLab 合屋' },
  en: { tip: 'HiveLab', open: 'Open workbench', stop: 'Stop all members', quit: 'Quit HiveLab' },
} as const;
let trayLanguage: keyof typeof TRAY_TEXT | undefined;
function syncTrayLanguage() {
  const language = lastSnapshot?.settings?.language === 'en' ? 'en' : 'zh-CN';
  if (!tray || language === trayLanguage) return;
  trayLanguage = language;
  const text = TRAY_TEXT[language];
  tray.setToolTip(text.tip);
  tray.setContextMenu(Menu.buildFromTemplate([{ label: text.open, click: () => showMainWindow('tray-menu') }, { label: text.stop, click: () => { void emergencyStop(); } }, { type: 'separator' }, { label: text.quit, click: () => app.quit() }]));
}
let ready = false, quitting = false, nextId = 0;
const backendReadiness=new BackendReadiness();
let backendGeneration=0;
let lastSnapshot: Snapshot | undefined;
let deskFileRecords:import('../shared/desk-files').DeskFileLocation[]=[];
const workspaceFiles=new WorkspaceFiles(dataDirectory,()=>{
  const s=lastSnapshot;if(!s)return [];
  const roots:WorkspaceRoot[]=s.projects.filter(p=>!p.kind).map(p=>({id:'project:'+p.id,name:p.name,directory:p.directory,kind:'project'}));
  for(const member of s.members){
    const directory=deskDirectory(dataDirectory,member.id),overview=s.rooms?.find(r=>r.roomId==='desk:'+member.id);
    roots.push({id:'desk:'+member.id,name:member.name+' · 全部会话',directory,kind:'desk',memberId:member.id,deskView:'all'});
    roots.push({id:'desk-shared:'+member.id,name:member.name+' · 共享资料',directory:path.join(directory,'shared'),kind:'desk',memberId:member.id,deskView:'shared'});
    roots.push({id:'desk-legacy:'+member.id,name:member.name+' · 原有工位文件',directory,kind:'desk',memberId:member.id,deskView:'legacy',aliases:!overview?.sessionId?['desk-current:'+member.id]:undefined});
    if(overview?.folder&&path.resolve(overview.folder).toLowerCase()!==path.resolve(directory).toLowerCase()&&!deskFileRecords.some(r=>r.sessionId===overview.sessionId))roots.push({id:'desk-current:'+member.id,name:member.name+' · 当前工作文件夹',directory:overview.folder,kind:'desk'});
  }
  for(const record of deskFileRecords){const session=s.sessions.find(v=>v.id===record.sessionId);roots.push({id:'session:'+record.sessionId,name:session?.title??record.title,directory:record.directory,kind:'session',memberId:record.memberId,sessionId:record.sessionId,deskView:'session',updatedAt:record.updatedAt,archived:record.archived,managed:record.managed,sharedDirectory:record.sharedDirectory,aliases:s.rooms?.some(r=>r.roomId==='desk:'+record.memberId&&r.sessionId===record.sessionId)?['desk-current:'+record.memberId]:undefined});}
  for(const session of s.sessions)if(session.workspace&&!session.restoredHistoryOnly&&session.workspaceKind!=='original')roots.push({id:'session:'+session.id,name:(session.title||'话题')+' · 工作副本',directory:session.workspace,kind:'session'});
  return roots;
});
const workspaceTerminals=new WorkspaceTerminals();
let dirtyEditorCount=0;
const backups=new BackupRestorer(dataDirectory);
let restoring=false,quitAfterRestore=false;
const guardians = new Map<number, Ownership>();
const loginChildren = new Map<string, import('node:child_process').ChildProcess>();
const loginStarting = new Set<string>();
const providerLoginState=new ProviderLoginState(provider=>{const child=loginChildren.get(provider);if(child)void stopOwned(child,1500);});
const loginBrowserGate=new LoginBrowserGate();
const pending = new Map<number, { resolve: (value: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout;method:string;startedAt:number }>();
let computerIndicator: ComputerIndicator | undefined;
const push = (event: unknown) => {
  const value = event as {type?: string; event?: import('../shared/types').TimelineEvent};
  if (ready && value.type === 'event' && value.event) computerIndicator?.event(value.event);
  if ((value.type === 'snapshot' || value.type === 'snapshot-patch') && lastSnapshot) {computerIndicator?.update(lastSnapshot);computerTools.reconcile();desktopTools.reconcile();}
  if (window && !window.isDestroyed()) window.webContents.send('hivelab:event', event);
};
function setBackendReady(value: boolean) {
  ready = value;
  if (!value) {computerIndicator?.clear();computerTools.reconcile();desktopTools.reconcile();}
  if (lastSnapshot) lastSnapshot = { ...lastSnapshot, backendReady: value };
}
const memberNotifications=new MemberNotifications({
  focused:()=>Boolean(window&&!window.isDestroyed()&&window.isVisible()&&!window.isMinimized()&&window.isFocused()),
  supported:()=>Notification.isSupported(),
  create:notice=>new Notification({title:notice.title,body:notice.body,icon:path.join(dist,'hivelab.png'),silent:false}),
  flash:()=>{if(window&&!window.isDestroyed())window.flashFrame(true);},
  open:target=>{showMainWindow('notification');window?.flashFrame(false);push({type:'notification-open',target});},
  fallback:notice=>push({type:'notification-fallback',notice}),
});

async function request(method: string, params?: unknown, timeout = 45000): Promise<any> {
  const requestedWorker=worker,requestedPort=port,generation=backendGeneration,startedAt=Date.now(),deadline=startedAt+timeout;
  const timedOut=()=>{logStartup(`rpc-timeout method=${method} durationMs=${Date.now()-startedAt} generation=${generation}`);return new Error(rpcTimeoutMessage(method));};
  if(method==='snapshot'&&!ready&&worker&&port)await backendReadiness.wait(generation,timeout);
  if(requestedWorker!==worker||requestedPort!==port)throw new Error('执行服务已切换，本次状态读取已取消。');
  backendReadiness.assertReady(generation);
  if (!worker || !port || !ready) return Promise.reject(new Error('执行服务尚未就绪，请稍候或重新打开应用'));
  const remaining=deadline-Date.now();
  if(remaining<=0)throw timedOut();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(timedOut()); }, remaining);
    pending.set(id, { resolve, reject, timer,method,startedAt });
    port!.postMessage({ id, method, params });
  });
}
function stopBackend() {
  backendReadiness.fail(backendGeneration,'执行服务已停止，请重启后端后核对记录。');
  // Kill the held UtilityProcess handle, never a potentially recycled PID.
  // Every guardian holds the worker's native parent handle and closes its Job on that parent's exit.
  worker?.kill(); setBackendReady(false);
}
async function emergencyStop() {
  loginBrowserGate.clear();
  // Keep a human stop durable even if the worker cannot receive its control message.
  try { mkdirSync(dataDirectory,{recursive:true});writeFileSync(path.join(dataDirectory,AUTOMATION_PAUSE_FILE),'paused',{flag:'wx'}); } catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST')try{appendFileSync(path.join(dataDirectory,'launch-stop.log'),`Automatic pause marker failed: ${String(error)}\n`);}catch{/* Stopping still takes precedence. */} }
  for(const provider of new Set([...loginStarting,...loginChildren.keys()]))providerLoginState.cancel(provider);
  await Promise.allSettled([...loginChildren.values()].map(child => stopOwned(child, 2000)));
  loginChildren.clear();
  if (ready) {
    try { return await request('all.stop', {}, 2500); } catch { /* Close only the recorded HiveLab-owned descendants. */ }
  }
  stopBackend();
  push({ type: 'backend', ready: false, message: '执行服务已强制停止；旧任务结果待核对，未自动重发。重新打开应用即可恢复记录。' });
  return { received: true, detail: '执行服务与本应用的成员已停止，旧结果待核对' };
}
function secretFile() { return path.join(dataDirectory, 'deepseek.secret'); }
/** Claude's long-lived subscription token from `claude setup-token`, encrypted with the system's credential protection. */
function claudeTokenFile() { return path.join(dataDirectory, 'claude-token.secret'); }
const claudeApiFile=()=>path.join(dataDirectory,'secrets','claude-api.secret');
function storedClaudeApiKey(){
  if(!safeStorage.isEncryptionAvailable()||!existsSync(claudeApiFile()))return;
  try{const value=safeStorage.decryptString(readFileSync(claudeApiFile()));registerSecret(value);return value;}catch{return;}
}
function storedClaudeToken(): string | undefined {
  if (!existsSync(claudeTokenFile()) || !safeStorage.isEncryptionAvailable()) return;
  try { const value = safeStorage.decryptString(readFileSync(claudeTokenFile())); registerSecret(value); return value; } catch { return; }
}
/* Connected programs' API keys and tokens: encrypted per program with the system's credential protection. */
const acpSecretDirectory = path.join(dataDirectory, 'secrets');
const acpSecretFile = (id: string) => path.join(acpSecretDirectory, `${id}.secret`);
function readAcpSecrets(id: string): Record<string, string> {
  if (!isAcpId(id) || !existsSync(acpSecretFile(id)) || !safeStorage.isEncryptionAvailable()) return {};
  try {
    const value = JSON.parse(safeStorage.decryptString(readFileSync(acpSecretFile(id))));
    const secrets: Record<string, string> = {};
    for (const [key, item] of Object.entries(value ?? {})) if (typeof item === 'string') { secrets[key] = item; registerSecret(item); }
    return secrets;
  } catch { return {}; }
}
function allAcpSecrets() {
  const result: Record<string, Record<string, string>> = {};
  try { for (const name of readdirSync(acpSecretDirectory)) { const id = name.replace(/\.secret$/, ''); if (name.endsWith('.secret') && isAcpId(id)) result[id] = readAcpSecrets(id); } } catch { /* No programs with secrets yet. */ }
  return result;
}
function writeAcpSecrets(id: string, secrets: Record<string, string>) {
  if (!isAcpId(id)) return;
  if (!Object.keys(secrets).length) { rmSync(acpSecretFile(id), { force: true }); return; }
  mkdirSync(acpSecretDirectory, { recursive: true });
  writeEncryptedSecret(acpSecretFile(id),JSON.stringify(secrets));
}
function writeEncryptedSecret(file:string,value:string){
  if(!safeStorage.isEncryptionAvailable())throw new Error('系统凭据加密不可用，没有保存密钥。');
  const encrypted=safeStorage.encryptString(value),temporary=file+'.'+randomUUID()+'.tmp';
  mkdirSync(path.dirname(file),{recursive:true});
  try{writeFileSync(temporary,encrypted);renameSync(temporary,file);}finally{rmSync(temporary,{force:true});}
}
/** Secrets are split off here, before anything reaches the backend database. */
async function saveExecutor(params: any) {
  const given = params?.executor && typeof params.executor === 'object' ? params.executor : {};
  const env = typeof given.env === 'string' ? parseEnv(given.env) : given.env && typeof given.env === 'object' ? given.env : {};
  const { plain, secrets } = splitSecretEnv(env, typeof given.id === 'string' ? readAcpSecrets(given.id) : {});
  if (Object.keys(secrets).length && !safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，没有保存密钥；请先去掉名称带 KEY、TOKEN、SECRET 等的变量');
  for (const value of Object.values(secrets)) registerSecret(value);
  const saved = await request('executor.save', { executor: { ...given, env: plain }, secrets }, 60_000) as AcpExecutor;
  writeAcpSecrets(saved.id, secrets);
  return saved;
}
/** After start: encrypt plaintext secrets an older version stored, and drop files of removed programs. */
async function tidyAcpSecrets() {
  try {
    const snapshot = await request('internal.lookup', { executors: true }) as Pick<Snapshot, 'executors'>;
    for (const executor of snapshot.executors ?? []) if (Object.keys(executor.env ?? {}).some(isSecretName) && safeStorage.isEncryptionAvailable()) await saveExecutor({ executor: { ...executor, env: { ...executor.env, ...Object.fromEntries((executor.secretKeys ?? []).map(key => [key, SECRET_PLACEHOLDER])) } } });
    const known = new Set((snapshot.executors ?? []).map(executor => executor.id));
    for (const id of Object.keys(allAcpSecrets())) if (!known.has(id as AcpExecutor['id'])) rmSync(acpSecretFile(id), { force: true });
  } catch (error) { logStartup(`acp secrets tidy failed: ${(error as Error).message}`); }
}
function storedKey(): string | undefined {
  if (!existsSync(secretFile()) || !safeStorage.isEncryptionAvailable()) return;
  try { const value = safeStorage.decryptString(readFileSync(secretFile())); registerSecret(value); return value; } catch { return; }
}
function startBackend() {
  setBackendReady(false);const generation=backendGeneration=backendReadiness.start();
  logStartup(`backend-starting generation=${generation}`);
  push({type:'backend',ready:false,message:'执行服务正在启动，准备好后即可操作。'});
  const env = buildEnvironment(lastSnapshot?.settings || DEFAULT_SETTINGS);
  const channel = new MessageChannelMain(); port = channel.port1;
  worker = utilityProcess.fork(path.join(dist, 'worker.mjs'), [], { cwd: root, env, serviceName: 'HiveLab 合屋 执行服务', stdio: 'pipe' });
  const ownWorker=worker,ownPort=port;let resyncPending=false;
  worker.stderr?.on('data', data => {if(worker!==ownWorker)return;const text = redact(String(data)); if (!/ExperimentalWarning|Use .--trace-warnings/.test(text)) push({ type: 'backend', ready, message: text.slice(-2000) }); });
  worker.on('spawn', () => {if(worker===ownWorker)ownWorker.postMessage({ type: 'connect', dataDirectory, key: storedKey(), claudeToken: storedClaudeToken(), claudeApiKey: storedClaudeApiKey(), acpSecrets: allAcpSecrets() }, [channel.port2]);});
  port.on('message', event => {
    if(worker!==ownWorker||port!==ownPort||!backendReadiness.current(generation))return;
    const packet = event.data;
    if(packet.type==='host-request'){
      const reply=(result?:unknown,error?:unknown)=>{if(worker===ownWorker&&port===ownPort)ownPort.postMessage({type:'host-result',id:packet.id,result,error:error?redact((error as Error).message):undefined});};
      if(!lastSnapshot?.runs.some(r=>r.id===packet.params?.runId&&r.status==='running')){reply(undefined,Error('本轮已结束或正在等待确认，未执行操作'));return;}
      const task=(async()=>{
        if(packet.method==='browser.open')return browserSidebar.open(packet.params.args?.url);
        if(packet.method==='computer'){if(!computerIndicator)throw Error('电脑操作提示条不可用');await computerIndicator.ensureVisible();return computerTools.call(packet.params.runId,packet.params.args);}
        if(packet.method==='desktop'){if(!computerIndicator)throw Error('电脑操作提示条不可用');await computerIndicator.ensureVisible();return desktopTools.call(packet.params.runId,packet.params.memberKey,packet.params.args);}
        if(packet.method==='file.create')return fileOutputs.create(packet.params.args);
        if(packet.method==='file.importWord')return fileOutputs.importWord(packet.params.args);
        throw Error('未知桌面服务');
      })();void task.then(result=>reply(result),error=>reply(undefined,error));return;
    }
    if (packet.id) { const item = pending.get(packet.id); if (!item) return; clearTimeout(item.timer); pending.delete(packet.id);const duration=Date.now()-item.startedAt;if(duration>=1500)logStartup(`rpc-slow method=${item.method} durationMs=${duration} outcome=${packet.error?'failed':'completed'} generation=${generation}`); packet.error ? item.reject(new Error(packet.error)) : item.resolve(packet.result); return; }
    if (packet.type === 'ownership') { packet.info.closed ? guardians.delete(packet.info.pid) : guardians.set(packet.info.pid, packet.info); return; }
    if (packet.type === 'ready') {if(!backendReadiness.markReady(generation))return;setBackendReady(true);logStartup(`backend-ready generation=${generation} pid=${ownWorker.pid}`);push({ type: 'backend', ready: true }); notifyRoomVisibility(); void checkConnectivity(); void tidyAcpSecrets(); return; }
    if (packet.type === 'push') { if(packet.event.type==='executor-login'){const url=loginBrowserGate.accept(packet.event.id,packet.event.state);if(url)void shell.openExternal(url).catch(()=>push({type:'backend',ready,message:'官方授权页未能打开，请点击“打开官方授权页面”重试。'}));return;}if (packet.event.type === 'snapshot') {lastSnapshot={...(lastSnapshot?acceptSnapshot(lastSnapshot,packet.event.snapshot):packet.event.snapshot),backendReady:ready};push({...packet.event,snapshot:lastSnapshot});}
      else if(packet.event.type==='snapshot-patch'){
        const next=lastSnapshot&&applySnapshotPatch(lastSnapshot,packet.event);
        if(next){lastSnapshot={...next,backendReady:ready};push(packet.event);syncTrayLanguage();}
        else if(!resyncPending){resyncPending=true;void request('snapshot').then(snapshot=>{if(worker===ownWorker&&backendReadiness.current(generation)){lastSnapshot={...snapshot,backendReady:ready};push({type:'snapshot',snapshot:lastSnapshot!});syncTrayLanguage();}}).catch(()=>{}).finally(()=>{resyncPending=false;});}
      }else push(packet.event);return; }
    if (packet.type === 'fatal') {logStartup(`backend-fatal generation=${generation} ${packet.error}`);stopBackend();push({ type: 'backend', ready: false, message: packet.error }); }
  }); port.start();
  worker.on('exit', code => {
    logStartup(`backend-exit generation=${generation} pid=${ownWorker.pid} code=${code} current=${worker===ownWorker}`);
    if(worker!==ownWorker||port!==ownPort)return;
    backendReadiness.fail(generation,'执行服务已退出，请重启后端并核对中断记录。');
    setBackendReady(false); guardians.clear();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('执行服务已退出；未自动重发任务')); } pending.clear();
    if (!quitting) push({ type: 'backend', ready: false, message: '执行服务已退出；重新打开应用后核对中断记录。' });
  });
}
async function checkConnectivity() {
  if (!ready) return;
  const generation=backendGeneration;
  try {
    const result = await request('network.check', {}, 15000);
    if(!backendReadiness.current(generation)||!ready)return;
    const failed = result.results.filter((entry: any) => !entry.reached);
    if (failed.length) push({ type: 'backend', ready, message: `部分服务连通性检查失败（${failed.map((entry: any) => new URL(entry.url).hostname).join('、')}）。请确认 TUN；可在设置中单独查看结果或选备用代理。其他成员仍可使用。` });
  } catch (error) { if(backendReadiness.current(generation)&&ready)push({ type: 'backend', ready, message: `连通性检测未完成：${redact((error as Error).message)}` }); }
}
async function restartBackend() {
  const old = worker;
  await emergencyStop();
  if (ready) try { await request('internal.close', {}, 4000); } catch { stopBackend(); }
  if (old?.pid) await new Promise<void>(resolve => { old.once('exit', () => resolve()); setTimeout(resolve, 4000).unref(); old.kill(); });
  port?.close(); worker = undefined; port = undefined; ready = false;
  startBackend();
  return { detail: '执行服务正在重新启动，旧任务会保留为中断或待核对，不会重发。' };
}
async function restoreData(params:any){
  if(params?.confirm!==true||typeof params?.token!=='string')throw new Error('请先预览、校验备份并明确确认恢复。');
  if(restoring)throw new Error('资料正在恢复，请等待本次操作完成。');
  if(loginChildren.size||loginStarting.size)throw new Error('成员登录仍在进行，请完成或结束登录后再恢复。');
  restoring=true;let paused=false,closed=false,closingWorker:UtilityProcess|undefined;
  try{
    await backups.verifyPrepared(params.token);
    await request('internal.restore.begin');paused=true;
    const before=await request('internal.backup.beforeRestore',{},rpcTimeout('backup.create')) as BackupEntry;
    await backups.verifyPrepared(params.token);
    closingWorker=worker;closed=true;
    await request('internal.close',{},30000);
    await waitRestoreWorkerExit(closingWorker,15000);
    port?.close();port=undefined;worker=undefined;ready=false;
    const result=await backups.apply(params.token,before.id);
    lastSnapshot=undefined;startBackend();
    const deadline=Date.now()+45000;while(!ready&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
    return ready?result:{...result,detail:'资料已恢复，但执行服务尚未就绪。请重新启动应用；自动功能保持暂停。'};
  }catch(error){
    if(closed){
      if(closingWorker?.pid){closingWorker.kill();try{await waitRestoreWorkerExit(closingWorker,5000);}catch{ready=false;throw new Error('原执行服务退出尚未确认，未启动新的执行服务。请退出并重新打开应用后核对恢复记录。');}}
      if(!(error instanceof RestoreFailure&&error.requiresRepair)){port?.close();port=undefined;worker=undefined;ready=false;lastSnapshot=undefined;startBackend();}
      else push({type:'backend',ready:false,message:error.message});
    }else if(paused&&ready)await request('internal.restore.cancel').catch(()=>{});
    throw error;
  }finally{restoring=false;if(quitAfterRestore){quitAfterRestore=false;app.quit();}}
}
async function waitRestoreWorkerExit(target:UtilityProcess|undefined,timeout:number){
  if(!target?.pid)return;
  await new Promise<void>((resolve,reject)=>{const exited=()=>{clearTimeout(timer);resolve();};const timer=setTimeout(()=>{target.removeListener('exit',exited);reject(new Error('原执行服务还未退出，没有替换数据。'));},timeout);target.once('exit',exited);if(!target.pid){target.removeListener('exit',exited);clearTimeout(timer);resolve();}});
}
async function login(provider: string) {
  const generation=backendGeneration;
  backendReadiness.assertReady(generation);
  if (!['codex', 'claude', 'dsh'].includes(provider)) throw new Error('DeepSeek API 请使用设置中的密钥入口');
  if (loginChildren.has(provider)||loginStarting.has(provider)||providerLoginState.active(provider)) return { detail: '登录正在进行，请完成或取消当前登录。' };
  const settings = lastSnapshot?.settings || DEFAULT_SETTINGS;
  const token=providerLoginState.begin(provider);
  loginStarting.add(provider);
  // Return immediately so the window can show progress and cancellation while discovery runs.
  void (async()=>{let loginHeld=false;try{
  await request('internal.provider.loginBegin',{provider});
  loginHeld=true;
  if(!providerLoginState.active(provider))return;
  const launch = provider==='dsh' ? await new DshAdapter().accountLaunch(settings,buildEnvironment(settings),'login') : (provider === 'codex' ? getCodexBrowserLoginLaunch : getClaudeLoginLaunch)(settings, buildEnvironment(settings));
  backendReadiness.assertReady(generation);
  if(!providerLoginState.active(provider))return;
  const child = spawnOwned(launch.command, launch.args, { cwd: 'cwd' in launch ? String(launch.cwd) : root, env: launch.env }); loginChildren.set(provider, child);
  loginStarting.delete(provider);
  let opened = false;
  let loginSucceeded=false;
  const open = (url:string) => { if(!opened&&providerLoginState.update(provider,token,{phase:'waiting',message:'请在浏览器完成授权，也可以重新打开授权页或取消。',url})){opened=true;void shell.openExternal(url).catch(()=>push({type:'backend',ready,message:'官方登录页面未能打开，请点击“打开官方授权页面”重试。'}));} };
  const show = (text:string) => {if(/报告登录完成/.test(text))loginSucceeded=true;push({type:'backend',ready,message:`${provider} 登录：${text}`});};
  if(provider==='codex'){
    child.stderr?.resume();
    void codexBrowserLogin(child,open,5*60_000).then(()=>{loginSucceeded=true;}).catch(()=>{loginSucceeded=false;show('官方授权尚未完成，请在设置中重新发起。');}).finally(()=>void stopOwned(child,1500));
  }else if(provider==='dsh'){
    const lines=createInterface({input:child.stdout!});
    lines.on('line',line=>{
      if(!line.startsWith('HIVELAB_DSH_ACCOUNT '))return;
      try{
        const value=JSON.parse(line.slice(19));
        if(value.type==='login-url'&&!opened){const url=new URL(value.url);if(url.origin==='https://platform.deepseek.com'&&url.pathname==='/dsh/authorize'&&!url.username&&!url.password)open(url.href);}
        else if(value.type==='phase')push({type:'backend',ready,message:`DSH 独立登录：${value.phase}${value.code?'（'+value.code+'）':''}`});
        else if(value.type==='status'){loginSucceeded=value.authenticated===true;push({type:'backend',ready,message:value.authenticated?'DSH 独立账号已登录':'DSH 登录状态：'+value.state});}
      }catch{push({type:'backend',ready,message:'DSH 登录组件返回无效状态'});}
    });
    child.stderr?.resume();child.once('close',()=>lines.close());
  }else{for(const stream of [child.stdout,child.stderr]){const output=loginOutput(provider,open,show);stream?.on('data',(chunk:Buffer)=>output.write(chunk));stream?.on('end',()=>output.end());}}
  child.on('error',()=>providerLoginState.update(provider,token,{phase:'failed',message:'官方登录程序启动失败，请检查程序路径。'}));
  child.once('close',code=>{
    if(loginChildren.get(provider)!==child)return;
    loginChildren.delete(provider);
    const completed=loginSucceeded&&(provider==='codex'||code===0);
    // DSH stores its grant before the login process finishes its own profile read, so an
    // unfinished DSH login is settled by the connection check rather than by the exit code.
    const unfinished='官方登录没有完成，可以重新登录。',recheck=!completed&&provider==='dsh'&&ready;
    const accepted=providerLoginState.update(provider,token,{phase:completed?'completed':'failed',message:completed?'官方程序报告登录完成，正在检查连接。':recheck?'登录程序没有报告完成，正在核对账号是否已经登录…':unfinished});
    if(ready)void request('internal.provider.loginEnd',{provider}).then(async()=>{
      if(!accepted||!completed&&!recheck)return;
      // The first check after a fresh install starts the program cold: give it the probe budget.
      const infos=await request('provider.probe',{provider},rpcTimeout('provider.probe')) as ProviderInfo[];
      const info=infos.find(item=>item.id===provider);
      // The program can report an unfinished login after the account was already stored.
      if(!completed){providerLoginState.settleUnfinished(provider,token,info?.available?{phase:'completed',message:'账号已经登录，连接检查通过。'}:{phase:'failed',message:unfinished});return;}
      providerLoginState.checked(provider,token,info?.available?'官方授权已完成，连接检查通过。':`官方授权已完成，连接检查未通过：${info?.detail||'请重新检测连接。'}`);
    }).catch(()=>{if(completed)providerLoginState.checked(provider,token,'官方授权已完成，连接检查还没有结果，请稍后重新检测连接。');else providerLoginState.settleUnfinished(provider,token,{phase:'failed',message:unfinished});});
  });
  }catch(error){providerLoginState.update(provider,token,{phase:'failed',message:`登录启动失败：${redact(error instanceof Error?error.message:String(error))}`});}
  finally{if(!loginChildren.has(provider)){loginStarting.delete(provider);if(loginHeld&&ready)void request('internal.provider.loginEnd',{provider}).catch(()=>{});}}
  })();
  return { started: true, detail: '正在准备官方登录，可在下方查看进度或取消。' };
}
const methods = new Set<string>(RENDERER_METHODS);
async function workspaceFileReference(reference:import('../shared/file-preview').FileReference){
  if(reference.source==='explorer')return workspaceFiles.resolve(reference.id,reference.path??'');
  const {session,project}=await request('internal.lookup',{sessionId:reference.id}) as Lookup;
  if(!session||!project||session.restoredHistoryOnly)throw Error('这份文件没有可用的原会话位置');
  if(typeof reference.path!=='string'||reference.path.length>4096||reference.path.includes('\0'))throw Error('文件链接无效');
  const roots=[session.workspace||project.directory,project.directory,path.join(dataDirectory,'artifacts',session.id),...(session.memberId?[deskDirectory(dataDirectory,session.memberId)]:[]),path.join(dataDirectory,'customizations')];
  const candidate=path.isAbsolute(reference.path)?path.resolve(reference.path):path.resolve(roots[0],reference.path);
  const target=realpathSync(candidate);
  for(const root of roots)try{const safe=resolveSafePath(root,path.relative(root,target));if(statSync(safe).isFile())return safe;}catch{}
  throw Error('文件不在这轮任务的工作位置，或文件已移动');
}
function registerIpc() {
  const sweepDeskFiles=()=>{if(ready&&!restoring&&!dirtyEditorCount&&!workspaceTerminals.list().some(t=>!t.exited))void request('deskFiles.sweep',{}).catch(error=>logStartup('desk-files cleanup: '+String(error)));};
  setTimeout(sweepDeskFiles,60000).unref();
  setInterval(sweepDeskFiles,15*60*1000).unref();
  ipcMain.handle('hivelab:invoke', async (event, method: string, params: any) => {
    if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame || !methods.has(method)) throw new Error('不允许的工作台请求');
    if(restoring&&!['snapshot','renderer.error','window.show','window.attention'].includes(method))throw new Error('正在恢复资料，请等待恢复完成。');
    if(method==='appearance.contrastFrame')return contrastFrame();
    if(method==='appearance.textCache.read')return adaptiveTextColors.read();
    if(method==='appearance.textCache.write')return adaptiveTextColors.write(params?.context,params?.tones);
    if(method==='link.open')return browserSidebar.external(params?.url,params?.browser);
    if(method==='link.menu')return browserSidebar.menu(params?.url);
    if(method==='browser.open')return browserSidebar.open(params?.url);
    if(method==='browser.state')return browserSidebar.snapshot();
    if(method==='browser.bounds')return browserSidebar.place(params);
    if(method==='browser.hide')return browserSidebar.hide();
    if(['browser.back','browser.forward','browser.reload','browser.stop'].includes(method))return browserSidebar.navigate(method.slice(8) as 'back'|'forward'|'reload'|'stop');
    if(method==='persona.file.open'){
      const document=await request('persona.file.read') as {path:string};
      const error=await shell.openPath(document.path);if(error)throw Error(error);
      return {opened:true};
    }
    if(method==='covenant.open'){
      const document=await request('covenant.read') as {path:string};
      const error=await shell.openPath(document.path);if(error)throw Error(error);
      return {opened:true};
    }
    if(method==='explorer.roots'){if(ready)deskFileRecords=await request('deskFiles.index',{});return workspaceFiles.roots();}
    if(['room.delete','storage.deleteTopic','storage.deleteSession','session.delete'].includes(method)&&params?.deleteFiles===true){
      if(dirtyEditorCount)throw Error('请先保存或关闭未保存的文件，再同步删除会话文件。');
      if(workspaceTerminals.list().some(t=>!t.exited))throw Error('请先关闭工作区终端，再同步删除会话文件。');
    }
    if(method.startsWith('deskFiles.')){
      const terminals=workspaceTerminals.list().filter(t=>!t.exited).map(t=>t.directory);
      if(['deskFiles.recycle','deskFiles.restore','deskFiles.purge','deskFiles.organize','deskFiles.share'].includes(method)){
        if(dirtyEditorCount)throw Error('请先保存或关闭未保存的文件，再整理工位文件。');
        const memberRoot=params?.memberId?deskDirectory(dataDirectory,String(params.memberId)).toLowerCase():path.resolve(dataDirectory,'desks').toLowerCase();
        if(terminals.some(t=>path.resolve(t).toLowerCase()===memberRoot||path.resolve(t).toLowerCase().startsWith(memberRoot+path.sep)))throw Error('请先关闭该工位的终端，再整理文件。');
      }
      return request(method,{...params,_terminalDirectories:terminals},180000);
    }
    if(method==='explorer.pick'){const picked=await dialog.showOpenDialog(window!,{title:'打开工作区文件夹',properties:['openDirectory']});return picked.canceled||!picked.filePaths[0]?null:workspaceFiles.add(picked.filePaths[0]);}
    if(method==='explorer.list')return workspaceFiles.list(params?.rootId,params?.path??'',params?.hidden!==false);
    if(method==='explorer.read')return workspaceFiles.read(params?.rootId,params?.path);
    if(method==='explorer.save')return workspaceFiles.save(params?.rootId,params?.path,params?.content,params?.version);
    if(method==='explorer.create')return workspaceFiles.create(params?.rootId,params?.parent??'',params?.name,params?.directory===true);
    if(method==='explorer.rename'){
      const before=workspaceFiles.resolve(params?.rootId,params?.path),result=await workspaceFiles.rename(params?.rootId,params?.path,params?.name);
      const after=workspaceFiles.resolve(params?.rootId,result.path);await request('deskFiles.renamedAt',{from:before,to:after});
      return result;
    }
    if(method==='explorer.dirty'){dirtyEditorCount=Number.isSafeInteger(params?.count)?Math.max(0,params.count):0;return {received:true};}
    if(method==='explorer.trash'){if(params?.confirm!==true)throw Error('请确认移入回收站。');await shell.trashItem(workspaceFiles.trashTarget(params?.rootId,params?.path));return {trashed:true};}
    if(method==='explorer.open'||method==='explorer.reveal'){
      const target=workspaceFiles.resolve(params?.rootId,params?.path??'');
      if(method==='explorer.reveal'||statSync(target).isFile()&&!OPENABLE_DOCUMENT.test(target)&&!/\.(?:doc|xls|ppt|rtf|odt|ods|odp|mp4|webm|mov|mp3|wav|flac|m4a|ogg)$/i.test(target)){shell.showItemInFolder(target);return {revealed:true};}
      const error=await shell.openPath(target);if(error)throw Error(error);return {opened:true};
    }
    if(method==='terminal.list')return workspaceTerminals.list();
    if(method==='terminal.open')return workspaceTerminals.open(params?.rootId,workspaceFiles.resolve(params?.rootId,params?.path??''),params?.cols,params?.rows);
    if(method==='terminal.read')return workspaceTerminals.read(params?.id,params?.cursor);
    if(method==='terminal.write')return workspaceTerminals.write(params?.id,params?.data);
    if(method==='terminal.resize')return workspaceTerminals.resize(params?.id,params?.cols,params?.rows);
    if(method==='terminal.close')return workspaceTerminals.close(params?.id);
    if(method==='backup.create'&&(loginChildren.size||loginStarting.size))throw new Error('成员登录仍在进行，请完成或结束登录后再备份。');
    if(method==='backup.prepare')return backups.prepare(String(params?.id));
    if(method==='backup.delete'){
      if(params?.confirm!==true)throw new Error('请先确认删除这份备份。');
      backups.assertRemovable(String(params?.id));
    }
    if(method==='backup.cancel')return backups.cancel(String(params?.token));
    if(method==='backup.restore')return restoreData(params);
    if (method === 'all.stop') return emergencyStop();
    if (method === 'backend.restart') return restartBackend();
    if (method === 'renderer.error') return logRendererError(params);
    if(method==='nativePlugins.pick'){const result=await dialog.showOpenDialog(window!,{title:'选择已解压的原生插件或插件市场目录',properties:['openDirectory']});return result.canceled?null:result.filePaths[0];}
    if(method==='nativeSkills.pick'){const result=await dialog.showOpenDialog(window!,{title:'选择包含 SKILL.md 的单个技能目录',properties:['openDirectory']});return result.canceled?null:result.filePaths[0];}
    if(method==='nativeSkills.folder'){const directory=await request('internal.nativeSkills.folder',params);const error=await shell.openPath(directory);if(error)throw Error(error);return {opened:true};}
    if(method==='nativePlugins.folder'){const providers=await request('nativePlugins.providers'),provider=providers.find((p:any)=>p.id===params?.provider);if(!provider?.home)throw Error('该执行端没有可管理的独立插件目录');const error=await shell.openPath(provider.home);if(error)throw Error(error);return {opened:true};}
    if(method==='extensions.pick'){
      if(!['plugin','skill'].includes(params?.kind))throw Error('扩展类型无效');
      const result=await dialog.showOpenDialog(window!,{title:params.kind==='skill'?'选择包含 SKILL.md 的技能目录（也可选择 Codex 已安装的技能目录）':'选择包含 hivelab-plugin.json 的插件目录',properties:['openDirectory']});
      return result.canceled?null:request('extensions.preview',{kind:params.kind,path:result.filePaths[0]});
    }
    if(method==='extensions.openFolder'){
      const catalog=await request('extensions.list');const item=params?.id?catalog.items.find((i:any)=>i.kind===params.kind&&i.id===params.id):undefined;
      const target=params?.id?item?.directory:['plugin','skill'].includes(params?.kind)?path.join(catalog.directory,params.kind+'s'):catalog.directory;if(!target)throw Error('扩展不存在');const error=await shell.openPath(target);if(error)throw Error(error);return {opened:true};
    }
    if(method==='extensions.openExamples'){const target=path.join(dist,'extensions','examples'),error=await shell.openPath(target);if(error)throw Error(error);return {opened:true};}
    const extensionForMethod:Record<string,string>={'file.export':'hivelab-files','file.preview':'hivelab-previews','background.save':'hivelab-backgrounds','background.import':'hivelab-backgrounds','background.wallpaper':'hivelab-backgrounds'};
    if(extensionForMethod[method])await request('internal.extensions.require',{id:extensionForMethod[method]});
    if (method === 'executor.save') return saveExecutor(params);
    if(method==='executor.authenticate'){
      const executor=lastSnapshot?.executors?.find(item=>item.id===params?.id);
      if(!executor?.catalogId)return request(method,params,rpcTimeout(method));
      loginBrowserGate.begin(executor.id,executor.catalogId);
      try{return await request(method,params,rpcTimeout(method));}finally{loginBrowserGate.finish(executor.id);}
    }
    if(method==='executor.cancelLogin'){loginBrowserGate.finish(String(params?.id));return request(method,params,rpcTimeout(method));}
    if(method==='executor.openLogin'){
      const executor=lastSnapshot?.executors?.find(item=>item.id===params?.id);
      const state=await request('executor.loginStatus',{id:executor?.id}) as {phase?:string;url?:string}|undefined;
      const url=executor?.catalogId&&state?.phase==='waiting'&&state.url?officialExecutorLoginUrl(executor.catalogId,state.url):undefined;
      if(!url)throw new Error('官方登录链接尚未准备好或已经过期，请重新登录。');
      await shell.openExternal(url);return {opened:true};
    }
    if(method==='catalog.openLink'){
      const entry=catalogEntry(params?.id),field=params?.kind;
      if(!['homepage','licenseUrl','termsUrl'].includes(field))throw new Error('只能打开清单中的官方链接。');
      await shell.openExternal(entry[field as 'homepage'|'licenseUrl'|'termsUrl']);return {opened:true};
    }
    if(method==='catalog.kimiChina'){
      const lookup=await request('internal.lookup',{executors:true}) as Pick<Snapshot,'executors'>;
      const executor=catalogExecutor(lookup.executors??[],'kimi',params?.executorId);
      if(!executor)throw new Error('Kimi 连接不存在。');
      const secrets=readAcpSecrets(executor.id);
      if(!secrets.KIMI_MODEL_API_KEY)throw new Error('请先在 Kimi 连接设置中填写中国站 API Key。');
      return request('catalog.credentials',{id:'kimi',executorId:executor.id,authentication:'kimi-api-cn',model:'kimi-k3',secrets},60_000);
    }
    if(method==='catalog.credentials'){
      const entry=catalogEntry(params?.id),auth=entry.authentication.find(item=>item.id===params?.authentication);
      const lookup=await request('internal.lookup',{executors:true}) as Pick<Snapshot,'executors'>;
      const previous=catalogExecutor(lookup.executors??[],entry.id,params?.executorId),id=previous?.id;
      if(!id||!auth)throw new Error('清单登录方式无效。');
      if(auth.kind==='api'&&previous?.authentication!==auth.id&&params.value===undefined&&!params.clear)throw new Error('切换订阅或 API 提供方时，请填写该登录方式对应的密钥。');
      const stored=readAcpSecrets(id),secrets:Record<string,string>={};
      for(const key of auth.secretKeys??[]){const value=params.clear?'':params.value===undefined?stored[key]:String(params.value).trim();if(value)secrets[key]=value;}
      if(Object.keys(secrets).length&&!safeStorage.isEncryptionAvailable())throw new Error('系统凭据加密不可用，没有保存密钥。');
      for(const value of Object.values(secrets))registerSecret(value);
      writeAcpSecrets(id,secrets);
      try{return await request('catalog.credentials',{id:entry.id,executorId:id,authentication:auth.id,model:params.model,baseUrl:params.baseUrl,clear:params.clear===true,secrets},60_000);}catch(error){writeAcpSecrets(id,stored);throw error;}
    }
    if(method==='claudeApiKey.set'){
      const value=String(params?.value??'').trim();if(value.length>4096||value&&/[\r\n\0]/.test(value))throw new Error('API Key 格式无效。');
      if(value&&!safeStorage.isEncryptionAvailable())throw new Error('系统凭据加密不可用，没有保存密钥。');
      if(value){registerSecret(value);writeEncryptedSecret(claudeApiFile(),value);}else rmSync(claudeApiFile(),{force:true});
      await request('internal.claudeApiKey',{value:value||undefined});await request('internal.provider.invalidate',{provider:'claude'});void request('provider.probe',{provider:'claude'}).catch(()=>{});return {saved:!!value};
    }
    if (method === 'executor.delete') { const result = await request('executor.delete', params); if (typeof params?.id === 'string') writeAcpSecrets(params.id, {}); return result; }
    if (method === 'dialog.program') {
      const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], title: '选择 AI 程序', filters: [{ name: '程序或脚本', extensions: ['exe', 'cmd', 'js', 'mjs', 'cjs'] }, { name: '所有文件', extensions: ['*'] }] });
      return result.canceled ? null : result.filePaths[0];
    }
    if (method === 'dialog.directory') { const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'], title: '选择项目目录' }); return result.canceled ? null : result.filePaths[0]; }
    if (method === 'provider.login') return login(params?.provider);
    if(method==='provider.loginStatus')return providerLoginState.get(String(params?.provider));
    if(method==='provider.openLogin'){
      const state=providerLoginState.get(String(params?.provider));
      if(state?.phase!=='waiting'||!state.url)throw new Error('官方授权链接尚未准备好或已过期，请重新登录。');
      await shell.openExternal(state.url);return {opened:true};
    }
    if(method==='provider.cancelLogin'){
      const provider=String(params?.provider);providerLoginState.cancel(provider);
      const child=loginChildren.get(provider);if(child)await stopOwned(child,1500);
      else if(!loginStarting.has(provider)&&ready)await request('internal.provider.loginEnd',{provider});
      return {cancelled:true};
    }
    if(method==='provider.logout'){
      const provider=String(params?.provider);
      if(loginChildren.has(provider)||loginStarting.has(provider))throw new Error('请先取消当前登录，再登出。');
      const result=await request('provider.logout',{provider},90_000);
      if(provider==='claude'){rmSync(claudeTokenFile(),{force:true});await request('internal.claudeToken',{value:undefined});}
      providerLoginState.clear(provider);return result;
    }
    if (method === 'provider.loginCode') {
      if(params?.provider!=='claude')throw new Error('该成员不使用授权码输入');
      await submitClaudeLoginCode(loginChildren.get('claude'),params?.code);return {submitted:true};
    }
    if (method === 'provider.tokenLogin') { if (params?.provider !== 'claude') throw new Error('只有 Claude 使用长期令牌登录'); if(!storedClaudeToken())throw new Error('请通过官方 Claude Code 登录，或选择 API Key。'); return login('claude'); }
    if (method === 'secret.set' && params?.provider === 'claude') {
      const value = String(params?.value || '').trim();
      if (value && !CLAUDE_TOKEN_PATTERN.test(value)) throw new Error('这不像 Claude 长期令牌。请复制令牌窗口里以 sk-ant- 开头的整行。');
      if (value && !safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，未保存令牌');
      if (value) { registerSecret(value); writeFileSync(claudeTokenFile(), safeStorage.encryptString(value)); } else rmSync(claudeTokenFile(), { force: true });
      await request('internal.claudeToken', { value: value || undefined }); await request('internal.provider.invalidate', { provider: 'claude' });
      await request('provider.probe', { provider: 'claude' }).catch(() => {}); return { saved: Boolean(value), cleared: !value };
    }
    if (method === 'secret.set') {
      if (params?.provider !== 'deepseek') throw new Error('首版仅保存 DeepSeek 备用密钥');
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，未保存密钥');
      const value = String(params?.value || '').trim(); registerSecret(value);
      writeFileSync(secretFile(), safeStorage.encryptString(value));
      await request('internal.key', { value }); await Promise.all([request('provider.probe', { provider: 'deepseek' }), request('provider.probe', { provider: 'dsh' })]); return { saved: true };
    }
    if (method === 'project.openPath') {
      const resolved = await request('project.openPath', params) as {root:string;relativePath:string;target:string;mode:'open'|'reveal';source?:'submitted'};
      if (resolved.source === 'submitted') {
        // A round's submitted copy lives in HiveLab's own flow workspaces; it is only shown in Explorer.
        const workspaces = realpathSync(path.join(dataDirectory, 'workspaces')), root = realpathSync(resolved.root);
        if (path.dirname(root).toLowerCase() !== workspaces.toLowerCase() || !path.basename(root).startsWith('flow-')) throw new Error('无法核对成果副本位置。');
        const target = resolveSafePath(root, resolved.relativePath);
        if (target !== resolved.target || !statSync(target).isFile()) throw new Error('成果副本已改变，请重新读取成果。');
        shell.showItemInFolder(target); return {revealed:true};
      }
      const { project } = await request('internal.lookup', { projectId: params.projectId }) as Lookup;
      if (!project) throw new Error('项目不存在。');
      const target = resolveSafePath(project.directory, resolved.relativePath);
      if (target !== resolved.target || resolveSafePath(project.directory) !== resolved.root || !statSync(target).isFile()) throw new Error('项目路径已改变，请重新打开。');
      if (resolved.mode === 'reveal' || !OPENABLE_DOCUMENT.test(target)) { shell.showItemInFolder(target); return {revealed:true}; }
      const error = await shell.openPath(target); if (error) throw new Error(error); return {opened:true};
    }
    if (method === 'artifact.open') {
      const { session, project: owner } = await request('internal.lookup', { sessionId: params?.sessionId }) as Lookup; if (!session) throw new Error('会话不存在');
      if(session.restoredHistoryOnly)throw new Error('恢复的会话仅保留历史，产物和工作副本未备份，请新建任务。');
      const project = owner!;
      const relative = String(params.relativePath || ''); const output = relative.startsWith('@artifacts/');
      const target = resolveSafePath(output ? path.join(dataDirectory, 'artifacts', session.id) : session.workspace || project.directory, output ? relative.slice(11) : relative);
      if (!/\.(?:txt|md|json|ya?ml|csv|log|png|jpe?g|webp|gif|pdf|docx|xlsx|pptx)$/i.test(target)) { shell.showItemInFolder(target); return { revealed: true, detail: '已在文件夹中显示产物，执行类文件不会从工作台直接运行' }; }
      const error = await shell.openPath(target); if (error) throw new Error(error); return { opened: true };
    }
    // Desktop affordances: taskbar attention while unfocused, focus from a notification, save an export.
    if (method === 'window.attention') { if (window && !window.isDestroyed() && !window.isFocused()) window.flashFrame(true); return { flashed: true }; }
    if(method==='window.notify'){const notice=normalizeMemberNotice(params);return memberNotifications.show({...notice,title:String(redact(notice.title)),body:String(redact(notice.body))});}
    if (method === 'window.show') { showMainWindow('notification'); window?.flashFrame(false); return { shown: true }; }
    if(method==='file.export'){const file=await fileOutputs.create(params);return fileOutputs.save(file.id,window);}
    if(method==='file.download')return fileOutputs.save(params?.id,window);
    if(method==='file.preview'){const data=await previewFile(dataDirectory,fileOutputs,params,workspaceFileReference);return ['html','audio','video'].includes(data.kind)?{...data,previewUrl:filePreviews.open(params,data.name)}:data;}
    if(method==='file.copy'){
      const {target}=await resolveFileReference(dataDirectory,fileOutputs,params,workspaceFileReference);
      if(!existsSync(target)||!statSync(target).isFile())throw Error('文件已移动或不存在。');
      // A picture goes on the clipboard as a picture, so it pastes into chats and editors.
      if(/\.(png|jpe?g|webp|gif|bmp)$/i.test(target)){const image=nativeImage.createFromPath(target);if(!image.isEmpty()){await clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(image.toPNG())],{type:'image/png'})})]);return {copied:'image'};}}
      // Other files are copied as files (Explorer's own format), so they paste into folders and back into the composer.
      if(process.platform==='win32'){
        const {execFile}=await import('node:child_process');
        await new Promise<void>((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','Set-Clipboard -LiteralPath $env:HIVELAB_COPY_PATH'],{windowsHide:true,timeout:15000,env:{...process.env,HIVELAB_COPY_PATH:target}},error=>error?reject(new Error('复制文件失败：'+error.message)):resolve()));
        return {copied:'file'};
      }
      await clipboard.writeText(target);return {copied:'path'};
    }
    if(method==='file.reveal'){
      const {target}=await resolveFileReference(dataDirectory,fileOutputs,params,workspaceFileReference);
      if(!existsSync(target))throw Error('文件已移动或不存在。');
      const info=statSync(target);if(!info.isFile()&&!info.isDirectory())throw Error('文件位置不可用。');
      shell.showItemInFolder(target);return {shown:true};
    }
    if (method === 'file.save') {
      const content = String(params?.content ?? ''); if (content.length > 20 * 1024 * 1024) throw new Error('导出内容过大');
      const name = String(params?.name ?? 'HiveLab 合屋 对话.md').replace(/[\\/:*?"<>|\r\n]+/g, ' ').slice(0, 120) || 'HiveLab 合屋 对话.md';
      const result = await dialog.showSaveDialog(window!, { title: String(params?.title??'导出对话').slice(0,80), defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '文本', extensions: ['txt'] }] });
      if (result.canceled || !result.filePath) return { saved: false };
      writeFileSync(result.filePath, content, 'utf8'); return { saved: true, path: result.filePath };
    }
    if (method === 'attachment.pick') {
      // Files the user picks are copied into HiveLab's attachment store by the backend; the originals stay put.
      const result = await dialog.showOpenDialog(window!, { title: '选择要附上的图片或文件', properties: ['openFile', 'multiSelections'], filters: [{ name: '所有文件', extensions: ['*'] }, { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
      if (result.canceled || !result.filePaths.length) return [];
      return request('attachment.import', { paths: result.filePaths }, rpcTimeout('attachment.import'));
    }
    if (method === 'attachment.reveal') {
      // Points Explorer at the stored copy; nothing is opened or run.
      const id = params?.id, name = typeof params?.name === 'string' ? params.name : '';
      if (!isAttachmentId(id) || !name || safeAttachmentName(name) !== name) throw new Error('附件无效');
      const file = path.join(dataDirectory, 'attachments', id, name);
      if (!existsSync(file)) throw new Error('附件已不存在');
      shell.showItemInFolder(file); return { shown: true };
    }
    // The running build and its deployment record sit next to HiveLab.exe.
    if (method === 'app.version') return runningVersion(process.platform==='darwin'?process.resourcesPath:path.dirname(process.execPath), app.isPackaged,process.platform==='darwin'?dataDirectory:undefined);
    if (method === 'app.accept') return acceptRunningVersion(process.platform==='darwin'?process.resourcesPath:path.dirname(process.execPath), app.isPackaged,undefined,process.platform==='darwin'?dataDirectory:undefined);
    if (method === 'attachment.save') {
      const id=params?.id,name=typeof params?.name==='string'?params.name:'';
      if(!isAttachmentId(id)||!name||safeAttachmentName(name)!==name||!/\.(png|jpe?g|webp|gif)$/i.test(name))throw new Error('图片无效');
      const source=resolveSafePath(dataDirectory,path.join('attachments',id,name));
      if(!statSync(source).isFile())throw new Error('图片已不存在');
      const extension=path.extname(name).slice(1);
      const result=await dialog.showSaveDialog(window!,{title:'保存图片',defaultPath:path.join(app.getPath('pictures'),name),filters:[{name:'图片',extensions:[extension]}],properties:['showOverwriteConfirmation']});
      if(result.canceled||!result.filePath)return {saved:false};
      copyFileSync(source,result.filePath);return {saved:true,path:result.filePath};
    }
    if (method === 'asset.import') {
      // Portraits and avatars the user picks are copied into HiveLab's own asset store; the original stays put.
      const result = await dialog.showOpenDialog(window!, { title: '选择图片', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
      if (result.canceled || !result.filePaths[0]) return { file: null };
      const source = result.filePaths[0], extension = path.extname(source).slice(1).toLowerCase();
      if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片');
      if (statSync(source).size > 8 * 1024 * 1024) throw new Error('图片太大了，请选择 8 MB 以内的图片');
      const directory = path.join(dataDirectory, 'assets'); mkdirSync(directory, { recursive: true });
      const file = `${randomUUID()}.${extension}`; copyFileSync(source, path.join(directory, file));
      return { file };
    }
    if(method==='startup.import'){
      const kind=params?.kind;if(kind!=='video'&&kind!=='image')throw Error('启动素材类型无效。');
      const extensions=kind==='video'?['mp4','webm','mov','m4v']:['png','jpg','jpeg','webp'];
      const result=await dialog.showOpenDialog(window!,{title:kind==='video'?'上传本地启动视频':'上传当前主页截图',properties:['openFile'],filters:[{name:kind==='video'?'视频':'主页截图',extensions}]});
      if(result.canceled||!result.filePaths[0])return null;
      const file=result.filePaths[0];if(!extensions.includes(path.extname(file).slice(1).toLowerCase()))throw Error('请选择支持的启动素材格式。');
      const imported=await startupMedia.import(file);return {file:imported.media!.file,name:imported.media!.name};
    }
    if(method==='startup.saveScene')return startupMedia.saveFrame(params?.data,params?.previous);
    if(method==='background.get')return backgrounds.get(String(params?.page??'home'));
    if(method==='background.save')return backgrounds.save(params,String(params?.page??'home'));
    if(method==='background.import'||method==='background.wallpaper'){
      const wallpaper=method==='background.wallpaper';
      const result=await dialog.showOpenDialog(window!,{title:wallpaper?'选择 Wallpaper Engine 的 project.json':'选择首页图片或视频',properties:['openFile'],filters:wallpaper?[{name:'Wallpaper Engine 项目',extensions:['json']}]:[{name:'图片与视频',extensions:['png','jpg','jpeg','webp','gif','mp4','webm','mov','m4v','json']}]});
      if(result.canceled||!result.filePaths[0])return null;
      return wallpaper||path.extname(result.filePaths[0]).toLowerCase()==='.json'?backgrounds.importWallpaper(result.filePaths[0],String(params?.page??'home')):backgrounds.import(result.filePaths[0],'local',undefined,String(params?.page??'home'));
    }
    if (method === 'storage.reveal') {
      // Settings → 存储: show a folder or file of the data folder in Explorer. Nothing outside it, nothing is run.
      const relative=String(params?.path??''),target=path.resolve(dataDirectory,relative),inside=path.relative(dataDirectory,target);
      if(inside.startsWith('..')||path.isAbsolute(inside))throw new Error('只能打开数据目录里的位置');
      if(!existsSync(target))throw new Error('这个位置已不存在，请重新统计');
      if(!statSync(target).isDirectory()){shell.showItemInFolder(target);return {revealed:true};}
      const error=await shell.openPath(target);if(error)throw new Error(error);return {opened:true};
    }
    if (method === 'desk.folder') {
      const result=await request('desk.folder',params) as {directory:string};
      const error=await shell.openPath(result.directory);if(error)throw new Error(error);return {opened:true,...result};
    }
    if (method === 'workspace.open') {
      // Opens the session's own work copy (or the project) in Explorer; nothing inside it is executed.
      const { session, project } = await request('internal.lookup', { sessionId: params?.sessionId }) as Lookup; if (!session) throw new Error('会话不存在');
      if(session.restoredHistoryOnly)throw new Error('恢复的会话仅保留历史，工作副本未备份，请新建任务。');
      const directory = session.workspace || project?.directory;
      if (!directory) throw new Error('这个会话还没有工作目录');
      const error = await shell.openPath(directory); if (error) throw new Error(error); return { opened: true, directory };
    }
    // Installing a member downloads a full package (can take minutes); version checks reach npm.
    const result = await request(method, params, rpcTimeout(method));
    if (method === 'settings.save') { /* Execution children get the latest isolated environment from Engine. */ }
    return result;
  });
}
function showMainWindow(reason: string) {
  if (!window || window.isDestroyed()) { logStartup(`show-pending ${reason}`); return; }
  if (window.isMinimized()) window.restore();
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const bounds = window.getBounds();
  if (!window.isMaximized() && (bounds.x < area.x || bounds.y < area.y || bounds.x + bounds.width > area.x + area.width || bounds.y + bounds.height > area.y + area.height)) {
    const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
    window.setMinimumSize(Math.min(1000, area.width), Math.min(700, area.height));
    window.setBounds({ x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2), width, height });
  }
  window.setSkipTaskbar(false);
  window.show(); window.moveTop(); window.focus();
  notifyRoomVisibility();
  logStartup(`window-visible ${JSON.stringify({ reason, visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), bounds: window.getBounds() })}`);
}
function notifyRoomVisibility(){
  if(ready&&window&&!window.isDestroyed())void request('internal.room.opened',{visible:window.isVisible()&&!window.isMinimized()},10_000).catch(()=>{});
}
function createWindow() {
  if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));
  const iconPath=path.join(dist,'hivelab.ico'),icon=nativeImage.createFromPath(path.join(dist,'hivelab.png'));
  if (icon.isEmpty()) throw new Error('HiveLab 合屋 窗口图标缺失，请使用完整程序包。');
  const startupDisplay=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),area=startupDisplay.workArea;
  const targetWidth=1832/startupDisplay.scaleFactor,targetHeight=1168/startupDisplay.scaleFactor;
  const startupScale=Math.min(1,(area.width-32)/targetWidth,(area.height-48)/targetHeight);
  const contentWidth=Math.max(16,Math.round(targetWidth*startupScale)),contentHeight=Math.max(16,Math.round(targetHeight*startupScale));
  window = new BrowserWindow({ width: contentWidth, height: contentHeight, useContentSize: true, minWidth: Math.min(1000,contentWidth), minHeight: Math.min(562,contentHeight), title: 'HiveLab 合屋', icon, backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff', show: false, webPreferences: { preload: path.join(dist, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if(process.platform==='win32')window.setAppDetails({appId:'local.hivelab.desktop',appIconPath:iconPath,appIconIndex:0,relaunchCommand:app.isPackaged?`"${process.execPath}"`:`"${process.execPath}" "${root}"`,relaunchDisplayName:'HiveLab 合屋'});
  window.setMenuBarVisibility(false);
  window.on('focus',()=>window?.flashFrame(false));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  void window.loadFile(path.join(dist, 'renderer', 'index.html')).catch(startupFailed);
  window.once('ready-to-show', () => { window!.setContentSize(contentWidth,contentHeight); window!.center(); showMainWindow('ready'); if (lastSnapshot) push({ type: 'snapshot', snapshot: lastSnapshot }); });
  window.on('show',notifyRoomVisibility);window.on('hide',notifyRoomVisibility);window.on('minimize',notifyRoomVisibility);window.on('restore',notifyRoomVisibility);window.on('focus',notifyRoomVisibility);
  window.webContents.on('render-process-gone', (_event, details) => { if (!quitting) startupFailed(new Error(`界面进程退出：${details.reason} (${details.exitCode})`)); });
  window.on('close', event => { if (!quitting) { event.preventDefault(); window!.hide(); logStartup('window-hidden-to-tray'); } });
  const appContents=window.webContents,appUrl=pathToFileURL(path.join(dist,'renderer','index.html')).href;
  appContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(allowClipboardPermission(permission,contents===appContents,details,appUrl)));
  appContents.session.setPermissionCheckHandler((contents,permission,_origin,details)=>allowClipboardPermission(permission,contents===appContents,details,appUrl));
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(dist,'hivelab.png')).resize({width:16,height:16}));
  trayLanguage = undefined; syncTrayLanguage();
  tray.on('double-click', () => showMainWindow('tray-double-click'));
}
// Uploaded portraits and avatars are served read-only from the asset store, by name only.
protocol.registerSchemesAsPrivileged([{scheme:'hivelab-startup',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}},{scheme:'hivelab-preview',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}},{scheme:'hivelab-wallpaper',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}},{ scheme: 'hivelab-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled:true } },{scheme:'hivelab-background',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}},{scheme:'hivelab-generated',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
function serveAssets() {
  protocol.handle('hivelab-startup',request=>startupMedia.serve(request));
  protocol.handle('hivelab-preview',request=>filePreviews.serve(request));
  protocol.handle('hivelab-wallpaper',request=>backgrounds.wallpapers.serve(request));
  protocol.handle('hivelab-background',request=>backgrounds.serve(request));
  // 成果文件直读：聊天里的 PNG 走这里，省掉 file.preview 的 base64 往返。
  protocol.handle('hivelab-generated', async request => {
    try {
      const url = new URL(request.url);
      const id = decodeURIComponent((url.host || '') + url.pathname).replace(/^\/+/, '').replace(/[?#].*$/, '');
      const {file,bytes} = await fileOutputs.read(id);
      const type = file.format === 'png' ? 'image/png' : file.format === 'pdf' ? 'application/pdf' : 'application/octet-stream';
      return new Response(new Uint8Array(bytes), {headers:{'content-type':type,'cache-control':'no-store','access-control-allow-origin':'*'}});
    } catch {
      return new Response('not found', {status:404});
    }
  });
  protocol.handle('hivelab-asset', async request => {
    const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    // Attached images are served from their own store, by id and stored name only.
    const attached = /^attachments\/([a-f0-9-]{36})\/([^/\\]+)$/.exec(name);
    if (attached) {
      if (!/\.(png|jpe?g|webp|gif)$/i.test(attached[2]) || safeAttachmentName(attached[2]) !== attached[2]) return new Response('not found', { status: 404 });
      return net.fetch(pathToFileURL(path.join(dataDirectory, 'attachments', attached[1], attached[2])).toString());
    }
    if (!/^[a-f0-9-]{8,64}\.(png|jpe?g|webp|gif)$/i.test(name)) return new Response('not found', { status: 404 });
    const response=await net.fetch(pathToFileURL(path.join(dataDirectory, 'assets', name)).toString());
    const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin','*');
    return new Response(response.body,{status:response.status,headers});
  });
}
// Windows shows desktop notifications under this identity (same as the packaged appId).
if(process.platform==='win32')app.setAppUserModelId('local.hivelab.desktop');
if(process.argv.includes('--agentnest-glm-balance')){
  app.whenReady().then(()=>exportGlmBalance(dataDirectory,readAcpSecrets)).then(()=>app.exit(0)).catch(()=>app.exit(1));
}else if(process.argv.includes('--agentnest-kimi-balance')){
  app.whenReady().then(()=>exportKimiBalance(dataDirectory,readAcpSecrets)).then(()=>app.exit(0)).catch(()=>app.exit(1));
}else if (!app.requestSingleInstanceLock()) app.quit();
else {
  if(process.platform==='darwin'){
    app.on('activate',()=>showMainWindow('dock-activate'));
  }
  app.on('second-instance', () => showMainWindow('second-instance'));
  app.whenReady().then(async () => { await recoverInterruptedRestore(dataDirectory);try{desktopTools.sweep();}catch{}const tempCleanup=await sweepOwnedTemp(nativeTemp);if(tempCleanup.removed||tempCleanup.failed)logStartup(`process-temp cleanup ${JSON.stringify(tempCleanup)}`);serveAssets(); registerIpc(); createWindow(); createTray(); computerIndicator=new ComputerIndicator(runId=>request('run.stop',{runId}),()=>showMainWindow('computer-stop'),error=>logStartup(`computer-indicator: ${String(error)}`)); startBackend(); powerMonitor.on('resume', () => { void checkConnectivity(); }); }).catch(startupFailed);
  app.on('before-quit', event => {
    if(restoring){event.preventDefault();quitAfterRestore=true;return;}
    if (quitting) return;
    if(dirtyEditorCount&&dialog.showMessageBoxSync(window!,{type:'question',buttons:['继续编辑','放弃修改并退出'],defaultId:0,cancelId:0,message:`还有 ${dirtyEditorCount} 个文件未保存`,detail:'未保存的编辑内容会在退出后丢失。'})===0){event.preventDefault();return;}
    event.preventDefault(); quitting = true; browserSidebar.dispose();workspaceTerminals.dispose();computerIndicator?.destroy();memberNotifications.close();
    void (async () => { await emergencyStop(); if (ready) try { await request('internal.close', {}, 5000); } catch { stopBackend(); } tray?.destroy(); app.exit(0); })();
  });
}

import {t} from './i18n';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronRight, Eraser, FolderOpen, Files, HardDrive, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { STORAGE_CATEGORIES, formatBytes, type StorageEntry, type StorageUsage, type StorageCategory } from '../shared/storage';
import type { SettingsTab } from './settings';
import type { Snapshot } from '../shared/types';
import { BackupSettings } from './backup';
import { DeskFileManager, DeskFilePreferencesSettings } from './desk-file-manager';
import { dateTime, errorText, type Invoke, type Notify } from './ui';
import './storage-settings.css';
import {DeleteSessionDialog} from './delete-session-dialog';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Where the data folder's space goes, and the places to free it: programs, desk files, topics, old copies. */
/** Categories whose own panel already lists every piece; a size breakdown would only repeat it. */
const OWN_LIST = new Set<StorageCategory>(['programs', 'desks', 'logs', 'backups']);
const NOTES: Partial<Record<StorageCategory, string>> = {
  get native(){return t("登录配置和各执行端自己的会话记录；删除话题时会一并清理对应的原生会话。")},
  get attachments(){return t("附件与生成文件随聊天记录保存，可在相应对话中预览和另存；删除话题时可选择同步删除。")},
  get temp(){return t("只清理已结束的 HiveLab 任务留下的目录；运行中执行端正在使用的临时文件不会被删除。")},
};
const shareText = (share: number) => share >= 0.995 ? '100%' : share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`;

export function StorageSettings({ snapshot, invoke, notify, onBackupBusy, onRestored, onNavigate }: { snapshot: Snapshot; invoke: Invoke; notify: Notify; onBackupBusy: (busy: boolean) => void; onRestored: () => void; onNavigate?: (tab: SettingsTab) => void }) {
  const [open, setOpen] = useState(new Set<StorageCategory>());
  const [usage, setUsage] = useState<StorageUsage>();
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [working, setWorking] = useState('');
  const [deleting,setDeleting]=useState<{memberId:string;threadId:string;title:string}>();
  const [files, setFiles] = useState<string>();
  const [selectedBackups, setSelectedBackups] = useState(new Set<string>());

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError('');
    try { setUsage(await invoke<StorageUsage>('storage.usage', { refresh }, undefined, { background: true })); }
    catch (cause) { setError(errorText(cause)); }
    finally { setLoading(false); }
  }, [invoke]);
  useEffect(() => { void load(false); }, [load]);

  async function act(key: string, action: () => Promise<unknown>) {
    setWorking(key); setError('');
    try { await action(); await load(true); } catch (cause) { setError(errorText(cause)); } finally { setWorking(''); }
  }
  const locked = Boolean(working) || !snapshot.backendReady;
  const total = usage?.total ?? 0;
  const categories = STORAGE_CATEGORIES.map(item => ({ ...item, bytes: usage?.categories[item.id] ?? 0 }));
  const toggle = (id: StorageCategory, value: boolean) => setOpen(previous => { if (previous.has(id) === value) return previous; const next = new Set(previous); if (value) next.add(id); else next.delete(id); return next; });
  /** Open another card on this page and bring it into view, highlighted the same way a settings link marks its target. */
  const scrollBehavior = (): ScrollBehavior => document.documentElement.dataset.motion === 'off' ? 'auto' : 'smooth';
  const showCategory = (id: StorageCategory) => {
    toggle(id, true);
    requestAnimationFrame(() => { const card = document.querySelector<HTMLElement>(`.storage-category[data-category="${id}"]`); if (!card) return; card.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }); card.classList.remove('focus-flash'); void card.offsetWidth; card.classList.add('focus-flash'); });
  };
  const showBackups = () => document.querySelector<HTMLElement>(`.storage-settings > [aria-label="${CSS.escape(t("备份"))}"]`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  const reveal = (target: string) => void invoke('storage.reveal', { path: target }).catch(cause => setError(errorText(cause)));
  const go = (tab: SettingsTab, label: string) => onNavigate ? <button type="button" className="button small secondary" key={tab} onClick={() => onNavigate(tab)}><ArrowUpRight size={13} />{label}</button> : null;
  const jump = (id: StorageCategory, label: string) => <button type="button" className="button small quiet" key={id} onClick={() => showCategory(id)}><ChevronRight size={13} />{label}</button>;
  const sweepTemp = () => void act('temp', async () => { const result = await invoke<{ removed: number; failed: number }>('storage.sweepTemp'); notify(result.failed ? t("已清理 {0} 个残留目录，{1} 个暂时无法删除。", result.removed, result.failed) : t("已清理 {0} 个残留目录。", result.removed)); });
  const breakdown = (id: StorageCategory, entries: StorageEntry[] | undefined, bytes: number) => entries?.length ? <ul className="storage-breakdown" aria-label={t("占用明细")}>{entries.map(entry => {
    const share = bytes ? entry.bytes / bytes : 0;
    return <li key={entry.path + entry.label} className="storage-row">
      <span><strong>{entry.label}</strong><small>{entry.path}{entry.items !== undefined ? t(" · {0} 项", entry.items) : ''}</small><i className="storage-share" aria-hidden="true"><b className={`storage-${id}`} style={{ width: `${Math.max(share * 100, entry.bytes ? 1 : 0)}%` }} /></i></span>
      <em>{formatBytes(entry.bytes)}{bytes > 0 && <small>{shareText(share)}</small>}</em>
      <button type="button" className="button small quiet" aria-label={t("打开 {0}", entry.label)} title={entry.directory ? t("在资源管理器中打开") : t("在资源管理器中显示")} disabled={!snapshot.backendReady} onClick={() => reveal(entry.path)}><FolderOpen size={12} />{entry.directory ? t("打开") : t("显示")}</button>
    </li>;
  })}</ul> : null;
  /** Where each category is managed and what can be cleaned from here, beyond its own list. */
  const actions: Partial<Record<StorageCategory, ReactNode[]>> = {
    programs: [go('connections', t("前往“连接与版本”"))],
    native: [go('connections', t("管理登录（连接与版本）")), jump('database', t("清理话题记录"))],
    database: [<button type="button" className="button small secondary" key="backup" onClick={showBackups}><ArrowUpRight size={13} />{t("备份与恢复")}</button>],
    attachments: [jump('database', t("按话题清理（可同步删除文件）"))],
    media: [go('appearance', t("壁纸与背景视频（外观）")), go('workspace', t("启动动画（工作台）"))],
    runtime: [go('extensions', t("管理插件")), go('skills', t("管理 Skills")), go('network', t("网络与下载源"))],
    temp: [<button type="button" className="button small quiet" key="sweep" disabled={locked || !usage?.staleTemp} title={usage?.staleTemp ? undefined : t("没有已结束任务留下的目录；运行中执行端的临时文件不会被清理")} onClick={sweepTemp}>{working === 'temp' ? <LoaderCircle size={12} className="spin" /> : <Eraser size={12} />}{t("清理已结束任务的残留{0}", usage?.staleTemp ? t("（{0} 个）", usage.staleTemp) : '')}</button>, jump('desks', t("工位临时文件保留规则"))],
    logs: [<button type="button" className="button small quiet" key="open" disabled={!snapshot.backendReady} onClick={() => reveal('logs')}><FolderOpen size={12} />{t("打开日志文件夹")}</button>],
    backups: [<button type="button" className="button small quiet" key="open" disabled={!snapshot.backendReady} onClick={() => reveal('.')}><FolderOpen size={12} />{t("打开数据目录")}</button>],
  };

  const panels: Partial<Record<StorageCategory, ReactNode>> = {
programs: (<section className="settings-group" aria-label={t("执行端程序")}><h3>{t("执行端程序")}</h3>
      <p className="settings-description">{t("从清单下载的 CLI 程序本体。删除或卸载只移除程序文件；人物卡、连接、登录配置和聊天记录保留，需要时可在“连接与版本”中重新下载。")}</p>
      {!usage ? <p className="provider-detail">{loading ? t("正在读取…") : t("暂无数据")}</p> : !usage.programs.length ? <p className="provider-detail">{t("没有 HiveLab 合屋 管理的程序版本。手动添加的程序不在这里，请在原安装位置卸载。")}</p>
        : usage.programs.map(program => <div className="storage-item" key={program.id}>
          <div className="storage-item-head"><strong>{program.name}</strong><em>{formatBytes(sum(program.versions.map(item => item.bytes)))}</em>
            <button type="button" className="button small quiet danger" disabled={locked} onClick={() => { if (window.confirm(t("卸载 {0} 的全部 {1} 个版本（包括正在使用的）？程序文件会被删除；人物卡、连接、聊天记录和登录配置都会保留，使用它的成员在重新安装前无法回复。", program.name, program.versions.length))) void act(`uninstall:${program.id}`, () => invoke('catalog.uninstall', { id: program.id }, t("已卸载 {0}。", program.name))); }}>{working === `uninstall:${program.id}` ? <LoaderCircle size={12} className="spin" /> : <Trash2 size={12} />}{t("卸载程序")}</button></div>
          {program.versions.map(version => <div className="storage-row" key={version.version}><span>{version.version}{version.inUse && <span className="version-badge ok">{t("正在使用")}</span>}</span><em>{formatBytes(version.bytes)}</em>
            <button type="button" className="button small quiet danger" disabled={locked || version.inUse} title={version.inUse ? t("正在使用的版本请用“卸载程序”，或先在连接与版本中切换") : undefined} onClick={() => { if (window.confirm(t("删除 {0} {1} 的程序目录？聊天记录和登录配置会保留。", program.name, version.version))) void act(`remove:${program.id}:${version.version}`, () => invoke('catalog.remove', { id: program.id, version: version.version }, t("已删除 {0}。", version.version))); }}>{working === `remove:${program.id}:${version.version}` ? <LoaderCircle size={12} className="spin" /> : <Trash2 size={12} />}{t("删除版本")}</button></div>)}
        </div>)}
    </section>),
desks: (<section className="settings-group" aria-label={t("工位文件")}><h3>{t("工位文件")}</h3>
      <p className="settings-description">{t("包含已删除人物保留的个人文件夹。文件管理中的清理会先将文件移入回收区；聊天记录在“聊天与设置数据库”卡片中管理。")}</p>
      {usage?.desks.map(desk => <details className="storage-item storage-desk" key={desk.memberId}>
        <summary className="storage-item-head"><ChevronRight size={14} className="storage-chevron" /><strong>{desk.name}</strong>{desk.removed && <span className="version-badge neutral">{t("人物卡已删除")}</span>}<small>{t("{0} 个话题", desk.topics.length)}</small><em>{formatBytes(desk.bytes)}</em></summary>
        <div className="storage-actions">
          <button type="button" className="button small secondary" disabled={!snapshot.backendReady} onClick={() => setFiles(desk.memberId)}><Files size={13} />{t("文件管理")}</button>
          <button type="button" className="button small quiet" disabled={!snapshot.backendReady} onClick={() => void invoke('desk.folder', { memberId: desk.memberId }).catch(cause => setError(errorText(cause)))}><FolderOpen size={13} />{t("打开个人文件夹")}</button>
        </div>
      </details>)}
      <DeskFilePreferencesSettings invoke={invoke} />
    </section>),
database: (<section className="settings-group" aria-label={t("聊天记录")}><h3>{t("聊天记录")}</h3>
      <p className="settings-description">{t("包含现有人物和已删除人物保留的话题。删除时可选择是否同步删除会话内文件，默认保留文件。")}</p>
      {usage?.desks.map(desk => <details className="storage-item storage-desk" key={desk.memberId}>
        <summary className="storage-item-head"><ChevronRight size={14} className="storage-chevron" /><strong>{desk.name}</strong>{desk.removed && <span className="version-badge neutral">{t("人物卡已删除")}</span>}<small>{t("{0} 个话题", desk.topics.length)}</small></summary>
        {desk.topics.length ? <ul className="storage-topics">{desk.topics.map(topic => <li key={topic.id} className="storage-row">
          <span><strong>{topic.title}</strong>{topic.current && <span className="version-badge neutral">{t("当前")}</span>}<small>{t("{0} 条消息 · {1} · {2}", topic.messages, dateTime(topic.updatedAt), topic.directory)}</small></span>
          <button type="button" className="button small quiet danger" disabled={locked} onClick={() => setDeleting({memberId:desk.memberId,threadId:topic.id,title:topic.title})}>{working === `topic:${topic.id}` ? <LoaderCircle size={12} className="spin" /> : <Trash2 size={12} />}{t("删除")}</button>
        </li>)}</ul> : <p className="provider-detail">{t("还没有话题。")}</p>}
      </details>)}

    </section>),
backups: (<section className="settings-group" aria-label={t("旧数据库备份")}><h3>{t("旧数据库备份")}</h3>
      {usage?.backups.length ? <>
        <p className="settings-description">{t("以下数据库副本由升级或迁移留下，是回退点。确认不再需要回退后再删除；正式备份请在下方“备份”中管理。")}</p>
        {usage.backups.map(item => <label className="storage-row storage-check" key={item.name}><input type="checkbox" checked={selectedBackups.has(item.name)} disabled={locked} onChange={event => setSelectedBackups(previous => { const next = new Set(previous); if (event.target.checked) next.add(item.name); else next.delete(item.name); return next; })} /><span>{item.name}</span><em>{formatBytes(item.bytes)}</em></label>)}
        <div className="storage-actions"><button type="button" className="button small quiet danger" disabled={locked || !selectedBackups.size} onClick={() => { const names = [...selectedBackups]; if (window.confirm(t("永久删除选中的 {0} 个数据库副本（{1}）？删除后无法用它们回退。", names.length, formatBytes(sum(usage.backups.filter(item => selectedBackups.has(item.name)).map(item => item.bytes)))))) void act('backups', async () => { await invoke('storage.removeBackups', { names }, t("已删除 {0} 个数据库副本。", names.length)); setSelectedBackups(new Set()); }); }}><Trash2 size={12} />{t("删除选中的副本")}</button></div>
      </> : <p className="provider-detail">{t("没有旧数据库副本。")}</p>}
</section>),
logs: (<section className="settings-group" aria-label={t("日志")}><h3>{t("日志")}</h3>      <div className="storage-row"><span>{t("日志文件 {0} 个", usage?.logFiles ?? 0)}<small>{t("数据库里另有一份事件记录，删除旧日志不影响聊天和任务记录。")}</small></span><em>{formatBytes(usage?.categories.logs ?? 0)}</em>
        <button type="button" className="button small quiet" disabled={locked || !usage?.logFiles} onClick={() => { if (window.confirm(t("删除 30 天前的日志文件？"))) void act('logs', () => invoke('storage.removeLogs', { days: 30 }, t("已清理旧日志。"))); }}>{working === 'logs' ? <LoaderCircle size={12} className="spin" /> : <Trash2 size={12} />}{t("删除 30 天前的日志")}</button></div>
    </section>)
  };

  return <div className="storage-settings">
    <section className="settings-group storage-summary" aria-label={t("空间占用")}>
      <div className="storage-summary-head">
        <div><h3><HardDrive size={16} />{t("空间占用")}</h3><small>{usage ? t("数据目录共 {0} · 统计于 {1}", formatBytes(total), dateTime(usage.measuredAt)) : loading ? t("正在统计，文件较多时需要几十秒…") : t("尚未统计")}</small></div>
        <button type="button" className="button small quiet" disabled={loading || !snapshot.backendReady} onClick={() => void load(true)}><RefreshCw size={13} className={loading ? 'spin' : ''} />{t("重新统计")}</button>
      </div>
      {usage && <code className="data-directory">{usage.directory}</code>}
      {total > 0 && <div className="storage-bar" role="img" aria-label={t("各类数据占用比例")}>{categories.filter(item => item.bytes > 0).map(item => <span key={item.id} className={`storage-bar-part storage-${item.id}`} style={{ flexGrow: item.bytes }} title={`${item.label} ${formatBytes(item.bytes)}`} />)}</div>}
      <div className="storage-category-grid">{categories.map(item => <details className="storage-category" key={item.id} data-category={item.id} open={open.has(item.id)} onToggle={event => toggle(item.id, event.currentTarget.open)}>
        <summary><i className={`storage-swatch storage-${item.id}`} /><strong>{item.label}</strong><em>{formatBytes(item.bytes)}</em><ChevronRight size={15} className="storage-chevron" /></summary>
        <div className="storage-category-body">
          <p className="settings-description">{item.hint || t("其他配置与辅助文件。")}</p>
          {NOTES[item.id] && <p className="settings-description storage-note">{NOTES[item.id]}</p>}
          {actions[item.id] && <div className="storage-actions">{actions[item.id]}</div>}
          {!OWN_LIST.has(item.id) && breakdown(item.id, usage?.breakdown?.[item.id], item.bytes)}
          {panels[item.id]}
          {!usage && <small className="provider-detail">{loading ? t("正在统计…") : t("尚未统计")}</small>}
        </div>
      </details>)}</div>
    </section>
    {error && <p role="alert" className="inline-notice error">{error}</p>}

    <section className="settings-group" aria-label={t("备份")}><BackupSettings invoke={invoke} notify={notify} available={snapshot.backendReady} onBusy={onBackupBusy} onRestored={onRestored} /></section>
    {files && <DeskFileManager snapshot={snapshot} invoke={invoke} memberId={files} onClose={() => { setFiles(undefined); void load(true); }} />}
    {deleting&&<DeleteSessionDialog title={deleting.title} onClose={()=>setDeleting(undefined)} onDelete={async deleteFiles=>{await invoke('storage.deleteTopic',{...deleting,deleteFiles},t("话题已删除。"));await load(true);}}/>}
  </div>;
}

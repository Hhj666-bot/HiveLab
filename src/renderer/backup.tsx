import {t} from './i18n';
import { useEffect, useRef, useState } from 'react';
import { Archive, LoaderCircle, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import type { BackupEntry, BackupPreview, RestorePreview, RestoreResult } from '../shared/backup';
import { bytes, dateTime, errorText, type Invoke, type Notify } from './ui';

export function BackupSettings({invoke,notify,available,onBusy,onRestored}:{invoke:Invoke;notify:Notify;available:boolean;onBusy:(busy:boolean)=>void;onRestored:()=>void}){
  const [entries,setEntries]=useState<BackupEntry[]>([]),[preview,setPreview]=useState<BackupPreview>(),[prepared,setPrepared]=useState<RestorePreview>();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef<string|undefined>(undefined);
  useEffect(()=>{let alive=true;void invoke<BackupEntry[]>('backup.list').then(value=>{if(!Array.isArray(value))throw new Error(t("备份列表尚未加载，请刷新后重试。"));if(alive)setEntries(value);}).catch(error=>{if(alive)setError(errorText(error));});return()=>{alive=false;if(pending.current)void invoke('backup.cancel',{token:pending.current}).catch(()=>{});};},[invoke]);
  async function act(action:()=>Promise<void>){if(busy)return;setBusy(true);onBusy(true);setError('');try{await action();}catch(error){setError(errorText(error));}finally{setBusy(false);onBusy(false);}}
  async function cancel(){const token=pending.current;pending.current=undefined;setPrepared(undefined);if(token)await invoke('backup.cancel',{token});}
  async function refresh(){await cancel();setPreview(undefined);setEntries(await invoke<BackupEntry[]>('backup.list'));}
  async function create(){await invoke('backup.create');await refresh();notify(t("资料备份已保存并校验。"));}
  async function remove(entry:BackupEntry){
    if(!window.confirm(t("删除 {0} 的备份？这份备份删除后无法恢复，当前聊天和人物资料不受影响。", entry.manifest?dateTime(entry.manifest.createdAt):entry.id)))return;
    await cancel();await invoke('backup.delete',{id:entry.id,confirm:true});await refresh();notify(t("备份已删除。"));
  }
  async function inspect(id:string){await cancel();setPreview(await invoke<BackupPreview>('backup.preview',{id}));}
  async function prepare(){if(!preview)return;const result=await invoke<RestorePreview>('backup.prepare',{id:preview.id});pending.current=result.token;setPrepared(result);}
  async function restore(){
    if(!prepared)return;
    const result=await invoke<RestoreResult>('backup.restore',{token:prepared.token,confirm:true});
    if(result.restored){pending.current=undefined;setPrepared(undefined);notify(result.detail);onRestored();}
  }
  return <section className="backup-settings" aria-label={t("资料备份与恢复")}>
    <div className="settings-section-heading"><h3>{t("资料备份与恢复")}</h3><button type="button" className="button small quiet" disabled={busy||!available} onClick={()=>void act(refresh)}><RefreshCw size={13}/>{t("刷新")}</button></div>
    <p className="settings-description">{t("备份保存聊天、人物卡、长期记忆、附件与图片。")}<strong>{t("工位个人文件夹和圆桌稿件不在备份中")}</strong>{t("，需要时请自行复制；成员登录、程序版本、工作副本和还原点也不备份。恢复时保留这台电脑当前的成员登录；原项目会话仅供查看，自动功能保持暂停。")}</p>
    <button type="button" className="button secondary" disabled={busy||!available} onClick={()=>void act(create)}>{busy?<LoaderCircle size={14} className="spin"/>:<Archive size={14}/>}{t("立即备份资料")}</button>
    <p className="panel-muted">{t("默认只保留最近 1 份备份。新备份保存并完整校验后，才会删除旧备份；校验异常的备份保留供你检查。备份存放在资料目录外的 backups 文件夹。")}</p>
    <div className="backup-list">{entries.length?entries.map(entry=><div className={`backup-list-item ${preview?.id===entry.id?'selected':''}`} key={entry.id}>
      <div><strong>{entry.manifest?dateTime(entry.manifest.createdAt):entry.id}</strong><small>{entry.manifest?t("{0} · {1} · {2} 条消息", entry.manifest.reason==='manual'?t("手动备份"):entry.manifest.reason==='deploy'?t("更新前备份"):t("恢复前备份"), bytes(entry.bytes), entry.manifest.counts.messages):entry.error}</small></div>
      <button type="button" className="button small secondary" disabled={busy||Boolean(entry.error)||!available} onClick={()=>void act(()=>inspect(entry.id))}>{t("预览备份")}</button>
      <button type="button" className="button small quiet danger" disabled={busy||!available} aria-label={t("删除备份 {0}", entry.id)} onClick={()=>void act(()=>remove(entry))}><Trash2 size={13}/>{t("删除备份")}</button>
    </div>):<p className="panel-muted">{t("还没有可用备份。可以先保存一份当前资料。")}</p>}</div>
    {preview&&<div className="backup-preview" role="group" aria-label={t("备份内容预览")}>
      <strong>{t("{0} · 内容校验通过", dateTime(preview.manifest.createdAt))}</strong>
      <dl><div><dt>{t("话题与消息")}</dt><dd>{t("{0} 个话题，{1} 条消息", preview.manifest.counts.threads, preview.manifest.counts.messages)}</dd></div><div><dt>{t("已保存人物卡")}</dt><dd>{t("{0} 张{1}", preview.manifest.counts.members, preview.memberNames.length?`（${preview.memberNames.join('、')}）`:'')}</dd></div><div><dt>{t("会话与任务记录")}</dt><dd>{t("{0} 个会话，{1} 次任务", preview.manifest.counts.sessions, preview.manifest.counts.runs)}</dd></div><div><dt>{t("程序版本")}</dt><dd>{preview.manifest.appVersion||t("未记录")}{preview.manifest.sourceCommit?` · ${preview.manifest.sourceCommit.slice(0,8)}`:''}</dd></div></dl>
      {!prepared&&<button type="button" className="button secondary" disabled={busy||!available} onClick={()=>void act(prepare)}><RotateCcw size={14}/>{t("准备恢复这份备份")}</button>}
    </div>}
    {prepared&&<div className="backup-confirm" role="group" aria-label={t("确认恢复资料")}>
      <strong>{t("已复制到临时目录并完成校验")}</strong>
      <p>{t("确认后，先备份当前资料，再替换为 {0} 的记录并重启执行服务。当前成员登录保持原样，项目文件不会恢复到过去的状态；旧项目会话请新建任务继续。", dateTime(prepared.backup.manifest.createdAt))}</p>
      <div className="backup-actions"><button type="button" className="button quiet" disabled={busy} onClick={()=>void act(cancel)}>{t("取消恢复")}</button><button type="button" className="button secondary danger" disabled={busy||!available} onClick={()=>void act(restore)}>{busy?<LoaderCircle size={14} className="spin"/>:<RotateCcw size={14}/>}{t("确认恢复并重启")}</button></div>
    </div>}
    {error&&<p className="inline-notice error" role="alert">{error}</p>}
  </section>;
}

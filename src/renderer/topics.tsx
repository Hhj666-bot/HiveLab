import {t} from './i18n';
import { useState } from 'react';
import { Archive, Download, Eraser, Eye, FileStack, LoaderCircle, MessageSquarePlus, Pencil, Sparkles, Trash2, X } from 'lucide-react';
import type { RoomThread, Snapshot } from '../shared/types';
import { Markdown } from './Markdown';
import { Modal } from './modals';
import {DeleteSessionDialog} from './delete-session-dialog';
import { TopicFocusShade } from './topic-focus';
import type { TeamMember } from './members';
import { dateTime, type Invoke } from './ui';

const SUMMARIZER_KEY = 'hivelab.room.summarizer';

/** Who writes topic summaries; remembered per viewer, falling back to the first member who is ready. */
export function useSummarizer(usable: TeamMember[]) {
  const [chosen, setChosen] = useState(() => { try { return localStorage.getItem(SUMMARIZER_KEY) ?? ''; } catch { return ''; } });
  const member = usable.find(item => item.id === chosen) ?? usable[0];
  const choose = (id: string) => { setChosen(id); try { localStorage.setItem(SUMMARIZER_KEY, id); } catch {} };
  return { member, choose };
}

function SummarizerSelect({ usable, member, onChange }: { usable: TeamMember[]; member?: TeamMember; onChange: (id: string) => void }) {
  if (!usable.length) return <span className="summarizer muted">{t("没有可以整理摘要的成员")}</span>;
  return <label className="summarizer">{t("由")}<select aria-label={t("由谁来压缩")} value={member?.id} onChange={event => onChange(event.target.value)}>{usable.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{t("整理摘要")}</label>;
}

/** The summary a topic carries, folded by default. */
export function SummaryNote({ thread }: { thread: RoomThread }) {
  return <>
    {thread.inherited && <details className="topic-summary inherited"><summary>{t("延续「{0}」的摘要", thread.inherited.title)}</summary><Markdown text={thread.inherited.text} /></details>}
    {thread.summary && <details className="topic-summary"><summary>{t("已压缩 · {0} · {1} · 覆盖 {2} 条", thread.summary.byName ?? t("成员"), dateTime(thread.summary.at), thread.summary.count)}</summary><Markdown text={thread.summary.text} /></details>}
  </>;
}

/** Start a new topic: archive the current one, optionally carrying a summary of it (or of an archived topic). */
export function NewTopicDialog({ snapshot, current, from, usable, invoke, onClose, onDone, personal=false }: { snapshot: Snapshot; current: RoomThread; from?: RoomThread; usable: TeamMember[]; invoke: Invoke; onClose: () => void; onDone: () => void; personal?:boolean }) {
  const source = from ?? current;
  const hasMessages = (current.count ?? snapshot.room.messages.length) > 0;
  const [title, setTitle] = useState(personal||['当前话题',t("当前话题")].includes(current.title) ? '' : current.title);
  const [inherit, setInherit] = useState(!personal);
  const [busy, setBusy] = useState(false);
  const summarizer = useSummarizer(usable);
  async function confirm() {
    setBusy(true);
    try {
      if(personal&&inherit)await invoke('room.compress',{threadId:current.id});
      await invoke('room.archive', { title: title.trim() || undefined, inherit: Boolean(from) || inherit, memberId: summarizer.member?.id, from: from?.id }, from ? t("新话题会接着「{0}」聊。", from.title) : inherit ? t("已归档，新话题会带上摘要。") : t("已归档，开始新话题。"));
      onDone();
    } catch {} finally { setBusy(false); }
  }
  const needsWriter = (Boolean(from) || inherit) && !source.summary;
  return <Modal title={from ? t("接着这个话题聊") : t("开新话题")} subtitle={from ? t("新话题会带上「{0}」的摘要，成员从摘要继续。", from.title) : personal&&!current.id?t("新话题将在当前文件夹创建。"):t("当前话题会归档保存，可以随时查看、导出或删除。")} onClose={() => { if (!busy) onClose(); }} className="topic-dialog">
    <div className="modal-body">
      {(hasMessages||personal) && <label className="field">{personal?t("新话题名称"):t("给当前话题起个名字")}<input aria-label={personal?t("新话题名称"):t("给当前话题起个名字")} value={title} maxLength={64} onChange={event => setTitle(event.target.value)} placeholder={personal?t("当前话题"):current.title} /><small>{personal?t("当前话题会归档，历史里可继续原会话。"):t("留空就用第一句话作为名字。")}</small></label>}
      {personal&&<p className="panel-muted">{t("新话题在当前文件夹创建。切换工作目录请使用工位顶部的“切换文件夹”。")}</p>}
      {!from && (!personal||current.id) && <label className="check-row"><input type="checkbox" checked={inherit} onChange={event => setInherit(event.target.checked)} /><span><strong>{t("新话题继承压缩后的上下文")}</strong><small>{t("成员在新话题里会先看到这段摘要，不需要从头讲起。")}</small></span></label>}
      {(from || inherit) && <div className="info-card"><Sparkles size={18} /><div>
        <p>{source.summary ? t("「{0}」已有摘要；如果之后又有新消息，会先更新摘要。", source.title) : t("会先把「{0}」压缩成摘要，这需要使用一次成员额度。", source.title)}</p>
        {(needsWriter || source.summary) && <SummarizerSelect usable={usable} member={summarizer.member} onChange={summarizer.choose} />}
      </div></div>}
    </div>
    <div className="modal-footer"><button type="button" className="button quiet" disabled={busy} onClick={onClose}>{t("取消")}</button>
      <button type="button" className="button primary" disabled={busy || ((from || inherit) && !summarizer.member) || !snapshot.backendReady} onClick={() => void confirm()}>{busy ? <LoaderCircle size={14} className="spin" /> : <MessageSquarePlus size={14} />}{busy ? (from || inherit) ? t("正在整理摘要…") : t("正在创建话题…") : t("开始新话题")}</button></div>
  </Modal>;
}

/** Every topic in one place: view, rename, compress, export, clear or delete. */
export function TopicPanel({ snapshot, selectedId, usable, invoke, busy, onSelect, onContinue, onExport, onClear, onClose,onChanged,personal=false,historyOnly=false }: {
  snapshot: Snapshot; selectedId: string; usable: TeamMember[]; invoke: Invoke; busy: boolean;
  onSelect: (id: string) => void; onContinue: (thread: RoomThread) => void; onExport: (id: string) => void; onClear: () => void; onClose: () => void;
  personal?:boolean; historyOnly?:boolean; onChanged?:()=>void;
}) {
  const threads = snapshot.room.threads ?? [];
  const currentId = snapshot.room.currentThreadId;
  const summarizer = useSummarizer(usable);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [working, setWorking] = useState<{id:string;label:string} | null>(null);
  const [actionError,setActionError]=useState<{id:string;message:string}>();
  const [deleting,setDeleting]=useState<RoomThread>();
  const [panelElement,setPanelElement]=useState<HTMLElement|null>(null);
  const locked = busy || Boolean(working) || snapshot.room.state.active || Boolean(snapshot.room.state.compressing) || !snapshot.backendReady;
  // Also refresh immediately after a local action while the backend revision reaches other views.
  async function run(id: string, action: () => Promise<unknown>,label:string) { setActionError(undefined);setWorking({id,label}); try { await action(); } catch(error) { setActionError({id,message:error instanceof Error?error.message:t("操作未完成，请重试。")}); } finally { setWorking(null); onChanged?.(); } }
  const compress = (thread: RoomThread) => run(thread.id, () => invoke('room.compress', { threadId: thread.id, memberId: summarizer.member?.id }, thread.id === currentId ? t("已压缩，成员接下来从摘要继续。") : t("摘要已更新。")),thread.summary?t("正在更新摘要…"):t("正在压缩话题…"));
  const remove = (thread: RoomThread) => {if(personal)setDeleting(thread);else if(window.confirm(t("删除归档话题「{0}」？这段记录将永久删除，当前话题不受影响。", thread.title)))void run(thread.id,()=>invoke('room.delete',{threadId:thread.id},t("归档话题已删除。")),t("正在删除话题…"));};
  const rename = () => { if (!renaming) return; const { id, title } = renaming; setRenaming(null); if (title.trim()) void run(id, () => invoke('room.rename', { threadId: id, title }),t("正在保存名称…")); };
  return <><aside ref={setPanelElement} className="topic-panel" aria-label={t("话题管理")}>
    <header><div><h2>{t("话题管理")}</h2><p>{t("共 {0} 个话题", threads.length)}</p></div><button type="button" className="icon-button" aria-label={t("关闭话题管理")} title={t("关闭话题管理")} onClick={onClose}><X size={16} /></button></header>
    <div className="topic-panel-tools"><strong>{t("摘要整理")}</strong><SummarizerSelect usable={usable} member={summarizer.member} onChange={summarizer.choose} /><p>{t("压缩后成员会从摘要继续，节省上下文。")}</p></div>
    <ol className="topic-list">
      {!threads.length&&<li className="topic-list-empty"><MessageSquarePlus size={24}/><strong>{t("暂无话题")}</strong><span>{t("开始聊天后，这里会保存话题记录。")}</span></li>}
      {threads.map(thread => {
        const current = thread.id === currentId, selected = thread.id === selectedId, empty = !thread.count;
        return <li key={thread.id} className={`topic-item ${current ? 'current' : ''} ${selected ? 'selected' : ''}`} aria-busy={working?.id===thread.id}>
          <div className="topic-item-head">
            {renaming?.id === thread.id ? <input className="topic-rename" autoFocus aria-label={t("话题名称")} value={renaming.title} maxLength={64} onChange={event => setRenaming({ id: thread.id, title: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') rename(); if (event.key === 'Escape') setRenaming(null); }} onBlur={rename} />
              : <strong title={thread.title}>{thread.title}</strong>}
            <span className={`topic-badge ${current ? 'current' : ''}`}>{current ? t("当前") : t("归档")}</span>
          </div>
          <small className="topic-meta"><span>{t("{0} 条消息", thread.count ?? 0)}</span><span>{current ? t("开始于 {0}", dateTime(thread.createdAt)) : t("归档于 {0}", dateTime(thread.archivedAt))}</span></small>
          <SummaryNote thread={thread} />
          <div className="topic-actions" role="group" aria-label={t("「{0}」操作", thread.title)}>
            {(!selected||!current)&&<div className="topic-actions-main">
              {!selected && <button type="button" className="button small secondary" disabled={personal&&(busy||Boolean(working)||!snapshot.backendReady)} onClick={() => onSelect(thread.id)}><Eye size={13} />{personal?t("打开话题"):t("查看")}</button>}
              {!current&&<button type="button" className={`button small ${selected?'secondary':'quiet'}`} disabled={personal?busy||Boolean(working)||!snapshot.backendReady:locked} onClick={() => onContinue(thread)}><FileStack size={13} />{t("接着聊")}</button>}
            </div>}
            <div className="topic-actions-tools">
              <button type="button" className="button small quiet" disabled={locked} onClick={() => setRenaming({ id: thread.id, title: thread.title })}><Pencil size={13} />{t("改名")}</button>
              <button type="button" className="button small quiet" disabled={locked || historyOnly || (personal&&!current) || (empty && !thread.inherited) || !summarizer.member} onClick={() => void compress(thread)}><Sparkles size={13} />{thread.summary ? t("更新摘要") : t("压缩")}</button>
              <button type="button" className="button small quiet" disabled={locked || empty} onClick={() => onExport(thread.id)}><Download size={13} />{t("导出")}</button>
            </div>
            <div className="topic-actions-danger">
              {current&&<button type="button" className="button small quiet danger" disabled={locked || empty || historyOnly} onClick={onClear}><Eraser size={13} />{t("清空")}</button>}
              {(!current||personal)&&<button type="button" className="button small quiet danger" disabled={locked} onClick={()=>remove(thread)}><Trash2 size={13}/>{t("删除")}</button>}
            </div>
          </div>
          {working?.id===thread.id&&<small className="topic-working" role="status"><LoaderCircle size={13} className="spin"/>{working.label}</small>}
          {!deleting&&actionError?.id===thread.id&&<small className="topic-action-error" role="alert">{actionError.message}</small>}
        </li>;
      })}
    </ol>
    <p className="topic-panel-note"><Archive size={12} />{personal?t("打开或接着聊会恢复这个话题的原生会话，话题之间不共享上下文。"):t("归档的话题只读；“接着聊”会开一个新话题并带上它的摘要。")}</p>
    {deleting&&<DeleteSessionDialog title={deleting.title} busy={Boolean(working)} onClose={()=>setDeleting(undefined)} onDelete={async deleteFiles=>{await invoke('room.delete',{threadId:deleting.id,deleteFiles},t("话题已删除。"));onChanged?.();}}/>}
  </aside><TopicFocusShade panel={panelElement}/></>;
}

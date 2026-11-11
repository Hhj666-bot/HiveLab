import {t} from './i18n';
import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { File as FileIcon, FileText, FolderOpen, LoaderCircle, Plus, X } from 'lucide-react';
import type { Attachment } from '../shared/types';
import { ATTACHMENTS_MAX, ATTACHMENT_MAX_BYTES, sizeText } from '../shared/attachments';
import type { Invoke } from './ui';
import {ImagePreview,FilePreview} from './file-preview';
import {useFileActions} from './file-actions';

/** Attached images are served from HiveLab's own store by id and stored name. */
export const attachmentUrl = (item: Pick<Attachment, 'id' | 'name'>) => `hivelab-asset://local/attachments/${item.id}/${encodeURIComponent(item.name)}`;

/** Files waiting to go with the next message: picked with "+", or dropped onto the composer. */
export function useAttachments(invoke: Invoke, initial: Attachment[] = [],controlled?:{items:Attachment[];update:(change:(previous:Attachment[])=>Attachment[])=>void}) {
  const [localItems, setLocalItems] = useState<Attachment[]>(initial), [busy, setBusy] = useState(false), [dragging, setDragging] = useState(false), [error, setError] = useState('');
  const importing = useRef(false);
  const items=controlled?.items??localItems,setItems=controlled?.update??setLocalItems;
  const add = (added: Attachment[] | undefined) => { if (added?.length) setItems(previous => [...previous, ...added.filter(item => !previous.some(old => old.id === item.id))].slice(0, ATTACHMENTS_MAX)); };
  async function load(action: () => Promise<Attachment[]>) {
    if (importing.current) return;
    importing.current = true; setBusy(true); setError('');
    try { add(await action()); } catch (cause) { setError(cause instanceof Error ? cause.message : t("附件添加失败，请重试")); }
    finally { importing.current = false; setBusy(false); }
  }
  const checkCount = (count: number) => { if (items.length + count > ATTACHMENTS_MAX) throw new Error(t("一条消息最多附 {0} 个文件，请先移除部分附件", ATTACHMENTS_MAX)); };
  async function pick() { await load(async () => { const picked = await invoke<Attachment[]>('attachment.pick'); checkCount(picked.length); return picked; }); }
  async function paste(event: ClipboardEvent) {
    const all = [...event.clipboardData.files];
    if (!all.length) return; // Plain text keeps the browser's normal selection/caret behavior.
    event.preventDefault();
    // Files copied from Explorer (or from an attachment's 复制) keep their path; pasted pictures arrive as data.
    const paths = all.map(file => window.hivelab?.pathForFile?.(file) ?? '').filter(Boolean);
    const files = all.filter(file => file.type.startsWith('image/') && !window.hivelab?.pathForFile?.(file));
    await load(async () => {
      checkCount(paths.length + files.length);
      const imported = paths.length ? await invoke<Attachment[]>('attachment.import', { paths }) : [];
      if (!files.length) return imported;
      const images = await Promise.all(files.map(async (file, index) => {
        if (file.size > ATTACHMENT_MAX_BYTES) throw new Error(t("图片超过 {0}，请换一个小一些的文件", sizeText(ATTACHMENT_MAX_BYTES)));
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error(t("无法读取剪贴板图片，请重新复制"))); reader.readAsDataURL(file);
        });
        return { name: file.name || t("粘贴图片-{0}.png", index + 1), dataUrl };
      }));
      return [...imported, ...await invoke<Attachment[]>('attachment.paste', { images })];
    });
  }
  async function drop(event: DragEvent) {
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault();
    const paths = files.map(file => window.hivelab?.pathForFile?.(file) ?? '').filter(Boolean);
    if (!paths.length) return;
    await load(async () => { checkCount(paths.length); return invoke<Attachment[]>('attachment.import', { paths }); });
  }
  const dropTarget = {
    onDragOver: (event: DragEvent) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent) => void drop(event),
    onPaste: (event: ClipboardEvent) => void paste(event),
  };
  return { items, busy, dragging, error, pick, dropTarget, remove: (id: string) => {setError('');setItems(previous => previous.filter(item => item.id !== id));}, clear: () => {setError('');setItems(() => []);} };
}

export function AttachButton({ onPick, busy, disabled, title = t("添加图片或文件（支持拖入和 Ctrl+V 粘贴图片）") }: { onPick: () => void; busy: boolean; disabled?: boolean; title?: string }) {
  return <button type="button" className="icon-button attach-button" aria-label={t("添加图片或文件")} title={title} disabled={busy || disabled} onClick={onPick}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={17} />}</button>;
}

const kindIcon = (item: Attachment) => item.kind === 'text' ? <FileText size={16} /> : <FileIcon size={16} />;

/** The files about to be sent, each removable. */
export function AttachmentTray({ items, onRemove, error, invoke }: { items: Attachment[]; onRemove: (id: string) => void; error?: string; invoke?: Invoke }) {
  const [preview,setPreview]=useState<Attachment>(),[notice,setNotice]=useState('');
  const actions=useFileActions(invoke??(()=>Promise.reject(new Error(t("不可用")))) as Invoke,setNotice,kind=>setNotice(kind==='image'?t("图片已复制。"):kind==='file'?t("文件已复制，可以粘贴到文件夹或输入框。"):t("路径已复制。")));
  if (!items.length && !error) return null;
  const open=(item:Attachment)=>{if(invoke)setPreview(item);};
  return <div className="attachment-tray" aria-label={t("待发送的附件")}>{error&&<p className="attachment-error" role="alert">{error}</p>}{items.map(item => <span className={`attachment-chip ${invoke?'previewable':''}`} key={item.id} onContextMenu={invoke?event=>actions.context(event,{source:'attachment',id:item.id,name:item.name},()=>open(item)):undefined}>
    <button type="button" className="attachment-open glass-content-action" title={invoke?t("{0} · 点击预览，右键复制", item.name):item.name} disabled={!invoke} onClick={()=>open(item)}>
      {item.kind === 'image' ? <img src={attachmentUrl(item)} alt="" /> : <span className="attachment-icon">{kindIcon(item)}</span>}
      <span className="attachment-meta"><strong title={item.name}>{item.name}</strong><small>{sizeText(item.size)}</small></span>
    </button>
    <button type="button" className="glass-content-action" aria-label={t("移除附件 {0}", item.name)} onClick={() => onRemove(item.id)}><X size={12} /></button>
  </span>)}{actions.menu}{notice&&<small className="attachment-notice" role="status">{notice}</small>}{invoke&&preview&&(preview.kind==='image'?<ImagePreview image={preview} invoke={invoke} onClose={()=>setPreview(undefined)}/>:<FilePreview file={{source:'attachment',id:preview.id,name:preview.name}} invoke={invoke} onClose={()=>setPreview(undefined)}/>)}</div>;
}

/** Files on a sent message: pictures shown, other files named; either can be shown in Explorer. */
export function AttachmentList({ items, invoke, align = 'start' }: { items?: Attachment[]; invoke: Invoke; align?: 'start' | 'end' }) {
  const [preview,setPreview]=useState<Attachment>();
  const [locationError,setLocationError]=useState(''),actions=useFileActions(invoke,setLocationError,kind=>setLocationError(kind==='image'?t("图片已复制。"):kind==='file'?t("文件已复制。"):t("路径已复制。")));
  if (!items?.length) return null;
  const reveal = (item: Attachment) => void invoke('attachment.reveal', { id: item.id, name: item.name }).catch(() => {});
  return <div className={`attachment-list ${align}`}>{items.map(item => item.kind === 'image'
    ? <button type="button" key={item.id} className="attachment-image" onContextMenu={event=>actions.context(event,{source:'attachment',id:item.id,name:item.name},()=>setPreview(item))} title={t("{0} · 在右侧预览", item.name)} onClick={()=>setPreview(item)} onDoubleClick={()=>setPreview(item)}><img src={attachmentUrl(item)} alt={item.name} /></button>
    : <span key={item.id} className="attachment-chip sent action-card" onContextMenu={event=>actions.context(event,{source:'attachment',id:item.id,name:item.name},()=>setPreview(item))}><span className="attachment-icon">{kindIcon(item)}</span><button type="button" className="attachment-file-preview action-card-main glass-content-action" title={t("在右侧预览文件")} onClick={()=>setPreview(item)} onDoubleClick={()=>setPreview(item)}><span className="attachment-meta"><strong title={item.name}>{item.name}</strong><small>{sizeText(item.size)}</small></span></button>
      <button type="button" className="glass-content-action" aria-label={t("在文件夹中显示 {0}", item.name)} title={t("在文件夹中显示")} onClick={() => reveal(item)}><FolderOpen size={13} /></button></span>)}{actions.menu}{locationError&&<small role="alert">{locationError}</small>}{preview&&(preview.kind==='image'?<ImagePreview image={preview} invoke={invoke} onClose={()=>setPreview(undefined)}/>:<FilePreview file={{source:'attachment',id:preview.id,name:preview.name}} invoke={invoke} onClose={()=>setPreview(undefined)}/>)}</div>;
}

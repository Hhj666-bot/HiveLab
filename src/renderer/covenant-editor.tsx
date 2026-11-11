import {t} from './i18n';
import { useCallback, useEffect, useState } from 'react';
import { CodeXml, Eye, Plus, RefreshCw, ExternalLink, RotateCcw, Save } from 'lucide-react';
import type { CovenantDocument } from '../shared/workspace-covenant';
import { Markdown } from './Markdown';
import { errorText, type Invoke } from './ui';
import './covenant-editor.css';

export function CovenantEditor({ invoke, userTitle = t("用户") }: { invoke: Invoke; userTitle?: string }) {
  const [document, setDocument] = useState<CovenantDocument>();
  const [draft, setDraft] = useState(''), [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [inserting, setInserting] = useState(false), [title, setTitle] = useState(''), [content, setContent] = useState('');
  const dirty = document !== undefined && draft !== document.content;
  const adopt = useCallback((value: CovenantDocument) => { setDocument(value); setDraft(value.content); }, []);
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { adopt(await invoke<CovenantDocument>('covenant.read')); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }, [invoke, adopt]);
  useEffect(() => { void load(); }, [load]);

  async function change(method: 'covenant.save' | 'covenant.append' | 'covenant.reset', params?: unknown) {
    setBusy(true); setError('');
    try { adopt(await invoke<CovenantDocument>(method, params)); return true; }
    catch (error) { setError(errorText(error)); return false; }
    finally { setBusy(false); }
  }
  async function insert() {
    if (await change('covenant.append', { title, content })) { setTitle(''); setContent(''); setInserting(false); }
  }
  function refresh() {
    if (!dirty || window.confirm(t("放弃未保存的修改并重新读取公约？"))) void load();
  }

  return <div className="covenant-editor">
    <div className="covenant-toolbar" role="toolbar" aria-label={t("工作公约工具")}>
      <button type="button" className="button small quiet" onClick={refresh} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''}/>{t("刷新")}</button>
      <button type="button" className="button small quiet" onClick={() => setEditing(value => !value)} disabled={busy || !document}>{editing ? <Eye size={14}/> : <CodeXml size={14}/>} {editing ? t("预览公约") : t("编辑公约")}</button>
      <button type="button" className="button small quiet" onClick={() => setInserting(value => !value)} disabled={busy || !document || dirty}><Plus size={14}/>{t("插入条目")}</button>
      <button type="button" className="button small quiet" disabled={busy || !document || dirty} onClick={() => void invoke('covenant.open').catch(error => setError(errorText(error)))}><ExternalLink size={14}/>{t("在编辑器中打开")}</button>
      <button type="button" className="button small quiet" disabled={busy || !document} onClick={() => { if (window.confirm(t("重置为默认公约？当前公约内容将被替换。"))) void change('covenant.reset'); }}><RotateCcw size={14}/>{t("重置")}</button>
      {dirty && <button type="button" className="button small primary" disabled={busy} onClick={() => void change('covenant.save', { content: draft })}><Save size={14}/>{t("保存公约")}</button>}
    </div>
    {error && <p role="alert" className="inline-notice error">{error}</p>}
    {!document ? <div className="covenant-empty">{busy ? t("正在读取工作公约…") : t("公约读取失败，可点击刷新重试。")}</div> : <>
      <p className="covenant-file-path">{document.path}{dirty ? t(" · 未保存") : ''}</p>
      {inserting && <section className="covenant-insert" aria-label={t("插入公约条目")}>
        <label className="field">{t("条目标题")}<input value={title} onChange={event => setTitle(event.target.value)} autoFocus/></label>
        <label className="field">{t("条目内容")}<textarea rows={4} value={content} onChange={event => setContent(event.target.value)}/></label>
        <div className="covenant-insert-actions"><button className="button quiet small" disabled={busy} onClick={() => setInserting(false)}>{t("取消插入")}</button><button className="button primary small" disabled={busy || !title.trim()} onClick={() => void insert()}>{t("插入并保存")}</button></div>
      </section>}
      {editing ? <textarea className="covenant-source" aria-label={t("工作公约内容")} value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false}/> : <div className="covenant-preview" aria-label={t("工作公约预览")}><Markdown text={draft.replace(/\{\{USER_TITLE\}\}/g, userTitle || t("用户"))}/></div>}
    </>}
  </div>;
}

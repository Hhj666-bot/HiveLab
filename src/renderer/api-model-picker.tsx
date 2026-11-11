import {t} from './i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { catalogEntry } from '../shared/executor-catalog';
import type { Snapshot } from '../shared/types';
import { errorText, type Invoke } from './ui';

/**
 * Choose a model the way Codex does: a button showing the current model, and a popover listing what the service
 * offers. The list is read from the service on first open (read-only, no model task); a name typed into the search
 * box can be used as it is, for models the service does not list.
 */
export function ApiModelPicker({ label, value, onChange, load, suggestions = [], emptyLabel, placeholder = t("选择模型"), disabled }: {
  label: string; value: string; onChange: (value: string) => void;
  /** Reads the service's list; omitted when the connection has no list to read. */
  load?: () => Promise<{ models: string[] }>;
  /** Models the program already reported; shown even before (or without) a list from the service. */
  suggestions?: { id: string; label?: string }[];
  /** When set, the first row clears the choice (e.g. "提供方默认"). */
  emptyLabel?: string; placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [fetched, setFetched] = useState<string[]>(), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const node = useRef<HTMLDivElement>(null);
  async function read() {
    if (!load) return;
    setLoading(true); setError('');
    try { setFetched((await load()).models); } catch (cause) { setError(errorText(cause)); } finally { setLoading(false); }
  }
  useEffect(() => { if (open && fetched === undefined && !loading) void read(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !node.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const models = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of suggestions) if (item.id) seen.set(item.id, item.label && item.label !== item.id ? item.label : item.id);
    for (const id of fetched ?? []) if (!seen.has(id)) seen.set(id, id);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [suggestions, fetched]);
  const term = query.trim().toLowerCase(), shown = term ? models.filter(item => item.id.toLowerCase().includes(term) || item.name.toLowerCase().includes(term)) : models;
  const typed = query.trim(), usable = !!typed && !/\s/.test(typed) && !models.some(item => item.id === typed);
  const choose = (id: string) => { onChange(id); setOpen(false); setQuery(''); };
  const current = models.find(item => item.id === value);
  return <div className="field compact api-model-field" ref={node}>
    <span>{label}</span>
    <button type="button" className="api-model-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(previous => !previous)}>
      <span className={value ? '' : 'placeholder'}>{value ? current?.name ?? value : emptyLabel ?? placeholder}</span>
      <ChevronDown size={14} className={open ? 'open' : ''} />
    </button>
    {open && <div className="api-model-popover" role="dialog" aria-label={t("{0}清单", label)}>
      <label className="api-model-search"><Search size={14} /><input autoFocus aria-label={t("搜索或填写模型名称")} value={query} spellCheck={false} placeholder={load ? t("搜索，或直接输入模型名称") : t("输入模型名称")} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (usable) choose(typed); else if (shown.length === 1) choose(shown[0].id); } }} />
        {load && <button type="button" className="icon-button" title={t("重新读取模型清单")} aria-label={t("重新读取模型清单")} disabled={loading} onClick={() => void read()}><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>}</label>
      <div className="api-model-list" role="listbox" aria-label={label}>
        {emptyLabel && !term && <button type="button" role="option" aria-selected={!value} className={!value ? 'selected' : ''} onClick={() => choose('')}><span>{emptyLabel}</span>{!value && <Check size={14} />}</button>}
        {usable && <button type="button" role="option" aria-selected={false} onClick={() => choose(typed)}><span>{t("使用「{0}」", typed)}</span><small>{t("手动填写")}</small></button>}
        {shown.map(item => <button type="button" role="option" key={item.id} aria-selected={item.id === value} className={item.id === value ? 'selected' : ''} title={item.id} onClick={() => choose(item.id)}><span>{item.name}</span>{item.name !== item.id ? <small>{item.id}</small> : null}{item.id === value && <Check size={14} />}</button>)}
        {loading && <p className="api-model-state"><LoaderCircle size={13} className="spin" />{t("正在读取这个服务的模型清单…")}</p>}
        {!loading && error && <p className="api-model-state error" role="alert">{error}</p>}
        {!loading && !error && !shown.length && !usable && <p className="api-model-state">{term ? t("没有匹配的模型，可以直接输入完整名称后按回车。") : load ? t("服务没有列出模型，可以直接输入名称。") : t("输入模型名称后按回车。")}</p>}
      </div>
      {fetched && <small className="api-model-foot">{t("服务列出 {0} 个模型，读取清单不发送模型任务。", fetched.length)}</small>}
    </div>}
  </div>;
}

/** A reader for the service's model list, for connections on an API key that name their service address. */
export function modelListLoader(snapshot: Snapshot, invoke: Invoke, provider: string): (() => Promise<{ models: string[] }>) | undefined {
  if (provider === 'claude') return snapshot.settings.claudeAuthMode === 'api' ? () => invoke<{ models: string[] }>('catalog.models', { provider: 'claude' }, undefined, { background: true }) : undefined;
  const executor = snapshot.executors?.find(item => item.id === provider);
  if (!executor?.catalogId) return;
  const entry = catalogEntry(executor.catalogId), auth = entry.authentication.find(item => item.id === executor.authentication);
  if (auth?.kind !== 'api' || !(entry.modelConfiguration?.baseUrlEnvironment || Object.keys(auth.environment ?? {}).some(name => /BASE_URL$/.test(name)))) return;
  return () => invoke<{ models: string[] }>('catalog.models', { id: entry.id, executorId: executor.id }, undefined, { background: true });
}

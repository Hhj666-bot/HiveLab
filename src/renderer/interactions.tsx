import {t} from './i18n';
import { ConfigurationHint, useProviderConfiguration } from './provider-configuration';
import {displayModelId} from '../shared/executor-config';
import {memberNotices,memberNoticeState,type MemberNotice,type MemberNoticeState,type MemberNoticeTarget} from '../shared/member-notifications';
import type {AttentionItem} from '../shared/attention';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, CornerDownLeft, RotateCcw, Search } from 'lucide-react';
import { PROVIDER_NAMES } from '../shared/defaults';
import type { Approval, RunSummary, Session, Snapshot } from '../shared/types';
import { Avatar, useTeam, type Team } from './members';
import { shortDateTime, runLabel, isActiveRun, sessionTitle } from './ui';
import { isConversationSession } from '../shared/session-classification';

/* ───────── Context menu ───────── */
export type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | 'separator';
export type MenuState = { x: number; y: number; items: MenuItem[] } | null;

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const node = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!menu) return;
    const rect = node.current?.getBoundingClientRect();
    const width = rect?.width ?? 200, height = rect?.height ?? 200;
    setPosition({ x: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8)) });
    node.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: Event) => { if (!node.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); } };
    const timer = window.setTimeout(() => { document.addEventListener('mousedown', close); document.addEventListener('keydown', escape, true); window.addEventListener('blur', onClose); window.addEventListener('resize', onClose); }, 0);
    return () => { window.clearTimeout(timer); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape, true); window.removeEventListener('blur', onClose); window.removeEventListener('resize', onClose); };
  }, [menu, onClose]);
  if (!menu) return null;
  return createPortal(<div className="context-menu" ref={node} role="menu" style={{ left: position.x, top: position.y }} onKeyDown={event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(node.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }}>
    {menu.items.map((item, index) => item === 'separator' ? <hr key={index} /> : <button type="button" role="menuitem" key={index} className={item.danger ? 'danger' : ''} disabled={item.disabled} onClick={() => { onClose(); item.onSelect(); }}>{item.icon}<span>{item.label}</span></button>)}
  </div>, document.body);
}

/* ───────── Quick switcher (Ctrl+K) ───────── */
export function QuickSwitcher({ snapshot, firstInput, onPick, onClose }: { snapshot: Snapshot; firstInput: (id: string) => string | undefined; onPick: (session: Session) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const team = useTeam();
  const projects = useMemo(() => new Map(snapshot.projects.map(project => [project.id, project])), [snapshot.projects]);
  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...snapshot.sessions].filter(session => isConversationSession(session,snapshot.runs)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter(session => {
      const text = `${sessionTitle(session, firstInput(session.id))} ${team.ofSession(session).name} ${PROVIDER_NAMES[session.provider]} ${projects.get(session.projectId)?.name ?? ''}`.toLowerCase();
      return words.every(word => text.includes(word));
    }).slice(0, 30);
  }, [query, snapshot.sessions, projects, firstInput, team]);
  useEffect(() => setIndex(0), [query]);
  return <div className="modal-overlay switcher-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="switcher" role="dialog" aria-modal="true" aria-label={t("快速切换会话")}>
      <label className="switcher-search"><Search size={16} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t("搜索会话、成员或项目…")} aria-label={t("搜索会话")}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
          else if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(value => Math.min(value + 1, results.length - 1)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => Math.max(value - 1, 0)); }
          else if (event.key === 'Enter' && results[index]) { event.preventDefault(); onPick(results[index]); }
        }} /><kbd>Esc</kbd></label>
      <div className="switcher-list" role="listbox">
        {!results.length && <div className="switcher-empty">{t("没有找到匹配的会话")}</div>}
        {results.map((session, position) => <button type="button" role="option" aria-selected={position === index} key={session.id} className={`switcher-item member-${team.ofSession(session).id} ${position === index ? 'active' : ''}`} onMouseEnter={() => setIndex(position)} onClick={() => onPick(session)}>
          <Avatar member={team.ofSession(session)} size={28} ring={false} />
          <span><strong>{sessionTitle(session, firstInput(session.id))}</strong><small>{team.ofSession(session).name} · {projects.get(session.projectId)?.name ?? t("项目")} · {shortDateTime(session.updatedAt)}{session.archived ? t(" · 已归档") : ''}</small></span>
          {position === index && <CornerDownLeft size={14} />}
        </button>)}
      </div>
      <div className="switcher-hint"><span><kbd>↑</kbd><kbd>↓</kbd> {t(" 选择")}</span><span><kbd>Enter</kbd> {t(" 打开")}</span><span><kbd>Ctrl</kbd>+<kbd>N</kbd> {t(" 新会话")}</span><span><kbd>Ctrl</kbd>+<kbd>,</kbd> {t(" 设置")}</span></div>
    </div>
  </div>;
}

/* ───────── Desktop notifications ───────── */
export const NOTIFY_KEY = 'hivelab.notify';
export const notificationsEnabled = () => { try { return localStorage.getItem(NOTIFY_KEY) !== 'off'; } catch { return true; } };

/** Notify task completions and requests for attention, with foreground and desktop delivery. */
export function useMemberNotifications(snapshot: Snapshot, firstInput: (id: string) => string | undefined, onOpen: (session: Session) => void, team: Team,onAttention:(item:AttentionItem)=>void,onToast:(notice:MemberNotice,open:()=>void)=>void) {
  const previous=useRef<MemberNoticeState|null>(null),latest=useRef({snapshot,onOpen,onAttention,onToast});latest.current={snapshot,onOpen,onAttention,onToast};
  const openTarget=useCallback((target:MemberNoticeTarget)=>{const current=latest.current,item=target.attentionId&&current.snapshot.attention?.items.find(item=>item.id===target.attentionId);if(item){current.onAttention(item);return;}const session=target.sessionId&&current.snapshot.sessions.find(session=>session.id===target.sessionId);if(session)current.onOpen(session);},[]);
  useEffect(()=>{
    if(!window.hivelab?.onEvent)return;
    return window.hivelab.onEvent(event=>{if(event.type==='notification-open')openTarget(event.target);else if(event.type==='notification-fallback')latest.current.onToast(event.notice,()=>openTarget(event.notice.target));});
  },[openTarget]);
  useEffect(()=>{
    if(!snapshot.backendReady){previous.current=null;return;}
    const before=previous.current;previous.current=memberNoticeState(snapshot);
    if(!before||!notificationsEnabled())return;
    const notices=memberNotices(before,snapshot,{name:session=>team.ofSession(session).name,topic:session=>sessionTitle(session,firstInput(session.id))});
    for(const notice of notices){
      const fallback=()=>latest.current.onToast(notice,()=>openTarget(notice.target));
      if(!window.hivelab){fallback();continue;}
      void window.hivelab.invoke<{delivery:string}>('window.notify',notice).then(reply=>{if(reply.delivery==='foreground'||reply.delivery==='fallback')fallback();}).catch(fallback);
    }
  },[snapshot.runs,snapshot.approvals,snapshot.attention,snapshot.sessions,snapshot.projects,snapshot.providers,snapshot.backendReady,snapshot.restoreEpoch,firstInput,team,openTarget]);
}

export const isBusy = (snapshot: Snapshot, sessionId: string) => snapshot.runs.some(run => run.sessionId === sessionId && (isActiveRun(run) || run.status === 'queued'));

/* ───────── Per-session model picker ───────── */
export const EFFORT_NAMES: Record<string, string> = { get auto(){return t("自动")}, get on(){return t("开启")}, get none(){return t("关闭")}, get off(){return t("关闭")}, get minimal(){return t("极低")}, get low(){return t("低")}, get medium(){return t("中")}, get high(){return t("高")}, get xhigh(){return t("很高")}, get max(){return t("最高")}, get ultra(){return t("超高")} };
const EFFORT_ORDER = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const EFFORT_WORD = /^(.*\S)\s*[（(]\s*(none|minimal|low|medium|high|x-?high|extra[ -]?high|max|ultra)\s*[)）]$/i;
const EFFORT_SUFFIX = /^(.*)-(minimal|low|medium|high|xhigh|max)$/i;
const effortKey = (word: string) => { const value = word.toLowerCase().replace(/[\s-]/g, ''); return value === 'extrahigh' ? 'xhigh' : value; };
type Variant = { id: string; effort: string };
type ModelRow = { key: string; label: string; ids: string[]; variants?: Variant[]; option?: import('../shared/types').ModelOption };
/** Some programs list one model once per thinking level ("Gemini 4 Argon (High)", "…-high"). Those become one row whose
 *  levels are chosen on the slider; a lone suffixed model stays as it is. */
export function groupEffortVariants(options: import('../shared/types').ModelOption[]): ModelRow[] {
  const parsed = options.map(option => {
    const byLabel = EFFORT_WORD.exec(option.label), byId = EFFORT_SUFFIX.exec(option.id);
    return byLabel ? { option, base: byLabel[1].trim(), effort: effortKey(byLabel[2]) } : byId ? { option, base: byId[1], effort: effortKey(byId[2]) } : { option };
  });
  const counts = new Map<string, number>();
  for (const item of parsed) if ('base' in item && item.base) counts.set(item.base, (counts.get(item.base) ?? 0) + 1);
  // The unsuffixed model of a family ("Gemini 3.8 Flash" beside its (High)/(Low) variants) is its automatic level.
  for (const item of parsed) if (!('base' in item) && (counts.get(item.option.label) ?? 0) > 0) Object.assign(item, { base: item.option.label, effort: 'auto' });
  for (const item of parsed) if ('base' in item && item.effort === 'auto') counts.set(item.base!, (counts.get(item.base!) ?? 0) + 1);
  const rows: ModelRow[] = [], groups = new Map<string, ModelRow>();
  for (const item of parsed) {
    if ('base' in item && item.base && (counts.get(item.base) ?? 0) > 1) {
      let row = groups.get(item.base);
      if (!row) { row = { key: 'group:' + item.base, label: item.base, ids: [], variants: [] }; groups.set(item.base, row); rows.push(row); }
      row.ids.push(item.option.id); row.variants!.push({ id: item.option.id, effort: item.effort! });
    } else rows.push({ key: item.option.id, label: item.option.label, ids: [item.option.id], option: item.option });
  }
  for (const row of groups.values()) row.variants!.sort((a, b) => EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort));
  return rows;
}
export function ModelPopover({ anchor, session, info, defaults, onSave, onSettings, onClose, invoke, listModels }: {
  invoke?: import('./ui').Invoke; anchor: DOMRect;
  /** Reads the models the connection's service offers (API keys with a service address). */
  listModels?: () => Promise<{ models: string[] }>; session: Session; info?: import('../shared/types').ProviderInfo; defaults: { model?: string; effort?: string };
  onSave: (change: { model: string | null; effort: string | null }) => void | Promise<unknown>; onSettings: () => void; onClose: () => void;
}) {
  const node = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null);
  // A topic without its own choice runs on the member's last choice; show that, not the program's default.
  const [model, setModel] = useState(displayModelId(session.model || defaults.model,info?.model) ?? '');
  const [customModel,setCustomModel]=useState(false),[draftModel,setDraftModel]=useState('');
  const [effort, setEffort] = useState(session.effort || defaults.effort || '');
  const [served,setServed]=useState<string[]>(),[reading,setReading]=useState(false),[readError,setReadError]=useState(''),[filter,setFilter]=useState('');
  const [listAt,setListAt]=useState<{left:number;bottom:number}>(),[status,setStatus]=useState<'idle'|'saving'|'saved'|'failed'>('idle'),[dragging,setDragging]=useState(false);
  const listOpen = !!listAt;
  useEffect(() => {
    const inside = (target: EventTarget | null) => !!target && (node.current?.contains(target as Node) || list.current?.contains(target as Node));
    const close = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !inside(event.target)) onClose(); };
    const timer = window.setTimeout(() => { document.addEventListener('mousedown', close); document.addEventListener('keydown', close); }, 0);
    return () => { window.clearTimeout(timer); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [onClose]);
  const configuration = useProviderConfiguration(session.provider, info, model || undefined, invoke);
  const { options, efforts } = configuration;
  const rows = useMemo(() => groupEffortVariants(options), [options]);
  const defaultOption = options.find(option => option.isDefault);
  const defaultModel = defaultOption?.label || info?.model || t("执行端默认");
  const effectiveId = model || defaultOption?.id || '';
  const group = rows.find(row => row.variants && row.ids.includes(effectiveId));
  const variant = group?.variants?.find(item => item.id === effectiveId);
  const modelLabel = group ? group.label : model ? options.find(option => option.id === model)?.label ?? model : defaultModel;
  // The backend skips an inherited level the session's model does not take, so show what will actually apply.
  const inheritedEffort = options.find(option => option.id === effectiveId)?.defaultEffort ?? (model && !options.some(option => option.id === model) && options.every(option => option.defaultEffort === options[0]?.defaultEffort) ? options[0]?.defaultEffort : undefined);
  // A model the service lists but the program does not (e.g. glm-4.6) takes the connection's levels when every reported model shares them.
  const shared = options.length && options.every(option => option.efforts.join() === options[0].efforts.join()) ? options[0].efforts : [];
  const known = efforts.length ? efforts : model && !options.some(option => option.id === model) ? shared : efforts;
  const levels = group ? group.variants!.map(item => item.effort) : [...known, ...(effort && !known.includes(effort) ? [effort] : [])];
  const shown = group ? variant?.effort ?? '' : effort || inheritedEffort || '', index = levels.indexOf(shown);
  /** Every choice applies at once to this topic, and becomes the member's choice for new topics. */
  async function apply(next: { model?: string; effort?: string }) {
    const chosenModel = (next.model ?? model).trim(), chosenEffort = next.effort ?? effort;
    setStatus('saving');
    try { await onSave({ model: chosenModel || null, effort: chosenEffort || null }); setStatus('saved'); } catch { setStatus('failed'); }
  }
  const levelAt = (clientX: number) => { const box = track.current?.getBoundingClientRect(); if (!box || levels.length < 2) return levels[0]; const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width)); return levels[Math.round(ratio * (levels.length - 1))]; };
  /** On a model listed once per level, a level is that variant of the model; otherwise it is the thinking level. */
  const chooseLevel = (level: string | undefined, commit: boolean) => {
    if (!level) return;
    const target = group?.variants?.find(item => item.effort === level);
    if (target) { setModel(target.id); if (effort) setEffort(''); if (commit) void apply({ model: target.id, effort: '' }); return; }
    setEffort(level); if (commit) void apply({ effort: level });
  };
  const percent = levels.length > 1 && index >= 0 ? index / (levels.length - 1) * 100 : 0;
  const closeList = () => { setListAt(undefined); setFilter(''); };
  const chooseModel = (value: string) => { setModel(value); setCustomModel(false); closeList(); void apply({ model: value }); };
  const chooseRow = (row: ModelRow) => {
    if (!row.variants) return chooseModel(row.ids[0]);
    const keep = row.variants.find(item => item.effort === shown) ?? row.variants.find(item => item.effort === 'high') ?? row.variants.at(-1)!;
    setEffort(''); setModel(keep.id); setCustomModel(false); closeList(); void apply({ model: keep.id, effort: '' });
  };
  function toggleList() {
    if (listOpen) return closeList();
    const box = node.current?.getBoundingClientRect(); if (!box) return;
    const width = 260, left = box.right + 8 + width > innerWidth - 8 ? Math.max(8, box.left - 8 - width) : box.right + 8;
    setListAt({ left, bottom: innerHeight - box.bottom });
  }
  async function readServed(){if(!listModels)return;setReading(true);setReadError('');try{setServed((await listModels()).models);}catch(cause){setReadError(cause instanceof Error?cause.message:t("模型清单读取失败"));}finally{setReading(false);}}
  useEffect(()=>{if(listOpen&&configuration.modelConfigurable&&listModels&&served===undefined&&!reading)void readServed();/* eslint-disable-next-line react-hooks/exhaustive-deps */},[listOpen,configuration.modelConfigurable]);
  // What the program reported first, then what the service lists beyond it; a filter once the list is long.
  const extra=(served??[]).filter(id=>!options.some(option=>option.id===id));
  const term=filter.trim().toLowerCase(),matches=(text:string)=>!term||text.toLowerCase().includes(term);
  const longList=rows.length+extra.length>10;
  const usable = levels.length > 1, position = (ratio: number) => `calc(16px + (100% - 32px) * ${ratio})`;
  const surface = `model-popover member-${session.memberId ?? session.provider}`;
  return <>
    <div className={`${surface} effort-popover`} ref={node} role="dialog" aria-label={t("这个话题的模型和思考程度")} style={{ left: anchor.left, bottom: window.innerHeight - anchor.top + 8 }}>
      <div className="effort-head">
        <span aria-hidden="true" />
        <div className="effort-title">
          <strong className={`effort-level ${usable || shown ? '' : 'muted'}`}>{shown ? EFFORT_NAMES[shown] ?? shown : configuration.checking ? t("正在读取…") : usable ? t("默认") : t("思考程度不可调")}</strong>
          <button type="button" className="effort-model" aria-expanded={listOpen} aria-haspopup="listbox" onClick={toggleList}><span>{modelLabel}</span><ChevronRight size={13} /></button>
        </div>
        <button type="button" className="icon-button effort-reset" title={t("使用执行端默认")} aria-label={t("使用执行端默认的模型和思考程度")} disabled={!model && !effort} onClick={() => { setModel(''); setEffort(''); setCustomModel(false); void apply({ model: '', effort: '' }); }}><RotateCcw size={14} /></button>
      </div>
      {usable && <div className={`effort-slider ${dragging ? 'dragging' : ''}`} ref={track} role="slider" tabIndex={0} aria-label={t("思考程度")} aria-valuemin={0} aria-valuemax={levels.length - 1} aria-valuenow={Math.max(0, index)} aria-valuetext={shown ? EFFORT_NAMES[shown] ?? shown : t("默认")}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); chooseLevel(levelAt(event.clientX), false); }}
        onPointerMove={event => { if (dragging) chooseLevel(levelAt(event.clientX), false); }}
        onPointerUp={event => { if (!dragging) return; setDragging(false); chooseLevel(levelAt(event.clientX), true); }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={event => { const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0; if (!step) return; event.preventDefault(); chooseLevel(levels[Math.min(levels.length - 1, Math.max(0, (index < 0 ? 0 : index) + step))], true); }}>
        {index >= 0 && <span className="effort-fill" style={{ width: `calc(${position(percent / 100)} + 16px)` }} />}
        {levels.map((level, at) => <span key={level} className="effort-dot" style={{ left: position(at / (levels.length - 1)) }} />)}
        {index >= 0 && <span className="effort-thumb" style={{ left: position(percent / 100) }} />}
      </div>}
      {status === 'failed' && <small className="effort-note" role="alert">{t("没有应用成功，请重试。")}</small>}
    </div>
    {/* A sibling, not a child: glass inside glass only sees the card behind it, so the list would look lighter than the card. */}
    {listAt && !configuration.modelConfigurable && <div className={`${surface} effort-models`} ref={list} role="group" aria-label={t("这个连接的模型")} style={listAt}>
      <small>{t("这个连接的模型在建立连接时填写（{0}），话题里不能单独更换。", defaultModel)}</small>
      <button type="button" onClick={() => { onClose(); onSettings(); }}><span>{t("打开连接设置…")}</span></button>
    </div>}
    {listAt && configuration.modelConfigurable && <div className={`${surface} effort-models`} ref={list} role="listbox" aria-label={t("选择模型")} style={listAt}>
      {longList && <input className="effort-filter" autoFocus aria-label={t("筛选模型")} value={filter} placeholder={t("筛选，或输入模型名称后回车")} spellCheck={false} onChange={event => setFilter(event.target.value)} onKeyDown={event => { const value = filter.trim(); if (event.key === 'Enter' && value && !/\s/.test(value)) { event.preventDefault(); chooseModel(value); } }} />}
      {!term && <button type="button" role="option" aria-selected={!model} className={!model ? 'selected' : ''} onClick={() => chooseModel('')}><span>{t("执行端默认")}</span><small>{defaultModel}</small></button>}
      {rows.filter(row => matches(row.label) || row.ids.some(matches)).map(row => { const selected = !!model && row.ids.includes(model); return <button type="button" role="option" key={row.key} aria-selected={selected} className={selected ? 'selected' : ''} title={row.option?.description} onClick={() => chooseRow(row)}><span>{row.label}</span>{row.variants ? <small>{t("{0} 档思考", row.variants.length)}</small> : row.option?.group === 'catalog' ? <small>{t("其他版本")}</small> : null}</button>; })}
      {extra.filter(matches).map(id => <button type="button" role="option" key={id} aria-selected={model === id} className={model === id ? 'selected' : ''} onClick={() => chooseModel(id)}><span>{id}</span></button>)}
      {model && !options.some(option => option.id === model) && !extra.includes(model) && <button type="button" role="option" aria-selected className="selected"><span>{model}</span></button>}
      {reading && <small className="effort-reading">{t("正在读取服务的模型清单…")}</small>}
      {!reading && readError && <small className="effort-reading" role="alert">{readError}</small>}
      {info?.auth === 'api' && (customModel
        ? <form className="effort-custom" onSubmit={event => { event.preventDefault(); const value = draftModel.trim(); if (value && !/\s/.test(value)) chooseModel(value); }}><input autoFocus aria-label={t("API 模型 ID")} value={draftModel} maxLength={120} onChange={event => setDraftModel(event.target.value)} placeholder="API Model ID" spellCheck={false} /><button type="submit" className="button small secondary" disabled={!draftModel.trim() || /\s/.test(draftModel.trim())}>{t("使用")}</button></form>
        : <button type="button" onClick={() => { setDraftModel(''); setCustomModel(true); }}><span>{t("其他模型…")}</span></button>)}
      {(!configuration.active || info?.updateVersion) && <hr />}
      {!configuration.active && <ConfigurationHint configuration={configuration} />}
      {info?.updateVersion && <button type="button" onClick={() => { onClose(); onSettings(); }}><span>{t("有新版本 {0}", info.updateVersion)}</span><small>{t("去更新")}</small></button>}
    </div>}
  </>;
}

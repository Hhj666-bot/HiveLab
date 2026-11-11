import {t} from './i18n';
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { createPortal } from 'react-dom';
import { CodeXml, ExternalLink, LayoutList, RefreshCw, Save } from 'lucide-react';
import { ROUTINE_PERIODS } from '../shared/life';
import { personaFieldsOf, type PersonaFields } from '../shared/persona-file';
import { codeChanges, codeLabel, codeRewriter, rewriteMemberCodes, validateCodes } from '../shared/member-codes';
import { VOICE_LIMIT } from '../shared/defaults';
import type { MemberProfile, Snapshot } from '../shared/types';
import { Avatar, useTeam } from './members';
import { Modal } from './modals';
import { errorText, type Invoke, type Notify } from './ui';
import './covenant-editor.css';
import './persona-editor.css';

interface PersonaDocument { path: string; content: string }
/** What the form edits; quirks are one per line, relations are keyed by the other member's internal id. */
interface Draft { userTitle: string; talkativeness: NonNullable<MemberProfile['talkativeness']>; motto: string; persona: string; voice: string; routine: Record<string, string>; quirks: string; relations: Record<string, string> }

const draftOf = (member: MemberProfile, team: MemberProfile[]): Draft => {
  const fields = personaFieldsOf(member, team);
  return {
    userTitle: fields.userTitle ?? '', talkativeness: fields.talkativeness ?? 'normal', motto: fields.motto ?? '', persona: fields.persona ?? '', voice: fields.voice ?? '',
    routine: { ...fields.routine } as Record<string, string>, quirks: (fields.quirks ?? []).join('\n'),
    relations: Object.fromEntries((member.relations ?? []).filter(relation => team.some(item => item.id === relation.memberId && item.id !== member.id)).map(relation => [relation.memberId, relation.text])),
  };
};
const fieldsOf = (draft: Draft, team: MemberProfile[], selfId: string): PersonaFields => ({
  userTitle: draft.userTitle.trim(), talkativeness: draft.talkativeness, motto: draft.motto.trim(), persona: draft.persona, voice: draft.voice,
  routine: Object.fromEntries(ROUTINE_PERIODS.map(period => [period.id, (draft.routine[period.id] ?? '').trim()]).filter(([, value]) => value)),
  quirks: draft.quirks.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
  relations: team.filter(item => item.id !== selfId).flatMap(item => (draft.relations[item.id] ?? '').trim() ? [{ ref: item.id, name: item.name, text: draft.relations[item.id].trim() }] : []),
});
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

type Section = 'basic' | 'persona' | 'voice' | 'routine' | 'quirks' | 'relations';
const SECTIONS: { id: Section; title: string; hint: string }[] = [
  { id: 'basic', get title(){return t("基本信息")}, get hint(){return t("称呼、一句话介绍和自由讨论时的发言积极度。")} },
  { id: 'routine', get title(){return t("日常")}, get hint(){return t("成员在一天不同时段通常在做什么，只作为状态展示。")} },
  { id: 'persona', get title(){return t("人设与说话风格")}, get hint(){return t("每轮对话都会作为系统设定交给成员，只影响身份、语气和称呼，不改变权限。只有你能修改。")} },
  { id: 'voice', get title(){return t("语气与小动作")}, get hint(){return t("口吻、括号小动作和口癖示例，随人设一起交给成员；成员可以自己微调这一项。")} },
  { id: 'quirks', get title(){return t("小习惯")}, get hint(){return t("空闲时显示，也会交给成员参考。每行一个，最多 8 个，每个 40 字以内；成员可以自己微调。")} },
  { id: 'relations', get title(){return t("和其他成员的关系")}, get hint(){return t("会作为人设的一部分交给成员，每段 120 字以内。")} },
];
const TALK_LABEL = { get quiet(){return t("安静")}, get normal(){return t("适中")}, get chatty(){return t("话多")} } as const;
/** What a closed card shows: a few lines of the content and a count. */
function sectionSummary(section: Section, draft: Draft, others: MemberProfile[]): { text: string; meta: string } {
  if (section === 'basic') return { text: [draft.userTitle && t("称呼你：{0}", draft.userTitle), draft.motto && t("介绍：{0}", draft.motto)].filter(Boolean).join('\n'), meta: t("发言{0}", TALK_LABEL[draft.talkativeness]) };
  if (section === 'persona') return { text: draft.persona.trim(), meta: draft.persona.trim() ? t("{0} 字", draft.persona.trim().length) : '' };
  if (section === 'voice') return { text: draft.voice.trim(), meta: draft.voice.trim() ? t("{0} 字", draft.voice.trim().length) : '' };
  if (section === 'routine') { const lines = ROUTINE_PERIODS.filter(period => draft.routine[period.id]?.trim()).map(period => `${period.label}：${draft.routine[period.id].trim()}`); return { text: lines.join('\n'), meta: t("{0}/4 个时段", lines.length) }; }
  if (section === 'quirks') { const items = draft.quirks.split(/\r?\n/).map(item => item.trim()).filter(Boolean); return { text: items.join('\n'), meta: t("{0} 个", items.length) }; }
  const lines = others.filter(other => draft.relations[other.id]?.trim()).map(other => `${codeLabel(other)}：${draft.relations[other.id].trim()}`);
  return { text: lines.join('\n'), meta: t("{0}/{1} 位成员", lines.length, others.length) };
}
const Count = ({ value, max }: { value: number; max: number }) => <small className={`persona-count ${value > max ? 'over' : ''}`}>{value}/{max}</small>;

/** 人物设定.md in two views: a form per member, and the Markdown itself. Both write the same file. */
export function PersonaEditor({ snapshot, invoke, notify }: { snapshot: Snapshot; invoke: Invoke; notify: Notify }) {
  const team = snapshot.members, shown = useTeam();
  const [view, setView] = useState<'form' | 'source'>('form');
  const [document, setDocument] = useState<PersonaDocument>();
  const [source, setSource] = useState('');
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sourceDirty = document !== undefined && source !== document.content;
  const dirtyIds = useMemo(() => team.filter(member => edits[member.id] && !same(edits[member.id], draftOf(member, team))).map(member => member.id), [edits, team]);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { const value = await invoke<PersonaDocument>('persona.file.read'); setDocument(value); setSource(value.content); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }, [invoke]);
  useEffect(() => { void load(); }, [load]);
  // An outside edit of the file reaches the cards, which arrive here as a new snapshot; follow it unless the source box has unsaved text.
  useEffect(() => { if (!sourceDirty && document) void invoke<PersonaDocument>('persona.file.read', undefined, undefined, { background: true }).then(value => { setDocument(value); setSource(value.content); }).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [team]);

  const [opened, setOpened] = useState<{ memberId: string; section: Section; before: Draft }>();
  const openedMember = opened && team.find(item => item.id === opened.memberId);
  const openSection = (member: MemberProfile, section: Section) => setOpened({ memberId: member.id, section, before: edits[member.id] ?? draftOf(member, team) });
  function sectionEditor(section: Section, member: MemberProfile) {
    const draft = edits[member.id] ?? draftOf(member, team), others = team.filter(item => item.id !== member.id);
    if (section === 'basic') return <div className="persona-basic">
      <label className="field">{t("怎么称呼你")}<input autoFocus value={draft.userTitle} maxLength={40} onChange={event => edit(member, { userTitle: event.target.value })} placeholder={t("留空就使用你的名字")} /></label>
      <label className="field">{t("发言积极度")}<select value={draft.talkativeness} onChange={event => edit(member, { talkativeness: event.target.value as Draft['talkativeness'] })}><option value="quiet">{t("安静")}</option><option value="normal">{t("适中")}</option><option value="chatty">{t("话多")}</option></select><small>{t("影响自由讨论中主动接话的机会。")}</small></label>
      <label className="field">{t("一句话介绍")}<textarea rows={3} value={draft.motto} maxLength={80} onChange={event => edit(member, { motto: event.target.value })} placeholder={t("会显示在团队卡片上")} /><Count value={draft.motto.length} max={80} /></label>
    </div>;
    if (section === 'persona') return <label className="field persona-long">{t("人设与说话风格")}<textarea autoFocus className="persona-long-text" maxLength={8000} value={draft.persona} onChange={event => edit(member, { persona: event.target.value })} placeholder={t("例如：\n你是团队里的审稿人，性格沉稳，说话简洁。\n先指出最重要的问题，再给出修改建议。")} /><Count value={draft.persona.length} max={8000} /></label>;
    if (section === 'voice') return <label className="field persona-long">{t("语气与小动作")}<textarea autoFocus className="persona-long-text" maxLength={VOICE_LIMIT} value={draft.voice} onChange={event => edit(member, { voice: event.target.value })} placeholder={t("例如：\n中文：语速轻快，爱用比喻。（转了转笔）\nEnglish: Quick and playful. (twirls her pen)")} /><Count value={draft.voice.length} max={VOICE_LIMIT} /></label>;
    if (section === 'routine') return <div className="persona-wide-grid">{ROUTINE_PERIODS.map((period, index) => <label className="field" key={period.id}>{period.label}<textarea autoFocus={index === 0} rows={3} maxLength={60} value={draft.routine[period.id] ?? ''} placeholder={period.example} onChange={event => edit(member, { routine: { ...draft.routine, [period.id]: event.target.value } })} /><Count value={(draft.routine[period.id] ?? '').length} max={60} /></label>)}</div>;
    if (section === 'quirks') { const items = draft.quirks.split(/\r?\n/).map(item => item.trim()).filter(Boolean); return <label className="field persona-long">{t("小习惯")}<textarea autoFocus className="persona-medium-text" value={draft.quirks} onChange={event => edit(member, { quirks: event.target.value })} placeholder={t("每行一个，例如：\n转笔\n思考时会轻敲桌面")} /><small className={`persona-count ${items.length > 8 || items.some(item => item.length > 40) ? 'over' : ''}`}>{t("{0}/8 个{1}{2}", items.length, items.some(item => item.length > 40) ? t("，有超过 40 字的条目，保存时会截断") : '', items.length > 8 ? t("，超出的条目不会保存") : '')}</small></label>; }
    return <div className="persona-wide-grid">{others.map((other, index) => <label className="field" key={other.id}>{codeLabel(other)}<textarea autoFocus={index === 0} rows={4} maxLength={120} value={draft.relations[other.id] ?? ''} placeholder={t("例如：像对待老同事一样随意")} onChange={event => edit(member, { relations: { ...draft.relations, [other.id]: event.target.value } })} /><Count value={(draft.relations[other.id] ?? '').length} max={120} /></label>)}</div>;
  }
  const edit = (member: MemberProfile, patch: Partial<Draft>) => setEdits(previous => ({ ...previous, [member.id]: { ...(previous[member.id] ?? draftOf(member, team)), ...patch } }));
  async function saveForm() {
    setBusy(true); setError('');
    try {
      const members = dirtyIds.map(id => ({ id, ...fieldsOf(edits[id], team, id) }));
      const value = await invoke<PersonaDocument>('persona.file.apply', { members }, t("已保存 {0} 位成员的人物设定，下一轮对话生效。", members.length));
      setDocument(value); setSource(value.content); setEdits({});
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  async function saveSource() {
    setBusy(true); setError('');
    try { const value = await invoke<PersonaDocument>('persona.file.save', { content: source }, t("人物设定已保存，下一轮对话生效。")); setDocument(value); setSource(value.content); setEdits({}); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  function refresh() {
    if ((dirtyIds.length || sourceDirty) && !window.confirm(t("放弃未保存的修改并重新读取人物设定？"))) return;
    setEdits({}); void load();
  }
  function switchView(next: 'form' | 'source') {
    if (next === view) return;
    if (view === 'source' && sourceDirty && !window.confirm(t("Markdown 源文件有未保存的修改，切换会丢弃它们。继续？"))) return;
    if (view === 'source') setSource(document?.content ?? '');
    setView(next);
  }

  return <div className="persona-editor">
    <div className="covenant-toolbar" role="toolbar" aria-label={t("人物设定工具")}>
      <div className="segmented" role="radiogroup" aria-label={t("编辑方式")}>
        <button type="button" role="radio" aria-checked={view === 'form'} className={view === 'form' ? 'selected' : ''} onClick={() => switchView('form')}><LayoutList size={14} /> {t(" 可视化编辑")}</button>
        <button type="button" role="radio" aria-checked={view === 'source'} className={view === 'source' ? 'selected' : ''} onClick={() => switchView('source')}><CodeXml size={14} /> {t(" Markdown 源文件")}</button>
      </div>
      <button type="button" className="button small quiet" onClick={refresh} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''} />{t("重新读取")}</button>
      <button type="button" className="button small quiet" disabled={busy || !document || sourceDirty} onClick={() => void invoke('persona.file.open').catch(cause => setError(errorText(cause)))}><ExternalLink size={14} />{t("在编辑器中打开")}</button>
      {view === 'form' && dirtyIds.length > 0 && <button type="button" className="button small primary" disabled={busy || !snapshot.backendReady} onClick={() => void saveForm()}><Save size={14} />{t("保存 {0} 位成员", dirtyIds.length)}</button>}
      {view === 'source' && sourceDirty && <button type="button" className="button small primary" disabled={busy || !snapshot.backendReady} onClick={() => void saveSource()}><Save size={14} />{t("保存 Markdown")}</button>}
    </div>
    {error && <p role="alert" className="inline-notice error">{error}</p>}
    <p className="covenant-file-path">{document ? `${document.path}${sourceDirty || dirtyIds.length ? t(" · 有未保存的修改") : ''}` : busy ? t("正在读取人物设定…") : t("读取失败，可点击重新读取。")}</p>
    <p className="settings-description">{t("程序里的表单和这个 Markdown 文件是同一份数据：在文件里直接修改并保存，程序会自动读取；在程序里保存，文件也会同步更新。名字、形象、连接和长期记忆仍在人物卡里编辑。")}</p>
    {view === 'form' && team.length > 0 && <MemberCodes team={team} invoke={invoke} disabled={busy || !snapshot.backendReady} />}
    {view === 'form' ? (team.length ? <div className="persona-list">
      {team.map(member => {
        const draft = edits[member.id] ?? draftOf(member, team), dirty = dirtyIds.includes(member.id), others = team.filter(item => item.id !== member.id);
        return <details className="persona-card" key={member.id} open={team.length <= 3 || dirty}>
          <summary>{shown.get(member.id) && <Avatar member={shown.get(member.id)!} size={34} />}{member.code && <span className="persona-code">{member.code}</span>}<strong>{member.name}</strong>{draft.motto && <small>{draft.motto}</small>}{dirty && <em className="persona-dirty">{t("未保存")}</em>}</summary>
          <div className="persona-sections">
            {SECTIONS.filter(section => section.id !== 'relations' || others.length).map(section => {
              const summary = sectionSummary(section.id, draft, others);
              return <button type="button" key={section.id} className={`persona-section persona-section-${section.id}`} onClick={() => openSection(member, section.id)}>
                <span className="persona-section-head"><strong>{section.title}</strong><small>{summary.meta}</small></span>
                <span className={`persona-section-preview ${summary.text ? '' : 'empty'}`}>{summary.text || t("未填写，点击填写")}</span>
              </button>;
            })}
          </div>
        </details>;
      })}
      {opened && openedMember && createPortal(<Modal title={`${codeLabel(openedMember)} · ${SECTIONS.find(item => item.id === opened.section)!.title}`} subtitle={SECTIONS.find(item => item.id === opened.section)!.hint} className="persona-section-dialog" onClose={() => setOpened(undefined)}>
        <div className="modal-body persona-section-body">{sectionEditor(opened.section, openedMember)}</div>
        <div className="modal-footer">
          <button type="button" className="button quiet" onClick={() => { setEdits(previous => ({ ...previous, [opened.memberId]: opened.before })); setOpened(undefined); }}>{t("撤销这次修改")}</button>
          <span className="spacer" />
          <button type="button" className="button secondary" onClick={() => setOpened(undefined)}>{t("完成")}</button>
          <button type="button" className="button primary" disabled={busy || !dirtyIds.length || !snapshot.backendReady} onClick={() => void saveForm().then(() => setOpened(undefined))}><Save size={14} />{t("保存")}</button>
        </div>
      </Modal>, window.document.body)}
    </div> : <div className="covenant-empty">{t("还没有人物卡。先在“团队成员”里添加成员。")}</div>)
      : <textarea className="covenant-source persona-source" aria-label={t("人物设定 Markdown 源文件")} value={source} onChange={event => setSource(event.target.value)} spellCheck={false} />}
  </div>;
}

/** Every member's code in one place. Codes are aliases of internal ids, so relations and history follow automatically. */
function MemberCodes({ team, invoke, disabled }: { team: MemberProfile[]; invoke: Invoke; disabled: boolean }) {
  const [codes, setCodes] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState('');
  const [open, setOpen] = useState(false), [rewriteText, setRewriteText] = useState(true), saving = useRef(false);
  const current = (member: MemberProfile) => codes[member.id] ?? member.code ?? '';
  const changed = team.filter(member => codes[member.id] !== undefined && codes[member.id] !== (member.code ?? ''));
  const problem = changed.length ? validateCodes(team, Object.fromEntries(team.map(member => [member.id, current(member).trim()]))) : undefined;
  // Persona text that names teammates by number ("身份=02", "姐姐 01") follows the move when the box is ticked.
  const mentions = useMemo(() => {
    const rewrite = changed.length ? codeRewriter(codeChanges(team, Object.fromEntries(team.map(member => [member.id, (codes[member.id] ?? member.code ?? '').trim()])))) : undefined;
    if (!rewrite) return { count: 0, members: 0 };
    const counts = team.map(member => rewriteMemberCodes(member, rewrite).count);
    return { count: counts.reduce((sum, value) => sum + value, 0), members: counts.filter(Boolean).length };
  }, [codes, team, changed.length]);
  // Close the gaps while keeping the order the numbers on screen already give (typed edits included): 01 · 05 · 03 → 01 · 03 · 02.
  // Members without a number go last, ties keep the join order.
  const compacted = Object.fromEntries(team.map((member, index) => ({ member, index, code: current(member).trim() }))
    .sort((a, b) => (!a.code ? 1 : 0) - (!b.code ? 1 : 0) || a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }) || a.index - b.index)
    .map((item, position) => [item.member.id, String(position + 1).padStart(2, '0')]));
  const compact = team.some(member => compacted[member.id] !== current(member).trim());
  function renumber() {
    if (!compact) { setSaved(t("编号已经是连续的 01、02、03…，没有需要整理的空缺。")); return; }
    setSaved(''); setCodes(previous => ({ ...previous, ...compacted }));
  }
  async function save() {
    if (saving.current || !changed.length || problem) return;
    saving.current = true;
    const next = Object.fromEntries(team.map(member => [member.id, current(member).trim()]));
    setBusy(true); setError(''); setSaved('');
    try {
      const withText = rewriteText && mentions.count > 0;
      const result = await invoke<{ members: { id: string; code?: string }[]; rewritten: number }>('team.codes', { codes: next, rewriteText: withText }, withText ? t("成员编号和人设文字中的编号已更新，人物设定文件已同步。") : t("成员编号已保存，人物设定文件已同步。"));
      // Keep the typed values until the backend confirms each one, so a late snapshot never shows the old numbers.
      const confirmed = new Map(result.members.map(item => [item.id, item.code ?? '']));
      const missed = team.filter(member => confirmed.get(member.id) !== next[member.id]);
      if (missed.length) setError(t("编号没有全部保存：{0}。请刷新后重试。", missed.map(member => member.name).join('、')));
      else { setCodes({}); setSaved(t("已保存 {0} 个编号{1}。", changed.length, result.rewritten ? t("，人设文字中的编号已更新 {0} 处", result.rewritten) : '')); }
    }
    catch (cause) { setError(errorText(cause)); }
    finally { saving.current = false; setBusy(false); }
  }
  // Leaving the code section (another field, 完成, closing the window) commits a complete, valid set, so an edit is never silently dropped.
  const leave = (event: FocusEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void save(); };
  return <details className="persona-codes" open={open || changed.length > 0} onToggle={event => setOpen(event.currentTarget.open)} onBlur={leave}>
    <summary><strong>{t("成员编号")}</strong><small>{team.map(member => member.code ?? '—').join(' · ')}</small></summary>
    <p className="settings-description">{t("编号是人物卡的固定代号，人物设定文件里的关系按编号对应成员，改名不会让关系失效。新成员自动取下一个没用过的编号，删掉的编号不会自动复用。修改后点“保存”，或离开编号区域时自动保存。")}</p>
    <div className="persona-code-grid">{team.map(member => <label key={member.id} className="persona-code-row"><input aria-label={t("{0} 的编号", member.name)} value={current(member)} maxLength={12} disabled={disabled || busy} onChange={event => { setSaved(''); setCodes(previous => ({ ...previous, [member.id]: event.target.value })); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }} /><span>{member.name}</span></label>)}</div>
    {(problem || error) && <p role="alert" className="inline-notice error">{problem || error}</p>}
    {changed.length > 0 && !problem && mentions.count > 0 && <label className="persona-codes-rewrite"><input type="checkbox" checked={rewriteText} disabled={busy} onChange={event => setRewriteText(event.target.checked)} />{t("同时更新人设文字里的旧编号")}<small>{t("共 {0} 处，涉及 {1} 位成员（如“身份=02”“姐姐 01”）；互换编号会一起换，时间、日期里的数字不受影响", mentions.count, mentions.members)}</small></label>}
    {saved && <p role="status" className="ready-text persona-codes-saved">{saved}</p>}
    <div className="storage-actions">
      {changed.length > 0 && <button type="button" className="button small primary" disabled={disabled || busy || Boolean(problem)} onClick={() => void save()}><Save size={13} />{t("保存 {0} 个编号", changed.length)}</button>}
      {changed.length > 0 && <button type="button" className="button small quiet" disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => { setCodes({}); setError(''); }}>{t("放弃修改")}</button>}
      <button type="button" className="button small quiet" disabled={disabled || busy} title={t("按上面编号的先后，整理成 01、02、03…，不改变成员的先后顺序")} onClick={renumber}>{t("整理为连续编号")}</button>
    </div>
  </details>;
}

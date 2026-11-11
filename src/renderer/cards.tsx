import {t,useLanguage} from './i18n';
import { connectionLabel } from '../shared/executor-connection';
import { catalogEntry } from '../shared/executor-catalog';
import { CatalogConnectionCreator, NativeConnectionCreator } from './executor-catalog';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Download, ImagePlus, LoaderCircle, Plus, RotateCcw, Save, Trash2, UserRound } from 'lucide-react';
import { BUILTIN_MEMBERS, PORTRAIT_SCALE, PROVIDER_NAMES, isAcpId } from '../shared/defaults';
import type { AcpExecutor, MemberProfile, PermissionMember, Snapshot, UserProfile } from '../shared/types';
import { Avatar, Portrait, UserAvatar, buildTeam, useTeam, type TeamMember } from './members';
import { providerSummary, runnable, type Invoke, type Notify } from './ui';
import { AcpFields, emptyAcpDraft, type AcpDraft } from './executors';
import { MemoryEditor } from './memory';
import { LifeEditor } from './life';
import {CardTextSection} from './card-text-section';
import { Modal } from './modals';
import { memoryEntries } from '../shared/memory';
import {CardVisibilityButton,DeleteMemberDialog} from './member-card-actions';
import {MEMBER_COLOR_PRESETS} from '../shared/appearance-colors';

const EXECUTORS: PermissionMember[] = ['claude', 'codex', 'dsh'];
const DESKTOP_PERSONA: Partial<Record<PermissionMember, string>> = { get codex(){return t("Codex 桌面端的 AGENTS.md")}, get dsh(){return t("DSH 桌面端的 AGENTS.md（人设）")}, get claude(){return t("Claude Code 的 CLAUDE.md")} };

/** The team as portrait cards; clicking one opens its editor. */
export function MemberGallery({ snapshot, invoke, onEdit, onAdd }: { snapshot: Snapshot; invoke: Invoke; onEdit: (id: string) => void; onAdd: () => void }) {
  const team = useTeam();
  return <div className="card-gallery">
    {team.members.map(member => {
      const executor = snapshot.providers.find(item => item.id === member.executor);
      const ready = runnable(executor);
      return <div key={member.id} className={`char-card member-${member.id}`}>
        <button type="button" className="char-card-main" onClick={() => onEdit(member.id)} aria-label={t("编辑 {0} 的人物卡", member.name)}>
          <Portrait member={member} className="char-card-portrait" />
          <span className="char-card-caption">
            <strong>{member.name}</strong>
            <small title={`${t(member.product)}${member.builtIn ? '' : t(" · 自定义成员")}`}>{t(member.product)}{member.builtIn ? '' : t(" · 自定义成员")}</small>
            <em className={ready ? 'ready' : ''}>{member.card.cardHidden?t("人物卡已隐藏 · "):''}{member.product==='未连接'?t("未连接"):providerSummary(executor)}</em>
          </span>
        </button>
        <CardVisibilityButton member={member.card} invoke={invoke} disabled={!snapshot.backendReady} iconOnly className="char-card-visibility"/>
      </div>;
    })}
    <button type="button" className="char-card add" onClick={onAdd}><span className="char-card-plus"><Plus size={26} /></span><strong>{t("添加成员")}</strong><small>{t("接入新的 AI 程序，或沿用已有的程序")}</small></button>
  </div>;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const within = (value: number, min: number, max: number) => round(Math.min(max, Math.max(min, value)));

/** An image you frame directly: drag to move, scroll (or +/-) to zoom, arrow keys to nudge. */
function FramePad({ label, className = '', disabled, onMove, onZoom, children }: { label: string; className?: string; disabled?: boolean; onMove: (dx: number, dy: number, frame: HTMLElement) => void; onZoom: (factor: number, frame: HTMLElement) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const zoom = useRef(onZoom); zoom.current = onZoom;
  const off = useRef(disabled); off.current = disabled;
  useEffect(() => {
    const node = ref.current; if (!node) return;
    // React's wheel listener is passive; a native one keeps the dialog from scrolling while zooming.
    const wheel = (event: WheelEvent) => { if (off.current) return; event.preventDefault(); zoom.current(Math.exp(-event.deltaY * 0.0015), node); };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);
  const end = () => { last.current = null; ref.current?.classList.remove('dragging'); };
  return <div ref={ref} className={`frame-pad ${className}`} role="group" tabIndex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled || undefined}
    onPointerDown={event => { if (disabled || event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); last.current = { x: event.clientX, y: event.clientY }; event.currentTarget.classList.add('dragging'); }}
    onPointerMove={event => { const from = last.current; if (!from) return; last.current = { x: event.clientX, y: event.clientY }; onMove(event.clientX - from.x, event.clientY - from.y, event.currentTarget); }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onKeyDown={event => {
      if (disabled) return;
      const step = event.shiftKey ? 10 : 2;
      const move = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[event.key];
      if (move) { event.preventDefault(); onMove(move[0], move[1], event.currentTarget); }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); onZoom(1.1, event.currentTarget); }
      else if (event.key === '-' || event.key === '_') { event.preventDefault(); onZoom(1 / 1.1, event.currentTarget); }
    }}>{children}</div>;
}

/** Edit one card. Built-in members keep their executor; new members choose one. */
export function CardEditor({ snapshot, memberId, invoke, notify, onBack, onCancel = onBack, actionContainer, initialExecutor }: { snapshot: Snapshot; memberId: string | 'new'; invoke: Invoke; notify: Notify; onBack: () => void; /** Leaving without saving; defaults to onBack. */ onCancel?: () => void; actionContainer?: HTMLElement | null;initialExecutor?: PermissionMember }) {
  const team = useTeam();
  const existing = memberId === 'new' ? undefined : team.get(memberId);
  const [draft, setDraft] = useState<MemberProfile>(() => existing ? { ...existing.card } : { id: '', executor: initialExecutor??'claude', name: '' });
  const [busy, setBusy] = useState<'save' | 'image' | 'import' | 'delete' | null>(null);
  const [deleting,setDeleting]=useState(false);
  // A new member either brings a new AI program (configured here, over ACP) or reuses an existing executor.
  const [source, setSource] = useState<'program' | 'existing'>(memberId === 'new'&&!initialExecutor ? 'program' : 'existing');
  const [program, setProgram] = useState<AcpDraft>(emptyAcpDraft);
  const connecting = !existing && source === 'program';
  const executors = [...EXECUTORS.filter(id=>!snapshot.removedProviders?.includes(id)), ...(snapshot.executors ?? []).map(item => item.id)];
  const language=useLanguage();const preview: TeamMember = useMemo(() => buildTeam([{ ...draft, id: draft.id || 'draft', name: draft.name || t("新成员"), builtIn: existing?.builtIn }])[0], [draft, existing?.builtIn,language]);
  const set = (change: Partial<MemberProfile>) => setDraft(previous => ({ ...previous, ...change }));
  const executor = snapshot.providers.find(item => item.id === draft.executor);
  const selectedConnection = snapshot.executors?.find(item => item.id === draft.executor);
  const disconnected = snapshot.removedProviders?.includes(draft.executor) || isAcpId(draft.executor) && !selectedConnection;
  const connectionName = (id: PermissionMember) => {
    const connection=snapshot.executors?.find(item=>item.id===id);
    const auth=connection?.catalogId?catalogEntry(connection.catalogId).authentication.find(item=>item.id===connection.authentication):undefined;
    return `${connection?.name??PROVIDER_NAMES[id]} · ${auth?.label??connectionLabel(id,connection)}`;
  };
  const userName = snapshot.profile.name && snapshot.profile.name !== '你' ? snapshot.profile.name : '';
  const face = draft.face ?? preview.face;
  const portraitScale = draft.portraitScale ?? PORTRAIT_SCALE.default;
  const portraitOffset = draft.portraitOffset ?? { x: 0, y: 0 };
  const framingAvatar = Boolean(draft.avatar || preview.art);
  const avatarZoom = (draft.avatar ? draft.avatarFace?.zoom : face.zoom) ?? 1;

  // Portrait: the drag distance is a share of the frame, so every card shows the same framing.
  function movePortrait(dx: number, dy: number, frame: HTMLElement) {
    const { width, height } = frame.getBoundingClientRect(); if (!width || !height) return;
    set({ portraitOffset: { x: within(portraitOffset.x + dx / width, -1, 1), y: within(portraitOffset.y + dy / height, -1, 1) } });
  }
  function zoomPortrait(factor: number) { set({ portraitScale: within(portraitScale * factor, PORTRAIT_SCALE.min, PORTRAIT_SCALE.max) }); }
  // Avatar: the crop centre moves against the drag, measured on the image as currently drawn.
  function avatarFrame(frame: HTMLElement) {
    const image = frame.querySelector<HTMLImageElement>('.avatar-face img'); if (!image?.naturalWidth) return;
    const aspect = image.naturalHeight / image.naturalWidth;
    // An uploaded avatar must still cover the circle, so its zoom never shows an empty edge.
    const minimum = draft.avatar ? Math.max(1, 1 / aspect) : 1;
    const current = draft.avatar ? draft.avatarFace ?? { x: 0.5, y: 0.5, zoom: round(minimum) } : face;
    return { image, current, minimum, apply: (next: { x: number; y: number; zoom: number }) => set(draft.avatar ? { avatarFace: next } : { face: next }) };
  }
  function moveAvatar(dx: number, dy: number, frame: HTMLElement) {
    const target = avatarFrame(frame); if (!target) return;
    const { width, height } = target.image.getBoundingClientRect(); if (!width || !height) return;
    target.apply({ ...target.current, x: within(target.current.x - dx / width, 0, 1), y: within(target.current.y - dy / height, 0, 1) });
  }
  function zoomAvatar(factor: number, frame: HTMLElement) {
    const target = avatarFrame(frame); if (!target) return;
    target.apply({ ...target.current, zoom: within(target.current.zoom * factor, target.minimum, 8) });
  }

  async function pick(kind: 'portrait' | 'avatar') {
    setBusy('image');
    try { const result = await invoke<{ file: string | null }>('asset.import'); if (result?.file) set(kind === 'portrait' ? { portrait: result.file, face: { x: 0.5, y: 0.15, zoom: 3 }, portraitScale: undefined, portraitOffset: undefined } : { avatar: result.file, avatarFace: undefined }); } catch {} finally { setBusy(null); }
  }
  const [personaPreview, setPersonaPreview] = useState<{ text: string; path: string; truncated: boolean } | null>(null);
  async function importPersona() {
    setBusy('import');
    try {
      // Shown in full before anything changes: a client's instruction file is not always a persona.
      setPersonaPreview(await invoke<{ text: string; path: string; truncated: boolean }>('persona.import', { executor: draft.executor }));
    } catch {} finally { setBusy(null); }
  }
  async function save() {
    if (busy || !draft.name.trim() || !snapshot.backendReady) return;
    setBusy('save');
    let created: AcpExecutor | undefined;
    try {
      if(snapshot.runs.some(run=>['running','waiting_user','stopping'].includes(run.status)&&!run.completedAt)){
        const addingTemplate=!existing&&Boolean(draft.id&&draft.templateId===draft.id);
        await invoke('member.change.queue',{method:connecting?'member.card.save':'team.save',params:{member:{...draft,id:existing?.id??(addingTemplate?draft.id:undefined)},addTemplate:addingTemplate,...(connecting?{executor:{...program,name:program.name.trim()||draft.name.trim()}}:{})},label:t("{0} 的人物卡", draft.name)},t("人物卡已排队，将在成员空闲后保存。"));onBack();return;
      }
      if (connecting) created = await invoke<AcpExecutor>('executor.save', { executor: { ...program, name: program.name.trim() || draft.name.trim() } });
      const addingTemplate=!existing&&Boolean(draft.id&&draft.templateId===draft.id);
      await invoke('team.save', { member: { ...draft, id: existing?.id??(addingTemplate?draft.id:undefined), ...(created ? { executor: created.id } : {}) },addTemplate:addingTemplate }, created ? t("{0} 已加入团队，正在检查 {1} 的连接。", draft.name, created.name) : t("{0} 的人物卡已保存，下一轮对话生效。", draft.name || t("成员")));
      onBack();
    } catch {
      // Do not leave a connection behind for a member that was not created.
      if (created) await invoke('executor.delete', { id: created.id }).catch(() => {});
    } finally { setBusy(null); }
  }

  const actions = <div className="card-editor-actions">
    {existing?.builtIn && <button type="button" className="button quiet" disabled={Boolean(busy)} onClick={() => void reset()}><RotateCcw size={14} />{t("恢复默认资料")}</button>}
    <span className="spacer" />
    <button type="button" className="button quiet" disabled={busy === 'save'} onClick={onCancel}>{t("取消")}</button>
    {existing && <button type="button" className="button danger-solid" disabled={Boolean(busy)||!snapshot.backendReady} onClick={() => setDeleting(true)}><Trash2 size={14} />{t("删除人物卡")}</button>}
    <button type="button" className="button primary" disabled={!draft.name.trim() || (connecting && !program.command.trim()) || Boolean(busy) || !snapshot.backendReady} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}{t("保存人物卡")}</button>
  </div>;
  async function reset() {
    if (!existing?.builtIn || !window.confirm(t("把 {0} 恢复成默认资料？人设、记忆和上传的图片都会清除。", existing.name))) return;
    try { await invoke('team.reset', { id: existing.id }, t("已恢复默认资料。")); onBack(); } catch {}
  }

  return <div className="card-editor">
    <div className="card-editor-head">
      <button type="button" className="button small quiet" onClick={onCancel}><ArrowLeft size={14} />{t("返回团队")}</button>
      <h3>{existing ? t("{0} 的人物卡", existing.name) : t("添加新成员")}</h3>
      {existing&&<CardVisibilityButton member={existing.card} invoke={invoke} disabled={Boolean(busy)||!snapshot.backendReady}/>}
    </div>
    <div className="card-editor-body">
      <aside className={`card-preview member-${preview.id}`}>
        {preview.art ? <FramePad label={t("调整立绘")} className="portrait-pad" disabled={Boolean(busy)} onMove={movePortrait} onZoom={zoomPortrait}><Portrait member={preview} className="card-preview-portrait" /></FramePad>
          : <Portrait member={preview} className="card-preview-portrait" />}
        {preview.art && <div className="frame-caption"><small>{t("立绘 {0}%", Math.round(portraitScale * 100))}</small>{(draft.portraitScale !== undefined || draft.portraitOffset) && <button type="button" className="link-button" onClick={() => set({ portraitScale: undefined, portraitOffset: undefined })}>{t("立绘恢复默认")}</button>}</div>}
        <div className="card-preview-avatar">
          {framingAvatar ? <FramePad label={t("调整头像")} className="avatar-pad" disabled={Boolean(busy)} onMove={moveAvatar} onZoom={zoomAvatar}><Avatar member={preview} size={92} /></FramePad> : <Avatar member={preview} size={92} />}
          <span><strong>{preview.name}</strong><small>{connecting ? program.name.trim() || t("新的 AI 程序") : PROVIDER_NAMES[draft.executor] ?? t("未连接")}</small>
            {framingAvatar && <small>{t("头像 {0}×", round(avatarZoom).toFixed(1))}</small>}
            {framingAvatar && (draft.avatar ? draft.avatarFace : draft.face) && <button type="button" className="link-button" onClick={() => set(draft.avatar ? { avatarFace: undefined } : { face: undefined })}>{t("头像恢复默认")}</button>}</span>
        </div>
        {draft.motto && <p className="card-preview-motto">「{draft.motto}」</p>}
        <small className="card-preview-note">{t("{0}调整后点击底部“保存人物卡”。", preview.art || draft.avatar ? t("在立绘和头像上拖动调整位置，滚轮缩放（也可以用方向键和 +/-）。") : t("上传立绘或头像后可以在这里调整。"))}</small>
      </aside>
      <div className="card-fields">
        {!existing&&<label className="field">{t("人物形象模板")}<select aria-label={t("人物形象模板")} value={draft.templateId??''} onChange={event=>{const template=BUILTIN_MEMBERS.find(item=>item.id===event.target.value);set({id:template&&!snapshot.members.some(item=>item.id===template.id)&&!snapshot.removedMembers?.some(item=>item.id===template.id)?template.id:'',templateId:template?.id as MemberProfile['templateId'],name:template?.name??draft.name,color:template?.color??draft.color,motto:template?.motto??draft.motto});}}><option value="">{t("自定义人物")}</option>{BUILTIN_MEMBERS.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{t("仅填入形象和名称，执行端由你选择。")}</small></label>}
        <div className="card-field-row">
          <label className="field">{t("名字")}<input value={draft.name} maxLength={40} onChange={event => set({ name: event.target.value })} placeholder={t("例如：小雪")} /></label>
          {existing ? <label className="field">{t("使用的连接")}<select aria-label={t("使用的连接")} value={draft.executor} onChange={event=>set({executor:event.target.value as PermissionMember,model:undefined,effort:undefined})}>{disconnected&&<option value={draft.executor} disabled>{t("未连接（原连接已删除）")}</option>}{executors.map(id=><option key={id} value={id}>{connectionName(id)}</option>)}</select>
              <small>{t("每个连接分别保存登录与密钥。更换后新会话使用所选连接；已有会话保留原连接和记录。")}</small></label>
            : <div className="field">{t("使用的连接")}<div className="segmented" role="radiogroup" aria-label={t("程序来源")}>
                <button type="button" role="radio" aria-checked={source === 'program'} className={source === 'program' ? 'selected' : ''} onClick={() => setSource('program')}>{t("接入新的 AI 程序")}</button>
                <button type="button" role="radio" aria-checked={source === 'existing'} className={source === 'existing' ? 'selected' : ''} onClick={() => setSource('existing')}>{t("沿用已有的程序")}</button></div>
              {source === 'existing' ? <select aria-label={t("使用的连接")} value={draft.executor} onChange={event => set({ executor: event.target.value as PermissionMember, model: undefined, effort: undefined })}>{executors.map(id => <option key={id} value={id}>{connectionName(id)}</option>)}</select>
                : <small>{t("像 Claude、Codex、DSH 一样单独配置：程序、参数、登录和权限都属于这位成员的连接。")}</small>}</div>}
        </div>
        {disconnected&&<p className="card-preview-note" role="status">{t("原连接已删除，人物卡资料和历史对话已保留。选择新连接并保存人物卡后，新话题会使用新连接。")}</p>}
        {!connecting&&selectedConnection?.catalogId&&<CatalogConnectionCreator key={selectedConnection.id} executor={selectedConnection} snapshot={snapshot} invoke={invoke} notify={notify} onCreated={connection=>set({executor:connection.id,model:undefined,effort:undefined})}/>}
        {!connecting&&!selectedConnection&&!disconnected&&draft.executor==='claude'&&snapshot.settings.paths.claude&&<NativeConnectionCreator id="claude" snapshot={snapshot} invoke={invoke} notify={notify} onCreated={connection=>set({executor:connection.id,model:undefined,effort:undefined})}/>}
        {!existing&&source==='existing'&&<p className="card-preview-note">{t("从清单下载并配置，或手动添加连接后，执行端会自动出现在这里。只下载到电脑、尚未添加到 HiveLab 合屋 的程序，需要先添加连接。")}</p>}
        {connecting && <AcpFields value={program} onChange={setProgram} invoke={invoke} nameHint={draft.name} />}
        <div className="card-image-controls">
          <div className="card-image-actions">
            <button type="button" className="button small secondary" disabled={Boolean(busy)} onClick={() => void pick('portrait')}><ImagePlus size={13} />{draft.portrait ? t("更换立绘") : t("上传立绘")}</button>
            {draft.portrait && <button type="button" className="button small quiet" disabled={Boolean(busy)} onClick={() => set({ portrait: undefined, portraitScale: undefined, portraitOffset: undefined, face: undefined })}>{existing?.builtIn ? t("用回默认立绘") : t("移除立绘")}</button>}
            <button type="button" className="button small secondary" disabled={Boolean(busy)} onClick={() => void pick('avatar')}><UserRound size={13} />{draft.avatar ? t("更换头像") : t("上传单独头像")}</button>
            {draft.avatar && <button type="button" className="button small quiet" disabled={Boolean(busy)} onClick={() => set({ avatar: undefined, avatarFace: undefined })}>{t("移除头像")}</button>}
          </div>
          <small className="card-preview-note">{t("图片会复制到 HiveLab 合屋 的数据目录，原文件不会被改动。支持 PNG、JPG、WebP、GIF，8 MB 以内。")}</small>
        </div>
        <div className="card-field-row">
          <label className="field">{t("怎么称呼你")}<input value={draft.userTitle ?? ''} maxLength={40} onChange={event => set({ userTitle: event.target.value })} placeholder={userName ? t("留空就叫你「{0}」", userName) : t("填写你希望使用的称呼")} /></label>
          <label className="field">{t("一句话介绍")}<input value={draft.motto ?? ''} maxLength={80} onChange={event => set({ motto: event.target.value })} placeholder={t("会显示在团队卡片上")} /></label>
        </div>
        <div className="card-field-row">
          <label className="field">{t("身高（厘米）")}<input type="number" inputMode="numeric" min={120} max={230} step={1} value={draft.height ?? ''} onChange={event => set({ height: event.target.value === '' ? undefined : Math.round(Number(event.target.value)) })} placeholder={t("例如：158")} /><small>{t("只影响首页立绘的高矮比例，不影响对话。")}</small></label>
        </div>
        <div className="field">{t("特征色")}<div className="swatches" role="group" aria-label={t("推荐特征色")}>{MEMBER_COLOR_PRESETS.map(({name,color}) => <button type="button" key={color} className={`swatch ${preview.color.toLowerCase() === color ? 'selected' : ''}`} style={{ background: color }} title={`${name} · ${color}`} aria-label={t("特征色 {0}", name)} aria-pressed={preview.color.toLowerCase()===color} onClick={() => set({ color })} />)}<input type="color" value={preview.color} onChange={event => set({ color: event.target.value })} aria-label={t("自定义代表色")} title={t("自定义特征色")} /></div><small>{t("选择柔和的识别色，也可以自行调色；聊天底色只取淡淡的色调。")}</small></div>
        <CardTextSection title={t("人设与说话风格")} preview={draft.persona??''} meta={t("{0} 字", draft.persona?.length??0)}><label className="field">{t("人设与说话风格")}<textarea rows={6} maxLength={8000} value={draft.persona ?? ''} onChange={event => set({ persona: event.target.value })} placeholder={t("例如：\n你是团队里的审稿人，性格沉稳，说话简洁。\n先指出最重要的问题，再给出修改建议。")} />
          <span className="field-actions"><small>{t("每轮对话都会作为系统设定交给成员。只影响身份、语气和称呼，不改变权限。")}</small>{!connecting && DESKTOP_PERSONA[draft.executor] && <button type="button" className="link-button" disabled={busy === 'import'} onClick={() => void importPersona()}><Download size={12} />{t("从 {0} 导入", DESKTOP_PERSONA[draft.executor])}</button>}</span>
        </label></CardTextSection>
        <label className="field">{t("发言积极度")}<select aria-label={t("发言积极度")} value={draft.talkativeness ?? 'normal'} onChange={event => set({ talkativeness: event.target.value as MemberProfile['talkativeness'] })}><option value="quiet">{t("安静")}</option><option value="normal">{t("适中")}</option><option value="chatty">{t("话多")}</option></select>
          <small>{t("影响自由讨论中主动接话的机会。点名和直接提问优先，成员仍可选择沉默。")}</small>
        </label>
        <LifeEditor draft={draft} onChange={set} />
        <CardTextSection title={t("长期记忆")} preview={memoryEntries(draft).map(item=>item.text).join('\n')} meta={t("{0} 条", memoryEntries(draft).length)}><MemoryEditor entries={memoryEntries(draft)} onChange={memories => set({ memories })} executor={connecting ? undefined : draft.executor} invoke={invoke} /></CardTextSection>
        <p className="card-preview-note">{t("模型和思考程度在工位输入框旁的模型按钮里选择，选择后立即生效，并作为这位成员新话题的设置。")}</p>
      </div>
    </div>
    {actionContainer ? createPortal(actions, actionContainer) : actions}
    {deleting&&existing&&createPortal(<DeleteMemberDialog member={existing.card} invoke={invoke} onClose={()=>setDeleting(false)} onDeleted={()=>{setDeleting(false);onBack();}}/>,document.body)}
    {personaPreview && createPortal(<Modal title={t("导入前先看看")} subtitle={personaPreview.path} onClose={() => setPersonaPreview(null)} className="memory-import-dialog">
      <div className="modal-body"><p className="confirm-text">{t("确认这是一段人设（身份、语气、称呼）。如果是工作规则或工具说明，就不要导入，否则成员可能照着去做。{0}{1}", draft.persona?.trim() ? t("导入会替换当前的人设。") : '', personaPreview.truncated ? t("文件较长，只会保留前 8000 字。") : '')}</p>
        <pre className="persona-preview">{personaPreview.text}</pre></div>
      <div className="modal-footer"><button type="button" className="button quiet" onClick={() => setPersonaPreview(null)}>{t("不导入")}</button>
        <button type="button" className="button primary" onClick={() => { set({ persona: personaPreview.text }); notify(t("已导入 {0}。保存人物卡后生效。", personaPreview.path)); setPersonaPreview(null); }}>{t("用这段作为人设")}</button></div>
    </Modal>, document.body)}
  </div>;
}

/** The user's own name and avatar, and how each member will address them. */
export function ProfileSettings({ snapshot, invoke }: { snapshot: Snapshot; invoke: Invoke }) {
  const team = useTeam();
  const [profile, setProfile] = useState<UserProfile>(snapshot.profile);
  const [busy, setBusy] = useState(false);
  async function pick() { try { const result = await invoke<{ file: string | null }>('asset.import'); if (result?.file) setProfile(previous => ({ ...previous, avatar: result.file! })); } catch {} }
  async function save() { setBusy(true); try { await invoke('profile.save', { profile }, t("个人资料已保存。")); } catch {} finally { setBusy(false); } }
  return <>
    <div className="settings-section-heading"><h3>{t("个人资料")}</h3></div>
    <div className="profile-card">
      <UserAvatar name={profile.name || t("我")} avatar={profile.avatar} size={84} />
      <div className="profile-fields">
        <label className="field">{t("你的名字")}<input value={profile.name} maxLength={40} onChange={event => setProfile(previous => ({ ...previous, name: event.target.value }))} placeholder={t("填写你的昵称")} /><small>{t("显示在你的消息旁；没有单独设置称呼的成员会这样叫你。")}</small></label>
        <div className="card-image-actions"><button type="button" className="button small secondary" onClick={() => void pick()}><ImagePlus size={13} />{profile.avatar ? t("更换头像") : t("上传头像")}</button>{profile.avatar && <button type="button" className="button small quiet" onClick={() => setProfile(previous => ({ name: previous.name }))}>{t("移除头像")}</button>}</div>
      </div>
    </div>
    <div className="panel-section-title">{t("大家会这样称呼你")}</div>
    <div className="address-list">{team.members.map(member => <div key={member.id} className={`address-row member-${member.id}`}><Avatar member={member} size={28} /><span><strong>{member.name}</strong>：「{member.userTitle || (profile.name && profile.name !== '你' ? profile.name : t("你"))}」</span></div>)}</div>
    <div className="profile-actions"><button type="button" className="button primary" disabled={!profile.name.trim() || busy} onClick={() => void save()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}{t("保存个人资料")}</button></div>
  </>;
}

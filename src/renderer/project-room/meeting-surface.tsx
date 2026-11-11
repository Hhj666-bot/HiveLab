import {t} from '../i18n';
import {createContext, useContext, useEffect, useState, type ReactNode, type Ref} from "react";
import {createPortal} from "react-dom";
import {AppWindow, ChevronDown, ChevronRight, ChevronUp, Maximize2, Minimize2, LoaderCircle, Send} from "lucide-react";
import {Avatar, type TeamMember} from "../members";
import {Markdown} from "../Markdown";
import {Modal} from "../modals";
import {action} from "./flow-ui";
export function FlowMessage({ title, status, pending, text, onOpen, children, headerAction, compact = false }: { title: string; status: string; pending: boolean; text: string; onOpen: () => void; children?:ReactNode; headerAction?:ReactNode; compact?:boolean }) {
  const body = text.replace(/^【[^】]*】\s*/, ''), long = body.length > 280 || body.split('\n').length > 6;
  const [open, setOpen] = useState(pending && !long);
  useEffect(() => { if (pending) setOpen(!long); }, [pending]);
  return <article aria-label={title} className={`room-bubble flow-message ${compact ? 'flow-message-decision' : ''} ${pending ? 'pending' : 'settled'} ${open ? 'open' : ''}`}>
    <header><button type="button" className="flow-message-title" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<strong>{title}</strong></button>{status && <span className="flow-message-status">{status}</span>}{pending && <button type="button" className="link-button" onClick={onOpen}>{t("去处理")}</button>}{headerAction}</header>
    {open && <div className="flow-message-text"><Markdown text={body} />{children}</div>}
  </article>;
}

const DockActionsTarget = createContext<HTMLDivElement | null | undefined>(undefined);

/** Acceptance controls share the dock's header, outside the report scroller. */
export function FlowDockActions({children}: {children:ReactNode}) {
  const target = useContext(DockActionsTarget);
  return target === undefined ? <>{children}</> : target ? createPortal(children, target) : null;
}

function FlowDockContent({children,bodyRef,actionsRef}: {children:ReactNode;bodyRef?:Ref<HTMLDivElement>;actionsRef?:Ref<HTMLDivElement>}) {
  return <div className="flow-dock-content">
    {actionsRef && <div className="flow-dock-actions" ref={actionsRef}/>}
    <div className="flow-dock-body" ref={bodyRef}>{children}</div>
  </div>;
}

export function FlowDock({ open, onToggle, waiting, standing, action, children,bodyRef }: { open: boolean; onToggle: (open: boolean) => void; waiting: string[]; standing: string[]; action?: ReactNode; children: ReactNode;bodyRef?:Ref<HTMLDivElement> }) {
  const [view, setView] = useState<'dock' | 'full' | 'window'>('dock');
  const [actionsTarget,setActionsTarget] = useState<HTMLDivElement | null>(null);
  const title = waiting.length ? t("待你处理") : t("进展");
  const body = <FlowDockContent bodyRef={bodyRef} actionsRef={view === 'window' ? setActionsTarget : undefined}>{children}</FlowDockContent>;
  return <DockActionsTarget.Provider value={actionsTarget}>
    <section className={`flow-dock ${open ? 'open' : ''} ${open && view === 'full' ? 'full' : ''} ${waiting.length ? 'has-waiting' : ''}`} aria-label={t("待你处理")}>
      <div className="flow-dock-bar">
        <button type="button" className="flow-dock-toggle" aria-expanded={open} aria-label={t("{0}会议待办：{1}", open ? t("收起") : t("展开"), (waiting.length ? waiting : standing).join('、'))} title={open ? t("收起，回到聊天") : t("展开待处理的事项")} onClick={() => { if (open) setView('dock'); onToggle(!open); }}>
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}<strong>{title}</strong>{waiting.length > 0 && <span className="flow-dock-count">{waiting.length}</span>}
          {/* Folded, the bar says what waits; open, the cards below say it, so the line is not repeated. */}
          <span className="flow-dock-summary">{open ? '' : (waiting.length ? waiting : standing).join(' · ')}</span>
        </button>
        {open && view !== 'window' && <div className="flow-dock-actions" ref={setActionsTarget}/>}
        {action}
        {view !== 'window' && <button type="button" className="icon-button" aria-label={view === 'full' && open ? t("还原到聊天框上方") : t("铺满聊天区查看")} title={view === 'full' && open ? t("还原到聊天框上方") : t("铺满聊天区查看")} onClick={() => { setView(view === 'full' && open ? 'dock' : 'full'); onToggle(true); }}>{view === 'full' && open ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>}
        <button type="button" className="icon-button" aria-label={view === 'window' ? t("收回到聊天框上方") : t("在独立窗口查看")} title={view === 'window' ? t("收回到聊天框上方") : t("在独立窗口查看")} onClick={() => { setView(view === 'window' ? 'dock' : 'window'); onToggle(true); }}><AppWindow size={14} /></button>
      </div>
      {open && view !== 'window' && body}
    </section>
    {open && view === 'window' && createPortal(<Modal title={title} subtitle={t("在这里处理与在聊天框上方处理相同；关闭后回到原位置。")} className="flow-dock-modal" onClose={() => setView('dock')}>{body}</Modal>, document.body)}
  </DockActionsTarget.Provider>;
}

export function LeadPicker({ team, ready, busy, onStart, onCancel }: { team: TeamMember[]; ready: (member: TeamMember) => boolean; busy: boolean; onStart: (lead: string, members: string[]) => Promise<void>; onCancel: () => void }) {
  const available = team.filter(ready), [lead, setLead] = useState(''), leader = available.find(member => member.id === lead);
  return <section className="lead-picker" aria-label={t("选负责人")}>
    <strong>{t("谁来当负责人？")}</strong><small>{t("负责人根据刚才的讨论起草方案、整合每轮成果。参加的成员在聊天栏上方调整；负责人自己做的任务由另一位复核。")}</small>
    <div className="lead-picker-members">{team.map(member => {
      const ok = ready(member);
      return <div key={member.id} className={`lead-option member-${member.id} on ${lead === member.id ? 'lead' : ''} ${ok ? '' : 'unready'}`}>
        <button type="button" className="lead-option-face" aria-label={t("{0} 当负责人", member.name)} aria-pressed={lead === member.id} disabled={!ok || busy} title={ok ? '' : t("{0} 还没准备好", member.product)} onClick={() => setLead(member.id)}><Avatar member={member} size={42} />{lead === member.id && <span className="lead-badge">{t("负责人")}</span>}</button>
        <span>{member.name}</span>
      </div>;
    })}</div>
    <div className="round-actions"><button type="button" className="button primary" disabled={busy || available.length < 2 || !leader} onClick={() => void onStart(lead, available.map(member => member.id))}>{busy ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}{leader ? t("请 {0} 起草方案", leader.name) : t("先选一位负责人")}</button><button type="button" className="button quiet" disabled={busy} onClick={onCancel}>{t("再聊聊")}</button></div>
  </section>;
}

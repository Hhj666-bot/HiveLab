import {t} from '../i18n';
import {useContext,useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,X} from 'lucide-react';
import type {RoomThread} from '../../shared/types';
import {Markdown} from '../Markdown';
import {SummaryNote} from '../topics';
import {dateTime} from '../ui';
import {WorkspaceDrawer,WorkspaceSearchPanel,WorkspaceSummaryControl} from '../workspace-toolbar';
import './room-summary-drawer.css';
export function RoomSummaryDrawer({thread,children}:{thread:RoomThread;children?:ReactNode}){
 const control=useContext(WorkspaceSummaryControl),panel=useContext(WorkspaceSearchPanel),drawer=useContext(WorkspaceDrawer),button=useRef<HTMLButtonElement>(null);
 const open=drawer?.active==='summary';
 const toggle=(value:boolean)=>drawer?.setActive(value?'summary':undefined);
 useEffect(()=>()=>{drawer?.setActive(previous=>previous==='summary'?undefined:previous);},[thread.id,drawer?.setActive]);
 const summary=thread.summary,label=summary?t("已压缩 · {0} · 覆盖 {1} 条", summary.byName??t("成员"), summary.count):t("延续的话题摘要");
 if(!control||!panel)return drawer?null:<div className="topic-bar-summary"><SummaryNote thread={thread}/>{children}</div>;
 const close=()=>{toggle(false);button.current?.focus();};
 return <>{createPortal(<button ref={button} type="button" className="room-summary-toggle" aria-label={t("查看压缩摘要")} aria-expanded={open} title={summary?`${label} · ${dateTime(summary.at)}`:label} onClick={()=>toggle(!open)}><span>{label}</span><ChevronDown size={14}/></button>,control)}
 {open&&createPortal(<aside className="room-summary-drawer workspace-glass-drawer" aria-label={t("压缩摘要")} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();}}}><header className="conversation-search-heading"><div><strong>{t("上下文摘要")}</strong><small>{summary?`${summary.byName??t("成员")} · ${dateTime(summary.at)}`:t("从先前话题延续")}</small></div><button type="button" className="preview-icon-button" aria-label={t("关闭压缩摘要")} onClick={close}><X size={16}/></button></header><div className="room-summary-content">{thread.inherited&&<section><h3>{t("延续「{0}」", thread.inherited.title)}</h3><Markdown text={thread.inherited.text}/></section>}{summary&&<section><Markdown text={summary.text}/></section>}{children&&<div className="topic-bar-links">{children}</div>}</div></aside>,panel)}</>;
}

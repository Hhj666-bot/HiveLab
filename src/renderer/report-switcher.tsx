import {t} from './i18n';
import { Avatar, useTeam } from './members';

export interface ReportEntry { id: string; name: string; count: number; historical?: boolean; unread?: boolean }

/** 成员汇报: one chip per project member. Shown in the project room and on the report page itself,
 *  where the current member is marked and the others switch the page. */
export function ReportSwitcher({ entries, current, onOpen }: { entries: ReportEntry[]; current?: string; onOpen: (memberId: string) => void }) {
  const team = useTeam();
  if (!entries.length) return null;
  return <nav className="report-switcher" aria-label={t("项目成员汇报")}>
    <span className="report-switcher-label">{t("成员汇报")}</span>
    <div className="report-switcher-members" role="group" aria-label={t("成员汇报列表")} tabIndex={0}>{entries.map(entry => {
      const member = team.get(entry.id), selected = current === entry.id;
      return <button key={entry.id} type="button" className={`report-chip member-${entry.id} ${selected ? 'selected' : ''} ${entry.historical ? 'historical' : ''}`}
        aria-label={t("{0} 的项目汇报", entry.name)} aria-current={selected ? 'page' : undefined}
        title={`${entry.name} · ${entry.count ? t("{0} 份汇报", entry.count) : t("还没有汇报")}${entry.historical ? t(" · 已不在名单") : ''}`} onClick={() => onOpen(entry.id)}>
        {member && <Avatar member={member} size={22} ring={false} />}<span>{entry.name}</span>
        {entry.count > 0 && <small>{entry.count}</small>}
        {entry.unread && <span className="unread-dot" aria-label={t("有未读汇报")} />}
      </button>;
    })}</div>
  </nav>;
}

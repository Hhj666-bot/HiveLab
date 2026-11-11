import {t} from './i18n';
import { useState } from 'react';
import {CardTextSection} from './card-text-section';
import type { MemberProfile } from '../shared/types';
import { QUIRK_LIMIT, QUIRKS_MAX, RELATION_LIMIT, ROUTINE_LIMIT, ROUTINE_PERIODS } from '../shared/life';
import { Avatar, useTeam } from './members';

const hours = (from: number, to: number) => `${String(from).padStart(2, '0')}:00–${String(to).padStart(2, '0')}:00`;

/** A member's everyday life on the card: routine by part of day, small habits and relations to teammates. */
export function LifeEditor({ draft, onChange }: { draft: MemberProfile; onChange: (change: Partial<MemberProfile>) => void }) {
  const team = useTeam(), others = team.members.filter(member => member.id !== draft.id);
  const [quirks, setQuirks] = useState(() => (draft.quirks ?? []).join('\n'));
  const relation = (id: string) => draft.relations?.find(item => item.memberId === id)?.text ?? '';
  function setRelation(id: string, text: string) {
    const rest = (draft.relations ?? []).filter(item => item.memberId !== id);
    onChange({ relations: text.trim() ? [...rest, { memberId: id, text }] : rest });
  }
  return <div className="card-persona-sections">
    <CardTextSection title={t("日常")} preview={ROUTINE_PERIODS.map(period=>draft.routine?.[period.id]?`${period.label}：${draft.routine[period.id]}`:'').filter(Boolean).join('\n')}>
    <div className="life-routine">{ROUTINE_PERIODS.map(period => <label key={period.id} className="life-slot"><span>{period.label}<small>{hours(period.from, period.to)}</small></span>
      <input aria-label={t("{0}的作息", period.label)} maxLength={ROUTINE_LIMIT} value={draft.routine?.[period.id] ?? ''} placeholder={period.example} onChange={event => onChange({ routine: { ...draft.routine, [period.id]: event.target.value } })} /></label>)}</div></CardTextSection>
    <CardTextSection title={t("小习惯")} preview={(draft.quirks??[]).join('\n')} meta={t("{0} 个", draft.quirks?.length??0)}><label className="life-label">{t("小动作")}<small>{t("每行一个，最多 {0} 个", QUIRKS_MAX)}</small>
      <textarea aria-label={t("小动作")} rows={3} value={quirks} placeholder={t("例如：\n转笔\n托腮看窗外")} onChange={event => { setQuirks(event.target.value); onChange({ quirks: event.target.value.split('\n').map(line => line.trim().slice(0, QUIRK_LIMIT)).filter(Boolean).slice(0, QUIRKS_MAX) }); }} /></label></CardTextSection>
    {others.length > 0 && <CardTextSection title={t("和其他成员的关系")} preview={others.filter(m=>relation(m.id)).map(m=>`${m.name}：${relation(m.id)}`).join('\n')}>
      <div className="life-relations">{others.map(member => <label key={member.id} className="life-relation"><Avatar member={member} size={22} ring={false} /><span>{member.name}</span>
        <input aria-label={t("和 {0} 的关系", member.name)} maxLength={RELATION_LIMIT} value={relation(member.id)} placeholder={t("例如：搭档，常互相吐槽")} onChange={event => setRelation(member.id, event.target.value)} /></label>)}</div></CardTextSection>}
    <small>{t("作息和小动作只用来显示成员此刻的状态，不会当作真实经历发给成员；关系会作为人设的一部分交给成员。")}</small>
  </div>;
}

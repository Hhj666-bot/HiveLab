import {t} from './i18n';
import type { MemberProfile } from './types';

/**
 * A member's short code ("01", "02", …) is a readable alias for its internal id.
 * The internal id keeps desks, topics and history together; the code is what people read and what
 * 人物设定.md uses to point at a teammate, so renaming a member never breaks a relation.
 */
export const MEMBER_CODE = /^[0-9A-Za-z][0-9A-Za-z_-]{0,11}$/;
export const isMemberCode = (value: unknown): value is string => typeof value === 'string' && MEMBER_CODE.test(value);

/** The numbers already taken, including codes of members who left: a code is never handed out twice automatically. */
export function highestNumber(codes: Iterable<string | undefined>, last = 0) {
  let highest = last;
  for (const code of codes) if (code && /^\d+$/.test(code)) highest = Math.max(highest, Number(code));
  return highest;
}
export const formatCode = (number: number) => String(number).padStart(2, '0');

/** Check a full set of codes chosen by the user: every code valid, no two members sharing one. */
export function validateCodes(members: Pick<MemberProfile, 'id' | 'name'>[], codes: Record<string, string>): string | undefined {
  const seen = new Map<string, string>();
  for (const member of members) {
    const code = codes[member.id]?.trim();
    if (!code) return t("请给「{0}」填写编号。", member.name);
    if (!isMemberCode(code)) return t("「{0}」的编号「{1}」无效：只能用字母、数字、下划线和短横线，最多 12 个字符。", member.name, code);
    const other = seen.get(code.toLowerCase());
    if (other) return t("「{0}」和「{1}」的编号都是「{2}」，请改成不同的编号。", other, member.name, code);
    seen.set(code.toLowerCase(), member.name);
  }
}

/** How a member is labelled wherever a code helps tell people apart. */
export const codeLabel = (member: Pick<MemberProfile, 'code' | 'name'>) => member.code ? `${member.code} ${member.name}` : member.name;

/**
 * Persona text often names teammates by number ("身份=02", "姐姐 01", "02 与 03 是主力").
 * When codes move, every old number is swapped for its new one in one pass, so a swap (02↔03) never collides.
 * A number only counts when it stands alone: not inside a longer number, a time (8:02), a date (11-02 / 11.02) or a word.
 */
export function codeRewriter(changes: Record<string, string>): ((text: string) => { text: string; count: number }) | undefined {
  const pairs = Object.entries(changes).map(([from, to]) => [from.trim(), to.trim()] as const).filter(([from, to]) => from && to && from !== to);
  if (!pairs.length) return undefined;
  const map = new Map(pairs);
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![0-9A-Za-z_.:/\-])(${[...map.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![0-9A-Za-z_.:/%\-])`, 'g');
  return (text: string) => {
    let count = 0;
    const next = text.replace(pattern, (match: string) => { count++; return map.get(match) ?? match; });
    return { text: next, count };
  };
}

type TextFields = Pick<MemberProfile, 'persona' | 'voice' | 'motto' | 'routine' | 'quirks' | 'relations' | 'memories' | 'memory'>;
/** The member's persona text with old numbers replaced, and how many places changed. Nothing else on the card moves. */
export function rewriteMemberCodes(member: MemberProfile, rewrite: (text: string) => { text: string; count: number }): { count: number; fields: Partial<TextFields> } {
  let count = 0;
  const one = (value: string | undefined) => { if (!value) return value; const result = rewrite(value); count += result.count; return result.text; };
  const fields: Partial<TextFields> = {};
  if (member.persona) fields.persona = one(member.persona);
  if (member.voice) fields.voice = one(member.voice);
  if (member.motto) fields.motto = one(member.motto);
  if (member.memory) fields.memory = one(member.memory);
  if (member.routine) fields.routine = Object.fromEntries(Object.entries(member.routine).map(([period, text]) => [period, one(text)])) as TextFields['routine'];
  if (member.quirks) fields.quirks = member.quirks.map(item => one(item) ?? item);
  if (member.relations) fields.relations = member.relations.map(relation => ({ ...relation, text: one(relation.text) ?? relation.text }));
  if (member.memories) fields.memories = member.memories.map(entry => ({ ...entry, text: one(entry.text) ?? entry.text }));
  return { count, fields: count ? fields : {} };
}

/** Old code → new code for every member whose code changes. */
export const codeChanges = (members: Pick<MemberProfile, 'id' | 'code'>[], codes: Record<string, string>) =>
  Object.fromEntries(members.filter(member => member.code && codes[member.id] && codes[member.id].trim() !== member.code).map(member => [member.code!, codes[member.id].trim()]));

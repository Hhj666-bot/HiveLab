import type { MemberProfile, RoutinePeriod } from './types';
import { ROUTINE_PERIODS } from './life';

/**
 * 人物设定.md — every member's personality, voice and daily habits in one Markdown file.
 * The app and the file are two views of the same data: edits in either place reach the member's card.
 * Only the fields below live in the file; the card still owns name, artwork, executor, model and memories.
 */
export const PERSONA_FILE_NAME = '人物设定.md';

export const PERSONA_HEADINGS = {
  persona: '人设与说话风格',
  voice: '语气与小动作',
  routine: '日常',
  quirks: '小习惯',
  relations: '和其他成员的关系',
} as const;

const TALK: Record<NonNullable<MemberProfile['talkativeness']>, string> = { quiet: '安静', normal: '适中', chatty: '话多' };
const TALK_READ: Record<string, NonNullable<MemberProfile['talkativeness']>> = { 安静: 'quiet', quiet: 'quiet', 适中: 'normal', normal: 'normal', 话多: 'chatty', chatty: 'chatty' };

export const PERSONA_FILE_INTRO = `<!--
这个文件保存每位成员的人设、说话风格和日常习惯。

- 在程序里“设置 → 人物设定”可视化编辑，也可以直接在这里用任意编辑器修改，保存后程序会自动读取。
- 每位成员一个“## 名字”小节。“编号”用来对应人物卡，请在“设置 → 人物设定 → 成员编号”中修改，不要在这里改；名字、形象、连接和长期记忆在人物卡里改。
- “和其他成员的关系”按编号对应成员，写成“- 03（Sol）：……”，括号里的名字只是方便阅读，改名不影响关系。
- “人设与说话风格”下面写什么都可以，会在每一轮对话里交给成员；正文里以 # 开头的行会被自动加上反斜杠，这是正常的。
- “人设与说话风格”和“和其他成员的关系”只由你修改；“语气与小动作”“小习惯”“日常”成员可以自己微调，改动同样写回这里。
- 这是唯一生效的人设来源，其他人设文档只作参考，不会交给成员。
- 删除某个小标题下的全部内容，会清空对应设置；整个小标题不写则保持原样。
- 以上设定只影响身份、语气和称呼，不改变权限和安全规则。
-->`;

/** The editable slice of a card. Undefined means "not mentioned"; an empty value means "cleared". */
export interface PersonaFields {
  userTitle?: string;
  talkativeness?: MemberProfile['talkativeness'];
  motto?: string;
  persona?: string;
  voice?: string;
  routine?: Partial<Record<RoutinePeriod, string>>;
  quirks?: string[];
  /** Relation text by the other member: `ref` is a code, an internal id or (older files) a name; `name` is for reading only. */
  relations?: { ref: string; name?: string; text: string }[];
}
export interface PersonaSection { id?: string; name: string; fields: PersonaFields }

export const personaFieldsOf = (member: MemberProfile, team: MemberProfile[] = []): PersonaFields => ({
  userTitle: member.userTitle ?? '',
  talkativeness: member.talkativeness ?? 'normal',
  motto: member.motto ?? '',
  persona: member.persona ?? '',
  voice: member.voice ?? '',
  routine: { ...member.routine },
  quirks: [...(member.quirks ?? [])],
  relations: (member.relations ?? []).flatMap(relation => {
    const other = team.find(item => item.id === relation.memberId);
    return other ? [{ ref: other.code ?? other.id, name: other.name, text: relation.text }] : [];
  }),
});

const escapeLine = (line: string) => line.replace(/^(\\*)#/, '\\$1#');
const unescapeLine = (line: string) => line.replace(/^\\(\\*)#/, '$1#');
const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

export function renderPersonaFile(members: MemberProfile[]): string {
  const parts = ['# 人物设定', '', PERSONA_FILE_INTRO];
  for (const member of members) {
    const fields = personaFieldsOf(member, members);
    parts.push('', `## ${oneLine(member.name)}`, '',
      `- 编号：${member.code ?? member.id}`,
      `- 怎么称呼你：${oneLine(fields.userTitle ?? '')}`,
      `- 发言积极度：${TALK[fields.talkativeness ?? 'normal']}（安静 / 适中 / 话多）`,
      `- 一句话介绍：${oneLine(fields.motto ?? '')}`,
      '', `### ${PERSONA_HEADINGS.persona}`, '',
      ...((fields.persona ?? '').trim() ? (fields.persona as string).trim().split(/\r?\n/).map(escapeLine) : ['']),
      '', `### ${PERSONA_HEADINGS.voice}`, '',
      ...((fields.voice ?? '').trim() ? (fields.voice as string).trim().split(/\r?\n/).map(escapeLine) : ['']),
      '', `### ${PERSONA_HEADINGS.routine}`, '',
      ...ROUTINE_PERIODS.map(period => `- ${period.label}：${oneLine(fields.routine?.[period.id] ?? '')}`),
      '', `### ${PERSONA_HEADINGS.quirks}`, '',
      ...((fields.quirks ?? []).length ? fields.quirks!.map(item => `- ${oneLine(item)}`) : ['- ']),
      '', `### ${PERSONA_HEADINGS.relations}`, '',
      ...((fields.relations ?? []).length ? fields.relations!.map(item => `- ${item.ref}${item.name ? `（${oneLine(item.name)}）` : ''}：${oneLine(item.text)}`) : ['- ']));
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

const KEY = /^\s*[-*]\s*([^：:]+?)\s*[：:]\s*(.*?)\s*$/;
/** "- 标签：内容" lines under a list heading; an empty bullet carries nothing. */
function bullets(lines: string[]): { label: string; value: string }[] {
  return lines.flatMap(line => { const match = KEY.exec(line); return match ? [{ label: match[1], value: match[2] }] : []; });
}

export function parsePersonaFile(text: string): PersonaSection[] {
  const body = text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const sections: { name: string; lines: string[] }[] = [];
  for (const line of body.split('\n')) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading && !line.startsWith('###')) sections.push({ name: heading[1], lines: [] });
    else sections.at(-1)?.lines.push(line);
  }
  return sections.map(section => {
    const blocks = new Map<string, string[]>(), head: string[] = [];
    let current = head;
    for (const line of section.lines) {
      const sub = /^###\s+(.+?)\s*#*\s*$/.exec(line);
      if (sub) { current = []; blocks.set(sub[1], current); } else current.push(line);
    }
    const fields: PersonaFields = {};
    let id: string | undefined;
    for (const { label, value } of bullets(head)) {
      if (label === '编号') id = value.replace(/[`\s]/g, '') || undefined;
      else if (label === '怎么称呼你') fields.userTitle = value;
      else if (label === '发言积极度') { const word = value.split(/[（(\s]/)[0]; if (TALK_READ[word]) fields.talkativeness = TALK_READ[word]; }
      else if (label === '一句话介绍') fields.motto = value;
    }
    const persona = blocks.get(PERSONA_HEADINGS.persona);
    if (persona) fields.persona = persona.map(unescapeLine).join('\n').trim();
    const voice = blocks.get(PERSONA_HEADINGS.voice);
    if (voice) fields.voice = voice.map(unescapeLine).join('\n').trim();
    const routine = blocks.get(PERSONA_HEADINGS.routine);
    if (routine) {
      fields.routine = {};
      for (const { label, value } of bullets(routine)) {
        const period = ROUTINE_PERIODS.find(item => item.label === label || item.id === label);
        if (period && value) fields.routine[period.id] = value;
      }
    }
    const quirks = blocks.get(PERSONA_HEADINGS.quirks);
    if (quirks) fields.quirks = quirks.flatMap(line => { const match = /^\s*[-*]\s*(.*?)\s*$/.exec(line); return match?.[1] ? [match[1]] : []; });
    const relations = blocks.get(PERSONA_HEADINGS.relations);
    if (relations) fields.relations = bullets(relations).filter(item => item.value).map(item => {
      const labelled = /^(.+?)\s*[（(]([^）)]*)[）)]$/.exec(item.label);
      return labelled ? { ref: labelled[1].trim(), name: labelled[2].trim(), text: item.value } : { ref: item.label, text: item.value };
    });
    return { id, name: section.name, fields };
  });
}

/** The card as it would look after the section is applied; the caller still runs it through normalizeMember. */
export function applyPersonaFields(member: MemberProfile, fields: PersonaFields, team: MemberProfile[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (fields.userTitle !== undefined) patch.userTitle = fields.userTitle;
  if (fields.talkativeness !== undefined) patch.talkativeness = fields.talkativeness;
  if (fields.motto !== undefined) patch.motto = fields.motto;
  if (fields.persona !== undefined) patch.persona = fields.persona;
  if (fields.voice !== undefined) patch.voice = fields.voice;
  if (fields.routine !== undefined) patch.routine = fields.routine;
  if (fields.quirks !== undefined) patch.quirks = fields.quirks;
  if (fields.relations !== undefined) {
    // Relations to members who left the team are not shown in the file; keep them as they were.
    const dormant = (member.relations ?? []).filter(relation => !team.some(item => item.id === relation.memberId));
    patch.relations = [...fields.relations.flatMap(relation => {
      const others = team.filter(item => item.id !== member.id);
      const other = others.find(item => item.code === relation.ref) ?? others.find(item => item.id === relation.ref)
        ?? others.find(item => item.name === relation.ref) ?? others.find(item => relation.name !== undefined && item.name === relation.name);
      return other ? [{ memberId: other.id, text: relation.text }] : [];
    }), ...dormant];
  }
  return patch;
}

/** The structured slice that decides whether two cards differ as far as this file is concerned. */
export const personaSignature = (member: MemberProfile, team: MemberProfile[]) => JSON.stringify(personaFieldsOf(member, team));

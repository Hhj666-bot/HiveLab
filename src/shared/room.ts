import {t} from './i18n';
import {readableContent} from './content-presentation';
import type { MemberProfile, RoomMessage, RoomThread } from './types';

export const DEFAULT_ROOM_THREAD = 'room-main';
export const ROOM_PAGE_SIZE = 100;
/** Where a screen's worth of messages starts, counting up from the newest. */
export const ROOM_PREVIEW_CHARACTERS=420;
export const roomMessageIsLong=(text:string)=>text.length>700||text.split('\n').length>14;
export function screenStart(messages: { text?: string;author?:string;status?:string }[], most = 16, characters = 2600) {
  let seen = 0;
  for (let index = messages.length - 1, count = 1; index >= 0; index--, count++) {
    const message=messages[index],text=message.text??'',folded=message.author!=='user'&&message.status!=='speaking'&&roomMessageIsLong(text);
    seen += folded?Math.min(ROOM_PREVIEW_CHARACTERS,text.length):text.length;
    if (count >= most || seen >= characters) return index;
  }
  return 0;
}

/** A local title, with no extra model call and no split surrogate pairs. */
export function firstMessageTitle(text:string,members:Pick<MemberProfile,'id'|'name'>[]=[]){
  let body=text.trim();
  const names=members.flatMap(member=>[member.name,...(member.id==='dsh'?['DS','DSH']:[])]).filter(Boolean).sort((a,b)=>b.length-a.length);
  while(/^[@＠]/u.test(body)){
    const rest=body.slice(1),name=names.find(name=>rest.toLowerCase().startsWith(name.toLowerCase())&&!/[A-Za-z0-9_]/.test(rest[name.length]??''));
    if(!name)break;
    body=rest.slice(name.length).replace(/^[\s，,:：、]+/u,'');
  }
  return [...body.replace(/\s+/gu,' ').trim()].slice(0,20).join('');
}

/** Resolve the text again on the backend; a client cannot choose recipients through metadata. */
export function roomMentions(text: string, members: Pick<MemberProfile, 'id' | 'name'>[]) {
  // Built-in aliases follow the member identity even when its display name changes.
  const names = members.flatMap(member => [...new Set([member.name,...(member.id === 'dsh' ? ['DS','DSH'] : [])])].map(name=>({id:member.id,name}))).sort((a,b)=>b.name.length-a.name.length);
  const ids: string[] = [], unknown: string[] = [], ambiguous: string[] = [];
  for (let offset = 0; offset < text.length; offset++) {
    if (!'@＠'.includes(text[offset])) continue;
    const rest = text.slice(offset + 1), folded = rest.toLowerCase();
    // An email address is ordinary text; a name directly after English prose still counts.
    if (offset && /[A-Za-z0-9_.+-]/.test(text[offset - 1]) && /^[A-Za-z0-9._+-]+\.[A-Za-z]{2,}(?![A-Za-z0-9_.-])/.test(rest)) continue;
    const matches = names.filter(member => folded.startsWith(member.name.toLowerCase()) && !/[A-Za-z0-9_]/.test(rest[member.name.length] ?? ''));
    if (matches.length) {
      const longest = matches.filter(member => member.name.length === matches[0].name.length);
      if (new Set(longest.map(member=>member.id)).size > 1) ambiguous.push(longest[0].name);
      else if (!ids.includes(longest[0].id)) ids.push(longest[0].id);
      offset += longest[0].name.length;
    } else {
      const token = rest.match(/^[^\s@＠，。！？、,:;：；!?()[\]{}<>]+/u)?.[0];
      unknown.push(token ? token.slice(0, 40) : t("（未填写名字）"));
    }
  }
  return { ids, unknown: [...new Set(unknown)], ambiguous: [...new Set(ambiguous)] };
}

export const isRoomPass = (text: string) => text.trim() === '[PASS]';

/** The few reactions everyone shares; a fixed set keeps their meaning clear. */
export const ROOM_REACTIONS = [
  { emoji: '👍', get label(){return t("同意")} }, { emoji: '❤️', get label(){return t("喜欢")} }, { emoji: '😄', get label(){return t("好笑")} },
  { emoji: '👀', get label(){return t("看到了")} }, { emoji: '❓', get label(){return t("有疑问")} },
] as const;
const fold = (value: string) => value.replace(/\uFE0F/g, '');
/** A reply that is only a reaction: the marker [REACT 👍] or the bare emoji. Anything more is a normal reply. */
export function roomReaction(text: string): string | undefined {
  const trimmed = text.trim(), marker = trimmed.match(/^\[REACT\s*([^\]]+?)\s*\]$/i);
  const value = fold(marker ? marker[1] : trimmed);
  return ROOM_REACTIONS.find(item => fold(item.emoji) === value)?.emoji;
}
/** A streamed reply that may still turn into [PASS] or a [REACT …] marker; shown only once it is clearly text. */
export const roomMarkerPending = (text: string) => { const trimmed = text.trim(); return trimmed.startsWith('[') && trimmed.length <= 16 && !trimmed.slice(1).includes('['); };
export function toggleReaction(reactions: Record<string, string[]> | undefined, emoji: string, author: string, on?: boolean) {
  const next = { ...(reactions ?? {}) }, authors = next[emoji] ?? [], present = authors.includes(author);
  const add = on ?? !present;
  if (add && !present) next[emoji] = [...authors, author];
  else if (!add && present) next[emoji] = authors.filter(item => item !== author);
  if (!next[emoji]?.length) delete next[emoji];
  return Object.keys(next).length ? next : undefined;
}
export const reactionText = (reactions: Record<string, string[]> | undefined, name: (author: string) => string) =>
  Object.entries(reactions ?? {}).map(([emoji, authors]) => `${emoji} ${authors.map(name).join('、')}`).join('；');

export function roomMarkdown(thread: RoomThread, messages: RoomMessage[], name: (author: string) => string) {
  const date = (at: string) => new Date(at).toLocaleString('zh-CN', { hour12: false });
  const lines = [`# ${thread.title.replace(/[\r\n]/g, ' ')}`, '', t("- 创建时间：{0}", date(thread.createdAt)), ...(thread.archivedAt ? [t("- 归档时间：{0}", date(thread.archivedAt))] : []), ''];
  if (thread.inherited) lines.push(t("## 延续「{0}」的摘要", thread.inherited.title.replace(/[\r\n]/g, ' ')), '', thread.inherited.text, '');
  if (thread.summary) lines.push(t("## 话题摘要（{0}整理于 {1}，覆盖 {2} 条）", thread.summary.byName ?? t("成员"), date(thread.summary.at), thread.summary.count), '', thread.summary.text, '');
  for (const message of messages) {
    if (message.discussionControl || message.contextOnly) continue;
    const speaker = (message.authorName ?? name(message.author)).replace(/[\r\n]/g, ' ');
    const label = message.kind === 'summary' ? t(" · 会议总结") : message.status === 'passed' ? message.reaction ? t(" · 表情回应") : t(" · 未发言") : message.status === 'failed' ? t(" · 未完成") : message.status === 'stopped' ? t(" · 已停止") : '';
    lines.push('---', '', `## ${speaker}${label} · ${date(message.at)}`, '', message.status === 'passed' ? message.reaction ? t("（用 {0} 回应）", message.reaction) : t("（选择不发言）") : (message.author==='user'?message.text:readableContent(message.text)) || t("（没有正文）"), '');
    if (message.reactions) lines.push(t("> 回应：{0}", reactionText(message.reactions, name)), '');
    if (message.error) lines.push(`> ${message.error}`, '');
    for (const file of message.attachments ?? []) lines.push(t("> 附件：{0}", file.name));
    for (const image of message.generatedImages ?? []) lines.push(t("> 生成的图片：{0}", image.name));
    if (message.attachments?.length || message.generatedImages?.length) lines.push('');
    if(message.memberReport){
      const report=message.memberReport;
      for(const task of report.tasks)lines.push(t("- 任务：{0}（{1}）", task.title, task.status),...task.files.map(file=>t("  - 文件：{0}", file)));

      lines.push(...report.remaining.map(s=>t("- 遗留：{0}", s)),...report.next.map(s=>t("- 下一步：{0}", s)),'');
    }
  }
  return lines.join('\n');
}

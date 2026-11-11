import {t} from './i18n';
import { createElement, memo, useContext, useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import {FileSession,MarkdownLink} from './markdown-link';
import {SyntaxCode} from './syntax-code';
import {SearchHighlight,HighlightText,markedText} from './search-highlight';

// Member output is rendered as React nodes only. No HTML from a member is ever parsed or executed.

type Block =
  | { type: 'code'; lang: string; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'rule' }
  | { type: 'paragraph'; text: string };

const LIST_ITEM = /^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)/);
    if (fence) {
      const body: string[] = []; index++;
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) body.push(lines[index++]);
      index++; blocks.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n') }); continue;
    }
    if (!line.trim()) { index++; continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] }); index++; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ type: 'rule' }); index++; continue; }
    if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
      const header = cells(line); const rows: string[][] = []; index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(cells(lines[index++]));
      blocks.push({ type: 'table', header, rows }); continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^\s{0,3}>/.test(lines[index])) body.push(lines[index++].replace(/^\s{0,3}>\s?/, ''));
      blocks.push({ type: 'quote', text: body.join('\n') }); continue;
    }
    if (LIST_ITEM.test(line)) {
      const ordered = /^\s{0,3}\d/.test(line); const items: string[] = [];
      while (index < lines.length && (LIST_ITEM.test(lines[index]) || (/^\s{2,}\S/.test(lines[index]) && items.length))) {
        const current = lines[index++];
        if (LIST_ITEM.test(current)) items.push(current.replace(LIST_ITEM, ''));
        else items[items.length - 1] += '\n' + current.trim();
      }
      blocks.push({ type: 'list', ordered, items }); continue;
    }
    const body: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^\s*(`{3,}|~{3,})/.test(lines[index]) && !/^\s{0,3}#{1,6}\s/.test(lines[index]) && !LIST_ITEM.test(lines[index]) && !/^\s{0,3}>/.test(lines[index])) body.push(lines[index++]);
    if (!body.length) body.push(lines[index++]);
    blocks.push({ type: 'paragraph', text: body.join('\n') });
  }
  return blocks;
}

const INLINE = /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|~~([^~]+?)~~|\*([^*\s][^*]*?)\*|\[([^\]]+)\]\((?:<([^>]+)>|([^)\s]+))\)/g;
export function inline(text: string, key = 'i',query=''): ReactNode[] {
  // A fresh pattern per call: nested emphasis recurses, and a shared global regex would lose its place.
  const pattern = new RegExp(INLINE.source, 'g');
  const nodes: ReactNode[] = []; let last = 0; let match: RegExpExecArray | null; let count = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(...markedText(text.slice(last, match.index),query,true,key+last));
    const id = `${key}-${count++}`;
    if (match[2] !== undefined) nodes.push(<code key={id}><HighlightText text={match[2]}/></code>);
    else if (match[3] !== undefined || match[4] !== undefined) nodes.push(<strong key={id}>{inline(match[3] ?? match[4], id,query)}</strong>);
    else if (match[5] !== undefined) nodes.push(<del key={id}>{inline(match[5], id,query)}</del>);
    else if (match[6] !== undefined) nodes.push(<em key={id}>{inline(match[6], id,query)}</em>);
    else if (match[7] !== undefined) nodes.push(<MarkdownLink key={id} href={match[8]??match[9]}>{inline(match[7], id,query)}</MarkdownLink>);
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(...markedText(text.slice(last),query,true,key+last));
  return nodes.flatMap<ReactNode>((node, index) => typeof node === 'string' ? node.split('\n').flatMap((part, line) => line ? [<br key={`${key}-br-${index}-${line}`} />, part] : [part]) : [node]);
}

/** Plain one-line text for previews: markdown punctuation removed. */
export function plainText(text: string) {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`~>#|]+/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);
  async function download(){setSaving(true);setError('');try{await window.hivelab.invoke('file.export',{name:'code',format:'code',language:lang||'txt',content:text});}catch(e){setError((e as Error).message);}finally{setSaving(false);}}
  return <div className="md-code">
    <div className="md-code-bar"><span>{lang || t("代码")}</span><button type="button" className="code-download glass-action" aria-label={t("另存为代码")} title={saving?t("保存中"):t("另存为代码")} disabled={saving} onClick={()=>void download()}><Download size={14}/></button><button type="button" className="glass-action" aria-label={t("复制代码")} title={copied?t("已复制"):t("复制代码")} onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400); }).catch(() => {}); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button></div>
    {error&&<small role="alert">{error}</small>}
    <SyntaxCode text={text} language={lang}/>
  </div>;
}

export const Markdown = memo(function Markdown({ text, className = '',sessionId }: { text: string; className?: string;sessionId?:string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const query=useContext(SearchHighlight),content=(text:string,key:string)=>inline(text,key,query);
  return <FileSession.Provider value={sessionId}><div className={`markdown ${className}`}>{blocks.map((block, index) => {
    const key = `b${index}`;
    switch (block.type) {
      case 'code': return <CodeBlock key={key} lang={block.lang} text={block.text} />;
      case 'heading': return createElement(`h${Math.min(6, block.level + 2)}`, { key }, ...content(block.text, key));
      case 'list': return createElement(block.ordered ? 'ol' : 'ul', { key }, block.items.map((item, itemIndex) => <li key={itemIndex}>{content(item.replace(/^\[( |x|X)\]\s+/, (_all, mark) => mark.trim() ? '✅ ' : '⬜ '), `${key}-${itemIndex}`)}</li>));
      case 'quote': return <blockquote key={key}>{content(block.text, key)}</blockquote>;
      case 'table': return <div className="md-table" key={key}><table><thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}>{content(cell, `${key}-h${cellIndex}`)}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{block.header.map((_cell, cellIndex) => <td key={cellIndex}>{content(row[cellIndex] ?? '', `${key}-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody></table></div>;
      case 'rule': return <hr key={key} />;
      default: return <p key={key}>{content(block.text, key)}</p>;
    }
  })}</div></FileSession.Provider>;
});

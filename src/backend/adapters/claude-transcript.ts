import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const THINKING = /"type"\s*:\s*"thinking"/;
const emptyThinking = (block: any) => block?.type === 'thinking' && !String(block.thinking ?? '').trim() && !block.signature;

/** Drops thinking blocks that have neither text nor signature, relinking the records that followed a dropped one.
 *  A relay can blank both while still counting the turn; it accepts them back, but Anthropic's API refuses the whole
 *  request ("each thinking block must contain thinking"), so a session moved to the official API could never resume. */
export function withoutEmptyThinking(source: string): { text: string; removed: number } {
  const dropped = new Map<string, string | null>();
  const output: string[] = [];
  let removed = 0;
  const target = (uuid: string | null) => { while (uuid && dropped.has(uuid)) uuid = dropped.get(uuid)!; return uuid; };
  for (const line of source.split('\n')) {
    let record: any;
    try { record = line.includes('"parentUuid"') ? JSON.parse(line) : undefined; } catch { record = undefined; }
    if (!record) { output.push(line); continue; }
    let changed = false;
    const content = record.message?.content;
    if (record.type === 'assistant' && Array.isArray(content) && THINKING.test(line)) {
      const kept = content.filter(block => !emptyThinking(block));
      if (kept.length !== content.length) {
        removed += content.length - kept.length;
        if (!kept.length) { if (typeof record.uuid === 'string') { dropped.set(record.uuid, record.parentUuid ?? null); continue; } }
        else { record.message.content = kept; changed = true; }
      }
    }
    const parent = target(record.parentUuid ?? null);
    if (parent !== (record.parentUuid ?? null)) { record.parentUuid = parent; changed = true; }
    output.push(changed ? JSON.stringify(record) : line);
  }
  return { text: output.join('\n'), removed };
}

/** Repairs every copy of one session's transcript before --resume; the original stays next to it, and the CLI ignores that name. */
export function repairClaudeTranscript(nativeId: string, home: string): number {
  if (!/^[0-9a-f-]{36}$/i.test(nativeId)) return 0;
  const projects = join(home, 'projects'), name = `${nativeId}.jsonl`;
  if (!existsSync(projects)) return 0;
  let removed = 0;
  for (const folder of readdirSync(projects)) {
    const file = join(projects, folder, name);
    if (!existsSync(file)) continue;
    const result = withoutEmptyThinking(readFileSync(file, 'utf8'));
    if (!result.removed) continue;
    const backup = `${file}.before-thinking-repair`, temporary = `${file}.repairing`;
    if (!existsSync(backup)) copyFileSync(file, backup);
    writeFileSync(temporary, result.text);
    renameSync(temporary, file);
    removed += result.removed;
  }
  return removed;
}

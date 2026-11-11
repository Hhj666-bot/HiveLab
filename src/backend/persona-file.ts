import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { normalizeMember } from '../shared/defaults';
import { applyPersonaFields, parsePersonaFile, PERSONA_FILE_NAME, personaSignature, renderPersonaFile, type PersonaFields } from '../shared/persona-file';
import type { MemberProfile } from '../shared/types';
import type { Store } from './store';

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');

export interface PersonaDocument { path: string; content: string; members: { id: string; name: string }[] }

/**
 * Keeps 人物设定.md and the member cards in step.
 * The file is the readable copy of the cards' persona fields. A hash of what the app last wrote or read
 * tells an outside edit from the app's own write: an outside edit is imported, the app's own write is ignored.
 */
export class PersonaFile {
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private closed = false;
  constructor(private readonly store: Store, private readonly changed: (ids: string[]) => void) {}

  get path() { return path.join(this.store.dataDirectory, PERSONA_FILE_NAME); }

  start() {
    try { this.reconcile(); } catch { /* A broken file must not stop the workbench from starting. */ }
    try {
      this.watcher = watch(this.store.dataDirectory, { persistent: false }, (_event, name) => {
        if (name && name !== PERSONA_FILE_NAME) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { try { this.reconcile(); } catch { /* Read again on the next change. */ } }, 350);
        this.timer.unref();
      });
      this.watcher.on('error', () => {});
    } catch { /* Watching is a convenience; reading on demand still works. */ }
    return this;
  }
  close() { this.closed = true; clearTimeout(this.timer); this.watcher?.close(); this.watcher = undefined; }

  private lastHash() { return this.store.get<{ hash: string }>('persona_file', 'main')?.hash; }
  private remember(text: string) { this.store.put('persona_file', 'main', { hash: hashOf(text) }); }
  private write(text: string) {
    // A temporary file and a rename keep an editor from ever seeing half a file.
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, text, 'utf8');
    renameSync(temporary, this.path);
    this.remember(text);
  }

  /** Create the file when missing, or import an outside edit. Returns the cards that changed. */
  reconcile(except: ReadonlySet<string> = new Set()): string[] {
    if (this.closed) return [];
    if (!existsSync(this.path)) { this.write(renderPersonaFile(this.store.members())); return []; }
    const text = readFileSync(this.path, 'utf8');
    if (hashOf(text) === this.lastHash()) return [];
    const ids = this.importText(text, except);
    this.remember(text);
    if (ids.length) this.changed(ids);
    return ids;
  }

  private importText(text: string, except: ReadonlySet<string>): string[] {
    const members = this.store.members(), ids: string[] = [];
    for (const section of parsePersonaFile(text)) {
      const sameName = members.filter(item => item.name === section.name);
      // The section's 编号 is a code (or, in files written before codes existed, the internal id); the heading name is a fallback.
      const member = (section.id ? members.find(item => item.code === section.id) ?? members.find(item => item.id === section.id) : undefined) ?? (sameName.length === 1 ? sameName[0] : undefined);
      if (!member || except.has(member.id) || ids.includes(member.id)) continue;
      const next = this.merge(member, section.fields, members);
      if (next) { this.store.put('members', member.id, next); ids.push(member.id); }
    }
    return ids;
  }

  /** The card with the fields applied, or nothing when the card already says the same. */
  private merge(member: MemberProfile, fields: PersonaFields, team: MemberProfile[]): MemberProfile | undefined {
    const next = normalizeMember({ ...member, ...applyPersonaFields(member, fields, team) }, member);
    return personaSignature(next, team) === personaSignature(member, team) ? undefined : next;
  }

  /** After the app changed a card: bring in outside edits to the other cards first, then write the file. */
  export(savedId?: string) {
    if (this.closed) return;
    this.reconcile(new Set(savedId ? [savedId] : []));
    this.write(renderPersonaFile(this.store.members()));
  }

  read(): PersonaDocument {
    this.reconcile();
    if (!existsSync(this.path)) this.write(renderPersonaFile(this.store.members()));
    return { path: this.path, content: readFileSync(this.path, 'utf8'), members: this.store.members().map(({ id, name }) => ({ id, name })) };
  }

  /** The user edited the Markdown inside the app. */
  saveText(content: string): PersonaDocument {
    if (typeof content !== 'string') throw new Error('人物设定必须是文本。');
    if (content.length > 400_000) throw new Error('人物设定文件过大。');
    const normalized = content.replace(/\r\n?/g, '\n');
    this.write(normalized);
    const ids = this.importText(normalized, new Set());
    if (ids.length) this.changed(ids);
    return this.read();
  }

  /** The user edited cards in the visual editor. Returns the ids that changed. */
  apply(updates: { id: string; fields: PersonaFields }[]): string[] {
    this.reconcile();
    const team = this.store.members(), ids: string[] = [];
    for (const update of updates) {
      const member = team.find(item => item.id === update.id);
      if (!member) throw new Error('这位成员不存在，请刷新工作台。');
      const next = this.merge(member, update.fields, team);
      if (next) { this.store.put('members', member.id, next); ids.push(member.id); }
    }
    this.write(renderPersonaFile(this.store.members()));
    if (ids.length) this.changed(ids);
    return ids;
  }
}

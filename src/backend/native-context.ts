import { createHash } from 'node:crypto';
import type { Session } from '../shared/types';
import { SUBAGENT_BRIEF_MARK } from '../shared/subagents';

// Bound how long identity, memory and room rules depend on native history alone.
export const NATIVE_CONTEXT_REFRESH_TURNS = 4;
export const NATIVE_CONTEXT_REFRESH_CHARS = 24_000;
export const CURRENT_PERSONA_NOTICE = '以下为最新完整设定，替换此前全部设定；未列出的旧记忆不再适用。';

export function nativeContextNeedsRefresh(session: Session, inputChars = 0): boolean {
  const state = session.nativeContext;
  return !session.nativeId || !state || state.nativeId !== session.nativeId
    || state.refreshRequired === true
    || state.turnsSinceRefresh >= NATIVE_CONTEXT_REFRESH_TURNS
    || state.inputCharsSinceRefresh + inputChars >= NATIVE_CONTEXT_REFRESH_CHARS;
}

/** Bump to make every native history receive the current persona once, e.g. after records were saved for a persona an adapter never sent. */
const PERSONA_HASH_VERSION = 'v2';
/** The fingerprint stored in `Session.nativePersona`; every adapter and the run loop must use this one. */
export function personaHash(persona?: string): string {
  return createHash('sha256').update(`${PERSONA_HASH_VERSION}
${persona ?? ''}`).digest('hex');
}

/** Whether this exact native history already holds the current persona and needs no reminder this turn. */
export function personaRemembered(session: Session, nativeId: string | undefined, hash: string, inputChars = 0): boolean {
  return Boolean(nativeId) && session.nativePersona?.nativeId === nativeId && session.nativePersona?.hash === hash && !nativeContextNeedsRefresh(session, inputChars);
}

export function latestPersona(persona?: string): string {
  // A subagent carries only its own brief, never a member card update.
  if (persona?.startsWith(SUBAGENT_BRIEF_MARK)) return persona;
  return `[HiveLab 合屋 人物与记忆更新]\n${CURRENT_PERSONA_NOTICE}\n${persona || '当前没有额外人物设定或长期记忆。'}`;
}

/** Call only after a positively confirmed successful turn. Unknown results never advance it. */
export function acknowledgedNativeContext(session: Session, inputChars: number, refreshed: boolean, compacted: boolean): Session['nativeContext'] {
  if (!session.nativeId) return;
  const previous = session.nativeContext?.nativeId === session.nativeId ? session.nativeContext : undefined;
  return {
    nativeId: session.nativeId,
    turnsSinceRefresh: (refreshed ? 0 : previous?.turnsSinceRefresh ?? 0) + 1,
    inputCharsSinceRefresh: (refreshed ? 0 : previous?.inputCharsSinceRefresh ?? 0) + inputChars,
    refreshRequired: compacted,
  };
}

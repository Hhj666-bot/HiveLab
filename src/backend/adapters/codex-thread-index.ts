import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Rollouts live under sessions/YYYY/MM/DD and carry the thread id at the end of their name. */
export function findCodexRollout(home: string, threadId: string): string | undefined {
  const suffix = `-${threadId}.jsonl`;
  const walk = (directory: string): string | undefined => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      const found = entry.isDirectory() ? walk(file) : entry.name.startsWith('rollout-') && entry.name.endsWith(suffix) ? file : undefined;
      if (found) return found;
    }
    return undefined;
  };
  const sessions = join(home, 'sessions');
  return existsSync(sessions) ? walk(sessions) : undefined;
}

/** Codex trusts the rollout_path row and only scans the disk when a thread has no row, so moving the data
 *  directory strands every thread on a path that is gone. `thread/resume` refuses a `path` that differs from
 *  the row, which leaves the row itself to correct. Returns true once it names the file on disk. */
export function repairCodexThreadIndex(env: NodeJS.ProcessEnv, threadId: string): boolean {
  const home = env.HIVELAB_CODEX_HOME, stateDirectory = env.HIVELAB_CODEX_STATE_DIR ?? home;
  if (!home || !stateDirectory || !existsSync(stateDirectory)) return false;
  const rollout = findCodexRollout(resolve(home), threadId);
  const database = readdirSync(stateDirectory).filter(name => /^state_\d+\.sqlite$/.test(name)).sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6))).pop();
  if (!rollout || !database) return false;
  const db = new DatabaseSync(join(stateDirectory, database));
  try {
    db.exec('PRAGMA busy_timeout=3000');
    return Number(db.prepare('UPDATE threads SET rollout_path=? WHERE id=?').run(rollout, threadId).changes) > 0;
  } finally { db.close(); }
}

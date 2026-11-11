import type { ExecutorIdentity } from './compatibility';
import type { EffectiveRunConfig, RequestedRunConfig } from './executor-config';
import type { PermissionMember } from './types';

/** An observed completed native reply, bound to the actual program rather than a version list. */
export interface MemberVersionUse {
  provider: PermissionMember; identity: ExecutorIdentity; runId: string; completedAt: string;
  requestedConfig?: RequestedRunConfig; effectiveConfig?: EffectiveRunConfig;
}
function compareVersions(left: RegExpMatchArray, right: RegExpMatchArray): number {
  for (const index of [1, 2, 3]) { const order = Number(left[index]) - Number(right[index]); if (order) return order; }
  // SemVer: a release outranks its prereleases, numeric identifiers rank below text and compare as numbers.
  if (!left[4] || !right[4]) return (left[4] ? 0 : 1) - (right[4] ? 0 : 1);
  const a = left[4].split('.'), b = right[4].split('.');
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const x = a[index], y = b[index], numericX = /^\d+$/.test(x), numericY = /^\d+$/.test(y);
    if (x === y) continue;
    if (numericX && numericY) return Number(x) - Number(y);
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return a.length - b.length;
}
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;
/** Whether an offered version is really an update: a build ahead of the registry must not be offered a downgrade.
 *  Versions outside SemVer can only be told apart, so any difference counts, as does an unknown current version. */
export function newerVersion(offered: string, current: string | undefined): boolean {
  if (!current) return true;
  const left = offered.match(SEMVER), right = current.match(SEMVER);
  return left && right ? compareVersions(left, right) > 0 : offered !== current;
}
export interface MemberInstallation {
  version: string; phase: 'installing' | 'files' | 'launch' | 'connection';
  startedAt: string; phaseStartedAt: string; writtenBytes?: number; lastProgressAt?: string;
  detail?:string;
}
export interface MemberVersions {
  member: PermissionMember; packageName: string; current?: string; baselineVersions: string[];
  source: 'hivelab' | 'custom' | 'global' | 'bundled'; activeVersion?: string;
  selectedPath: string | null; installed: string[]; latest?: string; latestError?: string;
  installedOnly?: boolean; detail?: string;
  installation?: MemberInstallation;
  connection: { state: 'connected' | 'unchecked' | 'stale' | 'failed'; detail: string; checkedAt?: string };
  successfulUse?: MemberVersionUse;
  lastRun?: { outcome: import('./compatibility').CompatibilityReport['outcome']; completedAt?: string; error?: string };
}

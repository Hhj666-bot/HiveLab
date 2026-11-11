import {t} from '../i18n';
import {BUILTIN_MEMBERS, DEFAULT_PROFILE, DEFAULT_SETTINGS, rememberExecutors} from "../../shared/defaults";
import type {Snapshot} from "../../shared/types";
export const EMPTY_SNAPSHOT: Snapshot = {
  projects: [], sessions: [], runs: [], events: [], approvals: [], providers: [],
  settings: DEFAULT_SETTINGS, collaborations: [], dataDirectory: '', backendReady: false,
  deepseekKeyConfigured: false, members: [], profile: DEFAULT_PROFILE,
  room: { messages: [], state: { active: false, mode: 'chat' }, currentThreadId: 'room-main', threads: [{ id: 'room-main', get title(){return t("当前话题")}, createdAt: '' }], hasMore: false },
};

/** A backend from before cards and the room sends none of those fields; fill them so the room still renders. */
export const withDefaults = (snapshot: Snapshot): Snapshot => {
  // Connected programs are named like built-in executors everywhere, so register their names first.
  rememberExecutors(snapshot.executors ?? []);
  return withSnapshotDefaults(snapshot);
};
// A missing roster is a legacy backend; an explicit [] is a real empty team and must stay empty.
const withSnapshotDefaults = (snapshot: Snapshot): Snapshot => ({ ...snapshot, executors: snapshot.executors ?? [], members: snapshot.members ?? BUILTIN_MEMBERS, profile: snapshot.profile ?? DEFAULT_PROFILE, room: { ...EMPTY_SNAPSHOT.room, ...snapshot.room, threads: snapshot.room?.threads ?? EMPTY_SNAPSHOT.room.threads } });

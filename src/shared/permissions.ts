import {t} from './i18n';
import {isPermissionMode,permissionPreset} from './permission-modes';
import type { AcpExecutor, MemberPermissions, MemberProfile, PermissionMember, Settings } from './types';
import { ACP_DEFAULT_PERMISSIONS, DEFAULT_SETTINGS } from './defaults';
/** Native ZCode can enforce plan/read-only mode; writable mode requires these permissions. */
export const zcodeCanWrite=(permissions:MemberPermissions)=>permissions.commands==='auto'&&permissions.fileScope==='any'&&permissions.network;

export function executorPermissions(settings: Settings, id: PermissionMember, executor?: AcpExecutor): MemberPermissions {
  return settings.permissions[id] ?? executor?.permissions ?? DEFAULT_SETTINGS.permissions[id] ?? ACP_DEFAULT_PERMISSIONS;
}

export function memberPermissions(settings: Settings, member: Pick<MemberProfile, 'id' | 'executor'>, executor?: AcpExecutor): MemberPermissions {
  const patch=settings.memberPermissions?.[member.id],value={ ...executorPermissions(settings, member.executor, executor), ...patch };
  if(patch&&Object.keys(patch).length&&!patch.mode)delete value.mode;
  return value;
}

/** Validate each override; absent fields keep inheriting, including after a default changes. */
export function normalizeMemberPermissions(value: unknown, members?: Set<string>): NonNullable<Settings['memberPermissions']> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t("人物权限设置无效"));
  const result: NonNullable<Settings['memberPermissions']> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (members && !members.has(id)) throw new Error(t("权限对应的人物已不存在，请刷新设置"));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(t("人物权限覆盖无效"));
    if(isPermissionMode((raw as MemberPermissions).mode)){result[id]=permissionPreset((raw as MemberPermissions).mode!);continue;}
    const patch: Partial<MemberPermissions> = {};
    for (const [key, choice] of Object.entries(raw)) {
      if (key === 'commands' && ['ask', 'auto', 'deny'].includes(choice as string)) patch.commands = choice as MemberPermissions['commands'];
      else if (key === 'fileScope' && ['workspace', 'any'].includes(choice as string)) patch.fileScope = choice as MemberPermissions['fileScope'];
      else if (key === 'network' && typeof choice === 'boolean') patch.network = choice;
      else throw new Error(t("人物权限选项无效：{0}", key));
    }
    if (Object.keys(patch).length) result[id] = patch;
  }
  return result;
}

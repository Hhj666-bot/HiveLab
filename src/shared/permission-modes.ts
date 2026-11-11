import {t} from './i18n';
import type {MemberPermissions} from './types';
export type PermissionMode='full'|'assist'|'request';
export const PERMISSION_MODES=[{id:'full',get label(){return t("完全访问")},get description(){return t("可访问工作区外的文件和网络，操作不再逐项询问。")}},{id:'assist',get label(){return t("帮我批准")},get description(){return t("在工作区内工作，自动审查可处理的操作，其余交给你确认。")}},{id:'request',get label(){return t("请求批准")},get description(){return t("在工作区内工作，需要扩大权限时由你批准。")}}] as const;
export function permissionPreset(mode:PermissionMode):MemberPermissions{return {mode,commands:'auto',fileScope:mode==='full'?'any':'workspace',network:true};}
export const isPermissionMode=(mode:unknown):mode is PermissionMode=>['full','assist','request'].includes(mode as string);

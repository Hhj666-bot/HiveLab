export interface DeskFilePreferences {
  recycleDays:number;
  inactiveDays:number;
  temporaryDays:number;
  autoTemporary:boolean;
}
export const DEFAULT_DESK_FILES:DeskFilePreferences={recycleDays:7,inactiveDays:30,temporaryDays:7,autoTemporary:false};
export interface DeskFileRecord {sessionId:string;memberId:string;directory:string;directoryName?:string;createdAt:string;title:string}
export interface DeskFileLocation extends DeskFileRecord {managed:boolean;sharedDirectory:boolean;updatedAt:string;archived:boolean}
export interface DeskFileItem {path:string;size:number;modifiedAt:string;temporary:boolean;kept:boolean;protectedReason?:string;version:string}
export interface DeskFileGroup extends DeskFileRecord {updatedAt:string;archived:boolean;active:boolean;deleted:boolean;files:DeskFileItem[];bytes:number;truncated:boolean;error?:string;source?:'session'|'legacy'|'shared'|'external';rootId?:string;relatedSessionIds?:string[];readOnly?:boolean}
export interface DeskRecycleItem {id:string;memberId:string;sessionId:string;title:string;path:string;size:number;recycledAt:string;state:'moving'|'stored'|'restoring'|'purging'}
export interface DeskFileScan {memberId:string;groups:DeskFileGroup[];preferences:DeskFilePreferences;recycle:DeskRecycleItem[];sharedDirectory:string;legacyDirectory:string}
export interface DeskFileSelection {sessionId:string;path:string}
export interface DeskCleanPreview {token:string;files:(DeskFileSelection&{size:number;title:string})[];bytes:number;skipped:number;expiresAt:string}
export const DESK_FILE_METHODS=['deskFiles.scan','deskFiles.preferences','deskFiles.configure','deskFiles.keep','deskFiles.preview','deskFiles.recycle','deskFiles.restore','deskFiles.purge','deskFiles.organize','deskFiles.share'] as const;

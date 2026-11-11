import type {MemberPermissions} from './types';

export type DiagnosticState='observed'|'configured'|'blocked'|'stale'|'unknown';
export interface DiagnosticItem {
  id:string; label:string; state:DiagnosticState; value:string; reason:string;
  source:string; observedAt:string|null; eventId?:string;
}
export interface DiagnosticSection {id:string;label:string;items:DiagnosticItem[]}
export interface RuntimeDiagnostics {
  provider:string; runId?:string; sessionId?:string; nativeId?:string;
  fetchedAt:string; sections:DiagnosticSection[];
}
/** Captured at dispatch, never reconstructed from settings changed after a run. */
export interface RunDiagnosticContext {
  capturedAt:string; cwd:string; home?:string; nativeId?:string;
  permissions?:MemberPermissions; writeMode:boolean; autoApprove:boolean;
}

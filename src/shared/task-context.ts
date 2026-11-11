import {t} from './i18n';
import type {Decision, VersionRef} from './project-flow';
import type {Run} from './types';

export interface TaskExecutionReceipt {
  runId: string; operationId: string; sessionId: string; memberId?: string; createdAt: string;
  status: Run['status']; delivery: Run['delivery']; nativeTurnId?: string; current: boolean;
}
export interface TaskDecisionContext {
  id: string; title: string; reason: string; status: Decision['status']; answer?: Decision['answer'];
  scope: string; effective: boolean; sourceVersions: VersionRef[];
  source?: {messageId: string; threadId?: string; text: string; at: string};
}
export interface TaskContext {
  planVersion?: number; activePlanVersion?: number; requirementsRevision: number; planStatus?: string;
  replacedBy?: {id: string; version: number}; nextAction: string;
  receipts: TaskExecutionReceipt[]; decisions: TaskDecisionContext[];
  submission?: {id: string; sequence: number; status: string; version: VersionRef; createdAt: string};
  review?: {id: string; status: string; version: VersionRef; current: boolean};
}
export const DELIVERY_LABELS: Record<Run['delivery'], string> = {
  get prepared(){return t("已排队，尚未投递")}, get sent(){return t("已投递，等待原生确认")}, get confirmed(){return t("原生回合已确认")},
  get unknown(){return t("投递待核对")}, get withdrawn(){return t("已撤回")},
};

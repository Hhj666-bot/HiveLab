import {t} from '../i18n';
import type {AllowedAction, Round, TaskStatus} from "../../shared/project-flow";
export const ROUND_STATUS: Record<Round['status'], string> = { get pending(){return t("未开始")}, get executing(){return t("进行中")}, get integrating(){return t("正在整合")}, get checking(){return t("整合检查中")}, get awaiting_acceptance(){return t("待验收")}, get accepted(){return t("已验收")}, get changes_requested(){return t("修改中")}, get blocked(){return t("已阻塞")} };
export const TASK_STATUS: Record<TaskStatus, string> = { get pending(){return t("待开始")}, get ready(){return t("可以开始")}, get queued(){return t("排队中")}, get running(){return t("进行中")}, get awaiting_review(){return t("待复核")}, get correcting(){return t("修正中")}, get review_passed(){return t("复核通过")}, get review_skipped(){return t("已提交，省略复核")},get integrated(){return t("已整合")}, get accepted(){return t("已验收")}, get escalated(){return t("需要重新安排")}, get blocked(){return t("已阻塞")}, get cancelled(){return t("已取消")} };
export const LANES: { id: string; label: string; statuses: TaskStatus[] }[] = [
  { id: 'todo', get label(){return t("待开始")}, statuses: ['pending', 'ready', 'queued'] },
  { id: 'doing', get label(){return t("进行中")}, statuses: ['running', 'correcting'] },
  { id: 'review', get label(){return t("待复核")}, statuses: ['awaiting_review'] },
  { id: 'done', get label(){return t("已完成")}, statuses: ['review_passed','review_skipped', 'integrated', 'accepted'] },
  { id: 'stuck', get label(){return t("需处理")}, statuses: ['blocked', 'escalated', 'cancelled'] },
];
export const REJECT_DEFAULT = '用户驳回了这一轮成品，请负责人复查并安排修正。';
export const OPERATION_KIND: Record<string, string> = { get plan(){return t("起草方案")}, get task(){return t("做任务")}, get review(){return t("复核")}, get 'integration-check'(){return t("整合检查")}, get 'round-report'(){return t("写本轮汇报")}, get rearrange(){return t("重新安排")}, get 'supplement-delivery'(){return t("补充要求")},get adjudication(){return t("裁定复核异议")},get 'next-round'(){return t("下一轮调整建议")},get 'requested-check'(){return t("按你的要求检查整轮")} };
export const requestId = () => crypto.randomUUID();
export const action = (list: AllowedAction[] | undefined, name: string) => list?.find(item => item.name === name);
export const allowed = (list: AllowedAction[] | undefined, name: string) => action(list, name)?.enabled !== false;

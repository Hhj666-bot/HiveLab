import {t} from './i18n';
/** Plan mode: a desk turn that only investigates and proposes a plan; the user approves before anything changes. */
export type PlanStatus = 'drafting' | 'pending' | 'ready' | 'approved' | 'revising' | 'expired';
export interface PlanProposal {
  status: PlanStatus;
  /** The plan text when the executor hands it over separately (Claude ExitPlanMode, Codex plan item). DSH's reply is the plan. */
  text?: string;
  /** Claude reviews inside the turn: the pending approval that resumes it. */
  approvalId?: string;
  at: string;
}
export const PLAN_EXECUTORS = ['claude', 'codex', 'dsh'] as const;
/** An added Claude connection runs the same Claude adapter. */
export function planCapable(provider: string | undefined, catalogId?: string) {
  return !!provider && ((PLAN_EXECUTORS as readonly string[]).includes(provider) || catalogId === 'claude');
}
/** Claude and its added connections review the plan inside the running turn. */
export const planInTurn = (provider: string, catalogId?: string) => provider === 'claude' || (provider !== 'codex' && provider !== 'dsh' && catalogId === 'claude');
export const PLAN_EXECUTE_TEXT = '按计划执行。';
export const PLAN_FEEDBACK_LIMIT = 8000;
export const PLAN_TEXT_LIMIT = 60000;
/** DSH's native plan review needs a question channel ACP lacks, so HiveLab removes its write and shell tools for the turn and adds this brief. */
export const PLAN_MODE_BRIEF = '[HiveLab 合屋 计划模式] 这一轮只做计划：写文件和运行命令的工具在这一轮不可用，用读取、搜索类工具了解现状即可，不要请求扩大权限。需要用户决定的地方用 ask_user 询问。最后的回答就是完整的计划，用 Markdown 写，开头用一个 # 标题点明计划，再写清目标、要改的文件和做法、步骤顺序、验证方法和风险。不要用 todo_write 记录计划阶段。用户批准后会另开一轮按计划执行。';
export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  get drafting(){return t("正在拟定")}, get pending(){return t("等你审阅")}, get ready(){return t("等你审阅")}, get approved(){return t("已批准")}, get revising(){return t("已提出修改")}, get expired(){return t("已失效")},
};
/** Only the latest plan of a topic can still be approved or revised. */
export function planActionable(status: PlanStatus | undefined) { return status === 'pending' || status === 'ready'; }

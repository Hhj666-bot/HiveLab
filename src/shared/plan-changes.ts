import {t} from './i18n';
import { criterionText, type PlanPayload } from './project-flow';

const lines = (items: readonly (string | Parameters<typeof criterionText>[0])[]) => items.map(item => typeof item === 'string' ? item : criterionText(item)).join('\n');

/** What a revised plan changed against the version it replaces, in plain words: plan level first, then each task. */
export function planChanges(previous: PlanPayload, next: PlanPayload, name: (memberId: string) => string = id => id): string[] {
  const changes: string[] = [];
  if (previous.objective !== next.objective) changes.push(t("目标改了"));
  if (previous.scope !== next.scope) changes.push(t("范围改了"));
  if (lines(previous.deliverables) !== lines(next.deliverables)) changes.push(t("交付内容改了"));
  if (lines(previous.acceptanceCriteria) !== lines(next.acceptanceCriteria)) changes.push(t("验收标准改了"));
  if (previous.rounds.length !== next.rounds.length) changes.push(t("轮次从 {0} 轮改成 {1} 轮", previous.rounds.length, next.rounds.length));
  const before = new Map(previous.tasks.map(task => [task.key, task]));
  for (const task of next.tasks) {
    const old = before.get(task.key);
    before.delete(task.key);
    if (!old) { changes.push(t("新增任务「{0}」，交给 {1}", task.title, name(task.memberId))); continue; }
    const parts: string[] = [];
    if (old.title !== task.title) parts.push(t("标题（原「{0}」）", old.title));
    if (old.memberId !== task.memberId) parts.push(t("负责成员（{0} → {1}）", name(old.memberId), name(task.memberId)));
    if (old.roundKey !== task.roundKey) parts.push(t("所在轮次"));
    if (old.goal !== task.goal) parts.push(t("目标"));
    if (lines(old.allowedPaths) !== lines(task.allowedPaths)) parts.push(t("可改文件（{0} → {1}）", old.allowedPaths.join('、') || t("无"), task.allowedPaths.join('、') || t("无")));
    if (lines(old.completionCriteria) !== lines(task.completionCriteria)) parts.push(t("完成标准"));
    if (lines(old.dependencies) !== lines(task.dependencies)) parts.push(t("先后顺序"));
    if (parts.length) changes.push(t("「{0}」改了{1}", task.title, parts.join('、')));
  }
  for (const task of before.values()) changes.push(t("去掉任务「{0}」", task.title));
  return changes;
}

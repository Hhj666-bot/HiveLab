import {t} from './i18n';
import type {RunSummary} from './types';
import {activeActivityRun} from './run-activity';

/** Wall time for this reply, including preparation, tools and approval waits. */
export function runDurationMs(run:Pick<RunSummary,'createdAt'|'completedAt'|'status'>,clock=Date.now()):number|undefined{
  const start=Date.parse(run.createdAt),end=run.completedAt?Date.parse(run.completedAt):activeActivityRun(run)?clock:NaN;
  return Number.isFinite(start)&&Number.isFinite(end)&&end>=start?end-start:undefined;
}
export function formatRunDuration(ms:number){
  const seconds=Math.floor(ms/1000);
  if(seconds<1)return t("不到 1 秒");
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
  return t("{0}{1}{2} 秒", hours?t("{0} 小时 ", hours):'', hours||minutes?t("{0} 分 ", minutes):'', rest);
}

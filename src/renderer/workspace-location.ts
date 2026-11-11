import {t} from './i18n';
import type {Session} from '../shared/types';

export function workspaceLocation(session:Session|undefined,directory?:string){
  const path=session?.workspace??directory??'';
  const mode=session?.restoredHistoryOnly?t("只读历史"):session&&!session.writeMode?t("只读查看"):session?.workspaceKind==='original'?t("直接读写"):session?.workspace?t("任务副本"):t("待创建任务副本");
  const hint=mode===t("直接读写")?t("改动直接保存到这里。"):mode===t("只读查看")||mode===t("只读历史")?t("本话题不修改文件。"):session?.workspace?t("改动保存在此副本，应用后写回原文件夹。"):t("第一次执行时创建独立副本，原文件夹作为来源。");
  return {path,mode,hint,label:t("{0}：{1}", mode, path||t("尚未选择文件夹"))};
}

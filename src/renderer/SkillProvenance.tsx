import {t} from './i18n';
import type {SkillProvenance as Provenance} from '../shared/skill-provenance';
import {dateTime} from './ui';
import styles from './SkillProvenance.module.css';

export function SkillProvenance({value}: {value?:Provenance}) {
  if(!value)return <p>{t("此目录尚无来源检测记录，可刷新后查看。")}</p>;
  return <dl className={styles.facts} aria-label={t("技能来源与版本")}>
    <dt>{t("来源")}</dt><dd>{value.source}</dd><dt>{t("独立环境")}</dt><dd>{value.home}</dd>
    <dt>{t("管理者")}</dt><dd>{value.manager}</dd><dt>{t("版本")}</dt><dd>{value.version??t("未声明版本")}{value.contentHash&&<small>SHA-256：{value.contentHash}</small>}</dd>
    <dt>{t("最近检测")}</dt><dd>{dateTime(value.inspectedAt)}</dd>
    {value.importedFrom&&<><dt>{t("导入来源")}</dt><dd>{value.importedFrom}<small>{value.importedAt&&dateTime(value.importedAt)}</small></dd><dt>{t("导入摘要")}</dt><dd>{value.importSummary}</dd><dt>{t("本地正文")}</dt><dd>{value.locallyModified?t("已修改，更新时保留副本"):t("与导入时一致")}</dd></>}
    <dt>{t("加载证据")}</dt><dd>{t("目录发现；本轮附加、读取与 Hook 记录见运行诊断。")}</dd>
  </dl>;
}

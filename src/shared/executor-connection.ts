import {t} from './i18n';
import type { AcpExecutor, ProviderId } from './types';
import { isAcpId } from './defaults';
import { ALL_EXECUTOR_CATALOG } from './executor-catalog';

/** Adapter ownership, program source and wire protocol are different facts. */
export function executorConnection(id: ProviderId, executor?: Pick<AcpExecutor, 'catalogId'|'authentication'>) {
  if (id === 'deepseek') return { integration: t("API 直连"), protocol: 'HTTPS API', source: t("远程服务") };
  if(executor?.catalogId==='zcode'&&executor.authentication?.startsWith('glm-api-'))return {integration:t("API 直连"),protocol:'GLM HTTPS API',source:t("智谱 / Z.ai 官方服务")};
  if (!isAcpId(id)) return { integration: t("内置适配"), protocol: id === 'codex' ? 'Codex App Server' : id === 'claude' ? t("Claude Code JSON 流") : t("ACP + DSH 权限插件"), source: t("官方 CLI，清单下载或本机安装") };
  const entry = ALL_EXECUTOR_CATALOG.find(item => item.id === executor?.catalogId);
  return { integration: t("外接适配"), protocol: entry?.adapter === 'zcode' ? t("ZCode 原生 CLI JSON") : 'ACP', source: entry ? t("官方清单管理") : t("手动连接") };
}

export function connectionLabel(id: ProviderId, executor?: Pick<AcpExecutor, 'catalogId'|'authentication'>) {
  const value = executorConnection(id, executor);
  return `${value.integration} · ${value.protocol} · ${value.source}`;
}

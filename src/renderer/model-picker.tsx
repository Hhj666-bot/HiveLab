import {t} from './i18n';
import { useState } from 'react';
import type { ProviderId, ProviderInfo, Settings } from '../shared/types';
import type { Invoke } from './ui';
import { ConfigurationHint, useProviderConfiguration } from './provider-configuration';

const EFFORT_LABELS: Record<string, string> = { get on(){return t("开启")}, get none(){return t("关闭")}, get off(){return t("关闭")}, get minimal(){return t("极低")}, get low(){return t("低")}, get medium(){return t("中")}, get high(){return t("高")}, get xhigh(){return t("很高")}, get max(){return t("最高")}, get ultra(){return t("超高")} };
const effortLabel = (value: string) => EFFORT_LABELS[value] ? `${EFFORT_LABELS[value]}（${value}）` : value;

/** Model and thinking level for one member; advertised options first, free text as a fallback. */
export function ModelPicker({ provider, info, settings, setSettings, invoke }: { provider: ProviderId; info?: ProviderInfo; settings: Settings; invoke?: Invoke; setSettings: (update: (previous: Settings) => Settings) => void }) {
  const model = settings.models[provider] ?? '';
  const configuration = useProviderConfiguration(provider, info, model || undefined, invoke);
  const { options, active, efforts } = configuration;
  const effort = settings.efforts?.[provider] ?? '';
  const listed = options.some(option => option.id === model);
  const [custom, setCustom] = useState(Boolean(model) && !listed);
  const setModel = (value: string) => setSettings(previous => ({ ...previous, models: { ...previous.models, [provider]: value } }));
  const setEffort = (value: string) => setSettings(previous => ({ ...previous, efforts: { ...previous.efforts, [provider]: value } }));
  const defaultLabel = options.find(option => option.isDefault)?.label ?? info?.model;
  return <div className="model-picker">
    <label className="field compact">{t("模型")}{options.length > 0 && <select aria-label={t("模型")} disabled={!configuration.modelConfigurable} value={custom ? '__custom' : model} onChange={event => { if (event.target.value === '__custom') { setCustom(true); return; } setCustom(false); setModel(event.target.value); }}>
        <option value="">{t("成员默认{0}", defaultLabel ? `（${defaultLabel}）` : '')}</option>
        {options.filter(option => option.id).map(option => <option key={option.id} value={option.id}>{option.label}{option.label !== option.id ? ` · ${option.id}` : ''}{option.isDefault ? t(" · 默认") : ''}</option>)}
        <option value="__custom">{t("其他（手动填写）")}</option>
      </select>}
      {(custom || !options.length) && <input aria-label={t("模型")} disabled={!configuration.modelConfigurable} value={model} onChange={event => setModel(event.target.value)} placeholder={options.length ? t("填写模型名称") : (info?.model ?? t("留空使用成员默认"))} spellCheck={false} />}
      {active?.description ? <small>{active.description}</small> : !options.length && <small>{t("检查连接后会列出这位成员可用的模型。")}</small>}
    </label>
    <label className="field compact">{t("思考程度")}<select aria-label={t("思考程度")} disabled={configuration.checking} value={effort} onChange={event => setEffort(event.target.value)}>
        <option value="">{t("模型默认{0}", active?.defaultEffort ? `（${effortLabel(active.defaultEffort)}）` : '')}</option>
        {[...efforts, ...(effort && !efforts.includes(effort) ? [effort] : [])].map(value => <option key={value} value={value}>{effortLabel(value)}{!efforts.includes(value) ? t("（需重新核对）") : ''}</option>)}
      </select>
      <ConfigurationHint configuration={configuration} onDefault={model ? () => { setModel(''); setEffort(''); } : undefined} />
    </label>
  </div>;
}

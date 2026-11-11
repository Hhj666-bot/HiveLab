import {t,useLanguage} from './i18n';
import {memo,useEffect} from 'react';
import {Bot} from 'lucide-react';
import {SUBAGENT_STATUS_LABEL,subagentActive,type SubagentRecord} from '../shared/subagents';
import {SubagentStatusIcon,subagentConfig,subagentElapsed,useNow,useSubagentPanel} from './subagent-panel';
import type {Invoke} from './ui';
import './subagents.css';

/** Every subagent the main agent sent in this turn, shown with its reply; a card opens the 子代理 side panel. */
export const SubagentCards=memo(function SubagentCards({records,invoke}:{records?:SubagentRecord[];invoke:Invoke}){useLanguage();
  const panel=useSubagentPanel();
  const live=!!records?.some(record=>subagentActive(record.status)),now=useNow(live);
  const runId=records?.[0]?.parentRunId;
  useEffect(()=>{if(panel&&runId&&records)panel.publish(runId,records);},[panel?.publish,runId,records]);// eslint-disable-line react-hooks/exhaustive-deps
  if(!records?.length)return null;
  return <section className="subagent-cards" aria-label={t("子代理")}>
    {records.map(item=>{const selected=panel?.selected?.id===item.id;return <button key={item.id} type="button" className={`subagent-card ${item.status}${selected?' selected':''}`} aria-label={t("子代理 #{0}：{1}，{2}", item.index, item.title, SUBAGENT_STATUS_LABEL[item.status])} aria-pressed={selected} onClick={()=>selected?panel?.close():panel?.open(item.parentRunId,item.id,invoke)}>
      <span className="subagent-card-head"><Bot size={14} aria-hidden="true"/><strong>#{item.index} {item.title}</strong><span className="subagent-state"><SubagentStatusIcon status={item.status}/>{SUBAGENT_STATUS_LABEL[item.status]}</span></span>
      <span className="subagent-card-line">{subagentActive(item.status)?(item.activity??t("正在启动")):item.status==='completed'?(item.result??'').replace(/[*_`#>]+/g,'').replace(/\s+/g,' ').trim().slice(0,120):(item.error??SUBAGENT_STATUS_LABEL[item.status])}</span>
      <span className="subagent-card-meta"><span>{subagentConfig(item)}</span>{item.write&&<span>{t("可写入")}</span>}<span>{subagentElapsed(item,now)}</span></span>
    </button>;})}
  </section>;
});

import {t} from './i18n';
import {useEffect,useState} from 'react';
import type {RunSummary} from '../shared/types';
import {activeActivityRun} from '../shared/run-activity';
import {formatRunDuration,runDurationMs} from '../shared/run-duration';

export function RunElapsed({run}:{run:RunSummary}){
  const active=activeActivityRun(run),[clock,setClock]=useState(Date.now);
  useEffect(()=>{if(!active)return;setClock(Date.now());const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[run.id,active]);
  const elapsed=runDurationMs(run,clock);
  return <span className="room-model run-elapsed" title={t("从本轮创建到结束的总耗时，包含准备、工具执行和等待确认。")}>{elapsed===undefined?t("耗时未记录"):`${active?t("已用"):t("本轮耗时")} ${formatRunDuration(elapsed)}`}</span>;
}

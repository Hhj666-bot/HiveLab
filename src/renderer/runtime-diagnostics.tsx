import {t} from './i18n';
import {useEffect,useRef,useState} from 'react';
import {RefreshCw,Stethoscope} from 'lucide-react';
import type {RuntimeDiagnostics,DiagnosticState} from '../shared/runtime-diagnostics';
import {dateTime,type Invoke} from './ui';
import './runtime-diagnostics.css';

const states:Record<DiagnosticState,string>={get observed(){return t("有记录")},get configured(){return t("配置记录")},get blocked(){return t("检查未通过")},get stale(){return t("记录待刷新")},get unknown(){return t("未确认")}};

export function RuntimeDiagnosticsPanel({runId,provider,invoke,available=true}:{runId?:string;provider?:string;invoke:Invoke;available?:boolean}){
  const key=runId?'run:'+runId:'provider:'+provider;
  const [open,setOpen]=useState(false),[retry,setRetry]=useState(0);
  const [loaded,setLoaded]=useState<{key:string;data?:RuntimeDiagnostics;error?:string;busy:boolean}>({key,busy:false});
  const generation=useRef(0);
  useEffect(()=>{
    const ticket=++generation.current;
    if(!open||!available)return;
    setLoaded({key,busy:true});
    void invoke<RuntimeDiagnostics>(runId?'run.diagnostics':'provider.diagnostics',runId?{runId}:{provider},undefined,{background:true}).then(data=>{
      if(ticket===generation.current)setLoaded({key,data,busy:false});
    }).catch(error=>{if(ticket===generation.current)setLoaded({key,error:(error as Error).message,busy:false});});
    return()=>{generation.current++;};
  },[key,runId,provider,invoke,open,retry,available]);
  const current=loaded.key===key?loaded:undefined,data=current?.data;
  return <details className="runtime-diagnostics" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><Stethoscope size={14}/><strong>{runId?t("运行诊断"):t("连接与运行诊断")}</strong><span>{t("只读查询")}</span></summary>
    {open&&<div className="runtime-diagnostics-body">
      <div className="runtime-diagnostics-toolbar"><p>{t("按来源分别显示工作台配置、原生回报和插件记录。")}</p><button type="button" className="button small quiet" disabled={current?.busy||!available} onClick={()=>setRetry(v=>v+1)}><RefreshCw size={13} className={current?.busy?'spin':''}/>{t("刷新诊断")}</button></div>
      {!available&&<p role="status">{t("执行服务暂不可用，恢复连接后可重新读取。")}</p>}
      {current?.busy&&<p role="status">{t("正在读取诊断记录…")}</p>}
      {current?.error&&<p role="alert" className="runtime-diagnostics-error">{current.error}</p>}
      {data&&<><p className="runtime-diagnostics-time">{t("读取时间：{0}。配置和日志可能晚于所选运行，各项以标注时间为准。", dateTime(data.fetchedAt))}</p>
        {data.sections.map(section=><section className="runtime-diagnostic-section" key={section.id} aria-label={section.label}><h4>{section.label}</h4>
          {section.items.map(entry=><div className={'runtime-diagnostic-row '+entry.state} key={entry.id}>
            <div><strong>{entry.label}</strong><span className="runtime-diagnostic-state">{states[entry.state]}</span></div><p>{entry.value}</p><small>{entry.reason}</small>
            <details className="runtime-diagnostic-evidence"><summary>{t("来源与时间")}</summary><dl><dt>{t("来源")}</dt><dd>{entry.source}</dd><dt>{t("记录时间")}</dt><dd>{entry.observedAt?dateTime(entry.observedAt):t("来源未提供时间")}</dd>{entry.eventId&&<><dt>{t("事件")}</dt><dd>{entry.eventId}</dd></>}</dl></details>
          </div>)}
        </section>)}
      </>}
    </div>}
  </details>;
}

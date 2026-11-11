import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RuntimeDiagnosticsPanel} from '../../src/renderer/runtime-diagnostics';
import type {RuntimeDiagnostics} from '../../src/shared/runtime-diagnostics';
import '../../src/renderer/styles.css';

const calls:{method:string;params:any}[]=[];(window as any).diagnosticCalls=calls;
let release:(()=>void)|undefined,held=false,fail=false;
(window as any).holdDiagnostic=()=>{held=true;};
(window as any).releaseDiagnostic=()=>{held=false;release?.();};
(window as any).failDiagnostic=()=>{fail=true;};
const invoke=async(method:string,params:any):Promise<any>=>{
  calls.push({method,params});
  if(params.runId==='one'&&held)await new Promise<void>(resolve=>{release=resolve;});
  if(fail){fail=false;throw Error('诊断读取暂时失败');}
  const report:RuntimeDiagnostics={provider:params.provider??'codex',runId:params.runId,sessionId:params.runId,fetchedAt:'2026-10-23T01:03:00.000Z',sections:[
    {id:'permissions',label:'工具权限',items:[{id:'mode',label:'工作台权限配置',state:'configured',value:'full · 自动工作',reason:'派发时保存的配置。',source:'运行派发快照',observedAt:'2026-10-23T01:00:00.000Z'}]},
    {id:'hooks',label:'技能、原生插件与 Hook',items:[{id:'skills',label:'本条消息选择的 Skills',state:'observed',value:'未选择',reason:'消息选择不负责启停 Hook。',source:'本轮 messageSkills',observedAt:'2026-10-23T01:00:00.000Z'},
      {id:'contract',label:'Stop That Shit 合同',state:params.runId==='one'?'configured':'unknown',value:params.runId==='one'?'review / guard · 一号会话':'合同未确认 · 二号会话',reason:'持久记录不代表宿主约束实际生效。',source:'D:/isolated/plugins/data/sessions/'+'x'.repeat(80)+'.json',observedAt:'2026-10-23T01:02:00.000Z',eventId:'evt_example'}]},
  ]};return report;
};
function Fixture(){const [runId,setRun]=useState('one');return <main style={{padding:16,maxWidth:850,margin:'auto'}}><label>选择运行<select aria-label="选择运行" value={runId} onChange={event=>setRun(event.target.value)}><option value="one">运行一</option><option value="two">运行二</option></select></label><RuntimeDiagnosticsPanel runId={runId} invoke={invoke}/><RuntimeDiagnosticsPanel provider="codex" invoke={invoke}/></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);

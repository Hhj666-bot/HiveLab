import {t} from './i18n';
import { useState } from 'react';
import type { CompatibilityReport } from '../shared/compatibility';
import type { ProviderInfo } from '../shared/types';
import {RuntimeDiagnosticsPanel} from './runtime-diagnostics';
import type {Invoke} from './ui';

const stages:Record<string,string>={get initialize(){return t("协议初始化")},get account(){return t("账户确认")},get configuration(){return t("配置协商")},get 'session-load'(){return t("恢复会话")},get 'session-new'(){return t("创建会话")},get dispatch(){return t("发送并等待结果")},get cancel(){return t("取消")},get close(){return t("关闭")}};
const outcomes:Record<string,string>={get running(){return t("进行中")},get passed(){return t("通过")},get 'needs-auth'(){return t("程序就绪，需要登录")},get failed(){return t("失败")},get unknown(){return t("结果未知")},get stopped(){return t("已停止")}};
export function CompatibilityDetails({provider,info,available,load,invoke}:{provider:string;info?:ProviderInfo;available:boolean;load:(provider:string)=>Promise<unknown>;invoke?:Invoke}){
  const [reports,setReports]=useState<CompatibilityReport[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function refresh(){setBusy(true);setError('');try{const result=await load(provider);setReports(Array.isArray(result)?result:[]);}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  const shown=reports.length?reports:info?.compatibility?[info.compatibility]:[];
  return <>{invoke&&<RuntimeDiagnosticsPanel key={provider} provider={provider} invoke={invoke} available={available}/>} {info?.lastRunCompatibility&&['failed','unknown'].includes(info.lastRunCompatibility.outcome)&&<p className="provider-detail">{t("最近实际运行：{0}（{1}）。最近连接检查与运行结果分别保留，请展开诊断核对。", outcomes[info.lastRunCompatibility.outcome], new Date(info.lastRunCompatibility.startedAt).toLocaleString())}</p>}<details className="provider-detail"><summary>{t("连接诊断与历史")}</summary>
    <p>{t("账户登录、连接检查和实际运行分别记录。探测通过不代表后续模型调用一定成功。")}</p>
    <button type="button" className="button small secondary" disabled={busy||!available} onClick={()=>void refresh()}>{busy?t("正在读取…"):t("读取最近记录")}</button>
    {error&&<p role="alert">{error}</p>}
    {!shown.length&&<p>{t("尚无分阶段记录；下一次检查或运行后生成。")}</p>}
    {shown.slice(0,20).map(report=><details key={report.id}><summary>{new Date(report.startedAt).toLocaleString()} · {report.trigger==='run'?t("实际运行"):report.trigger==='candidate'?t("候选版本"):report.trigger==='configuration'?t("配置读取"):t("连接检查")} · {outcomes[report.outcome]??report.outcome}</summary>
      <p>{t("账户：{0}；投递：{1}；恢复：{2}", report.account??t("本次未单独确认"), report.delivery??t("未发送工作"), report.restore==='current-version'?t("使用当前版本继续原会话"):report.restore==='bound'?t("当时使用绑定版本"):report.restore==='legacy-unbound'?t("历史版本未知"):report.restore==='new'?t("新会话"):t("未验证历史恢复"))}</p>
      <p>{t("执行端：{0}", report.identity.path??t("未能定位"))}<br/>{t("版本：{0}{1} · {2} · {3}{4}", report.identity.version??t("未报告"), report.identity.versionSource==='manifest'?t("（包清单）"):'', report.identity.adapterVersion, report.identity.protocol, report.identity.protocolVersion?' / '+report.identity.protocolVersion:'')}</p>
      <p>{t("运行环境：{0} {1}{2}", report.nodeRuntime?.source==='portable'?t("官方便携备用"):report.nodeRuntime?.source==='local'?t("本机 Node.js"):t("HiveLab 合屋 自带"), report.nodeRuntime?.version??t("历史记录未提供"), report.nodeRuntime?.detail?' · '+report.nodeRuntime.detail:'')}</p>
      <p>{t("网络：{0}{1}{2}", report.network.mode, report.network.proxyHost?' · '+report.network.proxyHost:'', report.network.mode==='tun'?t("（系统 TUN 状态未独立确认）"):'')}</p>
      <p>{t("请求配置：{0} · {1}", report.configuration?.model??t("程序默认"), report.configuration?.effort??t("默认思考程度"))}</p>
      {report.error&&<pre className="login-message">{report.error}</pre>}
      <ul>{report.stages.map((step,index)=><li key={index}>{stages[step.stage]??step.stage}{step.method?' / '+step.method:''}：{outcomes[step.outcome]} · {step.durationMs} ms{step.timeoutMs?t("（上限 {0} ms）", step.timeoutMs):''}{step.error&&<pre className="login-message">{step.error}</pre>}</li>)}</ul>
    </details>)}
  </details></>;
}

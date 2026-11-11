import {t} from './i18n';
import {TokenActivityPanel} from './token-activity';
import { useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import type { AccountBalance, AccountWallet, MemberQuota, ProviderId, QuotaWindow, Snapshot } from '../shared/types';
import { accountRefreshTargets, balanceAmount, balanceExhausted, balanceFresh, quotaFresh } from '../shared/quota';
import { Modal } from './modals';
import { useTeam, Avatar } from './members';
import { errorText, useTicker, type Invoke } from './ui';

const resetText=(seconds:number)=>t("{0} 恢复", new Date(seconds*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}));

function visibleWindows(quota?:MemberQuota){
  if(quota?.quotaKind==='google-models')return quota.windows;
  const windows=quota?.windows??[],core=[t("5 小时"),t("每周")].map(label=>windows.find(window=>window.label===label)||windows.find(window=>window.label.endsWith(` · ${label}`))||{id:label,label,checkedAt:''});
  return [...core,...windows.filter(window=>!core.some(item=>item.id===window.id))];
}
function tone(window:QuotaWindow,now:number){return !quotaFresh(window,now)?'stale':window.exhausted?'exhausted':window.warning||window.usedPercent!==undefined&&window.usedPercent>=80?'warning':'normal';}
function remaining(window:QuotaWindow,now:number){
  if(!window.checkedAt)return t("未提供");
  if(!quotaFresh(window,now))return t("待更新");
  if(window.exhausted&&window.usedPercent===undefined)return t("已受限");
  return window.usedPercent===undefined?t("未提供"):t("剩 {0}%", Math.round((100-window.usedPercent)*10)/10);
}
function detail(window:QuotaWindow,now:number){
  return `${window.label}：${remaining(window,now)}${window.usedPercent!==undefined?t("，已用 {0}%", Math.round(window.usedPercent*10)/10):''}${window.resetsAt?`；${resetText(window.resetsAt)}`:''}${window.checkedAt?t("；回报于 {0}", new Date(window.checkedAt).toLocaleTimeString('zh-CN')):t("；成员程序还没有提供额度数据")}`;
}
const isKimiBalance=(snapshot:Snapshot,id:ProviderId)=>snapshot.executors?.some(executor=>executor.id===id&&executor.catalogId==='kimi'&&['kimi-api','kimi-api-cn'].includes(executor.authentication??''))??false;
const isGlmBalance=(snapshot:Snapshot,id:ProviderId)=>snapshot.executors?.some(executor=>executor.id===id&&executor.catalogId==='zcode'&&['glm-api-cn','glm-api-global'].includes(executor.authentication??''))??false;
const walletText=(wallet:AccountWallet)=>`${wallet.currency==='CNY'?'¥':'US$'}${balanceAmount(wallet.balance,wallet.currency==='CNY'?2:undefined)}`;
function balanceText(balance:AccountBalance|undefined,now:number){
  if(!balance||balance.status!=='ready'||!balance.available&&!balance.wallets.length&&!balance.bonusWallets.length)return t("未提供");
  if(!balanceFresh(balance,now))return t("待更新");
}
function balanceRows(balance:AccountBalance){
  if(balance.kind==='glm-api')return balance.frozen?[{label:t("冻结"),wallet:balance.frozen,key:'frozen'}]:[];
  return [{label:balance.kind==='kimi-api'?t("现金"):t("充值"),wallets:balance.wallets},{label:balance.kind==='kimi-api'?t("代金券"):t("赠送"),wallets:balance.bonusWallets}].flatMap(group=>group.wallets.map((wallet,index)=>({label:group.label,wallet,key:`${group.label}-${wallet.currency}-${index}`})));
}
function BalanceMeter({balance,now}:{balance?:AccountBalance;now:number}){
  const text=balanceText(balance,now);
  if(text)return <span className="quota-unavailable">{t("余额 · {0}", text)}</span>;
  const rows=balance!.kind==='glm-api'&&balance!.available?[{label:t("可用"),wallet:balance!.available,key:'available'},...balanceRows(balance!)]:balanceRows(balance!);
  return <span className={`quota-mini balance-mini${balanceExhausted(balance,now)?' exhausted':''}`} aria-label={t("账户剩余余额")}>{rows.map(row=><span className="balance-line" key={row.key} title={t("{0}余额 {1}；更新于 {2}", row.label, walletText(row.wallet), new Date(balance!.checkedAt).toLocaleTimeString('zh-CN'))}><span>{row.label}</span><span>{walletText(row.wallet)}</span></span>)}</span>;
}
function BalanceDetails({balance,now}:{balance?:AccountBalance;now:number}){
  const text=balanceText(balance,now);
  return <div className="balance-detail">{!text&&balance?.available&&<div className="balance-wallet"><span>{t("可用余额")}</span><strong>{walletText(balance.available)}</strong></div>}{text?<p className="panel-muted">{t("账户余额：{0}{1}", text, text===t("待更新")?t("，请刷新余额。"):balance?.reason??t("，账号服务暂未返回可验证的数据。"))}</p>:balanceRows(balance!).map(row=><div className="balance-wallet" key={row.key}><span>{t("{0}余额 · {1}", row.label, row.wallet.currency==='CNY'?t("人民币"):t("美元"))}</span><strong>{walletText(row.wallet)}</strong></div>)}<small>{t("{0}自动发言以两位小数的余额为准。{1}", balance?.kind==='glm-api'?t("GLM 普通 API 钱包；可用余额以账户服务回报为准，不把累计充值、累计赠送或 Coding Plan 额度相加。"):balance?.kind==='kimi-api'?t("Kimi 开放平台按量计费；可用余额以服务端回报为准，现金与代金券不重复相加。"):t("按 API 扣费，充值和赠送余额分别显示；"), balanceExhausted(balance,now)?t("余额已耗尽，自动发言已暂停。"):'')}</small></div>;
}
export function QuotaMeter({provider,quota}:{provider:ProviderId;quota?:MemberQuota}){
  const tick=useTicker(true,30000),now=Math.max(tick,Date.now());
  if(provider==='dsh'||quota?.balance)return <BalanceMeter balance={quota?.balance} now={now}/>;
  if(provider!=='codex'&&provider!=='claude'&&!quota)return <span className="quota-unavailable">{t("程序未提供额度")}</span>;
  if(!visibleWindows(quota).some(window=>window.checkedAt))return <span className="quota-unavailable">{t("还没有额度数据，可在“用量与额度”中刷新")}</span>;
  return <span className="quota-mini" aria-label={t("成员剩余额度")}>{visibleWindows(quota).slice(0,2).map(window=><span key={window.id} className={`quota-line ${tone(window,now)}`} title={detail(window,now)}><span>{quota?.quotaKind==='google-models'?window.label:window.label.includes('5 小时')?t("5 小时"):t("每周")}</span><span>{remaining(window,now)}</span><span className="quota-track" aria-hidden="true"><i style={{width:`${quotaFresh(window,now)&&window.usedPercent!==undefined?100-window.usedPercent:0}%`}} /></span></span>)}</span>;
}
/** Compact sidebar indicator: only real, fresh data is shown; "not provided" lives in the usage dialog. */
export function QuotaBadge({provider,quota}:{provider:ProviderId;quota?:MemberQuota}){
  const tick=useTicker(true,30000),now=Math.max(tick,Date.now());
  if(provider==='dsh'||quota?.balance){
    const balance=quota?.balance;
    if(balanceText(balance,now))return null;
    const first=balance?.available?{wallet:balance.available}:balanceRows(balance!)[0];if(!first)return null;
    return <span className={`quota-badge balance${balanceExhausted(balance,now)?' exhausted':''}`} title={balanceRows(balance!).map(row=>t("{0}余额 {1}", row.label, walletText(row.wallet))).join('；')}>{walletText(first.wallet)}</span>;
  }
  const windows=(quota?.windows??[]).filter(window=>quotaFresh(window,now)&&(window.usedPercent!==undefined||window.exhausted));
  if(!windows.length)return null;
  const tightest=windows.reduce((a,b)=>(b.exhausted?101:b.usedPercent??0)>(a.exhausted?101:a.usedPercent??0)?b:a);
  const left=tightest.exhausted?0:100-(tightest.usedPercent??0);
  return <span className={`quota-badge ${tone(tightest,now)}`} title={windows.map(window=>detail(window,now)).join('\n')} aria-label={t("剩余额度 {0}%", Math.round(left))}><span className="quota-track" aria-hidden="true"><i style={{width:`${left}%`}}/></span></span>;
}
export function QuotaOverview({snapshot,invoke,onClose}:{snapshot:Snapshot;invoke:Invoke;onClose:()=>void}){
  const team=useTeam(),tick=useTicker(true,30000),now=Math.max(tick,Date.now());
  const [refreshing,setRefreshing]=useState<ProviderId|'all'>(),[errors,setErrors]=useState<Partial<Record<ProviderId,string>>>({});
  const refreshBusy=useRef(false);
  const targets=accountRefreshTargets(team.members.map(member=>({executor:member.executor})),snapshot.executors??[],snapshot.claudeTokenConfigured);
  const targetKey=JSON.stringify(targets);
  async function refresh(provider?:ProviderId){
    if(refreshBusy.current||!snapshot.backendReady)return;
    const selected=provider?targets.filter(item=>item.provider===provider):targets;if(!selected.length)return;
    refreshBusy.current=true;setRefreshing(provider??'all');
    setErrors(previous=>({...previous,...Object.fromEntries(selected.map(item=>[item.provider,'']))}));
    try{await Promise.allSettled(selected.map(async item=>{try{await invoke(item.method,{provider:item.provider},undefined,{background:true});}catch(error){setErrors(previous=>({...previous,[item.provider]:errorText(error)}));}}));}
    finally{refreshBusy.current=false;setRefreshing(undefined);}
  }
  useEffect(()=>{if(snapshot.backendReady)void refresh();},[targetKey,invoke,snapshot.backendReady]);
  return <Modal title={t("用量与额度")} subtitle={t("按成员程序的实际回报显示。使用同一个程序的成员共用账号额度。")} onClose={onClose} className="quota-modal">
    <div className="modal-body"><TokenActivityPanel invoke={invoke}/>{team.members.map(member=>{
      const quota=snapshot.quotas?.[member.executor],windows=visibleWindows(quota),kimi=isKimiBalance(snapshot,member.executor),glm=isGlmBalance(snapshot,member.executor);
      const google=quota?.quotaKind==='google-models'||snapshot.executors?.find(executor=>executor.id===member.executor)?.args.some(arg=>/[\\/]launch-official-acp\.cjs$/.test(arg));
      return <section className="quota-card" aria-label={t("{0} 的额度", member.name)} key={member.id}><div className="quota-card-heading"><Avatar member={member} size={30}/><strong>{member.name}</strong><small>{quota?t("更新于 {0}", new Date(quota.checkedAt).toLocaleTimeString('zh-CN')):t("等待程序回报")}</small></div>
        {member.executor==='dsh'||kimi||glm?<BalanceDetails balance={quota?.balance} now={now}/>:member.executor!=='codex'&&member.executor!=='claude'&&!quota?<p className="panel-muted">{t("这个成员程序尚未提供可验证的额度数据。")}</p>:!windows.some(window=>window.checkedAt)?(member.executor==='claude'&&snapshot.claudeTokenConfigured?null:<p className="panel-muted">{t("还没有额度数据，点“刷新额度”查询。")}</p>):windows.map(window=><div className={`quota-detail ${tone(window,now)}`} key={window.id}><div><span>{window.label}</span><strong>{remaining(window,now)}</strong></div><span className="quota-track"><i style={{width:`${quotaFresh(window,now)&&window.usedPercent!==undefined?100-window.usedPercent:0}%`}} /></span><small>{window.usedPercent!==undefined?t("已用 {0}% · ", Math.round(window.usedPercent*10)/10):''}{window.resetsAt?resetText(window.resetsAt):t("恢复时间未提供")}{tone(window,now)==='warning'?(google?t(" · 该模型额度较低"):t(" · 额度较低，自由讨论会减少自动点名")):tone(window,now)==='exhausted'?(google?t(" · 该模型额度受限"):t(" · 额度受限，自动发言已暂停")):tone(window,now)==='stale'&&window.checkedAt?t(" · 回报已过期，等待更新"):''}</small></div>)}
        {member.executor==='claude'&&snapshot.claudeTokenConfigured?<p className="panel-muted">{t("Claude 用长期令牌登录时不能单独查询额度。{0} 下次发言或做任务后，这里会自动显示最新额度。", member.name)}</p>
          :['codex','claude'].includes(member.executor)&&quota?.queryStatus==='unavailable'&&<p className="panel-muted">{t("已查询，{0} 暂未提供订阅额度数据。请检查连接或稍后重试。", member.name)}</p>}
        {google&&<p className="panel-muted">{t("Antigravity 账号模型配额，显示剩余比例；不是 Gemini API 金额余额。{0}自动发言只按所选模型的额度判断。", quota?.queryDetail??t("恢复时间以 Google 实际回报为准。"))}</p>}
        {(member.executor!=='claude'||!snapshot.claudeTokenConfigured)&&(['dsh','claude','codex'].includes(member.executor)||google||kimi||glm)&&<><button type="button" className="button secondary small balance-refresh" disabled={!!refreshing} onClick={()=>void refresh(member.executor)}><RefreshCw size={13}/>{refreshing===member.executor?t("正在查询…"):member.executor==='dsh'||kimi||glm?t("刷新余额"):t("刷新额度")}</button>{errors[member.executor]&&<p className="inline-error" role="alert">{errors[member.executor]}</p>}</>}
      </section>;
    })}<p className="quota-explanation"><Activity size={14}/>{t("显示最近一次账号回报；未提供或已过期的数据不计作零余额或零用量。订阅额度已用达到 80% 时减少自动点名，达到 100% 时暂停自动调用。")}</p></div>
    <div className="modal-footer"><button type="button" className="button secondary" disabled={!!refreshing||!snapshot.backendReady||!targets.length} onClick={()=>void refresh()}><RefreshCw size={14}/>{refreshing==='all'?t("正在刷新全部…"):t("刷新全部余额 / 额度")}</button><small>{t("后台每 30 秒更新；关闭此面板或隐藏窗口后继续刷新。")}</small><button type="button" className="button secondary" onClick={onClose}>{t("关闭")}</button></div>
  </Modal>;
}

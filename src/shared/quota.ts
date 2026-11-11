import {t} from './i18n';
import type { AccountBalance, AccountWallet, MemberQuota, ProviderId, QuotaWindow, MemberProfile, AcpExecutor } from './types';

export function accountRefreshTargets(members:Pick<MemberProfile,'executor'>[],executors:AcpExecutor[],claudeTokenConfigured=false){
 return [...new Set(members.map(member=>member.executor))].flatMap(provider=>{
  if(provider==='claude'&&claudeTokenConfigured)return [];
  const executor=executors.find(item=>item.id===provider),kimi=executor?.catalogId==='kimi'&&['kimi-api','kimi-api-cn'].includes(executor.authentication??''),glm=executor?.catalogId==='zcode'&&['glm-api-cn','glm-api-global'].includes(executor.authentication??''),claude=executor?.catalogId==='claude';
  const google=executor?.args.some(arg=>/[\\/]launch-official-acp\.cjs$/.test(arg));
  if(!['codex','claude','dsh'].includes(provider)&&!kimi&&!glm&&!google&&!claude)return [];
  return [{provider,method:provider==='dsh'||kimi||glm?'provider.balance':'provider.quota'}];
 });
}

export const QUOTA_STALE_MS = 15 * 60 * 1000;
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const percentage = (value: unknown) => { const n=number(value);return n===undefined||n<0?undefined:Math.min(100,n); };
const reset = (value: unknown) => {const n=number(value);return n!==undefined&&n>0?n:undefined;};
const label = (type: string, minutes?: number) => type==='five_hour'||minutes===300?t("5 小时"):type==='seven_day'||minutes===10080?t("每周"):type==='seven_day_opus'?t("每周 Opus"):type==='seven_day_sonnet'?t("每周 Sonnet"):minutes?`${minutes>=1440?t("{0} 天", Math.round(minutes/1440)):t("{0} 小时", Math.round(minutes/60))}`:t("当前窗口");
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Whitelist the native wallet projection. A failed or malformed sample clears old balances. */
export function accountBalanceReport(payload: unknown, checkedAt: string): AccountBalance {
  const data=object(payload),unavailable:AccountBalance={status:'unavailable',wallets:[],bonusWallets:[],checkedAt};
  const wallets=(value:unknown):AccountWallet[]|undefined=>{
    if(!Array.isArray(value)||value.length>20)return;
    const result:AccountWallet[]=[];
    for(const item of value){
      const wallet=object(item),balance=typeof wallet.balance==='string'?wallet.balance.trim():'';
      if(!['CNY','USD'].includes(wallet.currency)||!balance||balance.length>256||!decimal.test(balance))return;
      result.push({currency:wallet.currency,balance});
    }
    return result;
  };
  const kind=data.kind==='kimi-api'||data.kind==='glm-api'?data.kind as 'kimi-api'|'glm-api':undefined;
  if(data.status!=='ready')return {...unavailable,...(kind?{kind}:{}),...(typeof data.reason==='string'?{reason:data.reason.slice(0,300)}:{})};
  const normal=wallets(data.wallets),bonus=wallets(data.bonusWallets);
  const available=data.available?wallets([data.available])?.[0]:undefined;
  const frozen=data.frozen?wallets([data.frozen])?.[0]:undefined;
  const extra={...(kind?{kind}:{}),...(typeof data.reason==='string'?{reason:data.reason.slice(0,300)}:{}),...(available?{available}:{}),...(frozen?{frozen}:{})};
  return normal&&bonus?{status:'ready',wallets:normal,bonusWallets:bonus,checkedAt,...extra}:unavailable;
}
// Inspect decimal strings without a binary float; automatic calls use the owner's cent rule.
const nonzeroDecimal=(value:string)=>/[1-9]/.test(value.split(/[eE]/)[0]);
export function balanceExhausted(balance:AccountBalance|undefined,now=Date.now()){
  if(!balance||balance.status!=='ready'||!balanceFresh(balance,now))return false;
  if(balance.available)return Number(balance.available.balance)<=0;
  const wallets=[...balance.wallets,...balance.bonusWallets];
  return wallets.length>0&&wallets.every(wallet=>wallet.balance.startsWith('-')||!nonzeroDecimal(balanceAmount(wallet.balance,2)));
}
export function balanceAmount(value:string,places?:2){
  if(places===2){
    // Round the decimal string itself, rather than losing cents through a binary float.
    const negative=value.startsWith('-'),[coefficient,exponent='0']=value.replace(/^[+-]/,'').split(/[eE]/),[integer,fraction='']=coefficient.split('.');
    const raw=integer+fraction,digits=raw.replace(/^0+/,'');if(!digits)return '0.00';
    const point=BigInt(integer.length)+BigInt(exponent)-BigInt(raw.length-digits.length);
    if(point>512n){
      // Bound rendering for an extreme exponent while keeping two decimal places.
      const rounded=(BigInt(digits.slice(0,3).padEnd(3,'0'))+(Number(digits[3]??0)>=5?1n:0n)).toString();
      return `${negative?'-':''}${rounded[0]}.${rounded.slice(1,3)}e+${point-1n+(rounded.length>3?1n:0n)}`;
    }
    const keep=point+2n;if(keep<0n)return '0.00';
    const count=Number(keep),prefix=digits.slice(0,count).padEnd(count,'0')||'0';
    const cents=BigInt(prefix)+(Number(digits[count]??0)>=5?1n:0n),formatted=cents.toString().padStart(3,'0');
    return `${negative&&cents!==0n?'-':''}${formatted.slice(0,-2)}.${formatted.slice(-2)}`;
  }
  if(!nonzeroDecimal(value))return '0';
  if(/[eE]/.test(value))return value;
  return value.replace(/^\+/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
}

/** Parse only quota metadata; never infer account limits from tokens, cost or context size. */
export function quotaReport(provider: ProviderId, payload: unknown, checkedAt: string, source: MemberQuota['source']): MemberQuota | undefined {
  const received=object(payload),fullCodexQuery=provider==='codex'&&Object.hasOwn(received,'accountRateLimits');
  const data=fullCodexQuery?object(received.accountRateLimits):received,windows:QuotaWindow[]=[];
  if(Object.hasOwn(received,'googleQuota')){
    const google=object(received.googleQuota);
    if(google.status==='ready'&&Array.isArray(google.windows))for(const raw of google.windows.slice(0,200)){
      const row=object(raw),used=number(row.usedPercent);
      if(typeof row.id!=='string'||typeof row.label!=='string'||typeof row.model!=='string'||used===undefined||used<0||used>100)continue;
      windows.push({id:row.id.slice(0,160),label:row.label.slice(0,120),model:row.model.slice(0,160),usedPercent:used,resetsAt:reset(row.resetsAt),exhausted:used>=100,warning:used>=80,checkedAt});
    }
    return {provider,windows,checkedAt,source,quotaKind:'google-models',queryStatus:windows.length?'ready':'unavailable',queryDetail:typeof google.reason==='string'?google.reason.slice(0,300):undefined};
  }
  if(Object.hasOwn(data,'accountBalance'))return {provider,windows,checkedAt,source,balance:accountBalanceReport(data.accountBalance,checkedAt)};
  if(provider==='claude'&&Object.hasOwn(data,'accountUsage')){
    const rows=object(object(data.accountUsage).rate_limits).limits;
    if(Array.isArray(rows)&&rows.length<=40)for(const raw of rows){
      const row=object(raw),model=object(object(row.scope).model).display_name;
      const type=row.kind==='session'?'five_hour':row.kind==='weekly_all'?'seven_day':row.kind==='weekly_scoped'&&typeof model==='string'?/opus/i.test(model)?'seven_day_opus':/sonnet/i.test(model)?'seven_day_sonnet':undefined:undefined;
      const used=number(row.percent);if(!type||used===undefined||used<0||used>100)continue;
      const seconds=typeof row.resets_at==='string'?Date.parse(row.resets_at)/1000:undefined;
      windows.push({id:type,label:label(type),usedPercent:used,resetsAt:reset(seconds),exhausted:used>=100,warning:used>=80||['warning','critical'].includes(row.severity),checkedAt});
    }
    return {provider,windows,checkedAt,source,queryStatus:windows.length?'ready':'unavailable'};
  }
  if(provider==='codex') {
    const buckets=object(data.rateLimitsByLimitId),entries=Object.entries(buckets);
    const limits=entries.length?entries:(Object.keys(object(data.rateLimits)).length?[[object(data.rateLimits).limitId??'codex',data.rateLimits]]:[]);
    for(const [bucket,raw] of limits) {
      const limits=object(raw);
      for(const name of ['primary','secondary']) {
        const value=object(limits[name]);if(!Object.keys(value).length)continue;
        const minutes=number(value.windowDurationMins),usedPercent=percentage(value.usedPercent),windowLabel=label('',minutes);
        windows.push({id:`${bucket}:${name}`,label:entries.length>1?`${limits.limitName??bucket} · ${windowLabel}`:windowLabel,usedPercent,resetsAt:reset(value.resetsAt),exhausted:usedPercent!==undefined&&usedPercent>=100,warning:usedPercent!==undefined&&usedPercent>=80,checkedAt});
      }
    }
  } else if(provider==='claude') {
    const limit=object(data.rateLimit??data.rate_limit_info),unified=object(limit.unifiedWindows);
    for(const [type,raw] of Object.entries(unified)) {
      if(!['five_hour','seven_day','seven_day_opus','seven_day_sonnet'].includes(type))continue;
      const value=object(raw),utilization=number(value.utilization),usedPercent=utilization===undefined?undefined:percentage(utilization*100);
      windows.push({id:type,label:label(type),usedPercent,resetsAt:reset(value.resetsAt),exhausted:usedPercent!==undefined&&usedPercent>=100||limit.status==='rejected'&&limit.rateLimitType===type,warning:usedPercent!==undefined&&usedPercent>=80||limit.status==='allowed_warning'&&limit.rateLimitType===type,checkedAt});
    }
    const type=typeof limit.rateLimitType==='string'?limit.rateLimitType:'current';
    if(Object.keys(limit).length&&!windows.some(window=>window.id===type)&&(number(limit.utilization)!==undefined||['rejected','allowed_warning'].includes(limit.status)||type!=='current'&&limit.status==='allowed')) {
      const utilization=number(limit.utilization);
      windows.push({id:type,label:label(type),usedPercent:utilization===undefined?undefined:percentage(utilization*100),resetsAt:reset(limit.resetsAt),exhausted:limit.status==='rejected',warning:limit.status==='allowed_warning',checkedAt});
    }
  }
  return windows.length||fullCodexQuery?{provider,windows,checkedAt,source,...(fullCodexQuery?{queryStatus:windows.length?'ready' as const:'unavailable' as const}:{})}:undefined;
}

export function mergeQuota(previous: MemberQuota | undefined, report: MemberQuota): MemberQuota {
  // A native /usage query is a full account sample, including a truthful unavailable response.
  if(report.queryStatus&&(!previous||Date.parse(report.checkedAt)>=Date.parse(previous.checkedAt)))return report;
  const windows=new Map(previous?.windows.map(window=>[window.id,window]));
  if(report.provider==='claude'&&report.windows.some(window=>window.id!=='current')&&!report.windows.some(window=>window.exhausted)&&(!previous||Date.parse(report.checkedAt)>=Date.parse(previous.checkedAt)))windows.delete('current');
  for(const window of report.windows)if(!windows.has(window.id)||Date.parse(window.checkedAt)>=Date.parse(windows.get(window.id)!.checkedAt))windows.set(window.id,window);
  return {...(previous&&Date.parse(previous.checkedAt)>Date.parse(report.checkedAt)?previous:report),windows:[...windows.values()]};
}
export function quotaFresh(window: QuotaWindow, now=Date.now()) {
  const at=Date.parse(window.checkedAt);
  return Number.isFinite(at)&&now-at<=QUOTA_STALE_MS&&now>=at&&(window.resetsAt===undefined||window.resetsAt*1000>now);
}
export function balanceFresh(balance:AccountBalance,now=Date.now()){
  const at=Date.parse(balance.checkedAt);
  return Number.isFinite(at)&&now>=at&&now-at<=QUOTA_STALE_MS;
}
/** Explicitly named members/questions/closure are handled by the coordinator before this weight. */
export function quotaPreference(quota: MemberQuota | undefined, now=Date.now(), model?:string) {
  if(balanceExhausted(quota?.balance,now))return 0;
  if(quota?.quotaKind==='google-models'){
    const current=quota.windows.filter(window=>quotaFresh(window,now)&&window.model===model);
    if(current.some(window=>window.exhausted))return 0;
    if(current.some(window=>(window.usedPercent??0)>=95))return 0.1;
    if(current.some(window=>window.warning))return 0.35;
    return 1;
  }
  const windows=quota?.windows.filter(window=>quotaFresh(window,now)&&(!model||window.id!=='seven_day_opus'&&window.id!=='seven_day_sonnet'||window.id==='seven_day_opus'&&/opus/i.test(model)||window.id==='seven_day_sonnet'&&/sonnet/i.test(model)))??[];
  if(windows.some(window=>window.exhausted||window.usedPercent!==undefined&&window.usedPercent>=100))return 0;
  if(windows.some(window=>window.usedPercent!==undefined&&window.usedPercent>=95))return 0.1;
  if(windows.some(window=>window.warning||window.usedPercent!==undefined&&window.usedPercent>=80))return 0.35;
  return 1;
}
/** Only a current native 100% sample permits skipping a joint review's author response. */
export function quotaAt100(quota:MemberQuota|undefined,now=Date.now(),model?:string){
  return quotaPreference(quota,now,model)===0&&Boolean(quota?.windows.some(window=>quotaFresh(window,now)&&window.usedPercent!==undefined&&window.usedPercent>=100&&(!['seven_day_opus','seven_day_sonnet'].includes(window.id)||Boolean(model)&&(window.id==='seven_day_opus'&&/opus/i.test(model!)||window.id==='seven_day_sonnet'&&/sonnet/i.test(model!)))));
}

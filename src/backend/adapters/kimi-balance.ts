import {fetch,ProxyAgent} from 'undici';
import type {AccountBalance,AcpExecutor,Settings} from '../../shared/types';
export function kimiPlatform(executor:AcpExecutor){return executor.catalogId==='kimi'&&['kimi-api','kimi-api-cn'].includes(executor.authentication??'');}
export function parseKimiBalance(value:any,checkedAt=new Date().toISOString(),currency:'CNY'|'USD'='CNY'):AccountBalance{
  const unavailable:AccountBalance={status:'unavailable',wallets:[],bonusWallets:[],checkedAt,kind:'kimi-api'};
  const d=value?.data,amount=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?String(v):typeof v==='string'&&/^-?\d+(?:\.\d+)?$/.test(v)&&v.length<100?v:undefined;
  const available=amount(d?.available_balance),cash=amount(d?.cash_balance),voucher=amount(d?.voucher_balance);
  if(value?.status!==true||value?.code!==0||available===undefined||cash===undefined||voucher===undefined||Number(voucher)<0)return unavailable;
  return {...unavailable,status:'ready',available:{currency,balance:available},wallets:[{currency,balance:cash}],bonusWallets:[{currency,balance:voucher}]};
}
/** Exactly one read-only GET to the configured official regional account endpoint. */
export async function readKimiBalance(executor:AcpExecutor,settings:Settings):Promise<AccountBalance>{
  const checkedAt=new Date().toISOString(),empty=(reason:string,signedOut=false):AccountBalance=>({status:'unavailable',wallets:[],bonusWallets:[],checkedAt,kind:'kimi-api',reason,...(signedOut?{signedOut:true}:{})});
  if(!kimiPlatform(executor))return empty('仅支持 Kimi 开放平台 API 账户余额。');
  const base=executor.authentication==='kimi-api-cn'?'https://api.moonshot.cn/v1':'https://api.moonshot.ai/v1';
  if(executor.env.KIMI_MODEL_BASE_URL!==base)return empty('登录区域与服务地址不匹配，请先修正连接。');
  const key=executor.env.KIMI_MODEL_API_KEY;
  if(!key||/[\r\n\0]/.test(key))return empty('请在 Kimi 连接设置中保存有效的 API Key。');
  const proxy=settings.networkMode==='proxy'?new ProxyAgent(settings.proxyUrl):undefined;
  try{
    const r=await fetch(base+'/users/me/balance',{method:'GET',headers:{Authorization:'Bearer '+key,'User-Agent':'HiveLab/AgentNest balance reader'},dispatcher:proxy,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!r.ok){await r.body?.cancel();return empty(r.status===401?'Kimi Key 认证未通过，请核对 Key 与中国/国际站是否匹配。':`余额接口暂不可用（HTTP ${r.status}）。`,r.status===401);}
    const parts:Uint8Array[]=[];let size=0;for await(const chunk of r.body!){size+=chunk.length;if(size>65536)throw Error('response too large');parts.push(chunk);}
    const balance=parseKimiBalance(JSON.parse(Buffer.concat(parts).toString('utf8')),checkedAt,executor.authentication==='kimi-api-cn'?'CNY':'USD');
    if(balance.status==='unavailable')balance.reason='余额服务没有返回有效数据。';return balance;
  }catch{return empty('余额查询连接失败或超时，请检查网络。');}finally{await proxy?.close();}
}

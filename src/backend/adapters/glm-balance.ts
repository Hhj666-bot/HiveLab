import {fetch,ProxyAgent} from 'undici';
import type {AccountBalance,AcpExecutor,Settings} from '../../shared/types';

const amount=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)&&value.length<100?value:undefined;
const empty=(checkedAt:string,reason?:string):AccountBalance=>({status:'unavailable',kind:'glm-api',wallets:[],bonusWallets:[],checkedAt,...(reason?{reason}:{})});
/** Read the available wallet amount, never cumulative top-ups/gifts/spending or Coding Plan credits. */
export function parseGlmBalance(value:any,region:'cn'|'global',checkedAt=new Date().toISOString()):AccountBalance {
  const unavailable=empty(checkedAt,'余额服务没有返回可验证的账户余额。');
  if(region==='cn'){
    if(value?.success!==true||![200,'200',0,'0'].includes(value.code))return unavailable;
    const available=amount(value.data?.availableBalance);if(available===undefined)return unavailable;
    const frozen=amount(value.data?.frozenBalance);
    return {...unavailable,status:'ready',reason:undefined,available:{currency:'CNY',balance:available},...(frozen!==undefined?{frozen:{currency:'CNY' as const,balance:frozen}}:{})};
  }
  // International balance APIs may not be enabled for every account; unknown shapes stay unknown.
  if(value?.success===false||value?.error||value?.success!==true&&![200,'200',0,'0'].includes(value?.code))return unavailable;
  const data=value.data,currency=data?.currency;
  if(!['USD','CNY'].includes(currency))return unavailable;
  const available=amount(data?.availableBalance??data?.available_balance??data?.balance);
  return available===undefined?unavailable:{...unavailable,status:'ready',reason:undefined,available:{currency,balance:available}};
}

/** Fixed official hosts; one metadata GET, no model call and no credential-bearing redirect. */
export async function readGlmBalance(executor:AcpExecutor,settings:Settings,request:typeof fetch=fetch):Promise<AccountBalance>{
  const checkedAt=new Date().toISOString();
  if(executor.catalogId!=='zcode'||!['glm-api-cn','glm-api-global'].includes(executor.authentication??''))return empty(checkedAt,'请先选择 GLM 普通 API Key；Coding Plan 套餐额度不是账户现金余额。');
  const key=executor.env.GLM_API_KEY;
  if(!key||/[\r\n\0]/.test(key))return empty(checkedAt,'请在 GLM 连接设置中保存有效的 API Key。');
  const domestic=executor.authentication==='glm-api-cn';
  const url=domestic?'https://open.bigmodel.cn/api/biz/account/query-customer-account-report':'https://api.z.ai/api/paas/v4/balance';
  const proxy=settings.networkMode==='proxy'?new ProxyAgent(settings.proxyUrl):undefined;
  try{
    const response=await request(url,{method:'GET',headers:{Authorization:domestic?key:'Bearer '+key,'User-Agent':'HiveLab/AgentNest balance reader'},dispatcher:proxy,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok){await response.body?.cancel();return empty(checkedAt,response.status===401||response.status===403?'GLM 余额查询认证未通过，请核对 API Key 与登录地区。':response.status===404?'此地区暂未提供可用的 GLM 余额查询接口。':response.status===429?'GLM 余额查询过于频繁，请稍后重试。':`GLM 余额接口暂不可用（HTTP ${response.status}）。`);}
    const parts:Uint8Array[]=[];let size=0;for await(const chunk of response.body!){size+=chunk.length;if(size>65536)throw Error('response too large');parts.push(chunk);}
    const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
    if(value?.success===false||value?.error){const code=String(value?.code??value?.error?.code??'');return empty(checkedAt,['1000','1001','1002','1003','1004'].includes(code)?'GLM 余额查询认证未通过，请核对 API Key 与登录地区。':'GLM 账户服务未能完成余额查询。');}
    return parseGlmBalance(value,domestic?'cn':'global',checkedAt);
  }catch{return empty(checkedAt,'GLM 余额查询连接失败或超时，请检查网络。');}finally{await proxy?.close();}
}

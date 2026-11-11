import {fetch,ProxyAgent} from 'undici';
import type {AcpExecutor,ModelOption,Settings} from '../../shared/types';
import {KIMI_ENV_MODEL} from '../../shared/executor-config';
export {KIMI_ENV_MODEL} from '../../shared/executor-config';

const BASES:Record<string,string>={'kimi-api':'https://api.moonshot.ai/v1','kimi-api-cn':'https://api.moonshot.cn/v1','kimi-code-key':'https://api.kimi.com/coding/v1','kimi-code-key-global':'https://api.kimi.ai/coding/v1'};
/** Kimi's invocation-only environment model uses this native ACP alias, not the API Model ID. */
export function isKimiApi(executor:AcpExecutor){return executor.catalogId==='kimi'&&!!BASES[executor.authentication??''];}
export function kimiApiModel(executor:AcpExecutor,requested?:string,options:ModelOption[]=[]){
  const actual=(value:string|undefined)=>value&&value!==KIMI_ENV_MODEL?value:undefined;
  return actual(requested)||actual(executor.env.KIMI_MODEL_NAME)||actual(executor.model)||options.find(option=>option.id!==KIMI_ENV_MODEL)?.id||(executor.authentication?.startsWith('kimi-code-key')?'k3':'kimi-k3');
}
export function kimiApiFallback(executor:AcpExecutor):ModelOption[]{
  const ids=executor.authentication?.startsWith('kimi-code-key')?['k3','kimi-for-coding','kimi-for-coding-highspeed']:['kimi-k3'];
  return [...new Set([kimiApiModel(executor),...ids])].map(id=>({id,label:id,efforts:[],effortSource:'unreported',description:'常用 API 模型；账号可用性以服务端实际调用为准。'}));
}
export async function readKimiApiModels(executor:AcpExecutor,settings:Settings,request:typeof fetch=fetch):Promise<{models:ModelOption[];reported:boolean;unauthorized?:boolean;detail?:string}>{
  const fallback={models:kimiApiFallback(executor),reported:false,detail:'服务端未提供模型清单，显示常用模型；仍可在对话中选择。'};
  const base=BASES[executor.authentication??''],key=executor.env.KIMI_MODEL_API_KEY;
  if(!isKimiApi(executor)||!key||/[\r\n\0]/.test(key))return fallback;
  const proxy=settings.networkMode==='proxy'?new ProxyAgent(settings.proxyUrl):undefined;
  try{
    const response=await request(base+'/models',{method:'GET',headers:{Authorization:'Bearer '+key,'User-Agent':'HiveLab/AgentNest model-list reader'},dispatcher:proxy,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok){await response.body?.cancel();return {...fallback,unauthorized:response.status===401,detail:response.status===401?'API 模型清单认证未通过，请核对 Key 与登录地区。':'模型清单暂未读取，仍可在对话中选择或填写模型。'};}
    const chunks:Uint8Array[]=[];let size=0;
    for await(const chunk of response.body!){size+=chunk.length;if(size>1024*1024)throw Error('model list too large');chunks.push(chunk);}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!Array.isArray(value?.data))return {...fallback,detail:'服务端未返回模型清单，仍可在对话中选择或填写模型。'};
    const ids=[...new Set<string>(value.data.slice(0,500).map((item:any)=>item?.id).filter((id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=120&&!/\s/.test(id)))];
    if(!ids.length)return fallback;
    return {reported:true,models:ids.map(id=>({id,label:id,efforts:[],effortSource:'unreported',description:'来自当前 API 服务的模型清单。'}))};
  }catch{return {...fallback,detail:'模型清单连接失败或超时，仍可在对话中选择或填写模型。'};}
  finally{await proxy?.close();}
}

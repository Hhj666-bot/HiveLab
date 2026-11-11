import {fetch,ProxyAgent} from 'undici';
import type {Settings} from '../shared/types';

export type ModelListProtocol='openai'|'anthropic';
export interface ModelListResult{models:string[];url:string}

/** Only the service the user named, over HTTPS (plain HTTP only on this machine). */
function serviceUrl(base:string,protocol:ModelListProtocol){
  let url:URL;
  try{url=new URL(base.trim());}catch{throw new Error('请求地址格式不对，请填写完整的 https:// 地址。');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw new Error('请求地址需要以 https:// 开头。');
  if(url.username||url.password)throw new Error('请求地址里不要包含账号或密码。');
  const path=url.pathname.replace(/\/+$/,'');
  // OpenAI-compatible services put /models under their versioned root; Anthropic-style services under /v1.
  url.pathname=protocol==='anthropic'&&!/\/v1$/.test(path)?path+'/v1/models':path+'/models';
  url.search=protocol==='anthropic'?'?limit=1000':'';url.hash='';
  return url;
}

/** Read-only: asks the service which models this key may use. No model task is sent. */
export async function listApiModels(options:{protocol:ModelListProtocol;baseUrl:string;key:string},settings:Pick<Settings,'networkMode'|'proxyUrl'>,request:typeof fetch=fetch):Promise<ModelListResult>{
  const url=serviceUrl(options.baseUrl,options.protocol);
  if(!options.key||/[\r\n\0]/.test(options.key))throw new Error('请先填写 API Key。');
  const headers:Record<string,string>={'User-Agent':'HiveLab model-list reader',Accept:'application/json'};
  if(options.protocol==='anthropic'){headers['x-api-key']=options.key;headers['anthropic-version']='2023-06-01';}
  // Relays for either protocol commonly accept a bearer token too.
  headers.Authorization='Bearer '+options.key;
  const proxy=settings.networkMode==='proxy'&&settings.proxyUrl?new ProxyAgent(settings.proxyUrl):undefined;
  try{
    let response;
    try{response=await request(url,{method:'GET',headers,dispatcher:proxy,redirect:'error',signal:AbortSignal.timeout(12000)});}
    catch{throw new Error('连接模型清单失败或超时，请核对请求地址和网络。');}
    if(!response.ok){
      await response.body?.cancel();
      throw new Error(response.status===401||response.status===403?'API Key 未通过认证，请核对 Key 与请求地址。':response.status===404?'这个服务没有提供模型清单接口，请手动填写模型名称。':`模型清单读取失败（HTTP ${response.status}），可以手动填写模型名称。`);
    }
    const chunks:Uint8Array[]=[];let size=0;
    for await(const chunk of response.body!){size+=chunk.length;if(size>2*1024*1024)throw new Error('模型清单过大，请手动填写模型名称。');chunks.push(chunk);}
    let value:any;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('服务返回的不是模型清单，请核对请求地址。');}
    const items:any[]=Array.isArray(value?.data)?value.data:Array.isArray(value?.models)?value.models:Array.isArray(value)?value:[];
    const models=[...new Set(items.slice(0,1000).map(item=>typeof item==='string'?item:item?.id??item?.name).filter((id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=160&&!/\s/.test(id)).map(id=>id.replace(/^models\//,'')))];
    if(!models.length)throw new Error('服务没有列出可用模型，请手动填写模型名称。');
    return {models:models.sort((a,b)=>a.localeCompare(b)),url:url.origin+url.pathname};
  }finally{await proxy?.close();}
}

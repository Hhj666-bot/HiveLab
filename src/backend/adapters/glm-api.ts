import path from 'node:path';
import type {AcpExecutor} from '../../shared/types';
import {DeepseekAdapter} from './deepseek';
import {readGlmBalance} from './glm-balance';
import type {Settings} from '../../shared/types';

/** GLM 官方 API 的模型清单：id 直接作为请求体的 model 字段，必须与智谱文档一致（小写）。 */
/** Deep thinking is switched per request with `thinking: {type: enabled|disabled}`; GLM enables it by default. */
const THINKING={efforts:['off','on'],defaultEffort:'on',effortSource:'documented' as const};
const GLM_MODEL_OPTIONS = [
  {id:'glm-5.3-flash',label:'GLM-5.3-Flash（视觉）',...THINKING,description:'视觉语言模型，可读图片'},
  {id:'glm-5v-turbo',label:'GLM-5V-Turbo（视觉）',...THINKING,description:'视觉模型，速度优先'},
  {id:'glm-5.3',label:'GLM-5.3（纯文本）',...THINKING,description:'文本模型，不支持图片'},
];

/** API mode belongs to the existing GLM connection; native ZCode account login stays independent. */
export function isGlmApi(executor:AcpExecutor){return executor.catalogId==='zcode'&&['glm-api-cn','glm-api-global'].includes(executor.authentication??'');}
export class GlmApiAdapter extends DeepseekAdapter {
  constructor(private executor:AcpExecutor,dataDirectory:string,private fetcher?:ConstructorParameters<typeof DeepseekAdapter>[2]) {
    if(!isGlmApi(executor))throw new Error('请选择 GLM API Key 登录方式。');
    const global=executor.authentication==='glm-api-global';
    super(()=>executor.env.GLM_API_KEY,dataDirectory,fetcher,{
      id:executor.id,name:global?'GLM API（Z.ai 海外）':'GLM API（BigModel 中国区）',
      baseUrl:global?'https://api.z.ai/api/paas/v4':'https://open.bigmodel.cn/api/paas/v4',
      model:executor.env.GLM_MODEL||executor.model||'glm-5.3-flash',
      historyDirectory:path.join('glm-api-history',executor.id,executor.authentication!),
      vision:true,
      thinking:true,
    });
  }
  async probe(settings:Settings){
    const info=await super.probe(settings);
    const current=(info.model??'').toLowerCase();
    info.modelOptions=GLM_MODEL_OPTIONS.map(option=>({...option,isDefault:option.id===current}));
    info.configuration={model:true,effort:'documented',detail:'模型来自 GLM 官方 API 清单；默认 glm-5.3-flash。深度思考可开关，默认开启。修改从下一轮生效。'};
    if(info.auth==='api'){const result=await this.accountQuota(settings,{});info.quota=result.payload;info.quotaCheckedAt=result.checkedAt;info.detail=result.payload.accountBalance.status==='ready'?`${info.name} 账户余额已读取；模型权限以实际调用为准，未发送模型请求。`:`${info.name} 本地配置已保存；${result.payload.accountBalance.reason} 未发送模型请求。`;}
    return info;
  }
  async accountQuota(settings:Settings,_env:NodeJS.ProcessEnv){const balance=await readGlmBalance(this.executor,settings,this.fetcher);return {payload:{accountBalance:balance},checkedAt:balance.checkedAt};}
  async authenticate(..._args:unknown[]):Promise<{method:string}>{throw new Error('请在 GLM 连接设置中加密保存 API Key，无需浏览器登录。');}
}

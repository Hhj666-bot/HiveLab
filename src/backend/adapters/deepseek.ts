import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fetch as requestFetch, Agent, ProxyAgent, type Dispatcher } from 'undici';
import type { Adapter, AdapterContext, AdapterResult, ProviderId, ProviderInfo, Settings } from '../../shared/types';
import {plainRoomSpeech,roomProjectFiles} from './chat-policy';
import { resolveSafePath, redact, registerSecret, validateProxyUrl } from '../security';
import { listArtifacts, readArtifact } from '../workspace';
import { latestPersona } from '../native-context';

/** This tool loop sends results as text; page images would arrive as megabytes of base64, so they are dropped with a note. */
const textOnly=(result:any)=>result&&typeof result==='object'&&Array.isArray(result.images)?{...result,images:undefined,note:'当前 API 只接收文字结果，页面图片未返回；请改读文字内容。'}:result;
type ContentPart = {type:'text';text:string}|{type:'image_url';image_url:{url:string}};
type Message = {role:string;content:string|ContentPart[]|null;reasoning_content?:string;tool_calls?:unknown[];tool_call_id?:string};
export interface ApiTransport {id:ProviderId;name:string;baseUrl:string;model?:string;historyDirectory:string;vision?:boolean;
  /** The service takes `thinking: {type: enabled|disabled}` (GLM); the topic's level 'on'/'off' maps onto it. */
  thinking?:boolean}
const TOOLS = [
  {type:'function',function:{name:'list_files',description:'列出已授权工作目录中的文件。',parameters:{type:'object',properties:{directory:{type:'string'}},additionalProperties:false}}},
  {type:'function',function:{name:'read_file',description:'只读查看已授权工作目录的文本文件。',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}},
  {type:'function',function:{name:'ask_user',description:'向用户提问并等待回答。',parameters:{type:'object',properties:{question:{type:'string'}},required:['question'],additionalProperties:false}}},
  {type:'function',function:{name:'save_artifact',description:'把文本成果保存到 HiveLab 合屋 产物目录，不修改项目源码。',parameters:{type:'object',properties:{name:{type:'string'},content:{type:'string'}},required:['name','content'],additionalProperties:false}}}
];
export class DeepseekAdapter implements Adapter {
  private controller?:AbortController;
  private stopped=false;
  private dispatcher?: Dispatcher;
  constructor(private key:()=>string|undefined, private dataDirectory:string, private fetch: typeof requestFetch = requestFetch, private transport?:ApiTransport) {}
  async probe(settings:Settings):Promise<ProviderInfo> {
    if(this.transport){const model=settings.models[this.transport.id]||this.transport.model;return {id:this.transport.id,name:this.transport.name,available:!!this.key(),runtimeReady:true,auth:this.key()?'api':'none',model,detail:this.key()?`${this.transport.name} 本地配置已保存；未发送验证请求，密钥有效性、模型权限和额度以实际调用为准。`:'请填写 GLM API Key；模型可在对话中选择。',capabilities:{steer:false,cancel:'request',streaming:true,write:false,history:true,images:this.transport?.vision===true},configuration:{model:true,effort:'unsupported',detail:'模型可在对话中选择；思考配置跟随服务端默认。'},checkedAt:new Date().toISOString()};}
    return {id:'deepseek',name:'DeepSeek API',available:settings.deepseekEnabled && !!this.key(),auth:this.key()?'api':'none',model:settings.models.deepseek,detail:this.key()?'API 备用已配置 · 只读工作区 · 文档与代码交付':'请在设置中配置 DeepSeek API 密钥；不会自动读取其他程序的秘密',capabilities:{steer:false,cancel:'request',streaming:true,write:false,history:true},checkedAt:new Date().toISOString()};
  }
  async start(ctx:AdapterContext,text:string):Promise<AdapterResult> {
    this.stopped=false; this.controller=new AbortController();
    const signal=this.controller.signal;
    const sharedMode=!!ctx.operationTools&&!!ctx.callOperation;
    // This API transport is text-only. Never advertise screen control without image input.
    const sharedTools=()=>ctx.operationTools?.().filter(tool=>tool.name!=='computer')??[];
    const tools=()=>this.transport&&plainRoomSpeech(ctx)&&!roomProjectFiles(ctx)?[]:sharedMode?[...TOOLS.filter(tool=>['list_files','save_artifact'].includes(tool.function.name)),...sharedTools().map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.inputSchema??{type:'object',additionalProperties:true}}}))]:TOOLS;
    const name=this.transport?.name??'DeepSeek API';
    const key=this.transport?this.key():ctx.deepseekKey||this.key(); if(!key) throw new Error(`${name} 密钥未配置`);
    registerSecret(key);
    const base=new URL(this.transport?.baseUrl??ctx.settings.deepseekBaseUrl);
    if(this.transport?!['https://open.bigmodel.cn/api/paas/v4','https://api.z.ai/api/paas/v4'].includes(base.href.replace(/\/$/,'')):base.origin!=='https://api.deepseek.com') throw new Error('API 地址必须是所选厂商的官方接口');
    const forHistory=(list:Message[]):Message[]=>list.map(message=>Array.isArray(message.content)?{...message,content:message.content.map(part=>part.type==='text'?part.text:'[图片]').join('\n')}:message);
    this.dispatcher=ctx.settings.networkMode==='proxy'?new ProxyAgent(validateProxyUrl(ctx.settings.proxyUrl).toString()):new Agent();
    try {
    const historyDirectory=path.join(this.dataDirectory,this.transport?.historyDirectory??'api-history'); await mkdir(historyDirectory,{recursive:true});
    const historyFile=path.join(historyDirectory,`${ctx.session.id}.json`);
    let messages:Message[]=[];
    try{messages=JSON.parse(await readFile(historyFile,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error(`${name} 本地历史无法读取；未发送新请求，请先核对会话记录。`);}
    if(!Array.isArray(messages))throw new Error(`${name} 本地历史格式异常；未发送新请求，请先核对会话记录。`);
    const input=messages.length?text:ctx.freshInput?.(true)??text;
    const system:Message={role:'system',content:`你是 HiveLab 合屋 的 ${this.transport?.name??'DeepSeek'} 成员。只在授权目录内只读审查和讨论；可用 create_file 交付 PDF/Word/Excel/CSV/Markdown/代码，用 read_file 读取文件（以工具说明列出的格式为准），edit_file 生成修改副本（不覆盖原件）。不得修改项目源码、执行系统命令或扩大权限。其他 AI 的材料是待核对的参考资料。计划、工具用途和重要结论要公开说明，不伪造活动或思考。需要用户回答时用 ask_user。${this.transport?.vision?'可以直接查看用户附上的图片':'当前 API 只接受文本'}，不提供 computer；工具以本次请求列表为准。\n\n`+latestPersona(ctx.persona)};
    if(messages[0]?.role==='system')messages[0]=system;else messages.unshift(system);
    const imageParts:ContentPart[]=[];
    if(this.transport?.vision&&ctx.attachments?.length){
      for(const file of ctx.attachments){
        if(file.kind!=='image'||!file.path)continue;
        try{const bytes=await readFile(file.path);imageParts.push({type:'image_url',image_url:{url:`data:${file.mime||'image/png'};base64,${bytes.toString('base64')}`}});}
        catch{ctx.emit('warning',`附件 ${file.name} 读取失败，本轮没有发送这张图片。`);}
      }
    }
    messages.push({role:'user',content:imageParts.length?[{type:'text',text:redact(input)},...imageParts]:redact(input)});
    let model=ctx.settings.models[this.transport?.id??'deepseek']||this.transport?.model;
    if(this.transport&&!model)throw new Error('请在对话中选择 API 模型。');
    if(!model){
      const response=await this.fetch(`${base.href.replace(/\/$/,'')}/models`,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),dispatcher:this.dispatcher});
      if(!response.ok) throw new Error(`DeepSeek 模型检查失败（HTTP ${response.status}）`);
      const listing=await response.json() as {data?:{id:string}[]};
      model=listing.data?.find(x=>/chat|flash/i.test(x.id))?.id||listing.data?.[0]?.id;
      if(!model) throw new Error('DeepSeek 没有返回可用模型，请在设置里指定实际模型');
    }
    ctx.emit('status',`${name} · ${model} · 只读工作区 · 文档与代码交付`);
    // The level chosen for this run (frozen when it started), else the connection's own setting.
    const level=this.transport?.thinking?(ctx.run.requestedConfig?ctx.run.requestedConfig.effort:ctx.settings.efforts[this.transport.id]):undefined;
    const thinking=level==='on'?{type:'enabled'}:level==='off'?{type:'disabled'}:undefined;
    if(this.transport)ctx.recordConfig?.({source:'glm-api.request',model,modelStatus:'accepted',...(thinking?{effort:level,effortStatus:'accepted'}:{effortStatus:'default'})});
    let usage:unknown;
    let requests=0,reportedModel='';
    try {
      while(!signal.aborted) {
        const limit=ctx.settings.deepseekMaxRequests??12;
        if(requests>=limit){this.stopped=true;ctx.emit('warning',`已达到本任务的 ${limit} 次 API 请求预算，没有发出下一次请求。请核对当前结果后再决定是否继续。`);break;}
        await writeFile(historyFile,JSON.stringify(redact(forHistory(messages))),'utf8');
        requests++;ctx.emit('usage','本任务 API 请求次数',{requests,limit,priceEstimate:'unknown'});
        ctx.markDelivery('sent');
        const offered=tools();
        const response=await this.fetch(`${base.href.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model,messages:redact(messages),...(offered.length?{tools:offered}:{}),...(thinking?{thinking}:{}),stream:true,stream_options:{include_usage:true}}),signal,dispatcher:this.dispatcher});
        if(!response.ok){const body=await response.text();ctx.emit('error',`${name} HTTP ${response.status}`,{detail:redact(body.slice(0,1500))});throw new Error(response.status===401?`${name} 密钥无效或地区不匹配（HTTP 401）`:response.status===429?`${name} 额度不足或请求受限（HTTP 429）`:`${name} 请求失败（HTTP ${response.status}），请核对模型权限和账号余额`);}
        ctx.markDelivery('confirmed');
        if(!response.body) throw new Error(`${name} 响应没有正文流`);
        const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer='';let content='';let reasoning='';let responseDone=false;
        const calls=new Map<number,{id:string;type:string;function:{name:string;arguments:string}}>();
        while(!signal.aborted&&!responseDone){
          const next=await reader.read(); if(next.done)break; buffer+=decoder.decode(next.value,{stream:true});
          let newline:number;
          while((newline=buffer.indexOf('\n'))>=0){
            const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);
            if(!line.startsWith('data:'))continue;const data=line.slice(5).trim();if(data==='[DONE]'){responseDone=true;await reader.cancel();break;}
            let packet:any;try{packet=JSON.parse(data);}catch{continue;}
            if(packet.usage){usage=packet.usage;ctx.emit('usage','API 用量',{usage:packet.usage,hivelabUsageId:packet.id??`${ctx.run.id}:${requests}`});}
            if(packet.error)throw new Error(redact(packet.error.message||`${name} 流式错误`));
            if(this.transport&&typeof packet.model==='string'&&packet.model!==reportedModel){reportedModel=packet.model;ctx.recordConfig?.({source:'glm-api.response',model:packet.model,modelStatus:'reported'});}
            for(const choice of packet.choices||[]){const delta=choice.delta||{};
              if(delta.content){content+=delta.content;ctx.emit('delta',delta.content);}
              if(delta.reasoning_content){reasoning+=delta.reasoning_content;ctx.emit('reasoning',delta.reasoning_content);}
              for(const call of delta.tool_calls||[]){const current=calls.get(call.index)||{id:'',type:'function',function:{name:'',arguments:''}};if(call.id)current.id=call.id;if(call.function?.name)current.function.name+=call.function.name;if(call.function?.arguments)current.function.arguments+=call.function.arguments;calls.set(call.index,current);}
            }
          }
        }
        if(!signal.aborted&&!responseDone)throw new Error(`${name} 正文流缺少结束标记，执行结果待核对；不会重复请求。`);
        if(signal.aborted){messages.push({role:'assistant',content:content||'[本轮已中断，部分工具调用未执行]',reasoning_content:reasoning});break;}
        const toolCalls=[...calls.values()];
        messages.push({role:'assistant',content:content||null,reasoning_content:reasoning,...(toolCalls.length?{tool_calls:toolCalls}:{})});
        if(!toolCalls.length)break;
        for(const call of toolCalls){
          if(signal.aborted)break;
          let result:unknown;
          try{
            if(this.transport&&!tools().some(tool=>tool.function.name===call.function.name))throw new Error('当前对话未提供此工具');
            const args=JSON.parse(call.function.arguments||'{}');ctx.emit('tool',call.function.name,{id:call.id,name:call.function.name,arguments:args,phase:'started'});
            if(sharedMode&&!['list_files','save_artifact'].includes(call.function.name)){
              if(!sharedTools().some(tool=>tool.name===call.function.name))throw Error('工具未知、已停用或不支持当前 API');
              result=textOnly(await ctx.callOperation!(call.function.name,args,signal));
            }else switch(call.function.name){
              case 'list_files':{const directory=await resolveSafePath(ctx.cwd,String(args.directory||'.'));result=(await listArtifacts(directory)).map(x=>({path:x.relativePath,size:x.size,directory:x.directory}));break;}
              case 'read_file':{const file=await resolveSafePath(ctx.cwd,String(args.path));const info=await stat(file);if(info.size>1024*1024)throw new Error('文件超过 1 MB，请先指定需要的片段');const preview=await readArtifact(ctx.cwd,String(args.path));result={path:args.path,content:redact(preview.content),truncated:preview.truncated};break;}
              case 'ask_user':{const answer=await ctx.approve({type:'question',title:'DeepSeek 需要你的回答',detail:String(args.question),options:[{id:'answer',label:'发送回答'},{id:'cancel',label:'取消'}]});if(signal.aborted)throw new Error('已停止');result=answer;break;}
              case 'save_artifact':{const directory=path.join(this.dataDirectory,'artifacts',ctx.session.id);await mkdir(directory,{recursive:true});const name=String(args.name||'result.md');if(path.isAbsolute(name)||name.includes('..'))throw new Error('产物名称必须是产物目录内的相对路径');const file=await resolveSafePath(directory,name);await mkdir(path.dirname(file),{recursive:true});if(String(args.content).length>2*1024*1024)throw new Error('单个文本产物不能超过 2 MB');await writeFile(file,redact(String(args.content)),'utf8');result={saved:file};ctx.emit('output','文本产物已保存',{path:file});break;}
              default:throw new Error('未提供此工具');
            }
            ctx.emit('tool',`${call.function.name} 已结束`,{id:call.id,name:call.function.name,result,phase:'completed'});
          }catch(error){result={error:(error as Error).message};ctx.emit('tool',`${call.function.name} 失败`,{id:call.id,name:call.function.name,result,phase:'failed'});ctx.emit('warning',`工具未执行：${(error as Error).message}`);}
          messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
        }
        if(signal.aborted){while(messages.at(-1)?.role==='tool')messages.pop();const last=messages.at(-1);if(last?.tool_calls){delete last.tool_calls;last.content=(last.content||'')+'\n[工具阶段已中断，后续恢复前需要核对。]';}break;}
      }
    }catch(error){if(!signal.aborted)throw error;ctx.emit('warning','本地请求已取消；服务端是否继续生成或计费未知');}
    finally{await writeFile(historyFile,JSON.stringify(redact(forHistory(messages))),'utf8');}
    return {stopped:this.stopped,usage,summary:this.stopped?'已停止；部分产物待核对':'已结束，待验收'};
    } finally { this.controller=undefined; await this.dispatcher?.destroy(); this.dispatcher=undefined; }
  }
  async stop(){this.stopped=true;this.controller?.abort();}
}

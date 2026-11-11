// Local, provider-neutral operation tools. No secrets are written to arguments or responses.
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import {createInterface} from 'node:readline';
const controllers=new Map();
/** MCP content for one tool result: screenshots and PDF pages go out as image blocks, everything else as text. */
function toolContent(result){
  if(result?.image)return [{type:'image',mimeType:'image/png',data:result.image},{type:'text',text:JSON.stringify({...result,image:undefined})}];
  if(Array.isArray(result?.images)&&result.images.length){
    const {images,...rest}=result;
    return [{type:'text',text:JSON.stringify({...rest,images:images.map(({page,width,height})=>({page,width,height}))})},...images.map(item=>({type:'image',mimeType:'image/png',data:item.data}))];
  }
  return [{type:'text',text:typeof result==='string'?result:JSON.stringify(result)}];
}
function call(name,args={},signal){
  const url=process.env.HIVELAB_CONTROL_URL,token=process.env.HIVELAB_CONTROL_TOKEN;
  if(!url||!token)throw Error('请在 HiveLab 合屋 发起的成员任务中使用此工具。');
  const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1'||parsed.protocol!=='http:')throw Error('工具地址无效。');
  return new Promise((resolve,reject)=>{
    const request=http.request(parsed,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal},response=>{
      const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024){request.destroy(Error('工具响应过大'));return;}chunks.push(chunk);});
      response.on('end',()=>{try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(response.statusCode!==200)throw Error(result.error??'操作失败');resolve(result);}catch(e){reject(e);}});response.on('error',reject);
    });request.on('error',reject);if(!['ask_user','computer','desktop','create_file','edit_file','read_file','subagent_wait','subagent_stop'].includes(name)&&!name.startsWith('ext_'))request.setTimeout(30000,()=>request.destroy(Error('工具响应超时')));request.end(JSON.stringify({name,arguments:args}));
  });
}
const [name='list',file]=process.argv.slice(2);
if(name==='--mcp'){
  const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
  createInterface({input:process.stdin}).on('close',()=>{for(const controller of controllers.values())controller.abort();}).on('line',line=>{void(async()=>{
    let message;try{if(line.length>3*1024*1024)throw Error('请求过大');message=JSON.parse(line);if(message.method==='notifications/cancelled'){controllers.get(message.params?.requestId)?.abort();return;}if(message.id===undefined)return;
      let result;if(message.method==='initialize')result={protocolVersion:message.params?.protocolVersion??'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'hivelab',version:'1.0.0'}};
      else if(message.method==='ping')result={};
      else if(message.method==='tools/list'){const data=await call('list');result={tools:data.tools.map(tool=>({...tool,inputSchema:tool.inputSchema??{type:'object',additionalProperties:true}}))};}
      else if(message.method==='tools/call'){const controller=new AbortController();controllers.set(message.id,controller);try{const data=await call(message.params.name,message.params.arguments??{},controller.signal);result={content:toolContent(data.result)};}catch(error){result={content:[{type:'text',text:error.message}],isError:true};}finally{controllers.delete(message.id);}}
      else{send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Unsupported method'}});return;}
      send({jsonrpc:'2.0',id:message.id,result});
    }catch(error){if(message?.id!==undefined)send({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:error.message}});}
  })();});
}else try{const args=file?JSON.parse(await readFile(file,'utf8')):{};const result=await call(name,args);process.stdout.write(JSON.stringify(result,null,2)+'\n');}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}

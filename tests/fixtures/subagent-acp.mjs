// Offline ACP agent for subagent tests: the main turn sends a subagent over the HiveLab MCP bridge and reports
// what the subagent received; a subagent turn echoes whether its prompt carried any HiveLab member brief.
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
const send=packet=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...packet})+'\n');
let bridge,serialSession=0,serialAsk=0;const asks=new Map();
const ask=(sessionId,kind,title)=>new Promise(resolve=>{const id='ask-'+(++serialAsk);asks.set(id,resolve);send({id,method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:id,title,kind,rawInput:{command:title}},options:[{optionId:'allow',name:'Allow',kind:'allow_once'},{optionId:'deny',name:'Deny',kind:'reject_once'}]}});});
async function withBridge(work){
  if(!bridge)throw Error('ACP session did not receive the HiveLab MCP bridge');
  const child=spawn(bridge.command,bridge.args,{env:{...process.env,...Object.fromEntries(bridge.env.map(item=>[item.name,item.value]))},stdio:['pipe','pipe','pipe'],windowsHide:true});
  const pending=new Map();let serial=0;
  createInterface({input:child.stdout}).on('line',line=>{const packet=JSON.parse(line),p=pending.get(packet.id);if(p){pending.delete(packet.id);packet.error?p.reject(Error(packet.error.message)):p.resolve(packet.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  const tool=async(name,args)=>{const result=await call('tools/call',{name,arguments:args});const text=result.content?.find(item=>item.type==='text')?.text??'';if(result.isError)throw Error(text);return JSON.parse(text);};
  try{await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'offline-subagent-agent',version:'1'}});return await work(call,tool);}
  finally{child.stdin.end();child.kill();}
}
const text=prompt=>(prompt??[]).filter(item=>item.type==='text').map(item=>item.text).join('\n');
createInterface({input:process.stdin}).on('line',async line=>{
  const packet=JSON.parse(line);if(packet.id===undefined)return;
  if(!packet.method){asks.get(packet.id)?.(packet.result?.outcome?.optionId??'cancelled');asks.delete(packet.id);return;}
  try{
    let result={};
    if(packet.method==='initialize')result={protocolVersion:1,agentInfo:{name:'Offline subagent agent',version:'1'},agentCapabilities:{loadSession:false}};
    else if(packet.method==='session/new'){bridge=packet.params.mcpServers.find(server=>server.name==='hivelab');result={sessionId:'offline-'+(++serialSession)};}
    else if(packet.method==='session/prompt'){
      const prompt=text(packet.params.prompt);let reply='';
      if(prompt.startsWith('[HiveLab 合屋 子代理]')){const look=await ask(packet.params.sessionId,'execute','Get-ChildItem'),change=await ask(packet.params.sessionId,'edit','write a.txt'),again=await ask(packet.params.sessionId,'execute','dir /a');reply=`cmd=${look} edit=${change} again=${again} `;}
      if(prompt.startsWith('[HiveLab 合屋 子代理]'))reply+=`SUB brief=${/You are a member of HiveLab/.test(prompt)?'member':'clean'} card=${/人设|人物与记忆/.test(prompt)?'yes':'no'} task=${/数一数/.test(prompt)?'ok':'missing'}`;
      else reply=await withBridge(async(call,tool)=>{
        const {tools}=await call('tools/list');if(!tools.some(t=>t.name==='subagent_start'))return 'MAIN no subagent tools';
        const models=await tool('subagent_models',{});
        const started=await tool('subagent_start',{task:'数一数当前文件夹的文件',model:models.models[0]?.id});
        const waited=await tool('subagent_wait',{ids:[started.id],seconds:50});
        return `MAIN models=${models.models.map(m=>m.id).join('|')} status=${waited.subagents[0]?.status} result=${waited.subagents[0]?.result}`;
      });
      send({method:'session/update',params:{sessionId:packet.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:reply}}}});
      result={stopReason:'end_turn'};
    }
    send({id:packet.id,result});
  }catch(error){send({id:packet.id,error:{code:-32603,message:String(error?.message??error)}});}
});

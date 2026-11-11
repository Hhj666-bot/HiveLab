import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
const send=packet=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...packet})+'\n');let bridge;
async function openBrowser(){
 if(!bridge)throw Error('ACP session did not receive the HiveLab MCP bridge');
 const child=spawn(bridge.command,bridge.args,{env:{...process.env,...Object.fromEntries(bridge.env.map(item=>[item.name,item.value]))},stdio:['pipe','pipe','pipe'],windowsHide:true});
 const pending=new Map();let serial=0;
 createInterface({input:child.stdout}).on('line',line=>{const packet=JSON.parse(line),p=pending.get(packet.id);if(p){pending.delete(packet.id);packet.error?p.reject(Error(packet.error.message)):p.resolve(packet.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 try{
  await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'offline-browser-agent',version:'1'}});
  const {tools}=await call('tools/list');if(!tools.some(tool=>tool.name==='open_browser'))throw Error('open_browser is missing from the MCP tool list');
  const result=await call('tools/call',{name:'open_browser',arguments:{url:process.env.HIVELAB_BROWSER_TEST_URL}});
  if(result.isError)throw Error(result.content[0].text);
  return JSON.parse(result.content.find(item=>item.type==='text').text);
 }finally{child.stdin.end();child.kill();}
}
createInterface({input:process.stdin}).on('line',async line=>{
 const packet=JSON.parse(line);if(packet.id===undefined)return;
 try{
  let result={};
  if(packet.method==='initialize')result={protocolVersion:1,agentInfo:{name:'Offline browser agent',version:'1'},agentCapabilities:{loadSession:true}};
  else if(['session/new','session/load','session/resume'].includes(packet.method)){bridge=packet.params.mcpServers.find(server=>server.name==='hivelab');result={sessionId:packet.params.sessionId??'offline-sidebar-browser'};}
  else if(packet.method==='session/prompt'){
   const state=await openBrowser();if(!state.shown)throw Error('The application did not show its browser');
   send({method:'session/update',params:{sessionId:packet.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Agent opened sidebar: '+state.url}}}});result={stopReason:'end_turn'};
  }
  send({id:packet.id,result});
 }catch(error){send({id:packet.id,error:{code:-32603,message:error.message}});}
});

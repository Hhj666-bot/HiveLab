import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const alias='__kimi_env_model__';let thinking='on';
let awaitingApproval;
const send=packet=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...packet})+'\n');
const config=()=>[{id:'model',name:'Model',category:'model',type:'select',currentValue:alias,options:[{value:alias,name:process.env.KIMI_MODEL_NAME}]},{id:'thinking',name:'Thinking',category:'thought_level',type:'select',currentValue:thinking,options:[{value:'on',name:'On'},{value:'off',name:'Off'}]}];
createInterface({input:process.stdin}).on('line',line=>{
 const packet=JSON.parse(line);if(packet.id===undefined)return;
 if(packet.id==='offline-approval'&&awaitingApproval){const pending=awaitingApproval;awaitingApproval=undefined;send({method:'session/update',params:{sessionId:pending.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Offline approval handled'}}}});send({id:pending.id,result:{stopReason:'end_turn'}});return;}
 let result={};
 if(packet.method==='initialize')result={protocolVersion:1,agentInfo:{name:'Kimi offline fixture',version:'2.1.1-fixture'},agentCapabilities:{loadSession:true,promptCapabilities:{image:false}}};
 else if(['session/new','session/load','session/resume'].includes(packet.method))result={sessionId:packet.params.sessionId??'mock-native-api',configOptions:config()};
 else if(packet.method==='session/set_config_option'){if(packet.params.configId==='thinking')thinking=packet.params.value;else if(packet.params.value!==alias)throw Error('Native API model must use the environment alias');result={configOptions:config()};}
 else if(packet.method==='session/prompt'){
   const text=JSON.stringify(packet.params.prompt);
   if(text.includes('__error_notice__')){send({id:packet.id,error:{code:-32603,message:'Offline fixture failure'}});return;}
   if(text.includes('__approval_notice__')){awaitingApproval={id:packet.id,sessionId:packet.params.sessionId};send({id:'offline-approval',method:'session/request_permission',params:{sessionId:packet.params.sessionId,toolCall:{toolCallId:'offline-command',title:'离线审批测试',kind:'execute'},options:[{optionId:'allow',name:'允许',kind:'allow_once'},{optionId:'deny',name:'拒绝',kind:'reject_once'}]}});return;}
   if(process.env.HIVELAB_MODEL_TEST_LOG)appendFileSync(process.env.HIVELAB_MODEL_TEST_LOG,JSON.stringify({model:process.env.KIMI_MODEL_NAME,sessionId:packet.params.sessionId})+'\n');
   send({method:'session/update',params:{sessionId:packet.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Offline response from '+process.env.KIMI_MODEL_NAME}}}});result={stopReason:'end_turn'};
 }
 send({id:packet.id,result});
});

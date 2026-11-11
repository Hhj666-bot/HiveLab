import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ClaudeAdapter} from '../src/backend/adapters/claude';

const send='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',session='33333333-3333-4333-8333-333333333333';
const stream=(event:unknown,user_message_uuid?:string)=>({type:'stream_event',event,session_id:session,parent_tool_use_id:null,...(user_message_uuid?{user_message_uuid}:{})});
const assistant=(id:string,content:unknown[],user_message_uuid?:string)=>({type:'assistant',message:{id,content},session_id:session,parent_tool_use_id:null,...(user_message_uuid?{user_message_uuid}:{})});
const text=(value:string)=>stream({type:'content_block_delta',index:0,delta:{type:'text_delta',text:value}});
const result={type:'result',subtype:'success',is_error:false,result:'好',session_id:session,user_message_uuid:send,user_message_uuids:[send]};

/** A warm process on a later turn: the only state in which an unattributed frame is refused. */
function warmTurn(){
 const adapter=new ClaudeAdapter() as any,events:{kind:string;text:string}[]=[];
 Object.assign(adapter,{inputUuid:send,strictTurn:true,acknowledged:true,reusable:true,nativeSessionId:session,context:{settings:{efforts:{}},emit:(kind:string,text:string)=>events.push({kind,text}),markDelivery(){},recordRuntime(){}}});
 return {adapter,events,warnings:()=>events.filter(item=>item.kind==='warning')};
}

test('A warm turn keeps the reply that follows a tool, which Claude leaves unstamped',()=>{
 const {adapter,events,warnings}=warmTurn();
 adapter.event(stream({type:'message_start',message:{id:'msg_1'}},send));
 adapter.event(stream({type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool_1',name:'Bash'}}));
 adapter.event(assistant('msg_1',[{type:'tool_use',id:'tool_1',name:'Bash',input:{}}],send));
 adapter.event({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool_1',content:'06:08'}]},session_id:session,parent_tool_use_id:null});
 adapter.event(stream({type:'message_start',message:{id:'msg_2'}}));
 adapter.event(text('现在是早上六点。'));
 adapter.event(stream({type:'message_stop'}));
 adapter.event(assistant('msg_2',[{type:'text',text:'现在是早上六点。'}]));
 adapter.event(result);
 assert.deepEqual(warnings(),[]);
 assert.equal(adapter.malformed,false);
 assert.equal(adapter.correlated,true);
 assert.equal(adapter.streamCorrelation,true);
 assert.equal(adapter.matchedAssistantMessages,2);
 assert.ok(events.some(item=>item.kind==='delta'&&item.text==='现在是早上六点。'));
});

test('A reply frame arriving before this turn is stamped is still refused',()=>{
 const {adapter,warnings}=warmTurn();
 adapter.event(text('上一轮的残留'));
 assert.equal(warnings().length,1);
 assert.equal(adapter.malformed,true);
 assert.equal(adapter.reusable,false);
});

test('Frames continuing another send are dropped rather than shown as this turn',()=>{
 const {adapter,events,warnings}=warmTurn();
 adapter.event(stream({type:'message_start',message:{id:'msg_1'}},send));
 adapter.event(stream({type:'message_start',message:{id:'msg_2'}},other));
 adapter.event(text('别的消息'));
 adapter.event(assistant('msg_2',[{type:'text',text:'别的消息'}]));
 assert.deepEqual(warnings(),[]);
 assert.equal(events.some(item=>item.text==='别的消息'),false);
});

test('An unstamped result never closes a warm turn',()=>{
 const {adapter,warnings}=warmTurn();
 adapter.event(stream({type:'message_start',message:{id:'msg_1'}},send));
 adapter.event({...result,user_message_uuid:undefined,user_message_uuids:undefined});
 assert.equal(warnings().length,1);
 assert.equal(adapter.result,undefined);
});

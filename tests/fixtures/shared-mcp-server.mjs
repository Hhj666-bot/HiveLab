import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});
let calls=0;
for await(const line of lines){
 const message=JSON.parse(line);if(message.id===undefined)continue;
 const respond=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n');
 if(message.method==='initialize')respond({protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'portable-mcp-fixture',version:'1.0.0'}});
 else if(message.method==='tools/list')respond({tools:message.params?.cursor?[{name:'failure',description:'Return an MCP tool error',inputSchema:{type:'object',properties:{}}}]:[{name:'echo',description:'Echo a value',inputSchema:{type:'object',properties:{value:{type:'string'}}}}],...(message.params?.cursor?{}:{nextCursor:'second-page'})});
 else if(message.method==='tools/call'){
  if(message.params.name==='failure')respond({isError:true,content:[{type:'text',text:'intentional fixture failure'}]});
  else respond({content:[{type:'text',text:JSON.stringify({value:message.params.arguments.value,parentProviderKey:process.env.OPENAI_API_KEY??null,pid:process.pid,calls:++calls})}]});
 }else process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Unknown method'}})+'\n');
}

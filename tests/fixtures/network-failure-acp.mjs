import {createInterface} from 'node:readline';
// Mirrors Antigravity's ACP server when the proxy exit drops the TLS handshake:
// the traceback goes to stderr and the RPC reply is a bare "Internal error".
const mode=process.env.HIVELAB_NETWORK_FIXTURE??'ssl-eof';
const send=packet=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...packet})+'\n');
const traceback=mode==='plain'
  ?'E1107 21:07:15.926246 49376 connection.py:237] Unhandled error while handling request\r\nValueError: unexpected session state\r\n'
  :['E1107 21:07:15.923725 49376 ccpa_client.py:267] fetchAvailableModels failed','Traceback (most recent call last):','  File "google_auth_httplib2\\__init__.py", line 214, in request','  File "httplib2\\__init__.py", line 1179, in connect','  File "ssl.py", line 1341, in do_handshake','ssl.SSLEOFError: EOF occurred in violation of protocol (_ssl.c:997)','google3.cloud.developer_experience.antigravity_extensions.acp_server.ccpa_connection.ccpa_client.CCPAConnectionError: fetchAvailableModels failed: EOF occurred in violation of protocol (_ssl.c:997)',''].join('\r\n');
createInterface({input:process.stdin}).on('line',line=>{
  const packet=JSON.parse(line);if(packet.id===undefined)return;
  if(packet.method==='initialize'){send({id:packet.id,result:{protocolVersion:1,agentInfo:{name:'Network failure fixture',version:'0.0.1-fixture'},agentCapabilities:{sessionCapabilities:{resume:{}},promptCapabilities:{image:false}}}});return;}
  if(['session/new','session/resume'].includes(packet.method)){process.stderr.write(traceback,()=>send({id:packet.id,error:{code:-32603,message:'Internal error'}}));return;}
  send({id:packet.id,error:{code:-32601,message:'Method not found'}});
});

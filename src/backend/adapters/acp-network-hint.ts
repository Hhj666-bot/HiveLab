/**
 * ACP programs often answer a failed request with a bare JSON-RPC "Internal error"
 * while the real cause is a network traceback on stderr. Recognize the common
 * transport failures so the member card shows what actually broke.
 */
const RULES:{pattern:RegExp;what:string}[]=[
  {pattern:/SSLEOFError|EOF occurred in violation of protocol|UNEXPECTED_EOF_WHILE_READING|unexpected eof while reading/i,what:'TLS 握手被中断（连接在加密握手完成前就被断开）'},
  {pattern:/ConnectionResetError|Connection reset by peer|forcibly closed by the remote host|WinError 10054|ECONNRESET/i,what:'连接被重置'},
  {pattern:/ConnectTimeout|ConnectTimeoutError|Max retries exceeded.*timed out|WinError 10060|socket\.timeout|TimeoutError: timed out|ETIMEDOUT/i,what:'连接超时'},
  {pattern:/ConnectionRefusedError|WinError 10061|ECONNREFUSED/i,what:'连接被拒绝'},
  {pattern:/ProxyError|Tunnel connection failed|Unable to connect to proxy/i,what:'代理连接失败'},
];

function service(stderr:string,catalogId?:string){
  const host=stderr.match(/\b((?:[a-z0-9-]+\.)+googleapis\.com)\b/i)?.[1];
  if(host)return ` Google 服务（${host}）`;
  if(catalogId==='antigravity'||/CCPA|cloudcode|google_auth|googleapiclient/i.test(stderr))return ' Google 服务';
  return '服务端';
}

/** Chinese explanation for a transport failure found in this turn's stderr, or undefined. */
export function acpNetworkHint(stderr:string,catalogId?:string):string|undefined{
  const rule=RULES.find(item=>item.pattern.test(stderr));
  if(!rule)return undefined;
  const proxy=rule.what==='代理连接失败'?'请确认 HiveLab 合屋 设置里的代理地址可用':'通常是代理节点或 TUN 出口不稳定、超时，而不是登录失效';
  return `连接${service(stderr,catalogId)}时，${rule.what}。${proxy}；请在代理软件里检查或更换这个域名使用的节点后重试。原始报错保留在活动记录中。`;
}

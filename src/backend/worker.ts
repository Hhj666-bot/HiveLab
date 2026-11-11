import {randomUUID} from 'node:crypto';
import {SnapshotPublisher} from '../shared/snapshot-sync';
import type {PushEvent,Snapshot} from '../shared/types';
import { Engine } from './engine';
import { createWorkerLifecycle } from './worker-lifecycle';
import { setOwnershipListener } from './process-supervisor';
import { redact, registerSecret } from './security';
import { setClaudeOAuthToken, setClaudeApiKey } from './adapters/claude';
/** The saved Claude token goes to the Claude adapter only (never process.env), redacted from every log. */
const claudeToken = (value?: string) => { if (value) registerSecret(value); setClaudeOAuthToken(value); };
let engine: Engine | undefined;
let port: any;
const send = (value: unknown) => port?.postMessage(value);
const lifecycle=createWorkerLifecycle({close:async()=>{await engine?.close();},fatal:error=>send({type:'fatal',error:redact(error instanceof Error?error.message:String(error))}),exit:code=>process.exit(code)});
const hostPending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
function hostOperation(method:string,params:unknown){return new Promise<any>((resolve,reject)=>{const id='host:'+randomUUID(),timer=setTimeout(()=>{hostPending.delete(id);reject(Error('桌面操作服务响应超时'));},120000);hostPending.set(id,{resolve,reject,timer});send({type:'host-request',id,method,params});});}
const snapshots=new SnapshotPublisher(randomUUID());
function publish(event:PushEvent){const next=event.type==='snapshot'?snapshots.publish(event.snapshot):event;if(next)send({type:'push',event:next});}
function currentSnapshot(){publish({type:'snapshot',snapshot:engine!.snapshot()});return snapshots.current!;}
setOwnershipListener(info => send({ type: 'ownership', info }));
(process as any).parentPort.on('message', (event: any) => {
  if (event.data?.type !== 'connect' || !event.ports?.[0] || port) return;
  port = event.ports[0];
  engine = new Engine(event.data.dataDirectory, publish, () => {},undefined,{hostOperation});
  engine.setKey(event.data.key || undefined);
  engine.setAcpSecrets(event.data.acpSecrets || {});
  claudeToken(event.data.claudeToken || undefined);
  if(event.data.claudeApiKey)registerSecret(event.data.claudeApiKey);setClaudeApiKey(event.data.claudeApiKey||undefined);
  port.on('message', async (message: any) => {
    const packet = message.data;
    if(packet?.type==='host-result'){const item=hostPending.get(packet.id);if(item){clearTimeout(item.timer);hostPending.delete(packet.id);packet.error?item.reject(Error(packet.error)):item.resolve(packet.result);}return;}
    if (!packet?.id || typeof packet.method !== 'string') return;
    try {
      if (lifecycle.closing) throw new Error('执行服务正在关闭，不再接收新操作');
      if(packet.method==='internal.claudeApiKey'){if(packet.params?.value)registerSecret(packet.params.value);setClaudeApiKey(packet.params?.value||undefined);engine!.broadcast();send({id:packet.id,result:true});return;}
      if (packet.method === 'internal.claudeToken') { claudeToken(packet.params?.value || undefined); engine!.broadcast(); send({ id: packet.id, result: true }); return; }
      if (packet.method === 'internal.key') { engine!.setKey(packet.params?.value || undefined); send({ id: packet.id, result: true }); return; }
      if (packet.method === 'internal.close') { await lifecycle.close(); send({ id: packet.id, result: true }); if(!lifecycle.failing)process.exit(0); return; }
      send({ id: packet.id, result: packet.method==='snapshot'?currentSnapshot():await engine!.invoke(packet.method, packet.params) });
    } catch (error) { const message=redact(error instanceof Error ? error.message : String(error));if(packet.method.startsWith('projectFlow.'))send({id:packet.id,result:{__hivelabFlowError:{code:(error as {code?:string}).code??'FLOW_ERROR',message}}});else send({ id: packet.id, error: message }); }
  });
  port.start();
  currentSnapshot();
  send({ type: 'ready' });
  engine.startAccountRefresh();
  engine.startUpdateChecks();
  lifecycle.track(engine.probe());
});
process.on('uncaughtException', error => { process.exitCode=1;void lifecycle.fail(error); });
process.on('unhandledRejection', error => { process.exitCode=1;void lifecycle.fail(error); });

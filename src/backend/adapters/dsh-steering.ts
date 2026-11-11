import { createConnection } from 'node:net';

/** One attempt only: after writing, a missing receipt is unknown, never safe to replay. */
export function sendDshSteering(pipe: string, sessionId: string, turn: number, text: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipe);
    let written = false, reply = '', settled = false;
    const finish = (error?: Error, accepted = false) => {
      if(settled)return;settled=true;socket.destroy();error?reject(error):resolve(accepted);
    };
    socket.setTimeout(8000, () => finish(new Error('DSH 补充投递确认超时，未重复发送')));
    socket.once('connect', () => { written=true;socket.write(JSON.stringify({sessionId,turn,text})+'\n'); });
    socket.on('data', chunk => {
      reply+=String(chunk);
      if(reply.length>4096){finish(new Error('DSH 补充回执无效'));return;}
      if(!reply.includes('\n'))return;
      try { const result=JSON.parse(reply.trim());if(typeof result.accepted!=='boolean')throw Error();finish(undefined,result.accepted); }
      catch { finish(new Error('DSH 补充回执无效，未重复发送')); }
    });
    socket.once('error', error => {
      if(!written&&['ENOENT','ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code??''))finish();
      else finish(error);
    });
    socket.once('end', () => {if(!settled)finish(new Error('DSH 没有确认补充是否送达，未重复发送'));});
  });
}

/** Serialized into the existing policy plugin. Uses DSH's documented Agent.steer API. */
export const DSH_STEERING_SOURCE = `
  if (config.steeringPipe && config.steeringMessageModule) {
    const net = await import('node:net');
    const {createUserMessage} = await import(config.steeringMessageModule);
    const agents = new Map(), turns = new Map();
    ctx.on('agent/created', ({agent}) => {
      const id = agent.session?.header?.id;
      if (typeof id === 'string' && typeof agent.steer === 'function') {
        agents.set(id, agent);
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'hivelab/steeringReady',params:{sessionId:id}})+'\\n');
      }
    });
    ctx.on('session/event', (session,event) => {
      const id=session.header?.id;
      if(event.type==='turn/start')turns.set(id,event.data.turn);
      if(event.type==='turn/end')turns.delete(id);
    });
    const server=net.createServer(socket=>{
      let input='';
      socket.setEncoding('utf8');socket.setTimeout(5000,()=>socket.destroy());socket.on('error',()=>{});
      socket.on('data',chunk=>{
        input+=chunk;if(input.length>1_000_000){socket.destroy();return;}
        if(!input.includes('\\n'))return;
        socket.removeAllListeners('data');
        try {
          const request=JSON.parse(input.trim()),agent=agents.get(request.sessionId);
          if(!agent||turns.get(request.sessionId)!==request.turn||!Number.isInteger(request.turn)||typeof request.text!=='string'||!request.text.trim()||request.text.length>200000){socket.end(JSON.stringify({accepted:false})+'\\n');return;}
          agent.steer(createUserMessage({content:[{type:'text',text:request.text}],source:{kind:'user'}}));
          socket.end(JSON.stringify({accepted:true})+'\\n');
        } catch { socket.destroy(); }
      });
    });
    server.on('error',()=>{});server.listen(config.steeringPipe);server.unref();
    ctx.on('dispose',()=>{agents.clear();turns.clear();server.close();});
  }
`;

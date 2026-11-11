import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';

/**
 * ZCode 3.14.5 has no per-run --mcp-config. Its MCP servers come only from
 * `<homedir>/.zcode/cli/config.json` (`mcp.servers`) or project config files,
 * and stdio servers inherit the CLI's environment (minus proxy/telemetry keys).
 * HiveLab therefore writes a token-free `hivelab` entry into the member's own
 * home for the duration of a run; the loopback URL and token reach the helper
 * only through the inherited environment and are never written to disk.
 */
export const ZCODE_HIVELAB_SERVER='hivelab';
// ZCode uses one timeoutMs for connecting and for every call (default 30 s).
// ask_user and subagent_wait may legitimately wait for a long time.
const TOOL_TIMEOUT_MS=86_400_000;

type Json=Record<string,any>;
type Server={type:'stdio';command:string;args:string[];env:Record<string,string>;timeoutMs:number};

export function zcodeUserConfigPath(home:string){return path.join(home,'.zcode','cli','config.json');}

/** The server entry for this run, or undefined when the run has no tool bridge credentials. */
export function zcodeHivelabServer(env:NodeJS.ProcessEnv):Server|undefined{
  if(!env.HIVELAB_CONTROL_HELPER||!env.HIVELAB_CONTROL_NODE||!env.HIVELAB_CONTROL_URL||!env.HIVELAB_CONTROL_TOKEN)return undefined;
  return {type:'stdio',command:env.HIVELAB_CONTROL_NODE,args:[env.HIVELAB_CONTROL_HELPER,'--mcp'],env:{ELECTRON_RUN_AS_NODE:'1'},timeoutMs:TOOL_TIMEOUT_MS};
}

const record=(value:unknown):value is Json=>typeof value==='object'&&value!==null&&!Array.isArray(value);
// ZCode's server schema is strict, so ownership is recognised by the helper invocation, not by a marker field.
const ours=(value:unknown)=>record(value)&&Array.isArray(value.args)&&value.args.length===2&&value.args[1]==='--mcp'&&/hivelab-tools\.mjs$/i.test(String(value.args[0]));

export function withHivelabServer(config:Json,server:Server):Json|undefined{
  const mcp=record(config.mcp)?config.mcp:{},servers=record(mcp.servers)?mcp.servers:{};
  const current=servers[ZCODE_HIVELAB_SERVER];
  if(current!==undefined&&!ours(current))throw Error(`ZCode 配置里已有同名 MCP 服务器“${ZCODE_HIVELAB_SERVER}”，HiveLab 不会覆盖`);
  if(JSON.stringify(current)===JSON.stringify(server))return undefined;
  return {...config,mcp:{...mcp,servers:{...servers,[ZCODE_HIVELAB_SERVER]:server}}};
}

export function withoutHivelabServer(config:Json):Json|undefined{
  if(!record(config.mcp)||!record(config.mcp.servers)||!ours(config.mcp.servers[ZCODE_HIVELAB_SERVER]))return undefined;
  const {[ZCODE_HIVELAB_SERVER]:_,...servers}=config.mcp.servers;
  const {servers:__,...mcp}=config.mcp;
  const nextMcp=Object.keys(servers).length?{...mcp,servers}:mcp;
  const {mcp:___,...rest}=config;
  return Object.keys(nextMcp).length?{...rest,mcp:nextMcp}:rest;
}

const queues=new Map<string,Promise<unknown>>();
const holders=new Map<string,number>();
function serial<T>(file:string,task:()=>Promise<T>):Promise<T>{
  const next=(queues.get(file)??Promise.resolve()).then(task,task);
  queues.set(file,next.catch(()=>undefined));
  return next;
}

async function update(file:string,change:(config:Json)=>Json|undefined){
  let raw:string|undefined;
  try{raw=await readFile(file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const config=raw===undefined||!raw.trim()?{}:JSON.parse(raw.replace(/^﻿/,''));
  if(!record(config))throw Error('ZCode 配置文件不是 JSON 对象');
  const next=change(config);if(!next)return;
  await mkdir(path.dirname(file),{recursive:true});
  const temp=`${file}.hivelab-${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temp,JSON.stringify(next,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
  try{
    // ZCode may be reading the file at that moment; Windows then refuses the replace briefly.
    for(let attempt=0;;attempt++){
      try{await rename(temp,file);return;}
      catch(error){if(attempt>=5||!['EPERM','EBUSY','EACCES'].includes((error as NodeJS.ErrnoException).code??''))throw error;await new Promise(resolve=>setTimeout(resolve,50*(attempt+1)));}
    }
  }finally{await rm(temp,{force:true});}
}

export type ZcodeHivelabBridge={file:string;release:()=>Promise<void>};

/**
 * Enable the HiveLab tool bridge for one ZCode run. Concurrent runs of the same
 * member share the entry; the last one to finish removes it again.
 */
export async function attachZcodeHivelab(home:string,env:NodeJS.ProcessEnv):Promise<ZcodeHivelabBridge|undefined>{
  const server=zcodeHivelabServer(env);if(!server)return undefined;
  const file=zcodeUserConfigPath(home);
  await serial(file,async()=>{await update(file,config=>withHivelabServer(config,server));holders.set(file,(holders.get(file)??0)+1);});
  let released=false;
  return {file,release:()=>{
    if(released)return Promise.resolve();released=true;
    return serial(file,async()=>{
      const left=(holders.get(file)??1)-1;
      if(left>0){holders.set(file,left);return;}
      holders.delete(file);await update(file,withoutHivelabServer);
    });
  }};
}

/** Remove an entry left behind by a crash; never touches one that a live run holds. */
export function clearStaleZcodeHivelab(home:string){
  const file=zcodeUserConfigPath(home);
  return serial(file,async()=>{if(!holders.get(file))await update(file,withoutHivelabServer);});
}

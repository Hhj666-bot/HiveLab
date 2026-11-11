import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {createOwnedTemp,removeOwnedTemp,type OwnedTemp} from './owned-temp';

export interface Ownership { pid:number; ownerPid:number; startedAt:string; command:string; tempDirectory?:string }
const owned=new Map<ChildProcess,Ownership>();
const temporary=new WeakMap<ChildProcess,OwnedTemp>(),cleanups=new WeakMap<ChildProcess,Promise<void>>(),pendingCleanups=new Set<Promise<void>>();
function cleanupTemp(child:ChildProcess){
 const temp=temporary.get(child);if(!temp)return Promise.resolve();
 let pending=cleanups.get(child);if(pending)return pending;
 pending=removeOwnedTemp(temp).catch(error=>{process.emitWarning('进程临时目录暂未清理，下次启动时重试：'+(error as Error).message,{code:'HIVELAB_TEMP_CLEANUP'});});
 cleanups.set(child,pending);pendingCleanups.add(pending);void pending.then(()=>pendingCleanups.delete(pending!));return pending;
}
let listener:((info:Ownership | {pid:number;closed:true})=>void)|undefined;
export function setOwnershipListener(callback:typeof listener):void { listener=callback; }
export function getOwnership(child:ChildProcess):Ownership|undefined { return owned.get(child); }

function helperPath():string {
  const candidates=[process.env.HIVELAB_JOB_HELPER,path.resolve(process.env.HIVELAB_APP_ROOT??process.cwd(),'scripts/windows-job.ps1'),path.resolve(path.dirname(fileURLToPath(import.meta.url)),'windows-job.ps1')].filter(Boolean) as string[];
  const found=candidates.find(candidate=>existsSync(candidate));
  if (!found) throw new Error('缺少 Windows 进程保护组件，拒绝启动没有进程树保护的执行端。');
  return found;
}

export function spawnOwned(command:string,args:string[],options:SpawnOptions & {cwd:string;env:NodeJS.ProcessEnv}):ChildProcess {
  if (!path.isAbsolute(command)) throw new Error('执行端必须使用已核对的绝对路径。');
  if (/\.(?:cmd|bat|ps1)$/i.test(command)) throw new Error('请使用可执行文件或 Node.js 的明确入口，不直接启动命令脚本。');
  const helper=process.platform==='win32'?helperPath():undefined,temp=createOwnedTemp(options.env.HIVELAB_PROCESS_TEMP_ROOT??process.env.HIVELAB_PROCESS_TEMP_ROOT);
  if(temp)options={...options,env:{...options.env,TEMP:temp.directory,TMP:temp.directory,TMPDIR:temp.directory}};
  let child:ChildProcess;
  if (process.platform==='win32') {
    const config=Buffer.from(JSON.stringify({command,args,cwd:options.cwd,parentPid:process.pid}),'utf8').toString('base64');
    const systemRoot=process.env.SystemRoot??'C:\\Windows';
    const powershell=path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    // The spec travels base64-encoded (~1.33x), so a long system prompt such as Claude's
    // persona overflows the 32767-character command line. Above the budget, hand the spec
    // over as a file inside the turn's owned temp directory (removed with the process).
    let specArgs:string[];
    if(config.length>16000){
      const directory=temp?.directory??os.tmpdir();
      try{const file=path.join(directory,`job-config-${process.pid}-${Date.now()}.b64`);writeFileSync(file,config,{encoding:'utf8',flag:'wx'});specArgs=['-ConfigurationFile',file];}
      catch{specArgs=['-Configuration',config];}
    }else specArgs=['-Configuration',config];
    child=spawn(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper!,...specArgs],{...options,shell:false,stdio:['pipe','pipe','pipe'],windowsHide:true});
  } else child=spawn(command,args,{...options,shell:false,stdio:['pipe','pipe','pipe'],detached:true});
  if (child.pid) {
    const metadata={pid:child.pid,ownerPid:process.pid,startedAt:new Date().toISOString(),command,...(temp?{tempDirectory:temp.directory}:{})};
    owned.set(child,metadata); listener?.(metadata);
    child.once('close',()=>{owned.delete(child);listener?.({pid:metadata.pid,closed:true});});
  }
  if(temp){temporary.set(child,temp);child.once('close',()=>{void cleanupTemp(child);});}
  return child;
}

export async function stopOwned(child:ChildProcess,timeoutMs=10000):Promise<void> {
  const ownership=owned.get(child);
  if (!ownership || child.exitCode!==null || child.signalCode!==null) {if(child.exitCode!==null||child.signalCode!==null)await cleanupTemp(child);return;}
  const deadline=Math.max(100,Math.min(timeoutMs,60000));
  await new Promise<void>((resolve,reject)=>{
    let finished=false;
    let forceTimer:ReturnType<typeof setTimeout>|undefined;
    function cleanup() { clearTimeout(timer);clearTimeout(forceTimer);child.removeListener('exit',done);child.removeListener('close',done); }
    // Exit confirms the owned guardian has stopped; close also waits for redirected streams.
    function done() { if (finished) return;finished=true;cleanup();resolve(); }
    child.once('exit',done);
    child.once('close',done);
    const timer=setTimeout(()=>{
      if (finished) return;
      if (child.exitCode!==null || child.signalCode!==null) { done();return; }
      if (process.platform!=='win32') { try { process.kill(-ownership.pid,'SIGKILL'); } catch {} }
      else { try { child.kill('SIGKILL'); } catch {} }
      if(finished)return;
      // Killing is asynchronous: retain the exit listeners for a bounded confirmation window.
      forceTimer=setTimeout(()=>{
        if(finished)return;
        if(child.exitCode!==null||child.signalCode!==null){done();return;}
        finished=true;cleanup();
        reject(new Error(`进程 ${ownership.pid} 停止尚未得到确认，请核对进程状态。`));
      },2000);
    },deadline);
    try {
      if (process.platform==='win32') child.kill(); // Guardian handle closure terminates only its Job.
      else process.kill(-ownership.pid,'SIGTERM');
    } catch(error) { finished=true;cleanup();reject(error); }
  });
  await cleanupTemp(child);
}
export async function disposeOwned():Promise<void> { await Promise.all([...owned.keys()].map(child=>stopOwned(child)));await Promise.all([...pendingCleanups]); }

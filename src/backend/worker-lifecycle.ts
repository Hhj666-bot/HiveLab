/** One shutdown for RPC close, exceptions and detached work. Report fatal only
 * after cleanup: the desktop host terminates the worker upon that message. */
export function createWorkerLifecycle(host:{close:()=>Promise<unknown>;fatal:(error:unknown)=>void;exit:(code:number)=>void}){
  let closing:Promise<void>|undefined,failing=false;
  function close(){
    return closing??=(async()=>{await host.close();})();
  }
  async function fail(error:unknown){
    if(failing)return;
    failing=true;
    try{await close();}
    catch(cleanupError){error=new Error(`${error instanceof Error?error.message:String(error)}；关闭执行服务失败：${cleanupError instanceof Error?cleanupError.message:String(cleanupError)}`);}
    finally{try{host.fatal(error);}finally{host.exit(1);}}
  }
  function track(promise:Promise<unknown>){void promise.catch(error=>fail(error));}
  return {close,fail,track,get closing(){return !!closing;},get failing(){return failing;}};
}

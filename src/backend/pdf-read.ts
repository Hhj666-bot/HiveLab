import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';

export type PdfResult={pageCount:number;pages:{page:number;text:string}[];images:{page:number;width:number;height:number;data:string}[];nextPage?:number};
export const PDF_RENDER_PAGES=4;
// Under the 60-second tool-call limit some executors apply, so the member gets this message rather than a dropped call.
const TIMEOUT=55_000;

/** The thread entry next to this module: dist/pdf-thread.mjs when bundled, the TypeScript source in tests. */
function threadFile(){
 const here=path.dirname(fileURLToPath(import.meta.url));
 for(const name of ['pdf-thread.mjs','pdf-thread.ts'])if(existsSync(path.join(here,name)))return path.join(here,name);
 throw Error('缺少 PDF 读取组件');
}

export function readPdf(bytes:Buffer,options:{pages?:string;render?:boolean;maxChars:number;maxSide?:number}):Promise<PdfResult>{
 return new Promise((resolve,reject)=>{
  const data=new Uint8Array(bytes);
  const worker=new Worker(threadFile(),{workerData:{bytes:data,pages:options.pages,render:options.render===true,maxChars:options.maxChars,maxSide:options.maxSide??1600,maxRender:PDF_RENDER_PAGES},transferList:[data.buffer as ArrayBuffer],resourceLimits:{maxOldGenerationSizeMb:1024}});
  let settled=false;const finish=(fn:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);fn();void worker.terminate();};
  const timer=setTimeout(()=>finish(()=>reject(Error('PDF 处理超过 55 秒，已停止；可以缩小页码范围再试'))),TIMEOUT);
  worker.once('message',(message:{ok:boolean;error?:string}&PdfResult)=>finish(()=>message.ok?resolve(message):reject(Error(message.error||'PDF 读取失败'))));
  worker.once('error',error=>finish(()=>reject(error)));
  worker.once('exit',code=>finish(()=>reject(Error(`PDF 读取组件意外退出（${code}）`))));
 });
}

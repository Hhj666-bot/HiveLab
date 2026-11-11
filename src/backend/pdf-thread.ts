import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parsePages} from './page-range';

/** Runs in its own thread: parsing and drawing a large PDF never stalls the execution service. */
type Job={bytes:Uint8Array;pages?:string;render:boolean;maxChars:number;maxSide:number;maxRender:number};
const job=workerData as Job;
try{
 const require=createRequire(import.meta.url),root=pathToFileURL(path.dirname(require.resolve('pdfjs-dist/package.json'))).href+'/';
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:job.bytes,useSystemFonts:true,cMapUrl:root+'cmaps/',cMapPacked:true,standardFontDataUrl:root+'standard_fonts/',wasmUrl:root+'wasm/',iccUrl:root+'iccs/',verbosity:0}),document=await task.promise;
 const count=document.numPages,wanted=parsePages(job.pages,count,job.render?job.maxRender:Infinity);
 const pages:{page:number;text:string}[]=[],images:{page:number;width:number;height:number;data:string}[]=[];let used=0,nextPage:number|undefined;
 for(const number of wanted){
  const page=await document.getPage(number);
  let text='';for(const item of (await page.getTextContent()).items)if('str' in item)text+=item.str+(item.hasEOL?'\n':'');
  text=text.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if(pages.length&&used+text.length>job.maxChars){nextPage=number;break;}
  used+=text.length;pages.push({page:number,text});
  if(job.render){
   const base=page.getViewport({scale:1}),scale=Math.min(3,job.maxSide/Math.max(base.width,base.height)),viewport=page.getViewport({scale});
   const {canvas}=(document.canvasFactory as {create(width:number,height:number):unknown}).create(Math.ceil(viewport.width),Math.ceil(viewport.height)) as {canvas:any};
   await page.render({canvas,viewport}).promise;
   images.push({page:number,width:canvas.width,height:canvas.height,data:canvas.toBuffer('image/png').toString('base64')});
  }
  page.cleanup();
 }
 await task.destroy();
 parentPort!.postMessage({ok:true,pageCount:count,pages,images,nextPage});
}catch(error){
 const name=(error as {name?:string})?.name;
 parentPort!.postMessage({ok:false,error:name==='PasswordException'?'PDF 已加密，需要密码才能读取':name==='InvalidPDFException'?'不是有效的 PDF 文件':(error as Error)?.message??String(error)});
}

import {randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import type {FileReference} from '../shared/file-preview';

export const PREVIEW_MIME:Record<string,string>={html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',ico:'image/x-icon',svg:'image/svg+xml',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',oga:'audio/ogg',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',opus:'audio/ogg',mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',ogv:'video/ogg',mov:'video/quicktime'};
const CSP="default-src 'none'; script-src 'unsafe-inline' https: hivelab-preview: blob:; style-src 'unsafe-inline' https: hivelab-preview:; img-src https: data: blob: hivelab-preview:; font-src https: data: hivelab-preview:; media-src https: data: blob: hivelab-preview:; connect-src https: hivelab-preview:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";

// URLs contain an opaque capability, never an absolute path. Every request goes
// through the existing file-reference resolver, including its scope/link checks.
export class FilePreviewServer{
 private entries=new Map<string,FileReference>();
 private keys=new Map<string,string>();
 constructor(private resolve:(reference:FileReference)=>Promise<{target:string;name:string}>){ }
 open(reference:FileReference,name:string){
  const key=JSON.stringify(reference);let token=this.keys.get(key);
  if(!token){token=randomUUID();this.keys.set(key,token);this.entries.set(token,{...reference});}
  return `hivelab-preview://${token}/${encodeURIComponent(name)}`;
 }
 async serve(request:Request):Promise<Response>{
  try{
   const url=new URL(request.url),reference=this.entries.get(url.hostname);
   if(!reference||!['GET','HEAD'].includes(request.method))return new Response('not found',{status:404});
   const resource=decodeURIComponent(url.pathname.slice(1));
   const directory=path.posix.dirname((reference.resource??'').replaceAll('\\','/'));
   const {target}=await this.resolve({...reference,resource:directory==='.'?resource:directory+'/'+resource});
   const extension=path.extname(target).slice(1).toLowerCase(),mime=PREVIEW_MIME[extension];
   if(!mime)return new Response('unsupported resource',{status:415});
   const info=await stat(target),limit=mime.startsWith('text/html')?2*1024*1024:20*1024*1024;
   if(!info.isFile()||info.size>limit)return new Response('resource too large or unavailable',{status:413});
   const headers=new Headers({'Content-Type':mime,'Content-Security-Policy':CSP,'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
   // HTML follows the same BOM-aware decoding as the source preview.
   const bytes=await readFile(target);let body:Uint8Array<ArrayBuffer>|string=new Uint8Array(bytes);
   if(mime.startsWith('text/html')){const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8';body=new TextDecoder(encoding).decode(bytes);}
   if(/^(audio|video)\//.test(mime)){
    headers.set('Accept-Ranges','bytes');
    const range=request.headers.get('range');
    if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);const start=match?(match[1]?Number(match[1]):Math.max(0,bytes.length-Number(match[2]))):NaN,end=match?(match[1]?(match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1):bytes.length-1):NaN;
     if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length){headers.set('Content-Range',`bytes */${bytes.length}`);return new Response(null,{status:416,headers});}
     headers.set('Content-Range',`bytes ${start}-${end}/${bytes.length}`);headers.set('Content-Length',String(end-start+1));return new Response(request.method==='HEAD'?null:bytes.subarray(start,end+1),{status:206,headers});
    }
   }
   return new Response(request.method==='HEAD'?null:body,{headers});
  }catch{return new Response('preview resource unavailable',{status:404});}
 }
}

import {copyFile,lstat,mkdir,readFile,readdir,rename,rm,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {resolveSafePath} from '../backend/security';
import type {BackgroundMedia} from '../shared/background';

const ID=/^[a-f0-9-]{36}\.wallpaper$/;
const LIMIT=1024*1024*1024,MAX_FILES=10000;
const contentTypes:Record<string,string>={html:'text/html',htm:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',mp4:'video/mp4',webm:'video/webm',ogg:'audio/ogg',mp3:'audio/mpeg',wav:'audio/wav',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',wasm:'application/wasm'};
// This policy belongs only to the opaque, sandboxed wallpaper frame, never to the workbench.
const CSP="default-src 'none'; script-src hivelab-wallpaper: blob: 'unsafe-inline' 'unsafe-eval'; style-src hivelab-wallpaper: 'unsafe-inline'; img-src hivelab-wallpaper: data: blob:; media-src hivelab-wallpaper: data: blob:; font-src hivelab-wallpaper: data:; connect-src hivelab-wallpaper: blob:; worker-src blob:; frame-src hivelab-wallpaper: blob:; object-src 'none'; base-uri hivelab-wallpaper:; form-action 'none'";

export async function readWallpaperProject(file:string){
  const info=await stat(file);
  if(!info.isFile()||info.size>1024*1024||path.basename(file).toLowerCase()!=='project.json')throw Error('请选择 Wallpaper Engine 壁纸目录里的 project.json。');
  let project:any;try{project=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch{throw Error('壁纸项目说明无法读取。');}
  if(!project||typeof project!=='object'||Array.isArray(project))throw Error('壁纸项目说明格式无效。');
  return {project,type:String(project.type??'').trim().toLowerCase(),root:path.dirname(file)};
}

/** Immutable local project copies, served exclusively inside a sandbox without a preload bridge. */
export class WallpaperLibrary{
  constructor(readonly folder:string,readonly playerDirectory?:string){}
  async importProject(file:string):Promise<BackgroundMedia>{
    const {project,type,root}=await readWallpaperProject(file);
    if(type!=='scene'&&type!=='web')throw Error('当前支持图片、视频、场景和网页壁纸，不支持应用程序壁纸。');
    const entry=resolveSafePath(root,String(project.file??''));
    if(type==='web'&&!/\.html?$/i.test(entry))throw Error('网页壁纸需要 HTML 入口文件。');
    if(type==='scene'&&!/\.(json|pkg)$/i.test(entry))throw Error('场景壁纸需要 scene.json 或 scene.pkg。');
    const entryExists=await stat(entry).then(s=>s.isFile()).catch(()=>false);
    if(!entryExists&&!(type==='scene'&&await stat(path.join(root,'scene.pkg')).then(s=>s.isFile()).catch(()=>false)))throw Error('壁纸资源不完整：请保留 project.json 所在目录及其资源文件。');
    const files:{relative:string;bytes:number}[]=[];let bytes=0;
    const walk=async(relative='')=>{
      for(const item of await readdir(path.join(root,relative),{withFileTypes:true})){
        const name=path.join(relative,item.name),source=resolveSafePath(root,name),info=await lstat(source);
        if(info.isSymbolicLink())throw Error('壁纸目录包含文件链接，请改用完整的本地资源目录。');
        if(info.isDirectory())await walk(name);
        else if(info.isFile()){bytes+=info.size;files.push({relative:name,bytes:info.size});if(bytes>LIMIT||files.length>MAX_FILES)throw Error('壁纸项目请控制在 1 GB、10000 个文件以内。');}
      }
    };
    await walk();await mkdir(this.folder,{recursive:true});
    const id=randomUUID()+'.wallpaper',staging=path.join(this.folder,id+'.tmp'),destination=path.join(this.folder,id);
    try{
      await mkdir(staging);
      for(const item of files){const source=resolveSafePath(root,item.relative);if((await lstat(source)).isSymbolicLink())throw Error('壁纸资源在导入期间发生变化，请重试。');const target=path.join(staging,item.relative);await mkdir(path.dirname(target),{recursive:true});await copyFile(source,target);}
      await rename(staging,destination);
    }catch(error){if(path.dirname(staging)===path.resolve(this.folder))await rm(staging,{recursive:true,force:true});throw error;}
    return {file:id,name:String(project.title??path.basename(root)).slice(0,180),kind:type,source:'wallpaper-engine'};
  }
  async serve(request:Request):Promise<Response>{
    const url=new URL(request.url),headers=new Headers({'Access-Control-Allow-Origin':'*','Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=86400'});
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers});
    try{
      let file:string;
      if(url.hostname==='player'){
        if(url.pathname==='/index.html'){
          const id=url.searchParams.get('source')??'';if(!ID.test(id))return new Response(null,{status:404,headers});
          await stat(path.join(this.folder,id,'project.json'));
          headers.set('Content-Type','text/html; charset=utf-8');
          return new Response(request.method==='HEAD'?null:'<!doctype html><html><meta charset="utf-8"><style>html,body,#wallpaper{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}canvas,iframe,video{display:block;width:100%;height:100%;border:0}</style><div id="wallpaper"></div><script type="module" src="hivelab-wallpaper://player/player.js"></script></html>',{headers});
        }
        if(url.pathname!=='/player.js'||!this.playerDirectory)return new Response(null,{status:404,headers});
        file=path.join(this.playerDirectory,'player.js');
      }else{
        if(!ID.test(url.hostname))return new Response(null,{status:404,headers});
        const relative=decodeURIComponent(url.pathname.slice(1));if(!relative||relative.includes('\\'))return new Response(null,{status:404,headers});
        file=resolveSafePath(path.join(this.folder,url.hostname),relative);
      }
      const info=await stat(file);if(!info.isFile())return new Response(null,{status:404,headers});
      headers.set('Content-Type',contentTypes[path.extname(file).slice(1).toLowerCase()]??'application/octet-stream');
      headers.set('Accept-Ranges','bytes');let start=0,end=info.size-1,status=200;
      const range=request.headers.get('range');if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416,headers});start=Number(match[1]);end=match[2]?Math.min(end,Number(match[2])):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size)return new Response(null,{status:416,headers});status=206;headers.set('Content-Range',`bytes ${start}-${end}/${info.size}`);}
      headers.set('Content-Length',String(Math.max(0,end-start+1)));
      return new Response(request.method==='HEAD'||!info.size?null:Readable.toWeb(createReadStream(file,{start,end})) as ReadableStream,{status,headers});
    }catch{return new Response(null,{status:404,headers});}
  }
}

import {WallpaperLibrary,readWallpaperProject} from './wallpaper-library';
import {copyFile,mkdir,open,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {resolveSafePath} from '../backend/security';
import {backgroundKind,normalizeBackground,defaultBackground,type BackgroundPreferences} from '../shared/background';

export const MEDIA_LIMITS={image:32*1024*1024,video:512*1024*1024};
const mime:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',m4v:'video/mp4'};
/** Main-process only: local display preferences, with a separate bounded media store. */
export class BackgroundLibrary{
  private tail:Promise<unknown>=Promise.resolve();
  readonly wallpapers:WallpaperLibrary;
  constructor(readonly root:string,playerDirectory?:string){this.wallpapers=new WallpaperLibrary(path.join(this.folder,'wallpapers'),playerDirectory);}
  get folder(){return path.join(this.root,'backgrounds');}
  private page(page:string){if(page.length>160||!/^(home|lounge|roundtable|desk:[\w-]+|project:[\w-]+|report:[\w-]+:[\w-]+)$/.test(page))throw Error('背景页面标识无效。');return page;}
  private async document():Promise<Record<string,unknown>>{
    let raw:string;try{raw=await readFile(path.join(this.folder,'preferences.json'),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw error;}
    const saved=JSON.parse(raw);if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('背景配置无法读取，请保留配置文件并检查内容。');
    if(saved.version!==2)return {home:saved};
    if(!saved.pages||typeof saved.pages!=='object'||Array.isArray(saved.pages))throw Error('背景页面配置无法读取。');return saved.pages;
  }
  async get(page='home'):Promise<BackgroundPreferences>{
    const pages=await this.document();this.page(page);return normalizeBackground(Object.hasOwn(pages,page)?pages[page]:defaultBackground(page));
  }
  private serial<T>(action:()=>Promise<T>):Promise<T>{const task=this.tail.then(action,action);this.tail=task.catch(()=>{});return task;}
  private async persist(value:BackgroundPreferences,page='home'){
    const pages=await this.document();this.page(page);if(!(page in pages)&&Object.keys(pages).length>=500)throw Error('背景页面数量超过上限。');pages[page]=value;
    await mkdir(this.folder,{recursive:true});const temp=path.join(this.folder,randomUUID()+'.tmp');
    await writeFile(temp,JSON.stringify({version:2,pages},null,2));await rename(temp,path.join(this.folder,'preferences.json'));return value;
  }
  save(patch:unknown,page='home'){return this.serial(async()=>{
    const old=await this.get(page),p=patch&&typeof patch==='object'?patch as Record<string,unknown>:{};
    // The renderer may adjust presentation; only a native picker can add or replace media.
    return this.persist(normalizeBackground({...old,...Object.fromEntries(['mode','dim','blur','fit','paused','respectReducedMotion','matte','sidebarTransparency','headerTransparency','previewTransparency','terminalTransparency','welcomeCardTransparency'].filter(key=>key in p).map(key=>[key,p[key]])),media:old.media}),page);
  });}
  import(file:string,source:'local'|'wallpaper-engine'='local',name?:string,page='home'){return this.serial(async()=>{
    this.page(page);
    const kind=backgroundKind(file);if(!kind)throw Error('请选择 PNG、JPG、WebP、GIF、MP4、WebM、MOV 或 M4V 文件。');
    const info=await stat(file);if(!info.isFile()||!info.size)throw Error('背景文件为空或不是普通文件。');
    if(info.size>MEDIA_LIMITS[kind])throw Error(kind==='video'?'视频请控制在 512 MB 以内。':'图片请控制在 32 MB 以内。');
    // Reject renamed HTML/executables before registering a file in the media protocol.
    const handle=await open(file,'r'),header=Buffer.alloc(32);try{await handle.read(header,0,32,0);}finally{await handle.close();}
    const ext=path.extname(file).slice(1).toLowerCase();
    const signatures:Record<string,boolean>={png:header.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),jpg:header[0]===255&&header[1]===216,jpeg:header[0]===255&&header[1]===216,webp:header.toString('ascii',0,4)==='RIFF'&&header.toString('ascii',8,12)==='WEBP',gif:/^GIF8[79]a/.test(header.toString('ascii',0,6)),webm:header.subarray(0,4).equals(Buffer.from('1a45dfa3','hex')),mp4:header.toString('ascii',4,8)==='ftyp',m4v:header.toString('ascii',4,8)==='ftyp',mov:['ftyp','moov','mdat','wide'].includes(header.toString('ascii',4,8))};
    if(!signatures[ext])throw Error('文件内容与图片或视频格式不符。');
    await mkdir(this.folder,{recursive:true});const saved=randomUUID()+'.'+ext;
    await copyFile(file,path.join(this.folder,saved));
    const old=await this.get(page);return this.persist({...old,mode:'media',paused:false,media:{file:saved,name:(name??path.basename(file)).slice(0,180),kind,source}},page);
  });}
  async importWallpaper(projectFile:string,page='home'){
    const {project,type}=await readWallpaperProject(projectFile);
    if(type==='scene'||type==='web')return this.serial(async()=>{this.page(page);const media=await this.wallpapers.importProject(projectFile),old=await this.get(page);return this.persist({...old,mode:'media',paused:false,media},page);});
    if(!['video','image'].includes(type))throw Error('当前支持图片、视频、场景和网页壁纸，不支持应用程序壁纸。');
    const media=resolveSafePath(path.dirname(projectFile),String(project.file??''));
    if(backgroundKind(media)!==(type==='video'?'video':'image'))throw Error('壁纸项目指向的媒体类型不匹配。');
    return this.import(media,'wallpaper-engine',String(project.title??path.basename(path.dirname(projectFile))),page);
  }
  /** A frame of the home wallpaper for the startup scene; only the current one is kept. */
  saveFrame(data:unknown,previous?:unknown){return this.serial(async()=>{
    const stale=typeof previous==='string'&&/^[a-f0-9-]{36}\.(webp|jpg)$/i.test(previous)?path.join(this.folder,previous):undefined;
    if(data===undefined){if(stale)await rm(stale,{force:true}).catch(()=>{});return null;}
    if(!(data instanceof Uint8Array)||!data.length||data.length>MEDIA_LIMITS.image)throw Error('启动场景画面无效。');
    const header=Buffer.from(data.buffer,data.byteOffset,Math.min(12,data.length));
    if(header.toString('ascii',0,4)!=='RIFF'||header.toString('ascii',8,12)!=='WEBP')throw Error('启动场景画面格式无效。');
    await mkdir(this.folder,{recursive:true});const file=randomUUID()+'.webp';await writeFile(path.join(this.folder,file),data);
    if(stale)await rm(stale,{force:true}).catch(()=>{});
    return {file};
  });}
  /** Range requests allow large local videos to seek without buffering the complete file. */
  async serve(request:Request):Promise<Response>{
    const name=decodeURIComponent(new URL(request.url).pathname.replace(/^\//,''));
    if(!/^[a-f0-9-]{36}\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v)$/i.test(name))return new Response(null,{status:404});
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
    try{
      const file=path.join(this.folder,name),info=await stat(file),size=info.size;
      if(!info.isFile()||!size)return new Response(null,{status:404});
      const headers=new Headers({'Content-Type':mime[path.extname(name).slice(1).toLowerCase()],'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*','Cache-Control':'private, max-age=86400'});
      let start=0,end=size-1,status=200;const range=request.headers.get('range');
      if(range){
        const match=/^bytes=(\d*)-(\d*)$/.exec(range);
        if(!match||!match[1]&&!match[2])return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
        if(!match[1]){const suffix=Number(match[2]);if(!suffix)return new Response(null,{status:416});start=Math.max(0,size-suffix);}else{start=Number(match[1]);if(match[2])end=Math.min(size-1,Number(match[2]));}
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
        status=206;headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
      }
      headers.set('Content-Length',String(end-start+1));
      return new Response(request.method==='HEAD'?null:Readable.toWeb(createReadStream(file,{start,end})) as ReadableStream,{status,headers});
    }catch{return new Response(null,{status:404});}
  }
}

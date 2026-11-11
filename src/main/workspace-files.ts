import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {open,readdir,readFile,lstat,stat,rename,mkdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {resolveSafePath} from '../backend/security';
import {renameWithWindowsRetry} from '../backend/filesystem';
import type {WorkspaceRoot,WorkspaceText,WorkspaceListing} from '../shared/workspace-files';
import {workspaceFileLocation} from '../shared/workspace-files';

const MAX_TEXT=2*1024*1024;
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
/** User-facing files are scoped to known projects, personal folders, or a folder picked in the native dialog. */
export class WorkspaceFiles {
 private extras:WorkspaceRoot[]=[];
 private tails=new Map<string,Promise<unknown>>();
 constructor(private data:string,private known:()=>WorkspaceRoot[]){
  try{const saved=JSON.parse(readFileSync(path.join(data,'explorer-folders.json'),'utf8'));if(Array.isArray(saved))this.extras=saved.filter(v=>v&&typeof v.directory==='string'&&path.isAbsolute(v.directory)).slice(0,30).map(v=>this.folder(v.directory));}catch{}
 }
 private folder(directory:string):WorkspaceRoot{return {id:'folder:'+hash(Buffer.from(path.resolve(directory).toLowerCase())).slice(0,24),name:path.basename(directory)||directory,directory:path.resolve(directory),kind:'folder'};}
 roots(){
  const ids=new Set<string>(),all=[...this.known(),...this.extras].filter(root=>{if(ids.has(root.id)||!existsSync(root.directory))return false;ids.add(root.id);return true;}),result:WorkspaceRoot[]=[];
  const directoryKey=(directory:string)=>{let real:string;try{real=realpathSync(directory);}catch{real=path.resolve(directory);}return process.platform==='win32'?real.toLowerCase():real;};
  for(const root of all){const personal=root.id.startsWith('desk-current:')?result.find(r=>r.id==='desk:'+root.id.slice('desk-current:'.length)):undefined;if(personal&&directoryKey(personal.directory)===directoryKey(root.directory)){personal.aliases=[...(personal.aliases??[]),root.id];continue;}result.push({...root});}
  return result;
 }
 add(directory:string){const root=this.folder(directory);resolveSafePath(root.directory);this.extras=[root,...this.extras.filter(r=>r.id!==root.id)].slice(0,30);mkdirSync(this.data,{recursive:true});writeFileSync(path.join(this.data,'explorer-folders.json'),JSON.stringify(this.extras));return root;}
 root(id:unknown){const root=this.roots().find(r=>r.id===id||typeof id==='string'&&r.aliases?.includes(id));if(!root)throw Error('工作区已不存在，请重新选择文件夹。');return root;}
 resolve(id:unknown,relative:unknown=''){if(typeof relative!=='string'||relative.length>4096)throw Error('文件路径无效。');const location=workspaceFileLocation(this.roots(),id,relative);return resolveSafePath(location.root.directory,location.path);}
 async list(id:string,relative='',hidden=true):Promise<WorkspaceListing>{
  const root=this.root(id),directory=this.resolve(id,relative),info=await stat(directory);if(!info.isDirectory())throw Error('这不是文件夹。');
  const sessionRoots=root.memberId?this.roots().filter(r=>r.memberId===root.memberId&&r.deskView==='session'):[];
  if(root.deskView==='all'&&!relative)return {entries:sessionRoots.sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??'')).map(r=>({name:r.name+(r.sharedDirectory?' · 共用目录':''),path:'@sessions/'+r.sessionId,kind:'directory',sessionId:r.sessionId,updatedAt:r.updatedAt})),truncated:false};
  const location=workspaceFileLocation(this.roots(),id,relative),personal=this.roots().find(r=>r.id==='desk:'+root.memberId);
  const filterOwned=root.deskView==='legacy'||location.root.sharedDirectory&&personal&&realpathSync(personal.directory)===realpathSync(location.root.directory);
  const items=await readdir(directory,{withFileTypes:true});
  const filtered=items.filter(e=>{
   if(!(hidden||!e.name.startsWith('.'))||e.name.startsWith('.hivelab-save-'))return false;
   if(filterOwned){const target=path.join(directory,e.name).toLowerCase();if(personal&&target===path.join(realpathSync(personal.directory),'shared').toLowerCase()||sessionRoots.some(r=>r.managed!==false&&realpathSync(r.directory).toLowerCase()===target))return false;}
   return true;
  }).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
  return {entries:filtered.slice(0,3000).map(e=>({name:e.name,path:path.posix.join(relative.replaceAll('\\','/'),e.name),kind:e.isSymbolicLink()?'link':e.isDirectory()?'directory':'file'})),truncated:filtered.length>3000};
 }
 async read(id:string,relative:string):Promise<WorkspaceText>{
  if(/\.(?:pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|bmp|ico|zip|7z|rar|exe|dll|mp[34]|webm|mov|woff2?|ttf)$/i.test(relative))throw Error('这种文件请用默认应用编辑。');
  const target=this.resolve(id,relative),info=await stat(target);if(!info.isFile()||info.size>MAX_TEXT)throw Error('内置编辑支持 2 MB 以内的文本文件，请用默认应用打开。');
  const bytes=await readFile(target);let encoding:WorkspaceText['encoding']='utf8',raw=bytes,content:string;
  if(bytes[0]===0xff&&bytes[1]===0xfe){encoding='utf16le';raw=bytes.subarray(2);}
  else if(bytes[0]===0xfe&&bytes[1]===0xff){encoding='utf16be';raw=bytes.subarray(2);}
  else if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf){encoding='utf8bom';raw=bytes.subarray(3);}
  try{content=new TextDecoder(encoding==='utf16be'?'utf-16be':encoding==='utf16le'?'utf-16le':'utf-8',{fatal:true}).decode(raw);}catch{throw Error('此文件不是 UTF-8 / UTF-16 文本，请用默认应用编辑，以保留原编码。');}
  if(content.includes('\0'))throw Error('二进制文件不能作为文本编辑。');
  return {name:path.basename(target),content,version:hash(bytes),encoding};
 }
 private async serial<T>(key:string,operation:()=>Promise<T>){const previous=this.tails.get(key)??Promise.resolve(),next=previous.catch(()=>{}).then(operation);this.tails.set(key,next);try{return await next;}finally{if(this.tails.get(key)===next)this.tails.delete(key);}}
 async save(id:string,relative:string,content:unknown,version:unknown){
  const target=this.resolve(id,relative);
  return this.serial(target.toLowerCase(),async()=>{
   if(typeof content!=='string'||Buffer.byteLength(content)>MAX_TEXT||typeof version!=='string')throw Error('文件内容过大或版本无效。');
   if(!(await lstat(target)).isFile())throw Error('文件已改变，不能保存。');
   const current=await this.read(id,relative);if(current.version!==version)throw Error('文件已在外部修改，未覆盖磁盘内容。请先复制你的修改，再重新载入文件。');
   const encodedContent=current.content.includes('\r\n')&&!/(^|[^\r])\n/.test(current.content)?content.replace(/\r?\n/g,'\r\n'):content;
   let bytes:Buffer;
   if(current.encoding.startsWith('utf16')){const body=Buffer.from(encodedContent,'utf16le');if(current.encoding==='utf16be')body.swap16();bytes=Buffer.concat([Buffer.from(current.encoding==='utf16be'?[0xfe,0xff]:[0xff,0xfe]),body]);}
   else bytes=Buffer.concat([current.encoding==='utf8bom'?Buffer.from([0xef,0xbb,0xbf]):Buffer.alloc(0),Buffer.from(encodedContent,'utf8')]);
   if(bytes.length>MAX_TEXT)throw Error('文件编码后的内容超过 2 MB，请用默认应用编辑。');
   const temporary=path.join(path.dirname(target),'.hivelab-save-'+randomUUID());let made=false;
   try{const file=await open(temporary,'wx',(await stat(target)).mode);made=true;try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    if(this.resolve(id,relative)!==target||hash(await readFile(target))!==version)throw Error('保存前文件再次改变，未覆盖磁盘内容。');
    await renameWithWindowsRetry(temporary,target,{replaceExisting:true});made=false;
   }finally{if(made)await unlink(temporary).catch(()=>{});}
   return {name:current.name,content,encoding:current.encoding,version:hash(bytes)} satisfies WorkspaceText;
  });
 }
 private name(value:unknown){if(typeof value!=='string'||!value||value.length>180||/[\\/:*?"<>|\x00-\x1f]/.test(value)||/[. ]$/.test(value)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)||['.','..'].includes(value))throw Error('文件名无效，请不要使用路径分隔符或系统保留名称。');return value;}
 async create(id:string,parent:string,name:unknown,directory:boolean){const relative=path.posix.join(parent.replaceAll('\\','/'),this.name(name)),target=this.resolve(id,relative);if(directory)await mkdir(target);else{const file=await open(target,'wx');await file.close();}return {path:relative};}
 private protectedDirectory(target:string){const normalized=path.resolve(target).toLowerCase();return this.roots().some(r=>r.deskView==='session'&&(r.directory.toLowerCase()===normalized||r.directory.toLowerCase().startsWith(normalized+path.sep)));}
 async rename(id:string,relative:string,name:unknown){if(!relative||relative==='.')throw Error('不能重命名工作区根目录。');const target=this.resolve(id,relative);if(this.protectedDirectory(target))throw Error('会话目录保持固定；请在聊天中修改会话名称。');const next=path.posix.join(path.posix.dirname(relative.replaceAll('\\','/')),this.name(name)),destination=this.resolve(id,next);if(existsSync(destination))throw Error('同名文件或文件夹已存在。');await rename(target,destination);return {path:next};}
 trashTarget(id:string,relative:string){if(!relative||relative==='.')throw Error('不能移除工作区根目录。');const target=this.resolve(id,relative);if(this.protectedDirectory(target))throw Error('请通过“工位清理”管理会话文件，保留会话目录。');return target;}
}

import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,symlinkSync,writeFileSync,realpathSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import type {Store} from './store';
import type {Session} from '../shared/types';
import type {DeskFileRecord} from '../shared/desk-files';

interface Move {from:string;to:string}
interface Layout {version:1;members:Record<string,string>;moves:Move[]}
const file=(root:string)=>path.join(root,'desk-directory-layout.json');
const key=(value:string)=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
export function directoryLabel(value:string,max=34){return value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'').slice(0,max).replace(/[. ]+$/,'')||'未命名';}
function read(root:string):Layout {return existsSync(file(root))?JSON.parse(readFileSync(file(root),'utf8')):{version:1,members:{},moves:[]};}
function save(root:string,layout:Layout){const temp=file(root)+'.tmp';writeFileSync(temp,JSON.stringify(layout,null,2));renameSync(temp,file(root));}
function child(root:string,name:string){if(!name||name!==path.basename(name)||name==='.'||name==='..')throw Error('工位目录名称无效');const target=path.resolve(root,name);if(path.dirname(target)!==path.resolve(root))throw Error('工位目录超出管理范围');return target;}
export function deskDirectory(root:string,memberId:string){
 if(!/^[a-z0-9_-]{1,100}$/i.test(memberId))throw Error('工位标识无效');
 return child(path.join(root,'desks'),read(root).members[memberId]??memberId);
}
function checked(root:string,target:string){const relative=path.relative(path.join(root,'desks'),target);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('目录整理只能修改工位内的子目录');return target;}
function alias(from:string,to:string){
 if(existsSync(from)){if(key(realpathSync(from))!==key(realpathSync(to)))throw Error('目录整理遇到同名文件夹，未覆盖：'+from);return;}
 symlinkSync(to,from,process.platform==='win32'?'junction':'dir');
 // The physical, readable folders are shown normally; old paths remain for native sessions and historical links.
 if(process.platform==='win32')spawnSync('attrib.exe',['+H','/L',from],{windowsHide:true});
}
function move(root:string,m:Move){
 checked(root,m.from);checked(root,m.to);
 if(existsSync(m.from)&&!lstatSync(m.from).isSymbolicLink()){
  if(!lstatSync(m.from).isDirectory()||existsSync(m.to))throw Error('目录整理遇到同名文件，未覆盖：'+m.to);
  if(key(path.dirname(realpathSync(m.from)))!==key(realpathSync(path.dirname(m.to))))throw Error('目录整理不能跨越工位边界');
  try{renameSync(m.from,m.to);}catch(error){if(['EPERM','EBUSY','EACCES'].includes((error as NodeJS.ErrnoException).code??''))return false;throw error;}
 }
 if(existsSync(m.to))alias(m.from,m.to);
 return true;
}
function translated(value:string,moves:Move[]){let next=value;for(const m of moves){const rel=path.relative(m.from,next);if(!rel||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel))next=path.join(m.to,rel);}return next;}
/** Rewrite only saved locations, never chat text, prompts, credentials or native resume identifiers. */
function updateLocations(store:Store,moves:Move[]){
 const fields:Record<string,string[]>={sessions:['workspace','workspaceSource'],projects:['directory'],desk_topics:['directory'],desk_views:['directory','key'],desk_folders:['directory']};
 store.transaction(()=>{
  for(const [entity,names] of Object.entries(fields))for(const row of store.entries<Record<string,unknown>>(entity)){
   const next={...row.value};let changed=false;
   for(const name of names)if(typeof next[name]==='string'){const value=translated(next[name] as string,moves);if(value!==next[name]){next[name]=name==='key'?key(value):value;changed=true;}}
   if(changed){let id=row.id;if(entity==='desk_folders'){id=String(next.roomId)+':'+key(String(next.directory));store.delete(entity,row.id);}store.put(entity,id,next);}
  }
  for(const row of store.entries<{id:string}>('desk_folder_cursors')){
   const match=/^(desk:[^:]+:)(.*)$/.exec(row.id);if(!match)continue;
   const id=match[1]+key(translated(match[2],moves));if(id!==row.id){store.delete('desk_folder_cursors',row.id);store.put('desk_folder_cursors',id,row.value);}
  }
  for(const record of store.list<DeskFileRecord>('desk_file_sessions')){
   const directory=translated(record.directory,moves);if(directory!==record.directory)store.put('desk_file_sessions',record.sessionId,{...record,directory,directoryName:path.basename(directory)});
  }
 });
}
export function ensureDeskDirectory(store:Store,memberId:string){
 const root=store.dataDirectory,layout=read(root);if(layout.members[memberId])return deskDirectory(root,memberId);
 const member=store.historicalMembers().find(m=>m.id===memberId)??store.members().find(m=>m.id===memberId);
 const name=directoryLabel(member?.name??memberId)+'__'+memberId;
 const parent=path.join(root,'desks');mkdirSync(parent,{recursive:true});
 if(lstatSync(parent).isSymbolicLink())throw Error('工位根目录不能是链接');
 const from=child(parent,memberId),to=child(parent,name);
 layout.members[memberId]=name;
 if(existsSync(from)){if(lstatSync(from).isSymbolicLink())throw Error('原工位目录不能是未知链接');layout.moves.push({from,to});}
 else mkdirSync(to,{recursive:true});
 save(root,layout);
 if(existsSync(from)){if(!move(root,{from,to})){delete layout.members[memberId];layout.moves=layout.moves.filter(m=>m.from!==from||m.to!==to);save(root,layout);return from;}}else alias(from,to);
 updateLocations(store,layout.moves);
 return to;
}
export function sessionDirectoryName(store:Store,session:Pick<Session,'id'|'createdAt'|'title'|'provider'>){
 const executor=store.executors().find(e=>e.id===session.provider);
 const label=executor?.name??({codex:'Codex',claude:'Claude',gemini:'Gemini',dsh:'DSH'} as Record<string,string>)[session.provider]??session.provider;
 return `${session.createdAt.slice(0,10)}__${directoryLabel(label,20)}__${directoryLabel(session.title,32)}__${session.id.slice(0,8)}`;
}
export function isDeskDirectoryAlias(root:string,target:string){return read(root).moves.some(m=>key(m.from)===key(target));}
export function removeDeskSessionAliases(root:string,directory:string){
 const layout=read(root),moves=layout.moves.filter(m=>key(translated(m.to,layout.moves))===key(directory));
 for(const m of moves){checked(root,m.from);try{if(lstatSync(m.from).isSymbolicLink())unlinkSync(m.from);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 layout.moves=layout.moves.filter(m=>!moves.includes(m));save(root,layout);
}
export function renameDeskSession(store:Store,sessionId:string){
 const record=store.get<DeskFileRecord>('desk_file_sessions',sessionId);if(!record)return;
 const member=store.historicalMembers().find(m=>m.id===record.memberId)??store.members().find(m=>m.id===record.memberId);
 const session=store.get<Session>('sessions',sessionId)??{id:sessionId,title:record.title,createdAt:record.createdAt,provider:member?.executor??'未知执行端'} as Session;
 const root=store.dataDirectory,base=deskDirectory(root,record.memberId),parent=path.join(base,'sessions');
 const directoryName=sessionDirectoryName(store,session),target=child(parent,directoryName);
 if(key(target)===key(record.directory)||!existsSync(record.directory))return;
 if(key(path.dirname(record.directory))!==key(parent)||lstatSync(record.directory).isSymbolicLink())throw Error('会话目录不属于当前工位');
 const layout=read(root),m={from:record.directory,to:target};
 layout.moves.push(m);save(root,layout);if(!move(root,m)){layout.moves=layout.moves.filter(item=>item!==m);save(root,layout);return;}updateLocations(store,[m]);
 store.put('desk_file_sessions',sessionId,{...record,directory:target,directoryName,title:session.title});
}
/** Called before workspaces and runners start; a recorded move can be resumed after interruption. */
export function migrateDeskDirectories(store:Store){
 const root=store.dataDirectory,layout=read(root);
 for(const m of [...layout.moves]){if((existsSync(m.from)||existsSync(m.to))&&!move(root,m)){layout.moves=layout.moves.filter(item=>item!==m);for(const [id,name] of Object.entries(layout.members))if(key(path.join(root,'desks',name))===key(m.to))delete layout.members[id];save(root,layout);}}
 if(layout.moves.length)updateLocations(store,layout.moves);
 const ids=new Set([...store.historicalMembers(),...store.members()].map(m=>m.id));
 for(const record of store.list<DeskFileRecord>('desk_file_sessions'))ids.add(record.memberId);
 for(const id of ids)ensureDeskDirectory(store,id);
 for(const record of store.list<DeskFileRecord>('desk_file_sessions'))renameDeskSession(store,record.sessionId);
}

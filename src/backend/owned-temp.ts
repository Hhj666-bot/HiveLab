import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {readdir,rm} from 'node:fs/promises';
import path from 'node:path';

const marker='.hivelab-temp-owner.json';
export type OwnedTemp={root:string;directory:string};
function checkedRoot(root:string){
 if(!path.isAbsolute(root))throw Error('进程临时目录必须是绝对路径');
 const resolved=path.resolve(root);mkdirSync(resolved,{recursive:true});
 if(lstatSync(resolved).isSymbolicLink())throw Error('进程临时目录不能是目录链接');
 return resolved;
}
export function createOwnedTemp(root?:string):OwnedTemp|undefined{
 if(!root)return;
 const resolved=checkedRoot(root),directory=mkdtempSync(path.join(resolved,'owned-'));
 writeFileSync(path.join(directory,marker),JSON.stringify({version:1,ownerPid:process.pid,createdAt:new Date().toISOString()}),{flag:'wx'});
 return {root:resolved,directory};
}
export async function removeOwnedTemp(temp:OwnedTemp){
 const root=path.resolve(temp.root),directory=path.resolve(temp.directory);
 if(path.dirname(directory)!==root||!/^owned-[a-z0-9]+$/i.test(path.basename(directory)))throw Error('拒绝清理非托管进程临时目录');
 if(lstatSync(root).isSymbolicLink()||existsSync(directory)&&lstatSync(directory).isSymbolicLink())throw Error('进程临时目录清理拒绝目录链接');
 await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}
function alive(pid:number){try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}}
function staleOwner(directory:string){
 try{const owner=JSON.parse(readFileSync(path.join(directory,marker),'utf8')) as {version:number;ownerPid:number};return owner.version===1&&Number.isInteger(owner.ownerPid)&&owner.ownerPid>0&&!alive(owner.ownerPid);}catch{return false;}
}
/** How many marked directories the sweep below would remove now; nothing is touched. */
export async function countStaleOwnedTemp(root:string){
 const entries=await readdir(root,{withFileTypes:true}).catch(()=>[]);
 return entries.filter(entry=>entry.isDirectory()&&/^owned-[a-z0-9]+$/i.test(entry.name)&&staleOwner(path.join(root,entry.name))).length;
}
/** Recover only marked directories left by a terminated HiveLab owner. Never age-delete an active job or legacy _MEI directory. */
export async function sweepOwnedTemp(root:string){
 const resolved=checkedRoot(root),result={removed:0,skipped:0,failed:0};
 for(const entry of await readdir(resolved,{withFileTypes:true})){
  if(!entry.isDirectory()||!/^owned-[a-z0-9]+$/i.test(entry.name))continue;
  const directory=path.join(resolved,entry.name);let owner:{version:number;ownerPid:number};
  try{owner=JSON.parse(readFileSync(path.join(directory,marker),'utf8'));}catch{result.skipped++;continue;}
  if(owner.version!==1||!Number.isInteger(owner.ownerPid)||owner.ownerPid<=0||alive(owner.ownerPid)){result.skipped++;continue;}
  try{await removeOwnedTemp({root:resolved,directory});result.removed++;}catch{result.failed++;}
 }
 return result;
}

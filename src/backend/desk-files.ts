import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync} from 'node:fs';
import {readdir,lstat,rename,mkdir,unlink,copyFile,utimes,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {ensureDeskDirectory,sessionDirectoryName,renameDeskSession,isDeskDirectoryAlias,removeDeskSessionAliases} from './desk-directory-layout';
import type {Store} from './store';
import {resolveAttachments} from './attachments';
import type {Attachment,Session,Run,RoomMessage,RoomThread,Project} from '../shared/types';
import type {DeskTopic} from '../shared/member-workspaces';
import {resolveSafePath} from './security';
import {DEFAULT_DESK_FILES,type DeskFilePreferences,type DeskFileRecord,type DeskFileLocation,type DeskFileItem,type DeskFileGroup,type DeskRecycleItem,type DeskFileScan,type DeskFileSelection,type DeskCleanPreview} from '../shared/desk-files';

export type DeskFileLease=<T>(directories:string[],operation:()=>Promise<T>)=>Promise<T>;
const day=86400000,now=()=>new Date().toISOString();
const key=(p:string)=>path.resolve(p).replaceAll('\\','/').toLowerCase();
const inside=(root:string,file:string)=>key(file)===key(root)||key(file).startsWith(key(root)+'/');
const alive=(r:Run)=>!r.completedAt&&['queued','running','waiting_user','stopping','rate_limited'].includes(r.status);
const stamp=(s:Awaited<ReturnType<typeof lstat>>)=>`${s.size}:${s.mtimeMs}:${s.ino}`;
type Candidate=DeskFileSelection&{version:string;size:number;title:string};
type Preview={memberId:string;files:Candidate[];expires:number};
type FileSource=DeskFileRecord&Pick<DeskFileGroup,'source'|'rootId'|'relatedSessionIds'|'readOnly'>;

/** Personal files can be recycled explicitly; automatic cleanup only visits owned session temp folders. */
export class DeskFiles {
  private previews=new Map<string,Preview>();
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private store:Store,private lease:DeskFileLease=(_paths,operation)=>operation()){}
  private serial<T>(operation:()=>Promise<T>){const task=this.tail.catch(()=>{}).then(operation);this.tail=task;return task;}
  private directory(parent:string,name:string){
    const target=resolveSafePath(parent,name);
    if(!existsSync(target))mkdirSync(target,{recursive:true});
    if(!lstatSync(target).isDirectory()||lstatSync(target).isSymbolicLink())throw Error('工位目录不能是链接或文件。');
    resolveSafePath(parent,name);return target;
  }
  base(memberId:string){
    if(!/^[a-z0-9_-]{1,100}$/i.test(memberId))throw Error('工位标识无效。');
    const desks=this.directory(this.store.dataDirectory,'desks');return this.directory(desks,path.basename(ensureDeskDirectory(this.store,memberId)));
  }
  shared(memberId:string){return this.directory(this.base(memberId),'shared');}
  create(memberId:string,session:Session){
    if(!/^[a-z0-9-]{1,100}$/i.test(session.id))throw Error('会话标识无效。');
    const sessions=this.directory(this.base(memberId),'sessions');this.shared(memberId);
    const directoryName=sessionDirectoryName(this.store,session),directory=this.directory(sessions,directoryName);
    this.directory(directory,'_临时');
    this.store.put('desk_file_sessions',session.id,{sessionId:session.id,memberId,directory,directoryName,createdAt:session.createdAt,title:session.title} satisfies DeskFileRecord);
    return directory;
  }
  async refreshDirectory(sessionId:string){const record=this.store.get<DeskFileRecord>('desk_file_sessions',sessionId);if(!record)return;await this.serial(()=>this.lease([record.directory],async()=>{renameDeskSession(this.store,sessionId);}));}
  records(memberId:string){return this.store.list<DeskFileRecord>('desk_file_sessions').filter(r=>r.memberId===memberId);}
  index():DeskFileLocation[]{
    for(const member of this.store.members())this.shared(member.id);
    const locations:DeskFileLocation[]=this.store.list<DeskFileRecord>('desk_file_sessions').map(record=>{
      const session=this.store.get<Session>('sessions',record.sessionId),thread=this.store.get<RoomThread>('room_threads','desk-topic-'+record.sessionId);
      if(session?.title&&session.title!==record.title){record={...record,title:session.title};this.store.put('desk_file_sessions',record.sessionId,record);}
      return {...record,managed:true,sharedDirectory:false,updatedAt:session?.updatedAt??record.createdAt,archived:!!session?.archived||!!thread?.archivedAt||!session};
    });
    const ids=new Set(locations.map(r=>r.sessionId));
    for(const topic of this.store.list<DeskTopic>('desk_topics')){
      if(topic.deletedAt||ids.has(topic.sessionId))continue;
      const session=this.store.get<Session>('sessions',topic.sessionId);if(!session)continue;
      const directory=session.workspace||topic.directory||this.store.get<Project>('projects',session.projectId)?.directory;if(!directory)continue;
      const thread=this.store.get<RoomThread>('room_threads',topic.id);
      locations.push({sessionId:session.id,memberId:topic.memberId,directory,title:session.title,createdAt:session.createdAt,updatedAt:session.updatedAt,archived:!!session.archived||!!thread?.archivedAt,managed:false,sharedDirectory:false});ids.add(session.id);
    }
    const counts=new Map<string,number>();for(const r of locations)counts.set(key(r.directory),(counts.get(key(r.directory))??0)+1);
    return locations.map(r=>({...r,sharedDirectory:!r.managed&&((counts.get(key(r.directory))??0)>1||key(r.directory)===key(this.base(r.memberId)))}));
  }
  private record(id:string,memberId?:string){
    const record=this.store.get<DeskFileRecord>('desk_file_sessions',id);
    if(!record||memberId&&record.memberId!==memberId)throw Error('这不是可管理的工位会话目录。');
    if(!/^[a-z0-9-]{1,100}$/i.test(record.sessionId)||!/^\d{4}-\d{2}-\d{2}T/.test(record.createdAt))throw Error('会话目录记录无效。');
    const sessions=this.directory(this.base(record.memberId),'sessions');
    const expected=resolveSafePath(sessions,record.directoryName??record.createdAt.slice(0,10)+'_'+record.sessionId);
    if(key(expected)!==key(record.directory))throw Error('会话文件夹归属发生变化，未修改文件。');
    if(existsSync(expected)&&(!lstatSync(expected).isDirectory()||lstatSync(expected).isSymbolicLink()))throw Error('会话文件夹不能是链接。');
    return record;
  }
  private fileRecord(id:string,memberId?:string):FileSource{
    const common=/^(legacy|shared):([a-z0-9_-]{1,100})$/i.exec(id);
    if(!common)return {...this.record(id,memberId),source:'session',rootId:'session:'+id,relatedSessionIds:[id]};
    const owner=common[2];if(memberId&&memberId!==owner)throw Error('文件不属于当前工位。');
    const directory=common[1]==='legacy'?this.base(owner):this.shared(owner);
    const sessions=this.store.list<Session>('sessions').filter(s=>{
      const cwd=s.workspace||this.store.get<Project>('projects',s.projectId)?.directory;return cwd&&key(cwd)===key(directory);
    }).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
    return {sessionId:id,memberId:owner,directory,createdAt:sessions[0]?.createdAt??now(),title:common[1]==='legacy'?'原有工位文件（共用目录）':'共享资料',source:common[1] as 'legacy'|'shared',rootId:(common[1]==='legacy'?'desk-legacy:':'desk-shared:')+owner,relatedSessionIds:sessions.map(s=>s.id)};
  }
  preferences():DeskFilePreferences{return {...DEFAULT_DESK_FILES,...this.store.get<DeskFilePreferences>('desk_file_preferences','main')};}
  configure(p:Partial<DeskFilePreferences>){
    const next={...this.preferences(),...p};
    for(const field of ['recycleDays','inactiveDays','temporaryDays'] as const)if(!Number.isInteger(next[field])||next[field]<(field==='recycleDays'?0:1)||next[field]>3650)throw Error('保留时间请输入 1–3650 天；回收区可填 0 表示永久保留。');
    if(typeof next.autoTemporary!=='boolean')throw Error('自动清理设置无效。');
    this.store.put('desk_file_preferences','main',next);return next;
  }
  private keepId(sessionId:string,relative:string){return createHash('sha256').update(sessionId+'\0'+relative.replaceAll('\\','/').toLowerCase()).digest('hex');}
  keep(sessionId:string,relative:string,value:boolean){
    relative=relative.replaceAll('\\','/');
    const r=this.fileRecord(sessionId);resolveSafePath(r.directory,relative);
    const id=this.keepId(sessionId,relative);if(value)this.store.put('desk_kept_files',id,{sessionId,path:relative});else this.store.delete('desk_kept_files',id);
    this.previews.clear();return {kept:value};
  }
  renamed(sessionId:string,from:string,to:string){
    const record=this.fileRecord(sessionId);resolveSafePath(record.directory,from);resolveSafePath(record.directory,to);
    for(const kept of this.store.list<{sessionId:string;path:string}>('desk_kept_files').filter(v=>v.sessionId===sessionId&&(v.path===from||v.path.startsWith(from+'/')))){
      this.store.delete('desk_kept_files',this.keepId(sessionId,kept.path));
      const next=to+kept.path.slice(from.length);this.store.put('desk_kept_files',this.keepId(sessionId,next),{sessionId,path:next});
    }
    this.previews.clear();return {updated:true};
  }
  renamedAt(from:string,to:string){
    const sources:FileSource[]=this.store.list<DeskFileRecord>('desk_file_sessions').filter(r=>inside(r.directory,from)&&inside(r.directory,to)).map(r=>this.fileRecord(r.sessionId));
    for(const member of this.store.members())for(const prefix of ['legacy:','shared:']){
      const source=this.fileRecord(prefix+member.id);if(inside(source.directory,from)&&inside(source.directory,to))sources.push(source);
    }
    const source=sources.sort((a,b)=>b.directory.length-a.directory.length)[0];if(!source)return {updated:false};
    return this.renamed(source.sessionId,path.relative(source.directory,from).replaceAll('\\','/'),path.relative(source.directory,to).replaceAll('\\','/'));
  }
  private references(){
    const topics=new Map(this.store.list<{id:string;sessionId:string}>('desk_topics').map(t=>[t.id,t.sessionId]));
    const text:{sessionId:string;text:string}[]=this.store.list<Run>('runs').map(r=>({sessionId:r.sessionId,text:r.input}));
    for(const m of this.store.list<RoomMessage>('room_messages'))if(m.text)text.push({sessionId:topics.get(m.threadId??'')??'',text:m.text});
    return text.map(t=>({...t,text:t.text.replace(/(?:%[a-f0-9]{2})+/gi,value=>{try{return decodeURIComponent(value);}catch{return value;}}).replaceAll('\\','/').toLowerCase()}));
  }
  private async group(record:FileSource,references:ReturnType<DeskFiles['references']>,terminals:string[]=[],seenFiles?:Set<string>):Promise<DeskFileGroup>{
    if(record.source!=='external')record=this.fileRecord(record.sessionId,record.memberId);
    const session=this.store.get<Session>('sessions',record.sessionId),threads=this.store.list<RoomThread>('room_threads');
    const thread=threads.find(t=>t.id==='desk-topic-'+record.sessionId);
    const relatedIds=new Set(record.relatedSessionIds??[record.sessionId]);
    const sessions=this.store.list<Session>('sessions'),related=sessions.filter(s=>relatedIds.has(s.id));
    const overlapping=new Set([...relatedIds,...sessions.filter(s=>{const cwd=s.workspace||this.store.get<Project>('projects',s.projectId)?.directory;return cwd&&(inside(record.directory,cwd)||inside(cwd,record.directory));}).map(s=>s.id)]);
    const active=this.store.list<Run>('runs').some(r=>overlapping.has(r.sessionId)&&alive(r))||terminals.some(t=>inside(record.directory,t)||inside(t,record.directory));
    const archived=record.source==='session'?!!session?.archived||!!thread?.archivedAt||!session:related.length>0&&related.every(s=>s.archived||threads.some(t=>t.id==='desk-topic-'+s.id&&t.archivedAt));
    const updatedAt=related.reduce((last,s)=>s.updatedAt>last?s.updatedAt:last,record.createdAt);
    const result:DeskFileGroup={...record,title:record.source==='session'?(session?.title??record.title):record.title,updatedAt,archived,deleted:record.source==='session'&&!session,active,files:[],bytes:0,truncated:false};
    const otherWorkspaces=sessions.filter(s=>!relatedIds.has(s.id)&&s.workspace&&key(s.workspace)===key(record.directory));
    const referencedText=references.filter(ref=>!relatedIds.has(ref.sessionId)&&ref.text.includes(key(record.directory))).map(ref=>ref.text).join('\n');
    const keptPaths=this.store.list<{sessionId:string;path:string}>('desk_kept_files').filter(v=>v.sessionId===record.sessionId).map(v=>v.path.toLowerCase());
    const unavailable=record.readOnly?'项目或外部目录，请在文件树中管理':record.source==='session'&&session?.restoredHistoryOnly?'恢复的只读历史':record.source==='session'&&session?.workspace&&key(session.workspace)!==key(record.directory)?'会话已使用其他目录':undefined;
    const exclusions=record.source==='legacy'?[this.shared(record.memberId),...this.records(record.memberId).map(r=>r.directory)]:[];
    const walk=async(relative:string,inherited?:string)=>{
      for(const entry of await readdir(resolveSafePath(record.directory,relative),{withFileTypes:true})){
        if(result.files.length>=20000){result.truncated=true;return;}
        const child=relative?relative+'/'+entry.name:entry.name;
        if(entry.isSymbolicLink()){if(isDeskDirectoryAlias(this.store.dataDirectory,path.join(record.directory,child)))continue;result.files.push({path:child,size:0,modifiedAt:record.createdAt,temporary:false,kept:false,protectedReason:'链接不参与清理',version:''});continue;}
        const target=resolveSafePath(record.directory,child),s=await lstat(target);
        if(exclusions.some(excluded=>key(excluded)===key(target)))continue;
        const meta=inherited??(entry.name.startsWith('.')||['AGENTS.md','CLAUDE.md'].includes(entry.name)?'配置与上下文文件':undefined);
        if(s.isDirectory()){await walk(child,meta);continue;}if(!s.isFile())continue;
        if(seenFiles?.has(key(target)))continue;seenFiles?.add(key(target));
        const kept=keptPaths.some(p=>!p||p===child.toLowerCase()||child.toLowerCase().startsWith(p+'/')),absolute=key(target);
        const referenced=otherWorkspaces.length>0||referencedText.includes(absolute);
        result.files.push({path:child,size:s.size,modifiedAt:s.mtime.toISOString(),temporary:record.source==='session'&&child.startsWith('_临时/'),kept,version:stamp(s),protectedReason:active?'会话或终端正在运行':unavailable??(kept?'已标记保留':meta??(referenced?'其他会话有明确引用':undefined))});result.bytes+=s.size;if(s.mtime.toISOString()>result.updatedAt)result.updatedAt=s.mtime.toISOString();
      }
    };
    try{if(existsSync(record.directory))await walk('');}catch(e){result.error=String((e as Error).message);for(const f of result.files)f.protectedReason='扫描未完成，请刷新后再清理';}
    return result;
  }
  private recycleRoot(){return this.directory(this.store.dataDirectory,'desk-recycle');}
  private payload(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('回收记录无效。');const target=resolveSafePath(this.recycleRoot(),id);if(existsSync(target)&&!lstatSync(target).isFile())throw Error('回收文件类型发生变化。');return target;}
  private recover(){
    for(const item of this.store.list<DeskRecycleItem>('desk_recycle')){
      const file=this.payload(item.id),stored=existsSync(file);
      if(!stored){this.store.delete('desk_recycle',item.id);continue;}
      if(item.state!=='stored')this.store.put('desk_recycle',item.id,{...item,state:'stored'});
    }
  }
  async scan(memberId:string,terminals:string[]=[]):Promise<DeskFileScan>{
    await this.tail.catch(()=>{});this.recover();const references=this.references(),groups:DeskFileGroup[]=[],seenFiles=new Set<string>();
    for(const record of this.records(memberId))groups.push(await this.group(this.fileRecord(record.sessionId,memberId),references,terminals,seenFiles));
    for(const source of ['legacy:','shared:'])groups.push(await this.group(this.fileRecord(source+memberId,memberId),references,terminals,seenFiles));
    const base=this.base(memberId),external=new Map<string,DeskFileLocation[]>();
    for(const location of this.index().filter(r=>r.memberId===memberId&&!r.managed&&!inside(base,r.directory))){const id=key(location.directory);external.set(id,[...(external.get(id)??[]),location]);}
    for(const locations of [...external.values()].sort((a,b)=>b[0].directory.length-a[0].directory.length)){
      const first=locations[0];groups.push(await this.group({...first,title:locations.length>1?'原工作目录（共用）':first.title,source:'external',rootId:'session:'+first.sessionId,readOnly:true,relatedSessionIds:locations.map(r=>r.sessionId)},references,terminals,seenFiles));
    }
    groups.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    return {memberId,groups:groups.filter(g=>g.source==='session'&&!g.deleted||g.files.length||g.error),preferences:this.preferences(),recycle:this.store.list<DeskRecycleItem>('desk_recycle').filter(r=>r.memberId===memberId),sharedDirectory:this.shared(memberId),legacyDirectory:this.base(memberId)};
  }
  async preview(memberId:string,selection:DeskFileSelection[],terminals:string[]=[]):Promise<DeskCleanPreview>{
    if(!Array.isArray(selection)||selection.length>20000)throw Error('清理文件数量过多，请分批选择。');
    await this.tail.catch(()=>{});const references=this.references(),groups:DeskFileGroup[]=[];
    for(const id of new Set(selection.map(f=>f.sessionId)))groups.push(await this.group(this.fileRecord(id,memberId),references,terminals));
    const map=new Map(groups.flatMap(g=>g.files.map(f=>[g.sessionId+'\0'+f.path,{...f,sessionId:g.sessionId,title:g.title}])));
    const files:Candidate[]=[];let skipped=0;const seen=new Set<string>();
    for(const pick of selection){const id=pick.sessionId+'\0'+pick.path;if(seen.has(id))continue;seen.add(id);const file=map.get(id);if(!file||file.protectedReason){skipped++;continue;}files.push({sessionId:file.sessionId,path:file.path,size:file.size,title:file.title,version:file.version});}
    const token=randomUUID(),expires=Date.now()+10*60*1000;
    for(const [id,p] of this.previews)if(p.expires<Date.now())this.previews.delete(id);
    if(this.previews.size>=30)this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(token,{memberId,files,expires});
    return {token,files:files.map(({version,...f})=>f),bytes:files.reduce((n,f)=>n+f.size,0),skipped,expiresAt:new Date(expires).toISOString()};
  }
  async recycle(token:string){return this.serial(async()=>{
    const preview=this.previews.get(token);this.previews.delete(token);
    if(!preview||preview.expires<Date.now())throw Error('清理预览已过期，请重新扫描。');
    const records=[...new Set(preview.files.map(f=>f.sessionId))].map(id=>this.fileRecord(id,preview.memberId));
    return this.lease(records.map(r=>r.directory),async()=>{
      const references=this.references(),current=new Map<string,DeskFileItem>();
      for(const r of records){const g=await this.group(r,references);for(const f of g.files)current.set(r.sessionId+'\0'+f.path,f);if(g.error)throw Error(g.error);}
      let moved=0,bytes=0;const errors:string[]=[],recycledFiles:DeskFileSelection[]=[];
      for(const file of preview.files){
        const latest=current.get(file.sessionId+'\0'+file.path);
        if(!latest||latest.protectedReason||latest.version!==file.version){errors.push(file.path+'：文件已变化或受保护，已跳过');continue;}
        const r=this.fileRecord(file.sessionId,preview.memberId),source=resolveSafePath(r.directory,file.path);
        const item:DeskRecycleItem={id:randomUUID(),memberId:r.memberId,sessionId:r.sessionId,title:file.title,path:file.path,size:file.size,recycledAt:now(),state:'moving'};
        try{
          const info=await lstat(source);if(!info.isFile()||info.isSymbolicLink()||stamp(info)!==file.version)throw Error('文件已变化');
          this.store.put('desk_recycle',item.id,item);
          await rename(source,this.payload(item.id));
          this.store.put('desk_recycle',item.id,{...item,state:'stored'});moved++;bytes+=file.size;recycledFiles.push({sessionId:file.sessionId,path:file.path});
        }catch(e){if(!existsSync(this.payload(item.id)))this.store.delete('desk_recycle',item.id);errors.push(file.path+'：'+(e as Error).message);}
      }
      return {moved,bytes,errors,files:recycledFiles};
    });
  });}
  async restore(ids:string[]){return this.serial(async()=>{
    if(!Array.isArray(ids)||ids.length>20000)throw Error('回收记录无效。');
    let restored=0;const errors:string[]=[];
    for(const id of new Set(ids)){
      const item=this.store.get<DeskRecycleItem>('desk_recycle',id);if(!item)continue;
      const r=this.fileRecord(item.sessionId,item.memberId);
      try{await this.lease([r.directory],async()=>{
        if(!existsSync(r.directory))this.directory(this.directory(this.base(r.memberId),'sessions'),path.basename(r.directory));
        const source=this.payload(id),destination=resolveSafePath(r.directory,item.path);
        if(existsSync(destination))throw Error('原位置已有同名文件，未覆盖；请先重命名现有文件');
        await mkdir(path.dirname(destination),{recursive:true});resolveSafePath(r.directory,item.path);
        this.store.put('desk_recycle',id,{...item,state:'restoring'});
        const info=await lstat(source);await copyFile(source,destination,constants.COPYFILE_EXCL);await utimes(destination,info.atime,info.mtime).catch(()=>{});
        await unlink(source);this.store.delete('desk_recycle',id);restored++;
      });}catch(e){errors.push(item.path+'：'+(e as Error).message);}
    }
    return {restored,errors};
  });}
  async purge(ids:string[]){return this.serial(async()=>{
    if(!Array.isArray(ids)||ids.length>20000)throw Error('回收记录无效。');let removed=0,bytes=0;const errors:string[]=[];
    for(const id of new Set(ids)){
      const item=this.store.get<DeskRecycleItem>('desk_recycle',id);if(!item)continue;
      const r=this.fileRecord(item.sessionId,item.memberId);
      try{await this.lease([r.directory],async()=>{
        this.store.put('desk_recycle',id,{...item,state:'purging'});
        await unlink(this.payload(id));this.store.delete('desk_recycle',id);removed++;bytes+=item.size;
      });}catch(e){errors.push(item.path+'：'+(e as Error).message);}
    }
    return {removed,bytes,errors};
  });}
  async organize(memberId:string,relative:string,sessionId:string){return this.serial(async()=>{
    const r=this.record(sessionId,memberId),base=this.base(memberId),source=resolveSafePath(base,relative);
    if(this.records(memberId).some(record=>inside(record.directory,source))||inside(this.shared(memberId),source))throw Error('请选择历史未分类中的文件。');
    return this.lease([base,r.directory],async()=>{
      const info=await lstat(source);if(!info.isFile()||info.isSymbolicLink())throw Error('请逐个选择普通历史文件。');
      const absolute=key(source);if(this.references().some(ref=>ref.text.includes(absolute)))throw Error('已有会话明确引用这个文件，请保留原位置。');
      const destination=resolveSafePath(r.directory,path.basename(source));
      await copyFile(source,destination,constants.COPYFILE_EXCL);await unlink(source);return {moved:true};
    });
  });}
  async preserveSessionAttachments(session:Session){
    const attachments:Attachment[]=[...this.store.list<Run>('runs').filter(r=>r.sessionId===session.id).flatMap(r=>[...(r.attachments??[]),...(r.generatedImages??[])]),...this.store.allRoomMessages('desk-topic-'+session.id,`desk:${session.memberId??session.provider}`).flatMap(m=>[...(m.attachments??[]),...(m.generatedImages??[])])];
    if(!attachments.length)return;
    const record=this.store.get<DeskFileRecord>('desk_file_sessions',session.id);
    const parent=record?this.record(session.id).directory:this.directory(this.shared(session.memberId??session.provider),'保留的会话附件');
    const folder=record?'_对话附件':sessionDirectoryName(this.store,session);
    await this.serial(()=>this.lease([parent],async()=>{
      const target=this.directory(parent,folder),seen=new Set<string>();
      for(const item of attachments){if(seen.has(item.id))continue;seen.add(item.id);
        let stored;try{stored=resolveAttachments(this.store.dataDirectory,[item])[0];}catch{continue;}
        const sub=this.directory(target,item.id),destination=resolveSafePath(sub,item.name);
        try{await copyFile(stored.path,destination,constants.COPYFILE_EXCL);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
      }
    }));
  }
  async removeSessionFiles(sessionId:string){return this.serial(async()=>{
    if(!this.store.get('desk_file_sessions',sessionId))return {removed:false};
    const record=this.record(sessionId);
    return this.lease([record.directory],async()=>{
      const others=this.store.list<Session>('sessions').filter(s=>s.id!==sessionId);
      if(others.some(s=>{const cwd=s.workspace||this.store.get<Project>('projects',s.projectId)?.directory;return cwd&&inside(record.directory,cwd);}))throw Error('其他会话仍使用这个目录，请取消同步删除文件');
      if(this.store.list<Run>('runs').some(r=>r.sessionId===sessionId&&alive(r)))throw Error('请先停止会话再删除文件');
      const target=resolveSafePath(this.base(record.memberId),path.relative(this.base(record.memberId),record.directory));
      if(existsSync(target)&&(lstatSync(target).isSymbolicLink()||!lstatSync(target).isDirectory()))throw Error('会话目录类型发生变化');
      removeDeskSessionAliases(this.store.dataDirectory,target);
      await rm(target,{recursive:true,force:true});
      for(const item of this.store.list<DeskRecycleItem>('desk_recycle').filter(item=>item.sessionId===sessionId)){await rm(this.payload(item.id),{force:true});this.store.delete('desk_recycle',item.id);}
      this.store.delete('desk_file_sessions',sessionId);this.store.deleteEntitiesWhere('desk_kept_files',v=>(v as {sessionId:string}).sessionId===sessionId);this.previews.clear();
      return {removed:true};
    });
  });}
  async sweep(){
    const p=this.preferences(),cutoff=Date.now()-p.recycleDays*day;
    const expired=p.recycleDays?this.store.list<DeskRecycleItem>('desk_recycle').filter(r=>Date.parse(r.recycledAt)<cutoff).map(r=>r.id):[];
    if(expired.length)await this.purge(expired);
    if(p.autoTemporary)for(const member of this.store.members()){
      const references=this.references(),groups:DeskFileGroup[]=[];for(const record of this.records(member.id))groups.push(await this.group(this.fileRecord(record.sessionId,member.id),references));
      const selection=groups.filter(g=>!g.active&&!g.error).flatMap(g=>g.files.filter(f=>f.temporary&&!f.protectedReason&&Date.parse(f.modifiedAt)<Date.now()-p.temporaryDays*day).map(f=>({sessionId:g.sessionId,path:f.path})));
      if(selection.length){const preview=await this.preview(member.id,selection);if(preview.files.length)await this.recycle(preview.token);}
    }
    return {swept:true};
  }
  async invoke(method:string,p:Record<string,any>){
    if(['deskFiles.restore','deskFiles.purge'].includes(method)){
      if(!Array.isArray(p.ids)||p.ids.length>20000)throw Error('回收记录无效。');
      if(p.ids.some((id:string)=>{const item=this.store.get<DeskRecycleItem>('desk_recycle',id);return item&&item.memberId!==String(p.memberId);}))throw Error('回收文件不属于当前工位，请刷新后重试。');
    }
    switch(method){
      case 'deskFiles.index':return this.index();
      case 'deskFiles.renamed':return this.serial(async()=>this.renamed(String(p.sessionId),String(p.from),String(p.to)));
      case 'deskFiles.renamedAt':return this.serial(async()=>this.renamedAt(String(p.from),String(p.to)));
      case 'deskFiles.scan':return this.scan(String(p.memberId),p._terminalDirectories??[]);
      case 'deskFiles.preferences':return this.preferences();
      case 'deskFiles.configure':return this.serial(async()=>this.configure(p.preferences??{}));
      case 'deskFiles.keep':return this.serial(async()=>this.keep(String(p.sessionId),String(p.path),p.kept===true));
      case 'deskFiles.preview':return this.preview(String(p.memberId),p.files,p._terminalDirectories??[]);
      case 'deskFiles.recycle':if(this.previews.get(String(p.token))?.memberId!==String(p.memberId))throw Error('清理预览已失效或不属于当前工位，请重新扫描。');return this.recycle(String(p.token));
      case 'deskFiles.restore':return this.restore(p.ids);
      case 'deskFiles.purge':if(p.confirm!==true)throw Error('请确认永久删除这些回收文件。');return this.purge(p.ids);
      case 'deskFiles.organize':return this.organize(String(p.memberId),String(p.path),String(p.sessionId));
      case 'deskFiles.share':return this.serial(async()=>{
        const r=this.record(String(p.sessionId),String(p.memberId)),source=resolveSafePath(r.directory,String(p.path)),shared=this.shared(r.memberId);
        return this.lease([r.directory,shared],async()=>{const info=await lstat(source);if(!info.isFile()||info.isSymbolicLink())throw Error('只能复制普通文件到共享资料。');await copyFile(source,resolveSafePath(shared,path.basename(source)),constants.COPYFILE_EXCL);return {copied:true};});
      });
      case 'deskFiles.sweep':return this.sweep();
      default:throw Error('文件管理操作不可用。');
    }
  }
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,lstatSync,rmSync,existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../src/backend/store';
import {migrateDeskDirectories,deskDirectory,renameDeskSession} from '../src/backend/desk-directory-layout';
import {DeskFiles} from '../src/backend/desk-files';
import {Engine} from '../src/backend/engine';
import {importAttachments} from '../src/backend/attachments';
import type {Session} from '../src/shared/types';
import type {DeskFileRecord,DeskFileScan} from '../src/shared/desk-files';

test('legacy desk migration keeps bytes, old links, folder selection and native resume; repeats safely',async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'desk-layout-')),store=new Store(root);
 try{
  const memberId='m-old',sessionId='12345678-1234-1234-1234-123456789abc',base=path.join(root,'desks',memberId),old=path.join(base,'sessions','2026-11-05_'+sessionId);
  mkdirSync(old,{recursive:true});writeFileSync(path.join(old,'说明.md'),'原文件 🐱');writeFileSync(path.join(base,'shared-old.txt'),'shared');
  store.put('members',memberId,{id:memberId,name:'Sol',executor:'codex'});
  const session:Session={id:sessionId,memberId,provider:'codex',projectId:'project',title:'接入 Antigravity',createdAt:'2026-11-05T00:00:00Z',updatedAt:'2026-11-05T00:00:00Z',revision:1,writeMode:true,workspace:old,workspaceKind:'original',deskWorkspace:true,nativeId:'keep-native-id'};
  store.put('sessions',sessionId,session);store.put('projects','project',{id:'project',directory:base});store.put('desk_topics','topic',{id:'topic',memberId,sessionId,directory:base});
  store.put('desk_views','desk:'+memberId,{directory:base,key:base.toLowerCase()});store.put('desk_folder_cursors','desk:'+memberId+':'+base.toLowerCase(),{id:'topic'});
  store.put('desk_file_sessions',sessionId,{sessionId,memberId,directory:old,createdAt:session.createdAt,title:session.title});
  migrateDeskDirectories(store);
  const record=store.get<DeskFileRecord>('desk_file_sessions',sessionId)!,newBase=deskDirectory(root,memberId);
  assert.match(newBase,/Sol__m-old$/);assert.match(path.basename(record.directory),/^2026-11-05__Codex__接入 Antigravity__12345678$/);
  assert.equal(lstatSync(record.directory).isSymbolicLink(),false);assert.equal(realpathSync(old),realpathSync(record.directory));assert.equal(readFileSync(path.join(old,'说明.md'),'utf8'),'原文件 🐱');
  assert.equal(store.get<Session>('sessions',sessionId)?.workspace,record.directory);assert.equal(store.get<Session>('sessions',sessionId)?.nativeId,'keep-native-id');
  assert.deepEqual(store.get('desk_folder_cursors','desk:'+memberId+':'+newBase.toLowerCase()),{id:'topic'});
  migrateDeskDirectories(store);assert.equal(readFileSync(path.join(old,'说明.md'),'utf8'),'原文件 🐱');
  store.put('sessions',sessionId,{...store.get<Session>('sessions',sessionId),title:'新的标题'});renameDeskSession(store,sessionId);migrateDeskDirectories(store);
  const changed=store.get<DeskFileRecord>('desk_file_sessions',sessionId)!;assert.match(changed.directory,/新的标题/);assert.equal(readFileSync(path.join(old,'说明.md'),'utf8'),'原文件 🐱');
  const files=new DeskFiles(store);await files.removeSessionFiles(sessionId);assert.equal(existsSync(changed.directory),false);assert.equal(existsSync(path.join(newBase,'shared-old.txt')),true);
  migrateDeskDirectories(store);assert.equal(existsSync(changed.directory),false);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('deleted-member session deletion preserves files and attachments by default; explicit selection removes only its directory',async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'desk-delete-')),engine=new Engine(root,()=>{},()=>{},undefined,{maintenanceOnly:true});
 try{
  engine.store.put('members','m-user',{id:'m-user',name:'旧人物',executor:'codex'});
  const first=await engine.invoke('desk.topic',{memberId:'m-user',title:'保留文件'}) as {id:string};
  const second=await engine.invoke('desk.topic',{memberId:'m-user',title:'删除文件'}) as {id:string};
  const records=engine.store.list<DeskFileRecord>('desk_file_sessions'),a=records.find(r=>'desk-topic-'+r.sessionId===first.id)!,b=records.find(r=>'desk-topic-'+r.sessionId===second.id)!;
  writeFileSync(path.join(a.directory,'保留.txt'),'keep');writeFileSync(path.join(b.directory,'删除.txt'),'remove');
  const source=path.join(root,'测试附件.txt');writeFileSync(source,'attachment bytes');const attachments=importAttachments(root,[source]);
  engine.store.put('runs','run',{id:'run',sessionId:a.sessionId,status:'completed',completedAt:new Date().toISOString(),input:'',attachments});
  await engine.invoke('team.delete',{id:'m-user'});
  await engine.invoke('storage.deleteSession',{memberId:'m-user',sessionId:a.sessionId,deleteFiles:false});
  assert.equal(readFileSync(path.join(a.directory,'保留.txt'),'utf8'),'keep');assert.equal(readFileSync(path.join(a.directory,'_对话附件',attachments[0].id,attachments[0].name),'utf8'),'attachment bytes');
  assert.equal(engine.store.get('sessions',a.sessionId),undefined);
  await engine.invoke('storage.deleteSession',{memberId:'m-user',sessionId:b.sessionId,deleteFiles:true});
  assert.equal(existsSync(b.directory),false);assert.equal(existsSync(a.directory),true);
  const scan=await engine.invoke('deskFiles.scan',{memberId:'m-user'}) as DeskFileScan;assert.ok(scan.groups.some(g=>g.sessionId===a.sessionId&&g.deleted));assert.ok(!scan.groups.some(g=>g.sessionId===b.sessionId));
 }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

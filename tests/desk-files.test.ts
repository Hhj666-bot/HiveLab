import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,utimes} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {Store} from '../src/backend/store';
import {MemberWorkspaces} from '../src/backend/member-workspaces';
import {DeskFiles} from '../src/backend/desk-files';
import {WorkspaceFiles} from '../src/main/workspace-files';
import {BackgroundLibrary} from '../src/main/background-library';
import type {WorkspaceRoot} from '../src/shared/workspace-files';
import type {Session,Run} from '../src/shared/types';
import type {DeskRecycleItem} from '../src/shared/desk-files';

async function fixture(){
  const parent=path.resolve(process.env.TEMP!),root=await mkdtemp(path.join(parent,'desk-files-')),store=new Store(root);
  store.put('members','test-member',{id:'test-member',name:'测试工位',executor:'codex'});
  const session=(title:string):Session=>({id:randomUUID(),provider:'codex',memberId:'test-member',projectId:'desk-project',title,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),revision:1,writeMode:true});
  return {root,store,session,async close(){store.close();assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^desk-files-/);await rm(root,{recursive:true,force:true});}};
}

test('new personal topics own stable directories and the explorer groups them without moving legacy files',async()=>{
  const f=await fixture();
  try{
    const desks=new MemberWorkspaces(f.store,{
      createSession(projectId,member,title){const s={...f.session(title),projectId,memberId:member.id};f.store.put('sessions',s.id,s);return s;},
      async send(){return {};},async reply(){return {text:'',status:'done'};},async stop(){},async removeSession(){},async resetSession(){},changed(){},track(){},
    });
    const base=desks.folder('test-member');await writeFile(path.join(base,'old.txt'),'legacy');
    const first=await desks.newTopic('desk:test-member',{title:'第一项工作'}),second=await desks.newTopic('desk:test-member',{title:'第二项工作'});
    const records=desks.files.index();assert.equal(records.length,2);assert.notEqual(records[0].directory,records[1].directory);
    for(const record of records){const s=f.store.get<Session>('sessions',record.sessionId)!;assert.equal(s.deskWorkspace,true);assert.equal(s.workspace,record.directory);assert.equal(s.workspaceKind,'original');await writeFile(path.join(record.directory,'result.txt'),record.sessionId);}
    assert.equal(await readFile(path.join(base,'old.txt'),'utf8'),'legacy');assert.notEqual(first.id,second.id);
    const roots=[{id:'all',name:'全部会话',directory:base,kind:'desk' as const,memberId:'test-member',deskView:'all' as const},{id:'legacy',name:'历史未分类',directory:base,kind:'desk' as const,memberId:'test-member',deskView:'legacy' as const},...records.map(r=>({id:r.sessionId,name:r.title,directory:r.directory,kind:'session' as const,memberId:r.memberId,sessionId:r.sessionId,deskView:'session' as const}))];
    const explorer=new WorkspaceFiles(f.root,()=>roots),all=await explorer.list('all');assert.deepEqual(new Set(all.entries.map(e=>e.name)),new Set(['第一项工作','第二项工作']));
    assert.ok((await explorer.list('legacy')).entries.some(e=>e.name==='old.txt'));
    assert.equal((await explorer.list('legacy','sessions')).entries.length,0);
    await assert.rejects(explorer.rename('all',all.entries[0].path,'renamed'),/会话目录/);
    assert.throws(()=>explorer.trashTarget('all',all.entries[0].path),/工位清理/);
  }finally{await f.close();}
});

test('cleanup previews protect files, recover without overwriting, and apply configurable retention',async()=>{
  const f=await fixture();let blocked=false;
  const files=new DeskFiles(f.store,async(_paths,operation)=>{if(blocked)throw Error('busy fixture');return operation();});
  try{
    const a=f.session('报告'),b=f.session('引用');f.store.put('sessions',a.id,a);f.store.put('sessions',b.id,b);
    const directory=files.create('test-member',a);files.create('test-member',b);
    await writeFile(path.join(directory,'report.md'),'v1');await writeFile(path.join(directory,'keep.md'),'keep');await writeFile(path.join(directory,'reference.md'),'referenced');await writeFile(path.join(directory,'_临时','scratch.txt'),'temporary');
    await mkdir(path.join(directory,'.hivelab'));await writeFile(path.join(directory,'.hivelab','context.json'),'{}');
    files.keep(a.id,'keep.md',true);
    f.store.put('runs','reference',{id:'reference',sessionId:b.id,input:path.join(directory,'reference.md'),status:'completed',completedAt:new Date().toISOString()} as Run);
    let scan=await files.scan('test-member'),group=scan.groups.find(g=>g.sessionId===a.id)!;
    const selection=group.files.map(file=>({sessionId:a.id,path:file.path}));
    let preview=await files.preview('test-member',selection);assert.equal(preview.files.length,2);assert.equal(preview.skipped,3);
    await writeFile(path.join(directory,'report.md'),'changed since preview');
    const moved=await files.recycle(preview.token);assert.equal(moved.moved,1);assert.equal(moved.errors.length,1);assert.equal(await readFile(path.join(directory,'report.md'),'utf8'),'changed since preview');
    let recycled=(await files.scan('test-member')).recycle;assert.equal(recycled.length,1);await files.restore(recycled.map(r=>r.id));assert.equal(await readFile(path.join(directory,'_临时','scratch.txt'),'utf8'),'temporary');
    preview=await files.preview('test-member',[{sessionId:a.id,path:'report.md'}]);blocked=true;await assert.rejects(files.recycle(preview.token),/busy fixture/);blocked=false;assert.ok(existsSync(path.join(directory,'report.md')));
    preview=await files.preview('test-member',[{sessionId:a.id,path:'report.md'}]);await files.recycle(preview.token);recycled=(await files.scan('test-member')).recycle;
    await writeFile(path.join(directory,'report.md'),'newer user file');const conflict=await files.restore([recycled[0].id]);assert.equal(conflict.restored,0);assert.equal(await readFile(path.join(directory,'report.md'),'utf8'),'newer user file');
    await rm(path.join(directory,'report.md'));await files.restore([recycled[0].id]);assert.equal(await readFile(path.join(directory,'report.md'),'utf8'),'changed since preview');
    preview=await files.preview('test-member',[{sessionId:a.id,path:'report.md'}]);await files.recycle(preview.token);recycled=(await files.scan('test-member')).recycle;
    const old={...recycled[0],recycledAt:new Date(Date.now()-8*86400000).toISOString()};f.store.put('desk_recycle',old.id,old satisfies DeskRecycleItem);
    files.configure({recycleDays:0});await files.sweep();assert.ok(f.store.get('desk_recycle',old.id));
    files.configure({recycleDays:30});await files.sweep();assert.ok(f.store.get('desk_recycle',old.id));
    files.configure({recycleDays:1});await files.sweep();assert.equal(f.store.get('desk_recycle',old.id),undefined);
    const past=new Date(Date.now()-3*86400000);await utimes(path.join(directory,'_临时','scratch.txt'),past,past);
    files.configure({autoTemporary:true,temporaryDays:2});await files.sweep();scan=await files.scan('test-member');assert.ok(scan.recycle.some(r=>r.path==='_临时/scratch.txt'));assert.ok(existsSync(path.join(directory,'keep.md')));assert.ok(existsSync(path.join(directory,'reference.md')));assert.ok(existsSync(path.join(directory,'.hivelab','context.json')));
    const restarted=new DeskFiles(f.store);assert.equal(restarted.preferences().recycleDays,1);assert.equal(restarted.preferences().temporaryDays,2);
    assert.throws(()=>files.keep(a.id,'../../outside.txt',true),/超出/);
    f.store.put('runs','busy',{id:'busy',sessionId:a.id,input:'',status:'running'} as Run);group=(await files.scan('test-member')).groups.find(g=>g.sessionId===a.id)!;assert.ok(group.files.every(file=>file.protectedReason));
  }finally{await f.close();}
});

test('old sessions sharing a folder appear in all sessions and resolve files without moving their native workspaces',async()=>{
  const f=await fixture();
  try{
    const files=new DeskFiles(f.store),base=files.base('test-member'),a={...f.session('旧会话甲'),workspace:base,workspaceKind:'original' as const},b={...f.session('旧会话乙'),workspace:base,workspaceKind:'original' as const};
    for(const s of [a,b]){f.store.put('sessions',s.id,s);f.store.put('desk_topics','desk-topic-'+s.id,{id:'desk-topic-'+s.id,memberId:'test-member',sessionId:s.id,directory:base,direct:true});}
    await writeFile(path.join(base,'legacy.txt'),'original');
    const modern=f.session('独立会话');f.store.put('sessions',modern.id,modern);files.create('test-member',modern);
    const locations=files.index();assert.equal(locations.length,3);assert.equal(files.records('test-member').length,1);
    assert.ok(locations.filter(r=>[a.id,b.id].includes(r.sessionId)).every(r=>!r.managed&&r.sharedDirectory&&r.directory===base));
    const roots:WorkspaceRoot[]=[{id:'desk:test-member',name:'全部会话',directory:base,kind:'desk',memberId:'test-member',deskView:'all'},...locations.map(r=>({id:'session:'+r.sessionId,name:r.title,directory:r.directory,kind:'session' as const,memberId:r.memberId,sessionId:r.sessionId,deskView:'session' as const,managed:r.managed,sharedDirectory:r.sharedDirectory}))];
    const explorer=new WorkspaceFiles(f.root,()=>roots),all=await explorer.list('desk:test-member');assert.equal(all.entries.length,3);assert.equal(new Set(all.entries.map(e=>e.path)).size,3);
    const virtual='@sessions/'+a.id,children=await explorer.list('desk:test-member',virtual);assert.ok(children.entries.some(e=>e.path===virtual+'/legacy.txt'));
    const original=await explorer.read('desk:test-member',virtual+'/legacy.txt');assert.equal(original.content,'original');
    await explorer.save('desk:test-member',virtual+'/legacy.txt','edited',original.version);assert.equal((await explorer.read('session:'+a.id,'legacy.txt')).content,'edited');assert.equal((await explorer.read('session:'+b.id,'legacy.txt')).content,'edited');
    assert.equal(f.store.get<Session>('sessions',a.id)?.workspace,base);assert.equal(await readFile(path.join(base,'legacy.txt'),'utf8'),'edited');
    assert.throws(()=>explorer.resolve('desk:test-member','@sessions/unknown/file.txt'),/不可用/);assert.throws(()=>explorer.resolve('desk:test-member',virtual+'/../../outside.txt'),/超出/);
  }finally{await f.close();}
});

test('top toolbar transparency persists per page over its default',async()=>{
  const f=await fixture();
  try{
    const library=new BackgroundLibrary(f.root);assert.equal((await library.get('desk:test-member')).headerTransparency,95);
    await library.save({headerTransparency:70},'desk:test-member');assert.equal((await new BackgroundLibrary(f.root).get('desk:test-member')).headerTransparency,70);
    assert.equal((await library.get('desk:other')).headerTransparency,95);
    await library.save({headerTransparency:150},'desk:test-member');assert.equal((await library.get('desk:test-member')).headerTransparency,100);
  }finally{await f.close();}
});

test('file management includes legacy files once, recycles them manually, and keeps automatic cleanup scoped to new sessions',async()=>{
  const f=await fixture();
  try{
    const files=new DeskFiles(f.store),base=files.base('test-member');
    for(const title of ['原会话甲','原会话乙']){const s={...f.session(title),workspace:base,workspaceKind:'original' as const};f.store.put('sessions',s.id,s);f.store.put('desk_topics','desk-topic-'+s.id,{id:'desk-topic-'+s.id,memberId:'test-member',sessionId:s.id,directory:base,direct:true});}
    await writeFile(path.join(base,'old-report.md'),'old report');await mkdir(path.join(base,'_临时'));await writeFile(path.join(base,'_临时','old-scratch.txt'),'old scratch');
    await mkdir(path.join(base,'.gemini-api-home'));await writeFile(path.join(base,'.gemini-api-home','config.json'),'{}');
    await writeFile(path.join(files.shared('test-member'),'shared.txt'),'shared');
    const modern=f.session('新会话');f.store.put('sessions',modern.id,modern);const modernDirectory=files.create('test-member',modern);await writeFile(path.join(modernDirectory,'modern.md'),'modern');
    const scan=await files.scan('test-member'),legacy=scan.groups.find(g=>g.source==='legacy')!,shared=scan.groups.find(g=>g.source==='shared')!;
    assert.equal(scan.groups.filter(g=>g.source==='legacy').length,1);assert.equal(legacy.relatedSessionIds?.length,2);assert.ok(legacy.files.some(file=>file.path==='old-report.md'));assert.ok(legacy.files.every(file=>!file.path.includes('modern.md')&&!file.path.includes('shared.txt')));assert.equal(shared.files.length,1);
    assert.equal(scan.groups.flatMap(g=>g.files).filter(file=>file.path==='modern.md').length,1);assert.ok(legacy.files.find(file=>file.path==='.gemini-api-home/config.json')?.protectedReason);
    files.keep(legacy.sessionId,'old-report.md',true);await (await import('node:fs/promises')).rename(path.join(base,'old-report.md'),path.join(base,'renamed.md'));files.renamedAt(path.join(base,'old-report.md'),path.join(base,'renamed.md'));
    let current=(await files.scan('test-member')).groups.find(g=>g.source==='legacy')!;assert.equal(current.files.find(file=>file.path==='renamed.md')?.kept,true);files.keep(legacy.sessionId,'renamed.md',false);
    const preview=await files.preview('test-member',[{sessionId:legacy.sessionId,path:'renamed.md'}]);assert.equal(preview.files.length,1);const moved=await files.recycle(preview.token);assert.equal(moved.moved,1);assert.equal(existsSync(path.join(base,'renamed.md')),false);
    const recycle=(await files.scan('test-member')).recycle;await files.restore(recycle.map(r=>r.id));assert.equal(await readFile(path.join(base,'renamed.md'),'utf8'),'old report');
    const past=new Date(Date.now()-20*86400000);await utimes(path.join(base,'_临时','old-scratch.txt'),past,past);files.configure({autoTemporary:true,temporaryDays:1});await files.sweep();assert.equal(await readFile(path.join(base,'_临时','old-scratch.txt'),'utf8'),'old scratch');assert.equal(await readFile(path.join(files.shared('test-member'),'shared.txt'),'utf8'),'shared');
    for(const s of f.store.list<Session>('sessions').filter(s=>s.workspace===base))f.store.delete('sessions',s.id);
    current=(await files.scan('test-member')).groups.find(g=>g.source==='legacy')!;assert.ok(current.files.some(file=>file.path==='renamed.md'));
  }finally{await f.close();}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,existsSync} from 'node:fs';
import path from 'node:path';
import {WorkspaceFiles} from '../src/main/workspace-files';
import {WorkspaceTerminals} from '../src/main/workspace-terminal';
import {normalizeBackground} from '../src/shared/background';
import {BackgroundLibrary} from '../src/main/background-library';
function fixture(){const base=mkdtempSync(path.join(process.env.TEMP!,'workspace-files-')),root=path.join(base,'project');mkdirSync(root);return {base,root,files:new WorkspaceFiles(path.join(base,'data'),()=>[{id:'project:test',directory:root,name:'测试',kind:'project'}])};}
test('explorer scopes reads and mutations, lists folders before files and never overwrites on create or rename',async()=>{
 const {root,files}=fixture();mkdirSync(path.join(root,'资料'));writeFileSync(path.join(root,'说明.md'),'中文内容');writeFileSync(path.join(root,'.env'),'local-only');
 const listed=await files.list('project:test');assert.equal(listed.entries[0].name,'资料');assert.equal((await files.list('project:test','',false)).entries.some(e=>e.name==='.env'),false);
 for(const name of ['../outside','C:\\outside','file.txt:stream'])assert.throws(()=>files.resolve('project:test',name),/路径|工作区/);
 await assert.rejects(files.create('project:test','','../outside',false),/文件名/);await assert.rejects(files.create('project:test','','CON.txt',false),/文件名/);
 await assert.rejects(files.create('project:test','','说明.md',false));await files.create('project:test','资料','新文件.txt',false);await files.rename('project:test','资料/新文件.txt','改名.txt');assert.equal(existsSync(path.join(root,'资料/改名.txt')),true);await assert.rejects(files.rename('project:test','说明.md','.env'),/已存在/);
 assert.throws(()=>files.trashTarget('project:test',''),/根目录/);assert.throws(()=>files.resolve('unregistered','说明.md'),/不存在/);
});
test('editor preserves BOM, UTF16 endianness and Windows line endings; stale and concurrent saves cannot overwrite',async()=>{
 const {root,files}=fixture();const cases:[string,Buffer][]=[['utf8.txt',Buffer.from('第一行\r\n第二行\r\n')],['bom.txt',Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('第一行\r\n')])],['le.txt',Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('第一行\r\n','utf16le')])],['be.txt',Buffer.concat([Buffer.from([0xfe,0xff]),Buffer.from('第一行\r\n','utf16le').swap16()])]];
 for(const [name,bytes] of cases){writeFileSync(path.join(root,name),bytes);const before=await files.read('project:test',name),next=await files.save('project:test',name,'已修改\n',before.version);assert.notEqual(next.version,before.version);assert.equal((await files.read('project:test',name)).content,'已修改\r\n');assert.equal((await files.read('project:test',name)).encoding,before.encoding);await assert.rejects(files.save('project:test',name,'过期内容',before.version),/外部修改/);}
 writeFileSync(path.join(root,'race.txt'),'original');const version=(await files.read('project:test','race.txt')).version;const saved=await Promise.allSettled([files.save('project:test','race.txt','one',version),files.save('project:test','race.txt','two',version)]);assert.equal(saved.filter(r=>r.status==='fulfilled').length,1);assert.equal(readFileSync(path.join(root,'race.txt'),'utf8'),'one');
 writeFileSync(path.join(root,'bad.txt'),Buffer.from([0xff,0x80,0]));await assert.rejects(files.read('project:test','bad.txt'),/文本/);writeFileSync(path.join(root,'fake.pdf'),'%PDF');await assert.rejects(files.read('project:test','fake.pdf'),/默认应用/);
});
test('directory junctions cannot escape the selected root and picked folders persist by stable id',async()=>{
 const {base,root,files}=fixture(),outside=path.join(base,'outside');mkdirSync(outside);writeFileSync(path.join(outside,'private.txt'),'private');symlinkSync(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');assert.throws(()=>files.resolve('project:test','linked/private.txt'),/链接|之外/);
 const picked=files.add(outside),reopened=new WorkspaceFiles(path.join(base,'data'),()=>[]);assert.equal(reopened.roots()[0].id,picked.id);assert.equal((await reopened.read(picked.id,'private.txt')).content,'private');
});
test('identical personal/current desk folders have one entry, retain old IDs, and distinct working folders remain accessible',async()=>{
 const {base,root}=fixture(),other=path.join(base,'other');mkdirSync(other);let current=root;
 const files=new WorkspaceFiles(path.join(base,'data'),()=>[{id:'desk:m',name:'伙伴 · 工位文件夹',directory:root,kind:'desk'},{id:'desk-current:m',name:'伙伴 · 当前工作文件夹',directory:current,kind:'desk'}]);
 assert.equal(files.roots().length,1);assert.deepEqual(files.roots()[0].aliases,['desk-current:m']);assert.equal(files.resolve('desk:m'),files.resolve('desk-current:m'));
 current=other;assert.equal(files.roots().length,2);assert.equal(files.resolve('desk-current:m'),other);assert.equal(files.resolve('desk:m'),root);
});
test('sidebar wallpaper preferences clamp safely and fall back to the default',()=>{const old=normalizeBackground({mode:'studio'});assert.equal(old.sidebarTransparency,95);const next=normalizeBackground({mode:'studio',sidebarTransparency:123,extendToSidebar:true});assert.equal(next.sidebarTransparency,100);assert.equal('extendToSidebar' in next,false,'the wallpaper is always the whole window');});
test('sidebar wallpaper preferences persist through the native presentation whitelist and application restart',async()=>{const {base}=fixture(),library=new BackgroundLibrary(path.join(base,'wallpapers'));await library.save({sidebarTransparency:55},'home');const saved=await new BackgroundLibrary(path.join(base,'wallpapers')).get('home');assert.equal(saved.sidebarTransparency,55);assert.equal((await library.get('lounge')).sidebarTransparency,95);});
test('real pseudoterminal starts in the selected working directory, accepts input and closes without model calls',async()=>{
 const {root}=fixture(),terminals=new WorkspaceTerminals();try{const info=await terminals.open('project:test',root);terminals.write(info.id,process.platform==='win32'?"Write-Output ('workspace-result-'+(1+2))\r":"printf 'workspace-result-%s\\n' 3\r");const deadline=Date.now()+15000;let text='';while(Date.now()<deadline){text=terminals.read(info.id).data;if(text.includes('workspace-result-3'))break;await new Promise(r=>setTimeout(r,100));}assert.match(text,/workspace-result-3/);terminals.resize(info.id,120,30);terminals.close(info.id);assert.deepEqual(terminals.list(),[]);assert.throws(()=>terminals.read(info.id),/已关闭/);}finally{terminals.dispose();}
});

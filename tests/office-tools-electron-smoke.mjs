// Office files through the real process layout: read_file in an Electron utility process (as the execution service runs),
// PDF pages drawn in its worker thread, Excel/CSV written by the main process, and page images leaving the MCP bridge as image blocks.
import {build} from 'esbuild';
import {mkdir,readFile,symlink,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {createRequire} from 'node:module';
if(!process.env.HIVELAB_TEST_PROFILE)throw Error('Requires isolated test bootstrap');
const folder=path.join(process.env.HIVELAB_TEST_PROFILE,'office-tools-smoke');await mkdir(folder,{recursive:true});
// The bundles keep packages external, as the shipped app does; they resolve them through this link.
await symlink(path.resolve('node_modules'),path.join(folder,'node_modules'),'junction').catch(error=>{if(error.code!=='EEXIST')throw error;});
const src=file=>JSON.stringify(path.resolve(file));
await writeFile(path.join(folder,'service.ts'),`import {readSharedFile} from ${src('src/backend/shared-files.ts')};
process.parentPort.on('message',async({data})=>{try{const {bytes,...result}=await readSharedFile(data.file,data.options);process.parentPort.postMessage({ok:true,result});}catch(error){process.parentPort.postMessage({ok:false,error:error.message});}});`);
await writeFile(path.join(folder,'main.ts'),`import {app,utilityProcess} from 'electron';import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import http from 'node:http';import {spawn} from 'node:child_process';
import {FileOutputs} from ${src('src/main/file-output.ts')};import {xlsxContent} from ${src('src/backend/xlsx-write.ts')};import {pdf,pptx} from ${src('tests/office-fixtures.ts')};
const root=${JSON.stringify(folder)};app.setPath('userData',path.join(root,'electron'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const service=utilityProcess.fork(path.join(root,'service.mjs'),[],{stdio:'inherit'});
 const read=(file,options={})=>new Promise(resolve=>{service.once('message',resolve);service.postMessage({file,options});});
 const files=path.join(root,'files');await (await import('node:fs/promises')).mkdir(files,{recursive:true});
 await writeFile(path.join(files,'a.pdf'),pdf(['Alpha page','Beta page','']));await writeFile(path.join(files,'d.pptx'),pptx());
 await writeFile(path.join(files,'t.xlsx'),xlsxContent([{name:'表',rows:[['名称','金额'],['甲','12.5'],['合计','=SUM(B2:B2)']]}]));
 let reply=await read(path.join(files,'a.pdf'),{pages:'1-2',render:true});assert.equal(reply.ok,true,reply.error);
 const shot=reply.result;assert.equal(shot.pageCount,3);assert.match(shot.content,/Alpha page[\\s\\S]*Beta page/);assert.equal(shot.images.length,2);
 assert.equal(Buffer.from(shot.images[1].data,'base64').subarray(1,4).toString(),'PNG');
 reply=await read(path.join(files,'d.pptx'));assert.match(reply.result.content,/封面\\n备注：讲者备注/);
 reply=await read(path.join(files,'t.xlsx'),{sheet:'表'});assert.match(reply.result.content,/\\n2\\t甲\\t12\\.5\\n3\\t合计\\t=SUM\\(B2:B2\\)/);
 // Files written by the main process, then read back by the service.
 const outputs=new FileOutputs(root);
 const book=await outputs.create({name:'报表',format:'xlsx',sheets:[{name:'汇总',rows:[['日期','数量'],['2026-11-09','3']]},{name:'备注',rows:[['说明']],header:false}]});
 assert.equal(book.name,'报表.xlsx');assert.equal(book.format,'xlsx');
 reply=await read(path.join(root,'generated-files',book.id,book.name));assert.deepEqual(reply.result.sheets.map(s=>s.name),['汇总','备注']);assert.match(reply.result.content,/\\n2\\t2026-11-09\\t3/);
 const fromText=await outputs.create({name:'清单',format:'xlsx',content:'| 名称 | 数量 |\\n|---|---|\\n| 乙 | 7 |'});
 reply=await read(path.join(root,'generated-files',fromText.id,fromText.name));assert.match(reply.result.content,/\\n2\\t乙\\t7/);
 const csv=await outputs.create({name:'导出',format:'csv',content:'名称,数量\\n丙,1\\n'});
 assert.equal((await readFile(path.join(root,'generated-files',csv.id,csv.name))).subarray(0,3).toString('hex'),'efbbbf');
 await assert.rejects(()=>outputs.create({name:'坏',format:'xlsx'}),/sheets/);
 service.kill();
 // MCP bridge: the page images become image blocks after one text block.
 const server=http.createServer((request,response)=>{let body='';request.on('data',c=>body+=c);request.on('end',()=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({result:shot}));});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const bridge=spawn(process.execPath,[${src('scripts/hivelab-tools.mjs')},'--mcp'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',HIVELAB_CONTROL_URL:'http://127.0.0.1:'+server.address().port+'/call',HIVELAB_CONTROL_TOKEN:'t'},stdio:['pipe','pipe','inherit']});
 const answer=await new Promise(resolve=>{let out='';bridge.stdout.on('data',d=>{out+=d;if(out.includes('\\n'))resolve(JSON.parse(out.split('\\n')[0]));});bridge.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read_file',arguments:{path:'a.pdf',render:true}}})+'\\n');});
 bridge.kill();server.close();
 const content=answer.result.content;assert.deepEqual(content.map(c=>c.type),['text','image','image']);
 const meta=JSON.parse(content[0].text);assert.deepEqual(meta.images.map(i=>i.page),[1,2]);assert.equal(meta.images[0].data,undefined);assert.equal(content[1].mimeType,'image/png');
 await writeFile(path.join(root,'done.json'),JSON.stringify({ok:true,pages:shot.images.map(i=>[i.width,i.height])}));app.quit();
}).catch(async error=>{await writeFile(path.join(root,'done.json'),JSON.stringify({ok:false,error:String(error?.stack??error)}));app.exit(1);});`);
const options={bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',banner:{js:"import {createRequire as __hivelabRequire} from 'node:module';const require=__hivelabRequire(import.meta.url);"}};
await build({...options,entryPoints:[path.join(folder,'service.ts')],outfile:path.join(folder,'service.mjs')});
await build({...options,entryPoints:['src/backend/pdf-thread.ts'],outfile:path.join(folder,'pdf-thread.mjs')});
await build({...options,entryPoints:[path.join(folder,'main.ts')],outfile:path.join(folder,'main.mjs')});
const electron=createRequire(import.meta.url)('electron'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
await new Promise((resolve,reject)=>{const child=spawn(electron,[path.join(folder,'main.mjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const timer=setTimeout(()=>{child.kill();reject(Error('office smoke timed out\n'+output));},120000);child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(`office smoke exited ${code}\n${output}`));});});
const report=JSON.parse(await readFile(path.join(folder,'done.json'),'utf8'));if(!report.ok)throw Error(report.error);
console.log('PASS: utility-process read_file for PDF text/images, PPTX notes and XLSX formulas; worker-thread PDF drawing; main-process XLSX (sheets and Markdown) and BOM CSV; MCP bridge image blocks',JSON.stringify(report.pages));

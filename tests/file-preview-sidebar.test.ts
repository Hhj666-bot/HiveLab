import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {previewFile,resolveFileReference} from '../src/main/file-preview';
import {previewDocument} from './fixtures/preview-document';
import {FilePreviewServer} from '../src/main/file-preview-server';
import {delimitedRows} from '../src/main/delimited-preview';

test('sidebar preview returns the same scoped DOCX bytes for layout and safely reads workspace, generated and attached images',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'sidebar-preview-')),id='00000000-0000-4000-8000-000000000099',folder=path.join(root,'attachments',id);mkdirSync(folder,{recursive:true});
 const bytes=previewDocument();writeFileSync(path.join(folder,'报告.docx'),bytes);
 const word=await previewFile(root,{} as any,{source:'attachment',id,name:'报告.docx'});assert.equal(word.kind,'word');assert.deepEqual(Buffer.from(word.base64!,'base64'),bytes);assert.match(word.content!,/HiveLab 文档预览/);
 const image=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="teal"/></svg>');writeFileSync(path.join(folder,'插图.svg'),image);
 const attached=await previewFile(root,{} as any,{source:'attachment',id,name:'插图.svg'});assert.equal(attached.kind,'image');assert.equal(attached.language,'svg');assert.equal(attached.content,image.toString('utf8'));assert.equal(attached.dataUrl,'data:image/svg+xml;base64,'+image.toString('base64'));
 const outputs={resolve:async()=>({file:{name:'插图.svg'},target:path.join(folder,'插图.svg')})};assert.equal((await previewFile(root,outputs as any,{source:'generated',id})).kind,'image');
 assert.equal((await previewFile(root,{} as any,{source:'attachment',id,name:'报告.docx',resource:'插图.svg'})).kind,'image');
 await assert.rejects(previewFile(root,{} as any,{source:'attachment',id,name:'报告.docx',resource:'../outside.svg'}),/路径|范围|目录/);
 await assert.rejects(previewFile(root,{} as any,{source:'attachment',id,name:'报告.docx',resource:'https://example.com/image.png'}),/资源路径/);
 assert.equal((await previewFile(root,{} as any,{source:'workspace',id:'session',path:'插图.svg'},async()=>path.join(folder,'插图.svg'))).kind,'image');
 await assert.rejects(previewFile(root,{} as any,{source:'attachment',id,name:'../插图.svg'}),/标识无效/);
 writeFileSync(path.join(folder,'损坏.docx'),'invalid');await assert.rejects(previewFile(root,{} as any,{source:'attachment',id,name:'损坏.docx'}),/DOCX/);
});

test('file location actions resolve stored files and scoped explorer folders without parsing or opening them',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'file-location-')),id='00000000-0000-4000-8000-000000000099',folder=path.join(root,'attachments',id);mkdirSync(folder,{recursive:true});
 const target=path.join(folder,'报告.docx');writeFileSync(target,'not a document, location still works');
 assert.equal((await resolveFileReference(root,{} as any,{source:'attachment',id,name:'报告.docx'})).target,target);
 const outputs={resolve:async()=>({file:{name:'报告.docx'},target})};assert.equal((await resolveFileReference(root,outputs as any,{source:'generated',id})).target,target);
 assert.equal((await resolveFileReference(root,{} as any,{source:'explorer',id:'root',path:''},async reference=>{assert.equal(reference.id,'root');return folder;})).target,folder);
 await assert.rejects(resolveFileReference(root,{} as any,{source:'attachment',id,name:'../outside.docx'}),/标识无效/);
 await assert.rejects(resolveFileReference(root,{} as any,{source:'attachment',id,name:'报告.docx',resource:'../../outside.txt'}),/路径|范围|目录/);
});

test('HTML, CSV/TSV, AVIF and common media get dedicated previews; legacy and binary formats stay explicit',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'preview-formats-')),id='00000000-0000-4000-8000-000000000099',folder=path.join(root,'attachments',id);mkdirSync(folder,{recursive:true});
 const read=async(name:string,content:string|Buffer)=>{writeFileSync(path.join(folder,name),content);return previewFile(root,{} as any,{source:'attachment',id,name});};
 for(const name of ['流程图.html','网页.HTM']){const data=await read(name,'<!doctype html><h1>流程图</h1><script>document.title="preview"</script>');assert.equal(data.kind,'html');assert.match(data.content!,/流程图/);}
 const utf16=await read('编码.html',Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('<h1>中文</h1>','utf16le')]));assert.equal(utf16.kind,'html');assert.match(utf16.content!,/中文/);
 const csv=await read('数据.csv','\ufeff名称,说明,值\r\n甲,"逗号,换行\n以及""引号""",42\r\n');assert.equal(csv.kind,'spreadsheet');assert.deepEqual(csv.sheets?.[0].rows,[['名称','说明','值'],['甲','逗号,换行\n以及"引号"','42']]);assert.ok(csv.content);assert.equal(csv.language,'csv');
 assert.deepEqual((await read('数据.tsv','项目\t数值\n甲\t12')).sheets?.[0].rows,[['项目','数值'],['甲','12']]);
 for(const name of ['音乐.mp3','录音.wav','声音.ogg','语音.m4a','音频.flac'])assert.equal((await read(name,'fixture')).kind,'audio');
 for(const name of ['视频.mp4','录屏.webm','影片.mov'])assert.equal((await read(name,'fixture')).kind,'video');
 assert.equal((await read('图片.avif','fixture')).kind,'image');
 for(const name of ['文档.doc','数据.xls','演示.ppt','文字.rtf','照片.heic','压缩.zip']){await read(name,'fixture');const result=await previewFile(root,{} as any,{source:'explorer',id:'root',path:name},async()=>path.join(folder,name));assert.equal(result.kind,'unsupported',name);}
 assert.deepEqual(delimitedRows('""',','),[['']]);assert.deepEqual(delimitedRows('a,',','),[['a','']]);
 assert.equal(delimitedRows(Array.from({length:501},()=>Array(81).fill('x').join(',')).join('\n'),',').length,500);assert.equal(delimitedRows(Array(81).fill('x').join(','),',')[0].length,80);
});

test('HTML resource capabilities preserve scope, content policy, UTF16 and media byte ranges',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'preview-server-')),id='00000000-0000-4000-8000-000000000099',folder=path.join(root,'attachments',id);mkdirSync(path.join(folder,'assets'),{recursive:true});
 writeFileSync(path.join(folder,'流程.html'),Buffer.concat([Buffer.from([0xfe,0xff]),Buffer.from('<h1>中文流程</h1>','utf16le').swap16()]));writeFileSync(path.join(folder,'assets','view.css'),'h1{color:teal}');writeFileSync(path.join(folder,'clip.wav'),'0123456789');writeFileSync(path.join(folder,'.env'),'SECRET');writeFileSync(path.join(root,'outside.js'),'outside');
 const server=new FilePreviewServer(ref=>resolveFileReference(root,{} as any,ref));const ref={source:'attachment' as const,id,name:'流程.html'},url=server.open(ref,'流程.html');assert.equal(server.open(ref,'流程.html'),url);assert.ok(!url.includes(folder));
 const response=await server.serve(new Request(url));assert.equal(response.status,200);assert.match(await response.text(),/中文流程/);assert.match(response.headers.get('Content-Security-Policy')!,/sandbox allow-scripts/);assert.doesNotMatch(response.headers.get('Content-Security-Policy')!,/allow-same-origin|file:|hivelab-asset:/);
 const asset=await server.serve(new Request(new URL('assets/view.css',url)));assert.equal(asset.status,200);assert.match(await asset.text(),/color:teal/);assert.equal(asset.headers.get('Access-Control-Allow-Origin'),'*');
 assert.equal((await server.serve(new Request(new URL('.env',url)))).status,415);assert.equal((await server.serve(new Request(new URL('%2e%2e%5coutside.js',url)))).status,404);assert.equal((await server.serve(new Request('hivelab-preview://unknown/a.html'))).status,404);
 const audio=server.open({source:'attachment',id,name:'clip.wav'},'clip.wav');const partial=await server.serve(new Request(audio,{headers:{Range:'bytes=2-5'}}));assert.equal(partial.status,206);assert.equal(partial.headers.get('Content-Range'),'bytes 2-5/10');assert.equal(await partial.text(),'2345');
 const suffix=await server.serve(new Request(audio,{headers:{Range:'bytes=-3'}}));assert.equal(await suffix.text(),'789');assert.equal((await server.serve(new Request(audio,{headers:{Range:'bytes=99-'}}))).status,416);
 // A resource opened through a Markdown link keeps its original subdirectory.
 writeFileSync(path.join(folder,'assets','page.html'),'<h1>nested</h1>');const nested=server.open({...ref,resource:'assets/page.html'},'page.html');assert.match(await (await server.serve(new Request(new URL('view.css',nested)))).text(),/color:teal/);
});

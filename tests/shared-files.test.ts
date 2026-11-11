import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {docxContent,zipParts} from '../src/backend/document-output';
import {wordParts,wordBlocks,replaceWordText} from '../src/backend/word-document';
import {readSharedFile,editSharedFile} from '../src/backend/shared-files';
import {previewFile} from '../src/main/file-preview';
import {Engine} from '../src/backend/engine';
import {attachmentPath} from '../src/backend/attachments';
import {DeepseekAdapter} from '../src/backend/adapters/deepseek';
import {CONTROL_TOOLS} from '../src/backend/agent-control';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';
import {hivelabMcpEnvironment} from '../src/backend/adapters/hivelab-mcp';
const until=async(read:()=>boolean)=>{for(let i=0;i<250;i++){if(read())return;await new Promise(r=>setTimeout(r,12));}throw Error('not settled');};

test('Word previews all three origins, edits split runs and preserves unrelated binary parts',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'word-preview-')),id=randomUUID(),folder=path.join(root,'attachments',id);mkdirSync(folder,{recursive:true});
 try{
  const parts=wordParts(docxContent('# 项目计划\n你好 & 朋友\n尾段'));
  parts['word/document.xml']=Buffer.from(parts['word/document.xml'].toString().replace('你好 &amp; 朋友','你好</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t> &amp; 朋友'));
  parts['word/media/image.png']=Buffer.from([0,1,254,255]);const original=zipParts(parts),target=path.join(folder,'计划.docx');writeFileSync(target,original);
  for(const source of ['attachment','generated','workspace'] as const){const value=await previewFile(root,{resolve:async()=>({target,file:{name:'计划.docx'}})} as any,{source,id,name:'计划.docx'},async()=>target);assert.equal(value.kind,'word');assert.equal(value.blocks?.[0].heading,1);assert.match(value.content!,/你好 & 朋友/);}
  const file=await readSharedFile(target),changed=await editSharedFile(target,{expectedHash:file.sha256,oldText:'好 & 朋',newText:'好 <新> 朋'});assert.ok('bytes' in changed);if(!('bytes' in changed))throw Error('no bytes');
  assert.match(wordBlocks(changed.bytes).map(p=>p.text).join('\n'),/你好 <新> 朋友/);assert.deepEqual(wordParts(changed.bytes)['word/media/image.png'],parts['word/media/image.png']);assert.deepEqual(wordParts(changed.bytes)['word/styles.xml'],parts['word/styles.xml']);assert.deepEqual(readFileSync(target),original);
  assert.throws(()=>replaceWordText(docxContent('同文同文'),'同文','新文'),/2 处/);assert.equal(replaceWordText(docxContent('同文同文'),'同文','新文',true).replacements,2);
  await assert.rejects(editSharedFile(target,{expectedHash:'stale',oldText:'你好',newText:'再见'}),/文件已变化/);assert.throws(()=>replaceWordText(original,'你好','换\n段'),/单段落/);
  const corrupt=Buffer.from(original);corrupt[50]^=255;assert.throws(()=>wordParts(corrupt));assert.throws(()=>wordParts(Buffer.from('not a docx')),/有效/);
  const code=path.join(folder,'demo.py');writeFileSync(code,'print("你好")\n');const read=await readSharedFile(code),edit=await editSharedFile(code,{expectedHash:read.sha256,oldText:'你好',newText:'世界'});assert.equal(edit.format,'code');assert.equal('content' in edit&&edit.content,'print("世界")\n');
 }finally{rmSync(root,{recursive:true,force:true});}
});

for(const provider of ['codex','claude','dsh'] as const)test(`${provider} shares file tools, returns downloadable revised Word, and respects session/path boundaries`,async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'common-files-'));let ctx:any,release!:()=>void;const done=new Promise<void>(r=>release=r);
 const engine=new Engine(root,()=>{},()=>{},id=>({async probe(){return {id,name:id,auth:'subscription',available:true,detail:'mock',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true}};},async start(context){ctx=context;ctx.markDelivery('confirmed');await done;return {};},async stop(){release();}}),{maintenanceOnly:true,hostOperation:async(method,p:any)=>{const id=randomUUID(),args=p.args,name=args.name.endsWith('.docx')?args.name:args.name+'.docx',folder=path.join(root,'generated-files',id);mkdirSync(folder,{recursive:true});const bytes=method==='file.importWord'?Buffer.from(args.base64,'base64'):docxContent(args.content);writeFileSync(path.join(folder,name),bytes);const file={id,name,format:'docx',bytes:bytes.length,createdAt:new Date().toISOString()};writeFileSync(path.join(root,'generated-files',id+'.json'),JSON.stringify(file));return file;}});
 try{
  engine.store.put('members','member',{id:'member',executor:provider,name:'测试成员',color:'#339966',motto:''});await engine.probe(provider);await engine.invoke('desk.open',{memberId:'member'});await engine.invoke('desk.topic',{memberId:'member'});
  const note=path.join(root,'附件说明.txt');writeFileSync(note,'附件正文');const attachments=await engine.invoke('attachment.import',{paths:[note]}) as any[];
  await engine.invoke('room.send',{roomId:'desk:member',text:'mock',attachments});await until(()=>!!ctx);
  // An attachment can also be named by its absolute path; other absolute paths stay outside.
  assert.equal((await ctx.callOperation('read_file',{path:attachmentPath(root,attachments[0])})).content,'附件正文');
  await assert.rejects(ctx.callOperation('read_file',{path:note}));
  for(const name of ['create_file','read_file','edit_file','ask_user'])assert.ok(ctx.operationTools().some((t:any)=>t.name===name));
  const created=await ctx.callOperation('create_file',{name:'报告.docx',format:'docx',content:'# 标题\n原文'}),read=await ctx.callOperation('read_file',{fileId:created.id});assert.match(read.content,/原文/);
  const edited=await ctx.callOperation('edit_file',{fileId:created.id,expectedHash:read.sha256,oldText:'原文',newText:'修改后'});assert.equal(edited.originalUnchanged,true);assert.notEqual(edited.id,created.id);assert.match((await ctx.callOperation('read_file',{fileId:edited.id})).content,/修改后/);assert.match((await ctx.callOperation('read_file',{fileId:created.id})).content,/原文/);
  await assert.rejects(ctx.callOperation('read_file',{path:'../outside.txt'}),/超出/);await assert.rejects(ctx.callOperation('read_file',{attachmentId:randomUUID()}),/授权范围/);
  const foreign=randomUUID();engine.store.put('generated_files',foreign,{id:foreign,name:'other.docx',sessionId:'other'});await assert.rejects(ctx.callOperation('read_file',{fileId:foreign}),/当前会话/);
  const outputs=await engine.invoke('file.outputs',{runId:ctx.run.id}) as any[];assert.equal(outputs.length,2);release();await until(()=>engine.snapshot().runs.every(r=>['ended','stopped'].includes(r.status)));await assert.rejects(ctx.callOperation('read_file',{fileId:created.id}),/结束/);
 }finally{release();await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('DeepSeek API advertises shared tools and dispatches file/structured questions without screen control or paid calls',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'api-files-')),calls:any[]=[],requests:any[]=[];let step=0;
 const names=['create_file','read_file','edit_file','ask_user'];
 const fetch:any=async(_url:string,init:any)=>{const body=JSON.parse(init.body);requests.push(body);const name=names[step++],delta=name?{tool_calls:[{index:0,id:'call-'+step,type:'function',function:{name,arguments:JSON.stringify(name==='ask_user'?{questions:[{id:'q',question:'继续？',options:[{label:'继续'}]}]}:{name:'计划',format:'docx',content:'内容'})}}]}:{content:'完成'};return new Response('data: '+JSON.stringify({choices:[{delta}]})+'\n\ndata: [DONE]\n\n');};
 const adapter=new DeepseekAdapter(()=> 'test-api-key',root,fetch);
 try{await adapter.start({run:{id:'r'},session:{id:'s'},cwd:root,env:{},settings:{...DEFAULT_SETTINGS,models:{deepseek:'test-model'}},emit:()=>{},markDelivery:()=>{},operationTools:()=>CONTROL_TOOLS,callOperation:async(name:string,args:unknown,signal?:AbortSignal)=>{assert.equal(signal?.aborted,false);calls.push({name,args});return name==='ask_user'?{cancelled:false,answers:{q:'继续'}}:{id:'result',content:'内容'};}} as any,'交付 Word');assert.deepEqual(calls.map(c=>c.name),names);assert.equal(requests.length,5);const listed=requests[0].tools;assert.ok(listed.find((t:any)=>t.function.name==='ask_user').function.parameters.properties.questions);assert.ok(!listed.some((t:any)=>t.function.name==='computer'));assert.ok(requests.at(-1).messages.some((m:any)=>m.role==='tool'&&m.content.includes('继续')));
 }finally{await adapter.stop();rmSync(root,{recursive:true,force:true});}
});

test('Claude and ACP share explicit narrow MCP auth environment',()=>{assert.deepEqual(hivelabMcpEnvironment({HIVELAB_CONTROL_URL:'http://127.0.0.1:1/tools',HIVELAB_CONTROL_TOKEN:'capability',ANTHROPIC_API_KEY:'do-not-forward'}),{ELECTRON_RUN_AS_NODE:'1',HIVELAB_CONTROL_URL:'http://127.0.0.1:1/tools',HIVELAB_CONTROL_TOKEN:'capability'});assert.throws(()=>hivelabMcpEnvironment({}),/缺少/);});

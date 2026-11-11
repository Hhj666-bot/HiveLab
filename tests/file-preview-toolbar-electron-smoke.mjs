import assert from 'node:assert/strict';
import {unfoldSettings} from './helpers/settings-menu.mjs';
import path from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {_electron,expect} from '@playwright/test';
import {Engine} from '../src/backend/engine.ts';
import {previewDocument} from './fixtures/preview-document.ts';
if(!process.env.HIVELAB_TEST_PROFILE)throw Error('Requires isolated test bootstrap');
const data=process.env.HIVELAB_DATA_DIR,id='00000000-0000-4000-8000-000000000088',folder=path.join(data,'attachments',id),at=new Date().toISOString();await mkdir(folder,{recursive:true});
const files=[{name:'预览报告.docx',kind:'file',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:previewDocument()},{name:'预览代码.ts',kind:'text',mime:'text/plain',bytes:Buffer.from('const greeting: string = "Hello HiveLab";\nexport function welcome() { return greeting; }\n')},{name:'预览说明.md',kind:'text',mime:'text/markdown',bytes:Buffer.from('# 桌面预览验证\n\n这里是 **渲染后的 Markdown**。\n\n| 类型 | 状态 |\n|---|---|\n| 侧栏 | 正常 |')},{name:'预览图片.png',kind:'image',mime:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG3sAAAAASUVORK5CYII=','base64')}];
const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="assets/chart.css"><h1>FFT 流程图</h1><svg width="240" height="80"><rect width="240" height="80" fill="teal"/><text x="20" y="45" fill="white">拆分 → 递归 → 合并</text></svg><img src="预览图片.png" alt="同目录图片"><button id="count">交互 0</button><script>let n=0;document.querySelector("#count").onclick=()=>document.querySelector("#count").textContent="交互 "+(++n);window.bridgeAvailable=typeof window.hivelab;try{parent.document.body.dataset.previewInjected="true"}catch{document.body.dataset.parentBlocked="true"}</script><script src="assets/chart.js"></script></html>';
const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
files.push({name:'FFT流程图.html',kind:'text',mime:'text/html',bytes:Buffer.from(html)},{name:'统计.csv',kind:'text',mime:'text/csv',bytes:Buffer.from('项目,数值,备注\r\nFFT,8,"含,逗号"\r\n')},{name:'示例.wav',kind:'file',mime:'audio/wav',bytes:wav},{name:'示例.webm',kind:'file',mime:'video/webm',bytes:await readFile(new URL('./fixtures/background.webm',import.meta.url))},{name:'旧版.xls',kind:'file',mime:'application/vnd.ms-excel',bytes:Buffer.from('legacy')});
await mkdir(path.join(folder,'assets'));await writeFile(path.join(folder,'assets','chart.css'),'h1{color:rgb(12, 90, 80)}');await writeFile(path.join(folder,'assets','chart.js'),'document.body.dataset.externalScript="loaded"');
// The generated-file card from the reported flow uses the same dedicated viewer.
const generatedId='00000000-0000-4000-8000-000000000089',generatedFolder=path.join(data,'generated-files',generatedId);await mkdir(generatedFolder,{recursive:true});await writeFile(path.join(generatedFolder,'成果.htm'),'<!doctype html><meta charset="utf-8"><h1>生成的 HTML 成果</h1>');await writeFile(path.join(data,'generated-files',generatedId+'.json'),JSON.stringify({id:generatedId,name:'成果.htm',format:'code',bytes:Buffer.byteLength(html),createdAt:at}));
for(const file of files)await writeFile(path.join(folder,file.name),file.bytes);
const engine=new Engine(data,()=>{},()=>{},undefined,{maintenanceOnly:true});
try{const room=await engine.invoke('room.get',{roomId:'global'});engine.store.put('room_messages','preview-files',{id:'preview-files',threadId:room.currentThreadId,roomId:'global',author:'user',text:'在侧栏中查看这些文件。',at,attachments:files.map(file=>({id,name:file.name,kind:file.kind,mime:file.mime,size:file.bytes.length}))});}finally{await engine.close();}
const executable=process.env.HIVELAB_ELECTRON_EXE??process.env.HIVELAB_TEST_EXECUTABLE??path.resolve('node_modules/electron/dist/electron.exe'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:executable,args:process.env.HIVELAB_SMOKE_APP_ROOT||process.env.HIVELAB_TEST_EXECUTABLE?[]:[path.resolve('.')],env,timeout:30000});
try{
 const page=await app.firstWindow();
 await expect.poll(()=>page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.backendReady).catch(()=>false)),{timeout:25000}).toBe(true);
 console.log('Backend ready.');
 await page.getByRole('button',{name:'外观',exact:true}).click();await unfoldSettings(page);await page.getByRole('checkbox',{name:'液态玻璃',exact:true}).check();await page.getByRole('checkbox',{name:'自适应文本对比色',exact:true}).uncheck();await page.getByRole('dialog').getByRole('button',{name:'关闭对话框',exact:true}).click();console.log('Glass enabled.');
 await page.getByRole('button',{name:'茶歇室',exact:true}).click();
 await page.locator('.attachment-file-preview').filter({hasText:'FFT流程图.html'}).click();
 console.log('Opened HTML.');const panel=page.getByRole('complementary',{name:'文件预览侧栏'}),frame=panel.frameLocator('iframe');
 await expect(frame.getByRole('heading',{name:'FFT 流程图'})).toBeVisible();
 await expect(panel.getByRole('button',{name:'在资源管理器中打开',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'更多文件操作',exact:true})).toHaveCount(0);
 await frame.getByRole('button',{name:'交互 0'}).click();await expect(frame.getByRole('button',{name:'交互 1'})).toBeVisible();
 console.log('HTML geometry',await panel.locator('iframe').evaluate(n=>({rect:n.getBoundingClientRect().toJSON(),parent:n.parentElement.getBoundingClientRect().toJSON(),panel: getComputedStyle(n.closest('.file-preview-panel')).backdropFilter})));
 const out=process.env.HIVELAB_PREVIEW_CAPTURE_DIR;if(out){await mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'html-glass.png')});}
 console.log('PASS: native sandboxed HTML loads and responds; direct Explorer action; no overflow menu.');
}catch(error){const out=process.env.HIVELAB_PREVIEW_CAPTURE_DIR;console.error(error.message);if(out){await mkdir(out,{recursive:true});await (await app.firstWindow()).screenshot({path:path.join(out,'failure.png'),timeout:5000}).catch(()=>{});}throw error;}finally{await app.close();}


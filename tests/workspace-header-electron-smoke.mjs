import assert from 'node:assert/strict';
import {unfoldSettings} from './helpers/settings-menu.mjs';
import path from 'node:path';
import {mkdirSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {_electron,expect} from '@playwright/test';
import {enterWorkspace} from './helpers/desktop-ready.mjs';
import {isolatedTestEnvironment,cleanupTestEnvironment} from '../scripts/test-environment.mjs';
const {directory,env}=isolatedTestEnvironment(process.env,process.cwd());delete env.ELECTRON_RUN_AS_NODE;
const db=new DatabaseSync(path.join(env.HIVELAB_DATA_DIR,'hivelab.sqlite'));db.exec('CREATE TABLE entities(entity TEXT,id TEXT,value TEXT,PRIMARY KEY(entity,id))');
const put=(entity,id,value)=>db.prepare('INSERT INTO entities VALUES(?,?,?)').run(entity,id,JSON.stringify(value));
put('members','test-member',{id:'test-member',name:'测试成员',executor:'codex',color:'#7b6fd6'});
put('room_messages','test-message',{id:'test-message',author:'user',text:'保留的测试消息',threadId:'room-main',at:new Date().toISOString(),status:'done'});
put('room','state',{roomId:'global',active:false,mode:'discuss',discussion:{id:'test-discussion',phase:'paused',style:'chat',members:['test-member'],revision:1,seen:{},lastSpoke:{},priority:[],calls:0,limit:0,allowance:0,minutes:0,deadline:0,questions:[],reviewRequired:[],noProgress:0,latestUserId:'test-message',reason:'测试暂停状态'}});
const projectDir=path.join(directory,'project');mkdirSync(projectDir);put('projects','test-project',{id:'test-project',name:'测试项目',directory:projectDir,memberIds:['test-member'],createdAt:new Date().toISOString()});db.close();
const executablePath=process.env.HIVELAB_TEST_EXECUTABLE??process.env.HIVELAB_ELECTRON_EXE??path.resolve('node_modules/electron/dist/electron.exe');
const args=process.env.HIVELAB_TEST_APP?[path.resolve(process.env.HIVELAB_TEST_APP)]:process.env.HIVELAB_TEST_EXECUTABLE||process.env.HIVELAB_SMOKE_APP_ROOT?[]:[path.resolve('.')];
const shots=process.env.HIVELAB_TEST_SHOTS??path.resolve('tests/ui/results');mkdirSync(shots,{recursive:true});
let app;const errors=[];
async function launch(){app=await _electron.launch({executablePath,args,env,timeout:30000});const page=await app.firstWindow();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));await expect.poll(()=>page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.backendReady).catch(()=>false)),{timeout:25000}).toBe(true);await enterWorkspace(page);return page;}
async function sharedTools(page){
 const nav=page.getByRole('navigation',{name:'工作区工具',exact:true});await expect(nav).toBeVisible();await expect(nav.getByRole('button')).toHaveCount(4);
 for(const name of ['切换工作区终端','文件','外观'])await expect(nav.getByRole('button',{name,exact:true})).toBeVisible();
 const boxes=await nav.getByRole('button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert.ok(Math.max(...boxes)-Math.min(...boxes)<2,'four controls occupy one row');
 await nav.getByRole('button',{name:'文件',exact:true}).click();for(const name of ['查看当前会话文件','管理工位文件','个人文件夹','切换工位文件夹'])await expect(nav.getByRole('button',{name,exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await nav.getByRole('button',{name:'外观',exact:true}).click();await unfoldSettings(page);const appearance=page.getByRole('dialog',{name:'设置与成员连接',exact:true});await expect(appearance).toBeVisible();await expect(appearance.getByLabel('欢迎卡片透明度',{exact:true})).toBeVisible();await appearance.getByRole('button',{name:'关闭对话框',exact:true}).click();
 await expect(nav.getByRole('button')).toHaveCount(4);
}
try{
 let page=await launch();await sharedTools(page);
 const rosterGeometry=await page.locator('.roster-with-desk').first().evaluate(row=>{const avatar=row.querySelector('.avatar').getBoundingClientRect(),bounds=row.getBoundingClientRect();return {avatar:avatar.width,height:bounds.height,inset:avatar.left-bounds.left};});assert.equal(rosterGeometry.avatar,28);assert.ok(Math.abs(rosterGeometry.height-46)<0.25&&Math.abs(rosterGeometry.inset-10)<0.25,'the actual sidebar keeps a plain 46px row with 10px content padding: '+JSON.stringify(rosterGeometry));const attentionBubble=page.getByRole('button',{name:'消息',exact:true});await attentionBubble.hover();assert.equal((await attentionBubble.boundingBox()).width,44);
 await page.getByRole('button',{name:'设置',exact:true}).click();const covenantSettings=page.getByRole('dialog',{name:'设置与成员连接',exact:true});await unfoldSettings(page);await covenantSettings.getByRole('button',{name:'工作公约',exact:true}).click();const covenantFile=path.join(env.HIVELAB_DATA_DIR,'workspace-covenant.md');await expect(covenantSettings.getByLabel('工作公约预览',{exact:true})).toBeVisible();const defaultCovenant=readFileSync(covenantFile,'utf8');
 await covenantSettings.getByRole('button',{name:'编辑公约',exact:true}).click();const covenantSource=covenantSettings.getByRole('textbox',{name:'工作公约内容',exact:true}),customCovenant='# 公约保存回归\n\n保持现有资料。\n';await covenantSource.fill(customCovenant);await covenantSettings.getByRole('button',{name:'保存公约',exact:true}).click();await expect.poll(()=>readFileSync(covenantFile,'utf8')).toBe(customCovenant);
 await covenantSettings.getByRole('button',{name:'插入条目',exact:true}).click();await covenantSettings.getByLabel('条目标题',{exact:true}).fill('新增约定');await covenantSettings.getByLabel('条目内容',{exact:true}).fill('核对测试结果。');await covenantSettings.getByRole('button',{name:'插入并保存',exact:true}).click();await expect.poll(()=>readFileSync(covenantFile,'utf8')).toContain('## 新增约定');
 await app.evaluate(({shell})=>{globalThis.covenantOpened='';shell.openPath=async file=>{globalThis.covenantOpened=file;return '';};});await covenantSettings.getByRole('button',{name:'在编辑器中打开',exact:true}).click();await expect.poll(()=>app.evaluate(()=>globalThis.covenantOpened)).toBe(covenantFile);
 page.once('dialog',dialog=>dialog.accept());await covenantSettings.getByRole('button',{name:'重置',exact:true}).click();await expect.poll(()=>readFileSync(covenantFile,'utf8')).toBe(defaultCovenant);await covenantSource.fill(customCovenant);await covenantSettings.getByRole('button',{name:'保存公约',exact:true}).click();await expect.poll(()=>readFileSync(covenantFile,'utf8')).toBe(customCovenant);await covenantSettings.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('button',{name:'茶歇室',exact:true}).click();await sharedTools(page);
 await page.locator('.page-turn-live .room-input textarea').fill('保留的测试草稿');
 await expect(page.getByRole('combobox',{name:'话题记录'})).toBeVisible();await expect(page.getByRole('button',{name:'继续讨论',exact:true})).toBeVisible();await page.screenshot({path:path.join(shots,'workspace-header-lounge.png'),animations:'disabled'});
 await page.getByRole('button',{name:'测试成员 · 进入工位',exact:true}).click();
 await expect(page.locator('.room-header-in-toolbar').getByRole('heading',{name:'测试成员 的工位',exact:true})).toBeVisible();await sharedTools(page);await expect(page.getByRole('button',{name:'切换工位文件夹'})).toHaveCount(0);await expect(page.locator('.page-turn-live .room-input textarea')).toBeVisible();await page.screenshot({path:path.join(shots,'workspace-header-desk.png'),animations:'disabled'});
 await page.getByRole('button',{name:'圆桌',exact:true}).click();await sharedTools(page);await expect(page.locator('.roundtable-top').getByRole('button',{name:'开新议题',exact:true})).toBeVisible();
 await page.locator('.project-list .list-row-main').filter({hasText:'测试项目'}).click();await expect(page.getByRole('main',{name:'测试项目 的项目会议室'})).toBeVisible();await sharedTools(page);await expect(page.getByRole('heading',{name:'测试项目'})).toBeVisible();await page.screenshot({path:path.join(shots,'workspace-header-project.png'),animations:'disabled'});
 await page.setViewportSize({width:620,height:700});await page.getByRole('button',{name:'茶歇室',exact:true}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await expect(page.getByRole('combobox',{name:'话题记录'})).toBeVisible();
 await page.getByRole('button',{name:'测试成员 · 进入工位',exact:true}).click();
 await app.close();app=undefined;page=await launch();
 // Startup always opens the home page; only the remembered project and desk member survive a restart.
 await expect(page.getByRole('main',{name:'立绘首页',exact:true})).toBeVisible();await expect(page.locator('.room-header-in-toolbar')).toHaveCount(0);
 const navigation=await page.evaluate(()=>JSON.parse(localStorage.getItem('hivelab.navigation')).state);assert.equal(navigation.projectId,'test-project');assert.equal(navigation.deskMemberId,'test-member');assert.equal(navigation.view,undefined);
 await page.getByRole('button',{name:'茶歇室',exact:true}).click();await expect(page.locator('.page-turn-live .room-input textarea')).toHaveValue('保留的测试草稿');
 await page.getByRole('button',{name:'测试成员 · 进入工位',exact:true}).click();await expect(page.locator('.room-header-in-toolbar').getByRole('heading',{name:'测试成员 的工位',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'设置',exact:true}).click();const restoredSettings=page.getByRole('dialog',{name:'设置与成员连接',exact:true});await unfoldSettings(page);await restoredSettings.getByRole('button',{name:'工作公约',exact:true}).click();await expect(restoredSettings.getByRole('heading',{name:'公约保存回归',exact:true})).toBeVisible();await restoredSettings.getByRole('button',{name:'完成',exact:true}).click();
 assert.deepEqual(errors,[]);console.log('PASS: actual Electron; shared tools across home/lounge/desk/project/roundtable; visible room headers; covenant preview/edit/append/reset/open with real file persistence across restart; unified appearance settings; narrow viewport; draft restart persistence; no model calls.');
}finally{if(app)await app.close();cleanupTestEnvironment(directory,process.cwd());}



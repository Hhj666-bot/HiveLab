import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {_electron,expect} from '@playwright/test';
import {isolatedTestEnvironment,cleanupTestEnvironment} from '../scripts/test-environment.mjs';

const {directory,env}=isolatedTestEnvironment(process.env,process.cwd());delete env.ELECTRON_RUN_AS_NODE;
const db=new DatabaseSync(path.join(env.HIVELAB_DATA_DIR,'hivelab.sqlite'));db.exec('CREATE TABLE entities(entity TEXT,id TEXT,value TEXT,PRIMARY KEY(entity,id))');
for(const [id,name]of [['a','Alice'],['b','Bob'],['c','Carol']])db.prepare('INSERT INTO entities VALUES(?,?,?)').run('members',id,JSON.stringify({id,name,executor:'codex',color:'#447565'}));db.close();
const executablePath=process.env.HIVELAB_TEST_EXECUTABLE??path.resolve('node_modules/electron/dist/electron.exe');
const args=process.env.HIVELAB_TEST_APP?[path.resolve(process.env.HIVELAB_TEST_APP)]:process.env.HIVELAB_TEST_EXECUTABLE?[]:[path.resolve('.')];
const shots=process.env.HIVELAB_TEST_SHOTS??path.resolve('tests/ui/results');mkdirSync(shots,{recursive:true});let app;const errors=[];
async function launch(){const result=await _electron.launch({executablePath,args,env,timeout:30000});const page=await result.firstWindow();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));await expect.poll(()=>page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.backendReady).catch(()=>false)),{timeout:25000}).toBe(true);return {result,page};}
try{
  let started=await launch();app=started.result;let page=started.page;
  await page.evaluate(()=>{localStorage.setItem('hivelab.room.invited',JSON.stringify(['a','b','c']));localStorage.setItem('hivelab.theme','light');});await page.reload();
  await page.getByRole('button',{name:'茶歇室',exact:true}).click();
  const settings=()=>page.getByRole('button',{name:'设置本次每人发言次数',exact:true});
  await expect(settings()).toBeVisible();await expect(settings()).toContainText('每人 1 次');await expect(page.getByRole('button',{name:'终止本轮发言',exact:true})).toBeVisible();
  await settings().click();await page.getByRole('spinbutton',{name:'统一每人发言次数',exact:true}).fill('2');await page.getByRole('combobox',{name:'Bob 次数设置',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Bob 本次发言次数',exact:true}).fill('1');
  await page.getByRole('dialog',{name:'本次每人发言次数'}).screenshot({path:path.join(shots,'reply-limits-installed-dialog.png')});
  await page.getByRole('button',{name:'应用到下一条消息',exact:true}).click();await expect(settings()).toContainText('分别设置次数');
  const error=await page.evaluate(()=>window.hivelab.invoke('room.send',{text:'invalid allowance must not dispatch',memberIds:['a'],mode:'discuss',style:'chat',replyLimits:{perMember:101,overrides:{}}}).then(()=>'',e=>e.message));assert.match(error,/0–100/);
  assert.equal(await page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.runs.length)),0);
  await page.getByRole('radio',{name:'开会',exact:true}).click();await expect(settings()).toContainText('每人 1 次');await settings().click();await page.getByRole('spinbutton',{name:'统一每人发言次数',exact:true}).fill('3');await page.getByRole('button',{name:'应用到下一条消息',exact:true}).click();await expect(settings()).toContainText('每人 3 次');
  await page.setViewportSize({width:620,height:700});await expect(settings()).toBeVisible();await expect(page.getByRole('button',{name:'终止本轮发言',exact:true})).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await app.close();app=undefined;started=await launch();app=started.result;page=started.page;await page.getByRole('button',{name:'茶歇室',exact:true}).click();await expect(settings()).toContainText('分别设置次数');
  await settings().click();await expect(page.getByRole('spinbutton',{name:'统一每人发言次数',exact:true})).toHaveValue('2');await expect(page.getByRole('spinbutton',{name:'Bob 本次发言次数',exact:true})).toHaveValue('1');
  assert.deepEqual(errors,[]);console.log('PASS: actual Electron; reply-limit controls and persistent stop button in chat/work; uniform and per-member settings; process-restart preferences; invalid server allowance rejected before dispatch; narrow layout; no model requests.');
}finally{if(app)await app.close();cleanupTestEnvironment(directory,process.cwd());}

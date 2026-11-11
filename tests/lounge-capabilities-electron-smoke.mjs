import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdirSync} from 'node:fs';
import {_electron,expect} from '@playwright/test';
import {isolatedTestEnvironment,cleanupTestEnvironment} from '../scripts/test-environment.mjs';

const {directory,env}=isolatedTestEnvironment(process.env,process.cwd());delete env.ELECTRON_RUN_AS_NODE;
const executablePath=process.env.HIVELAB_TEST_EXECUTABLE??path.resolve('node_modules/electron/dist/electron.exe');
const args=process.env.HIVELAB_TEST_APP?[path.resolve(process.env.HIVELAB_TEST_APP)]:process.env.HIVELAB_TEST_EXECUTABLE?[]:[path.resolve('.')];
const shots=process.env.HIVELAB_TEST_SHOTS??path.resolve('tests/ui/results');mkdirSync(shots,{recursive:true});
let app;const errors=[];
async function launch(){
  app=await _electron.launch({executablePath,args,env,timeout:30000});const page=await app.firstWindow();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await expect.poll(()=>page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.backendReady).catch(()=>false)),{timeout:25000}).toBe(true);
  await page.getByRole('button',{name:'茶歇室',exact:true}).click();return page;
}
try{
  let page=await launch();const button=()=>page.getByRole('button',{name:'茶歇室工位能力',exact:true});
  await expect(button()).toHaveAttribute('aria-pressed','false');await expect(button()).toContainText('能力：受限');
  await button().click();await expect(button()).toHaveAttribute('aria-pressed','true');
  assert.equal(await page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.room.state.capabilityMode)),'desk');
  await expect(page.getByText('已启用工位能力，可以按你的要求使用工具、处理文件和执行任务。')).toBeVisible();
  await expect(button()).toBeVisible();await expect(button()).toHaveCount(1);
  await button().click();await expect(button()).toHaveAttribute('aria-pressed','false');
  await button().click();await expect(button()).toHaveAttribute('aria-pressed','true');
  await page.setViewportSize({width:620,height:700});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await expect(button()).toBeVisible();
  await app.close();app=undefined;page=await launch();await expect(button()).toHaveAttribute('aria-pressed','true');
  await expect(button()).toBeVisible();await expect(button()).toHaveCount(1);
  await page.locator('.room > .room-top').first().screenshot({path:path.join(shots,'lounge-capabilities.png')});
  await button().click();await expect(button()).toHaveAttribute('aria-pressed','false');
  const invalid=await page.evaluate(()=>window.hivelab.invoke('room.capabilities',{mode:'invalid'}).then(()=>'',e=>e.message));assert.match(invalid,/请选择/);
  assert.deepEqual(errors,[]);console.log('PASS: actual Electron; restricted/desk toggle; persisted backend state; visible capability control; narrow layout; process restart persistence; invalid mode rejected; no model calls.');
}finally{if(app)await app.close();cleanupTestEnvironment(directory,process.cwd());}

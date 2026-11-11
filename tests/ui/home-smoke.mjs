import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:5196},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1340,height:900}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));await page.goto(server.resolvedUrls.local[0]+'tests/ui/home-fixture.html');
  const cast=page.getByRole('list',{name:'团队立绘'});await expect(cast.getByRole('listitem')).toHaveCount(5);assert.equal(await page.locator('.stage-card').count(),0);
  await page.evaluate(()=>window.setMembers(12));await expect(cast.getByRole('listitem')).toHaveCount(12);assert.deepEqual(await page.locator('.standee-name').evaluateAll(nodes=>nodes.filter(n=>{const dot=n.querySelector('i').getBoundingClientRect(),name=n.querySelector('strong'),box=name.getBoundingClientRect();return Math.abs(dot.y+dot.height/2-box.y-box.height/2)>3||name.scrollWidth>name.clientWidth;}).map(n=>n.textContent)),[]);await page.evaluate(()=>window.setMembers(5));await expect(cast.getByRole('listitem')).toHaveCount(5);
  await page.getByRole('button',{name:'与 Sol 聊天',exact:true}).click({button:'right'});await expect(page.locator('output')).toHaveText('人物详情 member-1');
  await page.getByRole('button',{name:'与 Sol 聊天',exact:true}).focus();await page.keyboard.press('Shift+F10');await expect(page.locator('output')).toHaveText('人物详情 member-1');
  await page.getByRole('button',{name:'与 Sol 聊天',exact:true}).click();await expect(page.locator('output')).toHaveText('工位 member-1');
  for(const n of [1,3,8,16]){await page.evaluate(value=>window.setMembers(value),n);await expect(cast.getByRole('listitem')).toHaveCount(n);assert.equal(await cast.evaluate(node=>node.scrollWidth>=node.clientWidth),true);}
  await page.getByRole('button',{name:'查看后面的成员'}).click();await expect.poll(()=>cast.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
  await page.evaluate(()=>window.setMembers(5,true));await expect(cast.getByRole('listitem')).toHaveCount(4);await expect(page.getByRole('button',{name:'与 Astra 聊天',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'背景',exact:true}).click();const modal=page.getByRole('dialog',{name:'首页背景'});await modal.getByRole('button',{name:'选择图片 / 视频'}).click();await expect(modal.getByRole('combobox',{name:'本页背景模式'})).toHaveValue('media');
  await modal.getByRole('combobox',{name:'背景画面适配'}).selectOption('contain');await modal.getByRole('checkbox',{name:'淡化立绘浅色底'}).uncheck();await modal.getByRole('button',{name:'从 Wallpaper Engine 导入'}).click();await expect(modal.getByRole('alert')).toContainText('应用程序壁纸');
  await page.reload();await page.getByRole('button',{name:'背景',exact:true}).click();await expect(page.getByRole('combobox',{name:'背景画面适配'})).toHaveValue('contain');await expect(page.getByRole('checkbox',{name:'淡化立绘浅色底'})).not.toBeChecked();
  await page.getByRole('button',{name:'恢复本页默认'}).click();await expect(page.getByRole('combobox',{name:'本页背景模式'})).toHaveValue('studio');await page.getByRole('button',{name:'关闭对话框'}).click();
  // Switching entity pages must never reuse the previous page's local preferences.
  for(const [i,id] of ['lounge','roundtable','desk:sol','desk:astra','project:one','project:two','report:one:sol','report:one:astra'].entries()){
    await page.evaluate(value=>window.setPage(value),id);await page.getByRole('button',{name:'设置本页背景'}).click();
    await expect(page.getByRole('combobox',{name:'本页背景模式'})).toHaveValue('plain');
    await page.getByRole('button',{name:'选择图片 / 视频'}).click();await expect(page.getByRole('combobox',{name:'本页背景模式'})).toHaveValue('media');
    await page.getByRole('slider',{name:'背景模糊',exact:true}).fill(String(i+1));await page.getByRole('button',{name:'关闭对话框'}).click();
  }
  await page.reload();
  for(const [i,id] of ['lounge','roundtable','desk:sol','desk:astra','project:one','project:two','report:one:sol','report:one:astra'].entries()){
    await page.evaluate(value=>window.setPage(value),id);await page.getByRole('button',{name:'设置本页背景'}).click();await expect(page.getByRole('slider',{name:'背景模糊',exact:true})).toHaveValue(String(i+1));
    if(id==='desk:sol'){await page.getByRole('button',{name:'恢复本页默认'}).click();await expect(page.getByRole('combobox',{name:'本页背景模式'})).toHaveValue('plain');}
    await page.getByRole('button',{name:'关闭对话框'}).click();
  }
  await page.evaluate(()=>window.setPage('home'));await page.getByRole('button',{name:'背景',exact:true}).click();await expect(page.getByRole('combobox',{name:'本页背景模式'})).toHaveValue('studio');await page.getByRole('button',{name:'关闭对话框'}).click();
  await page.evaluate(()=>window.setMembers(0));await expect(page.getByRole('heading',{name:'把伙伴们请进来'})).toBeVisible();
  await page.evaluate(()=>window.setMembers(5));await page.setViewportSize({width:620,height:700});await expect(cast.getByRole('listitem')).toHaveCount(5);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:1340,height:900});const folder=path.resolve('tests/ui/results');await mkdir(folder,{recursive:true});await page.screenshot({path:path.join(folder,'standee-home.png')});assert.deepEqual(errors,[]);
  console.log('PASS: standee home with 0/1/3/5/8/16 members; hidden cards; direct desk entry; overflow navigation; local background persistence; Wallpaper Engine limitations; reset; narrow window');
}finally{await browser.close();await server.close();}

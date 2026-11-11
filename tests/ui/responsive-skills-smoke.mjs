import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);await page.goto(server.resolvedUrls.local[0]+'tests/ui/responsive-skills-fixture.html');
 const cast=page.getByRole('list',{name:'团队立绘'});await expect(cast.getByRole('listitem')).toHaveCount(8);
 const geometry=()=>cast.evaluate(n=>({width:n.clientWidth,overflow:n.scrollWidth-n.clientWidth,items:[...n.children].map(c=>({width:c.getBoundingClientRect().width,bottom:c.getBoundingClientRect().bottom,height:c.getBoundingClientRect().height}))}));
 // The compact default already sits on the minimum figure width at 1500px, so width scaling is measured from the standard density.
 const density=page.getByRole('slider',{name:'人物疏密'});await expect(density).toHaveValue('0.75');await density.fill('1');await expect.poll(async()=>(await geometry()).items[0].width).toBeGreaterThan(100);
 await expect.poll(async()=>(await geometry()).overflow).toBeLessThanOrEqual(2);const wide=await geometry();
 await page.setViewportSize({width:1100,height:900});await expect.poll(async()=>(await geometry()).items[0].width).toBeLessThan(wide.items[0].width);const narrow=await geometry();assert.ok(narrow.items[0].height<wide.items[0].height);assert.ok(narrow.items.every(i=>Math.abs(i.bottom-narrow.items[0].bottom)<1),'all figures stay on one baseline');
 await page.setViewportSize({width:1500,height:900});const divider=page.getByRole('separator',{name:'侧栏宽度'}),box=await divider.boundingBox();await page.mouse.move(box.x+4,300);await page.mouse.down();await page.mouse.move(box.x+94,300);await page.mouse.up();await expect.poll(()=>page.locator('aside.sidebar').evaluate(n=>n.getBoundingClientRect().width)).toBeGreaterThan(340);
 await page.getByRole('button',{name:'收起侧栏',exact:true}).click();await expect.poll(()=>page.locator('aside.sidebar').evaluate(n=>n.getBoundingClientRect().width)).toBe(76);
 await expect(page.getByRole('button',{name:'隐藏侧栏',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'展开侧栏',exact:true})).toBeVisible();await page.getByRole('button',{name:'展开侧栏',exact:true}).click();
 await page.reload();await expect.poll(()=>page.locator('aside.sidebar').evaluate(n=>n.getBoundingClientRect().width)).toBeGreaterThan(340);
 await page.setViewportSize({width:620,height:700});await expect(page.getByRole('button',{name:'查看后面的成员'})).toBeVisible();await page.getByRole('button',{name:'查看后面的成员'}).click();await expect.poll(()=>cast.evaluate(n=>n.scrollLeft)).toBeGreaterThan(0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.setViewportSize({width:1500,height:900});await density.fill('1.1');await page.reload();await expect(density).toHaveValue('1.1');await page.getByRole('button',{name:'自动',exact:true}).click();await expect(density).toHaveValue('0.75');
 await mkdir('tests/ui/results',{recursive:true});await page.screenshot({path:'tests/ui/results/responsive-home.png'});
 await page.evaluate(()=>window.showChat());assert.ok(await page.locator('aside.sidebar').evaluate(n=>n.getBoundingClientRect().width)>340,'chat shares the home sidebar width');
 await page.getByRole('button',{name:'选择本次 Skills'}).click();await page.getByRole('checkbox',{name:'使用技能 Humanizer'}).check();await page.getByRole('checkbox',{name:'使用技能 Team handoff'}).check();await page.getByRole('checkbox',{name:'记住当前话题的选择'}).check();await page.screenshot({path:'tests/ui/results/message-skills.png'});await page.getByRole('button',{name:'完成选择'}).click();
 const textarea=page.locator('.room-input textarea');await textarea.fill('请润色这份交接');await page.getByRole('button',{name:'发送到聊天室',exact:true}).click();await expect(page.getByRole('dialog',{name:'确认本条消息的 Skills'})).toHaveCount(0);await expect(page.getByLabel('消息指定的 Skills')).toContainText('Humanizer');
 const sent=await page.evaluate(()=>window.testCalls.find(c=>c.method==='room.send').params);assert.deepEqual(sent.skills,[{source:'codex',id:'humanizer'},{source:'common',id:'handoff'}]);
 await page.getByRole('button',{name:'选择本次 Skills'}).click();await expect(page.getByRole('checkbox',{name:'使用技能 Humanizer'})).toBeChecked();await page.getByRole('checkbox',{name:'记住当前话题的选择'}).uncheck();await page.getByRole('button',{name:'完成选择'}).click();await textarea.fill('第二条');await page.getByRole('button',{name:'发送到聊天室',exact:true}).click();await expect(page.getByRole('button',{name:'选择本次 Skills'})).toHaveAttribute('title','Skills · 自动');await expect(page.locator('.message-skill-chips')).toHaveCount(0);
 await page.evaluate(()=>window.changeTopic());await page.getByRole('button',{name:'选择本次 Skills'}).click();await expect(page.getByRole('checkbox',{name:'使用技能 Humanizer'})).not.toBeChecked();await page.getByRole('button',{name:'完成选择'}).click();
 assert.deepEqual(errors,[]);console.log('PASS: single-row responsive figures; extreme-width scrolling; density persistence; sidebar drag/collapse/restore/shared persistence; per-message manual skill selection, direct send, metadata, reset and topic isolation; no model calls');
}finally{await browser.close();await server.close();}


import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1300,height:860}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('hivelab.appearance.adaptive-text','false');localStorage.setItem('hivelab.appearance.liquid-glass','true');});
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/glass-controls-fixture.html');await page.getByRole('button',{name:'设置测试',exact:true}).click();
 const dialog=page.getByRole('dialog').first(),nav=dialog.getByRole('navigation',{name:'设置分类',exact:true}),group=name=>nav.locator('.settings-nav-group').filter({has:page.locator('summary',{hasText:name})}),item=name=>nav.getByRole('button',{name,exact:true});
 // Only the group holding the current page starts open; the others hide their entries.
 await expect(nav.locator('.settings-nav-group')).toHaveCount(3);await expect(group('执行端')).toHaveAttribute('open','');await expect(group('工作室')).not.toHaveAttribute('open');await expect(group('扩展')).not.toHaveAttribute('open');
 await expect(item('连接与版本')).toBeVisible();await expect(item('外观')).toBeHidden();await expect(item('Skills')).toBeHidden();
 // Groups open on demand and can close again, including with the keyboard.
 await group('工作室').locator('summary').click();await expect(item('外观')).toBeVisible();await expect(group('执行端')).toHaveAttribute('open','');
 await group('扩展').locator('summary').focus();await page.keyboard.press('Enter');await expect(item('Skills')).toBeVisible();await page.keyboard.press('Enter');await expect(item('Skills')).toBeHidden();
 await item('外观').click();await expect(item('外观')).toHaveClass(/selected/);
 // The long appearance page is a list of closed rows, each saying what it holds.
 const folds=dialog.locator('.settings-fold');await expect(folds).toHaveCount(9);assert.equal(await dialog.locator('.settings-fold[open]').count(),0);await expect(dialog.getByRole('heading',{name:'页面背景',exact:true})).toBeVisible();await expect(dialog.getByRole('slider',{name:'菜单透明度',exact:true})).toBeHidden();
 assert.ok(await folds.evaluateAll(nodes=>nodes.every(n=>n.querySelector('summary small').textContent.trim().length>0)));
 const material=folds.filter({has:page.getByRole('heading',{name:'界面材质',exact:true})});await material.locator('>summary').click();await expect(material).toHaveAttribute('open','');await expect(dialog.getByRole('checkbox',{name:'液态玻璃',exact:true})).toBeVisible();await expect(dialog.getByRole('slider',{name:'菜单透明度',exact:true})).toBeVisible();assert.equal(await dialog.locator('.settings-fold[open]').count(),1);
 await material.locator('>summary').click();await expect(dialog.getByRole('checkbox',{name:'液态玻璃',exact:true})).toBeHidden();
 assert.deepEqual(errors,[]);console.log('PASS: settings groups start closed except the current page; open on demand by mouse and keyboard; appearance sections are closed rows with a summary.');
}finally{await browser.close();await server.close();}

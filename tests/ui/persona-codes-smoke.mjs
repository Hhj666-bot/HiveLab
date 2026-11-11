import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1350,height:1000},colorScheme:'dark'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/persona-codes-fixture.html');
 const section=page.locator('.persona-codes'),saves=()=>page.evaluate(()=>window.settingsCalls.filter(c=>c.method==='team.codes').map(c=>({...c.params.codes,rewrite:c.params.rewriteText})));
 await section.locator('summary').click();
 const sol=page.getByRole('textbox',{name:'Sol 的编号'}),glm=page.getByRole('textbox',{name:'GLM 的编号'});
 // A half-done swap is never saved, even when focus leaves.
 await glm.fill('02');await page.locator('.persona-editor .covenant-toolbar').click({position:{x:2,y:2}});
 await expect(section.getByRole('alert')).toContainText('编号都是「02」');assert.deepEqual(await saves(),[]);
 // Discarding does not save on the way out.
 await glm.click();await section.getByRole('button',{name:'放弃修改',exact:true}).click();assert.deepEqual(await saves(),[]);await expect(glm).toHaveValue('03');
 // Completing the swap and leaving the section commits it; the section stays open showing the new numbers.
 await glm.fill('02');await sol.fill('03');
 // The recorded failure: after a swap the old button reset the numbers to join order. Already-continuous typed numbers leave nothing to tidy.
 const rewrite=section.getByRole('checkbox',{name:/同时更新人设文字里的旧编号/});await expect(rewrite).toBeChecked();await expect(section.locator('.persona-codes-rewrite')).toContainText('共 3 处，涉及 2 位成员');
 // Tidying is always clickable; with nothing to tidy it says so and keeps the edits.
 await section.getByRole('button',{name:'整理为连续编号',exact:true}).click();await expect(section.getByRole('status')).toContainText('编号已经是连续的');await expect(glm).toHaveValue('02');await expect(sol).toHaveValue('03');
 const order=await section.locator('.storage-actions button').allTextContents();assert.equal(order[0],'保存 2 个编号');
 await page.locator('.persona-editor .covenant-toolbar').click({position:{x:2,y:2}});
 await expect.poll(saves).toEqual([{astra:'01',sol:'03',glm:'02',rewrite:true}]);
 await expect(section).toHaveJSProperty('open',true);await expect(sol).toHaveValue('03');await expect(glm).toHaveValue('02');
 await expect(section.getByRole('status')).toHaveText('已保存 2 个编号，人设文字中的编号已更新 3 处。');await expect(section.locator('summary')).toContainText('01 · 03 · 02');
 // Enter saves too, and the explicit button still works.
 await sol.fill('09');await sol.press('Enter');await expect.poll(async()=>(await saves()).length).toBe(2);await expect(sol).toHaveValue('09');
 await glm.fill('07');await section.getByRole('button',{name:'保存 1 个编号',exact:true}).click();await expect.poll(async()=>(await saves()).length).toBe(3);await expect(glm).toHaveValue('07');
 // Tidying gaps follows the numbers on screen, not join order: 01 · 09 · 07 → Astra 01, GLM 02, Sol 03.
 await section.getByRole('button',{name:'整理为连续编号',exact:true}).click();await expect(page.getByRole('textbox',{name:'Astra 的编号'})).toHaveValue('01');await expect(glm).toHaveValue('02');await expect(sol).toHaveValue('03');
 await section.getByRole('button',{name:'保存 2 个编号',exact:true}).click();
 await expect.poll(async()=>(await saves()).at(-1)).toMatchObject({astra:'01',sol:'03',glm:'02'});
 await mkdir('tests/ui/results',{recursive:true});await page.screenshot({path:'tests/ui/results/persona-codes.png'});
 assert.deepEqual(errors,[]);console.log('PASS: member codes save on leave/Enter/button, never mid-swap or on discard, and stay visible after saving.');
}finally{await browser.close();await server.close();}

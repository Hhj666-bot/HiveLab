import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdirSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:5199},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const shots=process.env.HIVELAB_TEST_SHOTS??path.resolve('tests/ui/results');mkdirSync(shots,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:720}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const open=async(query='')=>{await page.goto(server.resolvedUrls.local[0]+'tests/ui/effort-popover-fixture.html'+query);await page.getByRole('button',{name:'打开模型选择'}).click();};
 const dialog=page.getByRole('dialog',{name:'这个话题的模型和思考程度',exact:true}),models=page.locator('.effort-models');
 await open();await expect(dialog).toBeVisible();
 await expect(dialog.locator('.effort-level')).toHaveText('高');await expect(dialog.locator('.effort-dot')).toHaveCount(5);
 // Simple like Codex: no decorative icon, end labels, save button or member-default link.
 await expect(dialog.locator('.effort-head>svg')).toHaveCount(0);await expect(dialog.locator('.effort-scale')).toHaveCount(0);await expect(dialog.getByRole('button',{name:'保存'})).toHaveCount(0);await expect(dialog).not.toContainText('修改成员默认');
 // Concentric geometry: the knob sits 4px inside the track on every side, and the fill ends in an arc centred on the knob.
 const geometry=()=>dialog.evaluate(node=>{const r=selector=>node.querySelector(selector).getBoundingClientRect();const track=r('.effort-slider'),thumb=r('.effort-thumb'),fill=r('.effort-fill');return {top:thumb.top-track.top,bottom:track.bottom-thumb.bottom,knobCenter:thumb.left+thumb.width/2,fillEnd:fill.right,trackRadius:parseFloat(getComputedStyle(node.querySelector('.effort-slider')).borderTopLeftRadius),trackHeight:track.height};});
 await page.waitForTimeout(400);let g=await geometry();
 assert.equal(g.top,4);assert.equal(g.bottom,4);assert.equal(g.trackRadius,g.trackHeight/2);assert.ok(Math.abs(g.fillEnd-g.knobCenter-16)<0.6,'fill arc is centred on the knob');
 await page.screenshot({path:path.join(shots,'effort-popover.png')});
 // A click applies at once.
 const box=await dialog.locator('.effort-slider').boundingBox();await page.mouse.click(box.x+box.width-10,box.y+box.height/2);
 await expect.poll(()=>page.evaluate(()=>window.effortSaves.at(-1)?.effort)).toBe('max');await expect(dialog.locator('.effort-level')).toHaveText('最高');
 await page.waitForTimeout(400);g=await geometry();assert.equal(g.top,4);assert.ok(Math.abs(g.fillEnd-g.knobCenter-16)<0.6);
 // Keyboard applies at once too.
 await dialog.locator('.effort-slider').focus();await page.keyboard.press('ArrowLeft');await expect.poll(()=>page.evaluate(()=>window.effortSaves.at(-1)?.effort)).toBe('xhigh');
 // The model list is the card's twin: a sibling with the same surface, beside the card.
 await dialog.locator('.effort-model').click();await expect(models).toBeVisible();
 const look=await page.evaluate(()=>{const read=node=>{const c=getComputedStyle(node);return {background:c.backgroundColor,image:c.backgroundImage,border:c.borderTopColor+' '+c.borderTopWidth,radius:c.borderTopLeftRadius,shadow:c.boxShadow,filter:c.backdropFilter};};const card=document.querySelector('.effort-popover'),list=document.querySelector('.effort-models');return {card:read(card),list:read(list),nested:card.contains(list),beside:list.getBoundingClientRect().left>=card.getBoundingClientRect().right};});
 assert.equal(look.nested,false,'the list is not inside the card');assert.ok(look.beside,'the list opens beside the card');assert.deepEqual(look.list,look.card,'the list uses the card surface');
 await page.screenshot({path:path.join(shots,'effort-popover-models.png')});
 await models.getByRole('option',{name:/GPT-6.1 Terra/}).click();await expect.poll(()=>page.evaluate(()=>window.effortSaves.at(-1)?.model)).toBe('gpt-6.1-terra');await expect(models).toHaveCount(0);
 // Antigravity-style lists: one row per model, and its listed levels on the slider.
 await open('?variants');await expect(dialog.locator('.effort-level')).toHaveText('高');await expect(dialog.locator('.effort-model')).toHaveText('Gemini 4 Argon');await expect(dialog.locator('.effort-dot')).toHaveCount(3);
 await dialog.locator('.effort-model').click();await expect(models.getByRole('option',{name:/Gemini 4 Argon/})).toHaveCount(1);await expect(models.getByRole('option',{name:/Gemini 4 Argon/})).toContainText('3 档思考');await expect(models.getByRole('option',{name:/^Gemini 3.8 Flash/})).toHaveCount(1);await expect(models.getByRole('option',{name:/^Gemini 3.8 Flash/})).toContainText('3 档思考');
 await page.screenshot({path:path.join(shots,'effort-popover-variants.png')});
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'打开模型选择'}).click();
 const variantBox=await dialog.locator('.effort-slider').boundingBox();await page.mouse.click(variantBox.x+8,variantBox.y+variantBox.height/2);
 await expect.poll(()=>page.evaluate(()=>window.effortSaves.at(-1))).toEqual({model:'gemini-4-argon-low',effort:null});await expect(dialog.locator('.effort-level')).toHaveText('低');
 // A model with no levels: no empty track, and the card says so.
 await open('?flat');await expect(dialog.locator('.effort-slider')).toHaveCount(0);await expect(dialog.locator('.effort-level')).toHaveText('思考程度不可调');
 await page.screenshot({path:path.join(shots,'effort-popover-flat.png')});
 // GLM: off/on for every listed model, and the same switch for a model only the service lists.
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/effort-popover-fixture.html?glm');await page.getByRole('button',{name:'打开模型选择'}).click();await expect(dialog.locator('.effort-level')).toHaveText('开启');await expect(dialog.locator('.effort-dot')).toHaveCount(2);
 await dialog.locator('.effort-model').click();await models.getByRole('option',{name:'glm-4.6',exact:true}).click();await expect(dialog.locator('.effort-dot')).toHaveCount(2);await expect(dialog.locator('.effort-level')).toHaveText('开启');
 // A connection whose model is fixed when it is set up: the topic cannot pick another one, and says where to change it.
 await open('?fixed');await dialog.locator('.effort-model').click();await expect(models.getByRole('option')).toHaveCount(0);await expect(models).toContainText('在建立连接时填写');
 await models.getByRole('button',{name:'打开连接设置…'}).click();await expect.poll(()=>page.evaluate(()=>window.settingsOpened.length)).toBe(1);
 // An API connection: the topic's list adds what the service offers beyond the program's own report.
 await open('?served');await dialog.locator('.effort-model').click();await expect(models.getByRole('option',{name:'gpt-6.1-luna',exact:true})).toBeVisible();
 await models.getByRole('option',{name:'gpt-6.1-luna',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.effortSaves.at(-1)?.model)).toBe('gpt-6.1-luna');
 await page.keyboard.press('Escape');
 // Connection settings: the model is picked from the service's list, or typed when it is not listed.
 const settings=page.getByRole('region',{name:'连接设置'});
 await settings.getByRole('button',{name:'模型',exact:true}).click();await expect(settings.getByRole('option',{name:'qwen3-coder-plus'})).toBeVisible();
 await expect(settings).toContainText('服务列出 3 个模型');await page.screenshot({path:path.join(shots,'api-model-picker.png')});
 await settings.getByLabel('搜索或填写模型名称').fill('coder');await expect(settings.getByRole('option')).toHaveCount(2);
 await settings.getByRole('option',{name:'qwen3-coder-plus'}).click();await expect.poll(()=>page.evaluate(()=>window.connectionModel)).toBe('qwen3-coder-plus');
 await settings.getByRole('button',{name:'模型',exact:true}).click();await settings.getByLabel('搜索或填写模型名称').fill('qwen-long-latest');await page.keyboard.press('Enter');
 await expect.poll(()=>page.evaluate(()=>window.connectionModel)).toBe('qwen-long-latest');
 assert.equal((await page.evaluate(()=>window.listReads.filter(read=>read==='connection').length)),1,'the list is read once, not on every opening or keystroke');
 assert.deepEqual(errors,[]);console.log('PASS: effort popover applies at once; concentric slider; list shares the card surface; level-in-name models grouped; no slider without levels; served models; connection model picked from the service list or typed.');
}finally{await browser.close();await server.close();}

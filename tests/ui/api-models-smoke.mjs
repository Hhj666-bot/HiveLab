import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:5198},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/api-models-fixture.html');
 for(const [label,entry,id] of [['Kimi','Kimi Code CLI','acp-kimiapiui'],['GLM','ZCode CLI','acp-glmapiui']]){
  const section=page.getByRole('region',{name:label+' API 连接',exact:true});await expect(section).toContainText('默认模型（可选）');await expect(section).toContainText('留空也可以保存密钥');
  await section.getByRole('button',{name:'默认模型（可选）',exact:true}).click();await expect(section.getByRole('option',{name:/^kimi-|^glm-/}).first()).toBeVisible();await section.getByRole('option',{name:'在对话中选择',exact:true}).click();await section.getByLabel(entry+' API Key',{exact:true}).fill('mock-key-for-'+label);await section.getByRole('button',{name:'保存密钥并检查',exact:true}).click();
  await expect.poll(()=>page.evaluate(id=>window.apiModelCalls.filter(call=>call.method==='catalog.credentials'&&call.executorId===id).length,id)).toBe(1);
  assert.equal((await page.evaluate(id=>window.apiModelCalls.find(call=>call.method==='catalog.credentials'&&call.executorId===id),id)).model,'');
 }
 for(const [label,id,model] of [['Kimi','acp-kimiapiui','kimi-k3.1-pro'],['GLM','acp-glmapiui','glm-5.3']]){
  await page.getByRole('button',{name:'选择 '+label+' 话题模型',exact:true}).click();let dialog=page.getByRole('dialog',{name:'这个话题的模型和思考程度',exact:true});await expect(dialog).not.toContainText('__kimi_env_model__');await dialog.locator('.effort-model').click();await page.locator('.effort-models').getByRole('option',{name:model,exact:true}).click();await expect.poll(()=>page.evaluate(id=>window.savedApiModels[id]?.model,id)).toBe(model);await expect(dialog.getByRole('button',{name:'保存',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'选择 '+label+' 话题模型',exact:true}).click();dialog=page.getByRole('dialog',{name:'这个话题的模型和思考程度',exact:true});await dialog.locator('.effort-model').click();await page.locator('.effort-models').getByRole('button',{name:'其他模型…'}).click();const before=await page.evaluate(()=>window.apiModelCalls.filter(call=>call.method==='provider.config').length);await page.locator('.effort-models').getByLabel('API 模型 ID',{exact:true}).fill(label.toLowerCase()+'-custom-model');assert.equal(await page.evaluate(()=>window.apiModelCalls.filter(call=>call.method==='provider.config').length),before);await page.locator('.effort-models').getByRole('button',{name:'使用',exact:true}).click();await expect.poll(()=>page.evaluate(id=>window.savedApiModels[id]?.model,id)).toBe(label.toLowerCase()+'-custom-model');await page.keyboard.press('Escape');
 }
 assert.deepEqual(errors,[]);console.log('PASS: Kimi/GLM key-only saves; optional connection defaults; conversation model choices; custom API IDs; no model probe per keystroke; no model requests.');
}finally{await browser.close();await server.close();}

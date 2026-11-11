import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/task-evidence-fixture.html');
  await expect(page.getByRole('definition').filter({hasText:'原生回合已确认'})).toBeVisible();
  await expect(page.getByText('任务结果已提交 · 第 2 次提交')).toBeVisible();
  await expect(page.getByText('尚未验收',{exact:true})).toBeVisible();
  await expect(page.getByText('历史成果 · previous-artifact-version')).toBeVisible();
  await expect(page.getByText(/已送达，成员正在处理/)).toBeVisible();
  await page.getByText('决定与用户确认 · 1',{exact:true}).click();
  const original=page.getByText(/原始用户记录 ·/);await original.focus();await expect(original).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.getByText('确认增加使用说明，并保持现有透明度设置。',{exact:true})).toBeVisible();
  await expect(page.getByText(/original-user-record/)).toBeVisible();
  await page.getByText('执行记录 · 2',{exact:true}).click();
  await expect(page.getByText('历史会话 · 投递待核对',{exact:false})).toBeVisible();
  await expect(page.getByText('已修改，更新时保留副本',{exact:true})).toBeVisible();
  await mkdir('tests/ui/results',{recursive:true});
  for(const width of [320,768,1440])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:1000});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`tests/ui/results/task-evidence-${width}-${theme}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: task delivery/submission/review/acceptance stay distinct; original decision is keyboard-accessible; delivered supplements are not applied; skill provenance and 320/768/1440 light/dark layouts.');
}finally{await browser.close();await server.close();}

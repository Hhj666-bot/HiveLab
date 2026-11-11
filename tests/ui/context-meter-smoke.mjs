import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const url=query=>server.resolvedUrls.local[0]+'tests/ui/room-preview-fixture.html?'+query;
const folder=path.resolve('tests/ui/results');await mkdir(folder,{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1400,height:950},colorScheme:'dark'}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  const calls=method=>page.evaluate(name=>window.testCalls.filter(call=>call.method===name).map(call=>call.params),method);
  await page.goto(url('sidebar&context'));await page.evaluate(()=>window.showDesk());
  const ring=page.locator('.composer-context'),panel=page.getByRole('dialog',{name:'上下文'});
  // The ring: 576.8k of the 1M window.
  await expect(ring).toContainText('58%');await expect(ring).toHaveAttribute('data-level','ok');
  assert.notEqual(await ring.locator('.context-ring-fill').evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  await ring.click();await expect(panel).toBeVisible();
  await expect(panel).toContainText('已使用 58%');await expect(panel).toContainText('576.8k / 1M');
  const rows=panel.getByRole('list',{name:'上下文占用'}).getByRole('listitem');
  for(const label of ['对话消息','执行端系统提示与工具','HiveLab 工具（MCP）','人物设定与工作公约','HiveLab 工作说明','Skills 索引','记忆文件','自上次更新以来','自动压缩缓冲','剩余空间'])await expect(rows.filter({hasText:label})).toHaveCount(1);
  await expect(rows.filter({hasText:'自上次更新以来'})).toContainText('84.4k');await expect(rows.filter({hasText:'自动压缩缓冲'})).toContainText('150k');
  await expect(panel).toContainText('距自动压缩还剩 273.2k');
  const bar=await panel.locator('.context-bar>span').count();assert.ok(bar>=8,'the bar shows each part');
  await panel.getByText('HiveLab 工具（MCP）').last().click();await expect(panel.locator('.context-list').first()).toContainText('subagent_wait');
  // Limit: never above the window; presets below it; the point changes the buffer.
  const limit=panel.getByRole('textbox',{name:'上下文上限'});
  await limit.fill('2M');await panel.getByRole('button',{name:'保存'}).click();await expect(panel.getByRole('alert')).toContainText('不能超过模型自带的上限 1M');
  await panel.getByRole('group',{name:'常用上限'}).getByRole('button',{name:'400k'}).click();await expect(limit).toHaveValue('400k');
  await panel.getByRole('radiogroup',{name:'自动压缩点'}).getByRole('radio',{name:'80%'}).click();
  await panel.getByRole('button',{name:'保存'}).click();await expect(panel.getByRole('status')).toContainText('已保存');
  assert.deepEqual((await calls('context.config')).at(-1),{sessionId:'s',limit:400_000,percent:80});
  await expect(ring).toContainText('100%');await expect(ring).toHaveAttribute('data-level','danger');
  await expect(panel).toContainText('576.8k / 400k');await expect(panel).toContainText('你设定的上限；模型自带上限 1M');
  // Compress with a focus note.
  await panel.getByRole('button',{name:'压缩会话'}).click();await panel.getByRole('textbox',{name:'压缩时重点保留'}).fill('保留接口约定');
  await panel.getByRole('button',{name:'开始压缩'}).click();
  assert.deepEqual((await calls('room.compress')).at(-1),{roomId:'desk:m1',threadId:'topic',focus:'保留接口约定'});
  await page.keyboard.press('Escape');await expect(panel).toHaveAttribute('data-leaving','true');
  assert.notEqual(await panel.evaluate(node=>getComputedStyle(node).animationDuration),'0s','closing fades out');await expect(panel).toHaveCount(0);
  // No reading yet.
  await page.goto(url('sidebar&context-empty'));await page.evaluate(()=>window.showDesk());
  await expect(ring).toContainText('—');await ring.click();await expect(panel).toContainText('还没有读数');await expect(panel.getByRole('textbox',{name:'上下文上限'})).toBeDisabled();
  await page.mouse.click(5,5);await expect(panel).toHaveCount(0);
  // Liquid glass and a narrow window.
  await page.goto(url('sidebar&glass&context'));await page.evaluate(()=>window.showDesk());await ring.click();await expect(panel).toBeVisible();
  assert.notEqual(await panel.evaluate(node=>getComputedStyle(node).backdropFilter),'none','the panel is glass');
  const top=await panel.boundingBox();assert.ok(top.y>=0,'the panel stays inside the window');
  await page.mouse.move(5,5);await panel.screenshot({path:path.join(folder,'context-panel-glass.png')});
  await page.locator('.composer-bottom').screenshot({path:path.join(folder,'context-ring-glass.png')});
  await page.setViewportSize({width:420,height:820});
  const box=await panel.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=421,'the panel fits a narrow window');
  assert.deepEqual(errors,[]);
  console.log('PASS: context ring and level; panel rows/bar/lists; window cap; presets and point; save; compress with focus; empty state; outside click/Escape; liquid glass; narrow width');
}finally{await browser.close();await server.close();}

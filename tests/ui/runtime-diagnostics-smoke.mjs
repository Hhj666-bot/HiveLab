import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:5197},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1080,height:950},reducedMotion:'reduce'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/runtime-diagnostics-fixture.html');
  await expect(page.locator('.runtime-diagnostics')).toHaveCount(2);assert.equal(await page.evaluate(()=>window.diagnosticCalls.length),0);
  const panel=page.locator('.runtime-diagnostics').first();await panel.locator(':scope > summary').click();
  await expect(panel).toContainText('review / guard · 一号会话');await expect(panel).toContainText('full · 自动工作');await expect(panel).toContainText('未选择');
  await panel.locator('.runtime-diagnostic-evidence').first().locator('summary').click();await expect(panel).toContainText('运行派发快照');await expect(panel).toContainText('读取时间');
  await page.evaluate(()=>window.holdDiagnostic());await panel.getByRole('button',{name:'刷新诊断'}).click();await expect(panel).toContainText('正在读取诊断记录');
  await page.getByRole('combobox',{name:'选择运行'}).selectOption('two');await expect(panel).toContainText('合同未确认 · 二号会话');
  await page.evaluate(()=>window.releaseDiagnostic());await expect(panel).not.toContainText('一号会话');
  await page.evaluate(()=>window.failDiagnostic());await panel.getByRole('button',{name:'刷新诊断'}).click();await expect(panel.getByRole('alert')).toContainText('诊断读取暂时失败');
  await panel.getByRole('button',{name:'刷新诊断'}).click();await expect(panel).toContainText('二号会话');
  const connection=page.locator('.runtime-diagnostics').last();await connection.locator(':scope > summary').click();await expect(connection).toContainText('工作台权限配置');
  assert.ok((await page.evaluate(()=>window.diagnosticCalls)).every(c=>['run.diagnostics','provider.diagnostics'].includes(c.method)));
  await mkdir(path.resolve('.test-cache/screenshots'),{recursive:true});await page.screenshot({path:path.resolve('.test-cache/screenshots/runtime-diagnostics.png'),fullPage:true});
  await page.setViewportSize({width:420,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:path.resolve('.test-cache/screenshots/runtime-diagnostics-narrow.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: lazy read-only diagnostics, permissions/skills/hooks separation, provenance, session switch fencing, read retry, connection entry, narrow layout');
}finally{await browser.close();await server.close();}

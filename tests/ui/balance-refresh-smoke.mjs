import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1380,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/balance-refresh-fixture.html');
 const count=()=>page.evaluate(()=>window.balanceCalls.length);
 await expect.poll(count).toBe(5);
 await expect(page.locator('#api-status')).toContainText('acp-catalogkimi: 已就绪');await expect(page.locator('#api-status')).toContainText('acp-catalogzcode: 已就绪');
 const all=page.getByRole('button',{name:'刷新全部余额 / 额度',exact:true});await expect(all).toBeEnabled();await all.click();await expect.poll(count).toBe(10);
 const last=await page.evaluate(()=>window.balanceCalls.slice(-5));assert.equal(last.filter(c=>c.provider==='codex').length,1,'Sol and Astra share one query');assert.equal(last.filter(c=>c.method==='provider.balance').length,3);
 await page.clock.fastForward(30000);assert.equal(await count(),10,'The dialog must not create a second account polling loop');await expect(page.getByText('后台每 30 秒更新；关闭此面板或隐藏窗口后继续刷新。',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.failGlm=true);await all.click();await expect.poll(count).toBe(15);await expect(page.getByRole('alert')).toContainText('模拟 GLM 连接失败');await expect(all).toBeEnabled();
 const screenshot=process.env.BALANCE_TEST_CAPTURE;if(screenshot)await page.screenshot({path:path.resolve(screenshot)});
 assert.deepEqual(errors,[]);console.log('PASS: API members ready; initial/manual refresh with one backend polling owner; refresh-all button; shared executors queried once; one provider failure does not block others; no real accounts/models.');
}finally{await browser.close();await server.close();}

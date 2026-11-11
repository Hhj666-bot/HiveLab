import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1100,height:740}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/markdown-links-fixture.html');
  const policy=page.getByRole('link',{name:'Generative AI Prohibited Use policy',exact:true}),feedback=page.getByRole('link',{name:'send feedback',exact:true}),address=page.url();
  await expect(policy).toHaveAttribute('href','https://policies.google.com/terms/generative-ai/use-policy');
  await policy.click();await expect.poll(()=>page.evaluate(()=>window.markdownLinkCalls.filter(c=>c.method==='browser.open').length)).toBe(1);
  const browserPanel=page.getByRole('complementary',{name:'网页浏览器侧栏',exact:true});await expect(browserPanel).toBeVisible();await expect(browserPanel.getByRole('textbox',{name:'网页地址',exact:true})).toHaveValue('https://policies.google.com/terms/generative-ai/use-policy');
  await policy.focus();await page.keyboard.press('Enter');await expect.poll(()=>page.evaluate(()=>window.markdownLinkCalls.filter(c=>c.method==='browser.open').length)).toBe(2);
  await feedback.click({button:'middle'});await expect.poll(()=>page.evaluate(()=>window.markdownLinkCalls.filter(c=>c.method==='browser.open').length)).toBe(3);
  await policy.click({button:'right'});await expect.poll(()=>page.evaluate(()=>window.markdownLinkCalls.filter(c=>c.method==='link.menu').length)).toBe(1);
  assert.equal(page.url(),address);assert.equal(page.context().pages().length,1);
  for(const name of ['脚本链接','程序文件','数据链接']){await expect(page.getByRole('link',{name,exact:true})).toHaveCount(0);await page.getByText(name,{exact:true}).click();}
  assert.equal(await page.evaluate(()=>window.markdownLinkCalls.filter(c=>c.method==='browser.open').length),3);
  assert.equal(await page.evaluate(()=>window.markdownExecuted),undefined);
  await page.evaluate(()=>window.failNextLink=true);await feedback.click();await expect(page.getByRole('alert')).toHaveText('链接未能打开：网页暂时不可用');
  await feedback.click();await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'工作文件',exact:true}).click();const preview=page.getByRole('dialog',{name:'文件预览',exact:true});await expect(preview.getByRole('heading',{name:'本地文件预览',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.markdownLinkCalls.filter(c=>c.method==='browser.bounds').at(-1)?.params.visible)).toBe(false);
  assert.ok(await page.evaluate(()=>window.markdownLinkCalls.some(c=>c.method==='file.preview'&&c.params.source==='workspace'&&c.params.id==='link-test-session'&&c.params.path==='./README.md')));
  assert.deepEqual(errors,[]);console.log('PASS: named Markdown HTTP/HTTPS links open the browser sidebar once per left/middle/keyboard action; right-click opens browser choices; app stays on the conversation; modal hides native webpage; errors are visible and retryable; local preview remains scoped; executable schemes and member HTML stay inert.');
}finally{await browser.close();await server.close();}

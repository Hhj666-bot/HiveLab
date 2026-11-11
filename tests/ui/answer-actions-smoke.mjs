import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const context=await browser.newContext({viewport:{width:1280,height:900},permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    localStorage.setItem('hivelab.appearance.liquid-glass','true');
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=450;const c=canvas.getContext('2d');c.fillStyle='#ffffff';c.fillRect(0,0,640,450);window.contrastFrame=canvas.toDataURL();
  });
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/p0-fixture.html?contrast');
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
  const line=page.locator('[data-message-id="saved-199"]'),bar=line.getByRole('group',{name:'答复操作'});
  await bar.scrollIntoViewIfNeeded();await page.mouse.move(2,2);
  await expect(bar.locator('.room-more-button')).toHaveCount(0);
  const controls=[bar.getByLabel('另存为答复'),bar.getByRole('button',{name:'复制答复',exact:true}),bar.getByRole('button',{name:'添加表情回应',exact:true}),bar.getByRole('button',{name:'回复 测试成员 的消息',exact:true})];
  const centers=[];
  for(const control of controls){await expect(control).toBeVisible();const box=await control.boundingBox();centers.push(box.y+box.height/2);assert.equal(await control.evaluate(n=>getComputedStyle(n).opacity),'1');}
  assert.ok(Math.max(...centers)-Math.min(...centers)<1,'download, copy, reaction and reply share one baseline');
  assert.equal(await bar.locator('.room-tools').evaluate(n=>getComputedStyle(n).opacity),'1');
  const bubble=line.locator('.room-bubble');
  const background=n=>getComputedStyle(n).backgroundColor;
  assert.equal(await bar.evaluate(background),'rgba(0, 0, 0, 0)');assert.equal(await bar.evaluate(n=>getComputedStyle(n).backdropFilter),'none');await expect(bar).not.toHaveAttribute('data-liquid-surface','');
  for(const control of controls){const size=await control.boundingBox();assert.equal(size.width,28);assert.equal(size.height,28);assert.equal(await control.evaluate(n=>getComputedStyle(n).borderRadius),'8px');await expect(control).toHaveAttribute('data-liquid-surface','');assert.equal(await control.evaluate(n=>[...n.childNodes].filter(c=>c.nodeType===Node.TEXT_NODE).map(c=>c.textContent).join('').trim()),'');}
  await expect(bar).toHaveAttribute('data-adaptive-group','answer-actions');assert.equal(new Set(await Promise.all(controls.map(c=>c.evaluate(n=>getComputedStyle(n).color)))).size,1);
  assert.equal(await bar.evaluate(n=>getComputedStyle(n).boxShadow),'none','the secondary action row does not cast a bubble shadow');
  await expect(bar).toHaveAttribute('data-adaptive-tone','dark');
  await page.locator('.page-background').evaluate(n=>{n.dataset.chatReplyCustom='true';n.style.setProperty('--chat-reply-color','#4b78cd');n.style.setProperty('--chat-reply-opacity','68%');});
  assert.equal(await bar.evaluate(background),'rgba(0, 0, 0, 0)','custom reply opacity does not paint a fifth glass backing');
  await controls[1].click();await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('已完成的回复 199 **正文**');
  await controls[0].click();await bar.getByRole('button',{name:'Word',exact:true}).click();
  assert.ok(await page.evaluate(()=>window.testCalls.some(c=>c.method==='file.export'&&c.params.format==='docx'&&c.params.content==='已完成的回复 199 **正文**')),'download preserves full answer text');
  await controls[2].click();await bar.getByRole('menuitem').first().click();
  assert.ok(await page.evaluate(()=>window.testCalls.some(c=>c.method==='room.react'&&c.params.messageId==='saved-199')),'emoji picker retains its action');
  await controls[3].click();await expect(page.locator('.room-composer .room-reply-note')).toContainText('已完成的回复 199');
  const folder=path.resolve('tests/ui/results');await mkdir(folder,{recursive:true});
  await expect(controls[1]).toHaveAttribute('title','复制答复');
  await page.mouse.move(2,2);await bar.screenshot({path:path.join(folder,'answer-actions-glass.png')});
  for(const width of [800,580,360]){await page.setViewportSize({width,height:900});await bar.scrollIntoViewIfNeeded();await expect(controls[2]).toBeVisible();await expect(controls[3]).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'narrow viewport does not overflow');}
  await page.setViewportSize({width:1280,height:900});
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
  await controls[2].click();assert.equal(await bar.locator('.reaction-picker').evaluate(n=>getComputedStyle(n).backdropFilter),'none');assert.equal(await bar.evaluate(n=>getComputedStyle(n).backdropFilter),'none');
  await page.keyboard.press('Escape');assert.deepEqual(errors,[]);
  console.log('PASS: always-visible one-row answer actions; four square glass icons without a shared backing; adaptive contrast; full-text copy/export; emoji/reply actions; 1280/800/580/360px layout; reduced-transparency fallback');
}finally{await browser.close();await server.close();}

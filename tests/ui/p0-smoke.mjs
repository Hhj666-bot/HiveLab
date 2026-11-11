import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    localStorage.setItem('hivelab.appearance.liquid-glass','true');
    window.p0Metrics={renders:{},observes:0};
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberUnmount:()=>{},onCommitFiberRoot:(_id,root)=>{
      function visit(fiber){if(!fiber)return;if(fiber.type?.name==='MessageLine'&&(fiber.flags&1)){const id=fiber.memoizedProps.message.id;window.p0Metrics.renders[id]=(window.p0Metrics.renders[id]??0)+1;}visit(fiber.child);visit(fiber.sibling);}visit(root.current);
    }};
    const Observer=ResizeObserver;window.ResizeObserver=class extends Observer{observe(node,...args){if(node.matches('.room-messages,.room-message-content,.room-line'))window.p0Metrics.observes++;super.observe(node,...args);}};
  });
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/p0-fixture.html');
  await expect(page.locator('[data-message-id="saved-199"]')).toBeAttached();
  await expect.poll(()=>page.evaluate(()=>Object.keys(window.p0Metrics.renders).length)).toBe(201);
  await page.evaluate(()=>{window.p0Metrics.renders={};window.p0Metrics.observes=0;});
  for(let n=1;n<=15;n++){await page.evaluate(n=>window.p0Delta(n),n);await expect(page.locator('[data-message-id="live"] .markdown')).toHaveText('流式文本 '+n);}
  const metrics=await page.evaluate(()=>window.p0Metrics);
  assert.equal(Object.entries(metrics.renders).filter(([id])=>id.startsWith('saved-')).reduce((sum,[,n])=>sum+n,0),0,'completed rows must bail out for another run\'s deltas');
  assert.equal(metrics.renders.live,15);assert.equal(metrics.observes,0,'streaming must not resubscribe the scroll observer');
  const log=page.getByRole('log');await expect.poll(()=>log.evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight)).toBeLessThan(3);
  await log.evaluate(n=>{n.scrollTop=600;n.dispatchEvent(new Event('scroll'));});const top=await log.evaluate(n=>n.scrollTop);
  await page.evaluate(()=>window.p0Delta(16));await expect(page.locator('[data-message-id="live"] .markdown')).toHaveText('流式文本 16');assert.equal(await log.evaluate(n=>n.scrollTop),top);
  const long=page.locator('[data-message-id="saved-100"]');assert.equal(await long.locator('.room-bubble .md-code').count(),0);const expand=long.getByRole('button',{name:'展开全文',exact:true});await expect(expand).toHaveAttribute('data-liquid-surface','');assert.ok((await expand.boundingBox()).height>=26);assert.notEqual(await expand.evaluate(n=>getComputedStyle(n).boxShadow),'none');await expand.click();await expect(long.locator('.room-bubble .md-code')).toBeVisible();await long.getByRole('button',{name:'收起',exact:true}).click();assert.equal(await long.locator('.room-bubble .md-code').count(),0);
  const bubble=page.locator('[data-message-id="saved-1"] .room-bubble');
  const alpha=locator=>locator.evaluate(n=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');c.fillStyle=getComputedStyle(n).backgroundColor;c.fillRect(0,0,1,1);return c.getImageData(0,0,1,1).data[3]/255;});
  const glass=await bubble.evaluate(n=>({filter:getComputedStyle(n).backdropFilter,background:getComputedStyle(n).backgroundColor}));assert.match(glass.filter,/blur\(1\.25px\)/);assert.match(glass.filter,/contrast\(1\.2\)/);assert.equal(await alpha(bubble),0,'glass preserves the fixture\'s explicitly selected 0% reply opacity');
  const cdp=await page.context().newCDPSession(page);
  for(const feature of ['prefers-reduced-transparency','prefers-contrast']){
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:feature,value:feature==='prefers-contrast'?'more':'reduce'}]});
    await expect.poll(()=>page.evaluate(()=>document.querySelectorAll('[data-liquid-surface]').length)).toBe(0);
    const accessible=await bubble.evaluate(n=>({filter:getComputedStyle(n).backdropFilter,image:getComputedStyle(n).backgroundImage,background:getComputedStyle(n).backgroundColor}));assert.equal(accessible.filter,'none');assert.equal(accessible.image,'none');assert.equal(await alpha(bubble),1,'accessibility surface must be opaque');
    assert.equal(await page.locator('.home-background').evaluate(n=>getComputedStyle(n).visibility),'hidden');
    const headerFilters=await page.locator('.room-top').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n,'::before').backdropFilter));assert.ok(headerFilters.length>0);assert.ok(headerFilters.every(filter=>filter==='none'));
  }
  await cdp.send('Emulation.setEmulatedMedia',{features:[]});await expect.poll(()=>page.evaluate(()=>document.querySelectorAll('[data-liquid-surface]').length)).toBeGreaterThan(0);
  const folder=path.resolve('tests/ui/results');await mkdir(folder,{recursive:true});await page.screenshot({path:path.join(folder,'p0-streaming.png')});
  await writeFile(path.join(folder,'p0-streaming-metrics.json'),JSON.stringify({completedMessages:200,streamUpdates:15,completedRowRenders:0,liveRowRenders:metrics.renders.live,scrollObserverResubscriptions:metrics.observes},null,2));
  const contrastPage=await browser.newPage({viewport:{width:1280,height:900}});contrastPage.on('pageerror',e=>errors.push(e.message));
  await contrastPage.addInitScript(()=>{localStorage.setItem('hivelab.appearance.liquid-glass','true');const canvas=document.createElement('canvas');canvas.width=640;canvas.height=450;const c=canvas.getContext('2d');c.fillStyle='#ffffff';c.fillRect(0,0,640,450);window.contrastFrame=canvas.toDataURL();});
  await contrastPage.goto(server.resolvedUrls.local[0]+'tests/ui/p0-fixture.html?contrast');
  const tone=contrastPage.locator('[data-message-id="live"] .room-bubble');await expect(tone).toHaveAttribute('data-adaptive-tone','dark');
  await contrastPage.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=450;const c=canvas.getContext('2d');c.fillStyle='#000000';c.fillRect(0,0,640,450);window.contrastFrame=canvas.toDataURL();document.querySelector('.home-background').setAttribute('data-contrast-background','dark-wallpaper');});
  await expect(tone).toHaveAttribute('data-adaptive-tone','light');
  assert.deepEqual(errors,[]);
  console.log('PASS: 200 completed messages × 15 deltas = 0 completed-row renders; 15 live renders; 0 scroll resubscriptions; pin/read position; folded code; glass backing; live accessibility preferences; bright/dark adaptive text');
}finally{await browser.close();await server.close();}

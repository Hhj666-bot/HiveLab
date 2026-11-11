import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1800,height:1100},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
await mkdir('tests/ui/results',{recursive:true});
async function footerFits(scope='.flow-dock'){
 const bounds=await page.locator(scope).evaluate(n=>{const body=n.querySelector('.flow-dock-body').getBoundingClientRect(),footer=n.querySelector('.flow-dock-actions').getBoundingClientRect(),panel=n.getBoundingClientRect();return {bodyTop:body.top,footerTop:footer.top,footerBottom:footer.bottom,panelTop:panel.top};});
 assert.ok(bounds.footerBottom<=bounds.bodyTop+1&&bounds.footerTop>=bounds.panelTop-1,JSON.stringify(bounds));
}
try{
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/project-polish-fixture.html?acceptance');
 await expect(page.locator('.flow-dock-actions').getByRole('button',{name:'通过',exact:true})).toBeVisible();
 await expect(page.locator('.flow-dock-body .verdict')).toHaveCount(0);
 await expect(page.locator('.flow-message-decision')).toHaveCount(2);
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>window.fixtureTheme(theme),theme);
  for(const selector of ['.flow-message-title','.flow-dock-actions','.flow-dock-body .meeting-card','.board-lane']){
   const styles=await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n);return {filter:s.backdropFilter,shadow:s.boxShadow,glass:n.hasAttribute('data-liquid-surface'),background:s.backgroundColor};}));
   assert.ok(styles.every(s=>s.filter==='none'&&s.shadow==='none'&&!s.glass),JSON.stringify({selector,styles}));
  }
  assert.ok(await page.locator('.project-room-summary').evaluate(n=>n.getBoundingClientRect().height<85),'summary should use compact rows');
  assert.ok(await page.locator('.flow-message-title').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).backgroundColor==='rgba(0, 0, 0, 0)')));
  await footerFits();
  const before=await page.locator('.flow-dock-actions').boundingBox();
  await page.locator('.flow-dock-body').evaluate(n=>n.scrollTop=n.scrollHeight);
  const after=await page.locator('.flow-dock-actions').boundingBox();assert.equal(Math.round(before.y),Math.round(after.y));
  await page.screenshot({path:`tests/ui/results/project-compact-${theme}.png`});
 }
 await page.locator('.flow-dock-actions').getByRole('button',{name:'驳回',exact:true}).click();
 await page.getByRole('textbox',{name:'驳回理由（可选）',exact:true}).fill('补充检查说明');
 await footerFits();
 await page.locator('.flow-dock-actions').getByRole('button',{name:'确定驳回',exact:true}).click();
 assert.ok(await page.evaluate(()=>window.testCalls.some(c=>c.method==='projectFlow.round.requestChanges'&&c.params.roundId==='r1'&&c.params.opinion==='补充检查说明')));
 await page.getByRole('button',{name:'铺满聊天区查看',exact:true}).click();await footerFits();
 await page.getByRole('button',{name:'还原到聊天框上方',exact:true}).click();
 await page.getByRole('button',{name:'在独立窗口查看',exact:true}).click();
 await expect(page.locator('.flow-dock-modal .flow-dock-actions').getByRole('button',{name:'通过',exact:true})).toBeVisible();await footerFits('.flow-dock-modal');
 await page.locator('.flow-dock-modal .flow-dock-actions').getByRole('button',{name:'通过',exact:true}).click();
 assert.ok(await page.evaluate(()=>window.testCalls.some(c=>c.method==='projectFlow.round.accept'&&c.params.roundId==='r1'&&c.params.integrationId==='i1'&&c.params.expectedRevision===3)));
 await page.keyboard.press('Escape');
 for(const width of [1100,720]){
  await page.setViewportSize({width,height:1000});await footerFits();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');
  assert.ok(await page.locator('.room-embedded').evaluate(n=>n.querySelector('.room-top').getBoundingClientRect().bottom<=n.querySelector('.flow-dock').getBoundingClientRect().top),'discussion header must not overlap pending items');
 }
 await page.screenshot({path:'tests/ui/results/project-compact-narrow.png'});

 await page.setViewportSize({width:1800,height:1100});
 await page.getByRole('textbox',{name:'在会议室里说话',exact:true}).fill('@DS 进度如何');
 assert.ok(await page.locator('.room-work-intent').evaluate(n=>{const s=getComputedStyle(n);return parseFloat(s.paddingLeft)>=12&&parseFloat(s.paddingTop)>=8;}));
 assert.ok(await page.locator('.project-stage .flow-member').evaluate(n=>{const r=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect();return Math.abs(r.y+r.height/2-p.y-p.height/2)<1;}));
 await page.getByRole('button',{name:'打开文件预览',exact:true}).click();
 await expect(page.locator('[data-drawer-moving]')).toHaveCount(0);
 for(const width of [1800,1400,1100]){
  await page.setViewportSize({width,height:1100});
  const bounds=await page.locator('.preview-conversation').evaluate(n=>{const r=n.getBoundingClientRect(),p=document.querySelector('.file-preview-panel').getBoundingClientRect(),grid=n.querySelector('.project-room-grid').getBoundingClientRect();return {right:r.right,panel:p.left,grid:grid.right,left:r.left};});
  assert.ok(bounds.right<=bounds.panel+1&&bounds.grid<=bounds.right+1&&bounds.left>=0,JSON.stringify(bounds));
  assert.ok(await page.locator('.preview-conversation').evaluate(n=>n.clientWidth>860||getComputedStyle(n.querySelector('.project-room-grid')).gridTemplateColumns.split(' ').length===1),'narrow conversation must stack the board below chat');
 }
 await page.screenshot({path:'tests/ui/results/project-preview-followup.png'});
 assert.deepEqual(errors,[]);console.log('PASS: transparent decision title and compact text; compact summary; header acceptance controls in dock/full/modal, no report overlap; original accept/reject commands preserved; aligned identity, inset mention, narrow preview layout.');
}catch(error){console.error(errors);await page.screenshot({path:'tests/ui/results/project-compact-failure.png'});throw error;}finally{await browser.close();await server.close();}

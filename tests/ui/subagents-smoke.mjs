import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const settled=page=>page.waitForFunction(()=>document.documentElement.dataset.panelMoving===undefined&&!document.querySelector('[data-drawer-moving]'));
try{
  const page=await browser.newPage({viewport:{width:1700,height:1000},colorScheme:'dark'}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/room-preview-fixture.html?sidebar&subagents');
  const cards=page.getByRole('region',{name:'子代理'}),sidebar=page.getByRole('complementary',{name:'子代理侧栏'}),preview=page.getByRole('complementary',{name:'文件预览侧栏'});
  const first=cards.getByRole('button',{name:/子代理 #1：检索配置默认值，运行中/}),second=cards.getByRole('button',{name:/子代理 #2：阅读测试目录，已完成/});
  await expect(first).toContainText('调用：Grep');await expect(first).toContainText('fast-model · low');await expect(second).toContainText('共有 3 个冒烟测试');
  assert.notEqual(await first.evaluate(node=>getComputedStyle(node).animationDuration),'0s','cards fade in');
  await expect(sidebar).toHaveCount(0);
  // Opening springs the panel in with the shared drawer motion, never an instant cut.
  await second.click();
  await expect.poll(()=>page.evaluate(()=>!!document.querySelector('.subagent-sidebar[data-drawer-moving]'))).toBe(true);
  await settled(page);await expect(second).toHaveAttribute('aria-pressed','true');
  await expect(sidebar.getByRole('tab')).toHaveCount(2);await expect(sidebar.getByRole('tab',{name:/#2 阅读测试目录/})).toHaveAttribute('aria-selected','true');
  await expect(sidebar).toContainText('列出 tests/ui 下的冒烟测试。');await expect(sidebar.locator('.subagent-result')).toContainText('activity-smoke.mjs');await expect(sidebar).toContainText('主代理已取回这个结果。');
  const chat=await page.locator('.preview-conversation').boundingBox(),side=await sidebar.boundingBox();assert.ok(chat.x+chat.width<=side.x+1,'conversation sits left of the subagent panel');
  // Width: drag the left edge, arrows step 24px, the conversation keeps 320px, double-click restores, the width is remembered.
  const resizer=sidebar.getByRole('separator',{name:'子代理侧栏宽度'}),grip=await resizer.boundingBox();
  assert.ok(Math.abs(side.width-420)<=2,`default width ${side.width}`);
  await page.mouse.move(grip.x+3,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(grip.x-117,grip.y+grip.height/2,{steps:6});
  assert.equal(await sidebar.getAttribute('data-resizing'),'true');await page.mouse.up();
  assert.ok(Math.abs((await sidebar.boundingBox()).width-540)<=3,'dragging left widens the panel');
  await resizer.focus();await page.keyboard.press('ArrowRight');assert.ok(Math.abs((await sidebar.boundingBox()).width-516)<=3,'ArrowRight narrows by 24px');
  assert.equal(await page.evaluate(()=>localStorage.getItem('hivelab.subagent-panel.width')),'516');
  const wide=await resizer.boundingBox();await page.mouse.move(wide.x+3,wide.y+wide.height/2);await page.mouse.down();await page.mouse.move(wide.x-2000,wide.y+wide.height/2,{steps:4});await page.mouse.up();
  assert.ok((await page.locator('.preview-conversation').boundingBox()).width>=318,'the conversation keeps at least 320px');
  await resizer.dblclick();assert.ok(Math.abs((await sidebar.boundingBox()).width-420)<=2,'double-click restores the default');
  assert.notEqual(await resizer.evaluate(node=>getComputedStyle(node,'::after').transitionDuration),'0s');
  // The result reads smaller than a chat reply.
  const sizes=await page.evaluate(()=>({result:parseFloat(getComputedStyle(document.querySelector('.subagent-result .markdown')).fontSize),chat:(()=>{const probe=document.createElement('div');probe.className='markdown';document.querySelector('.room-bubble').append(probe);const size=parseFloat(getComputedStyle(probe).fontSize);probe.remove();return size;})()}));
  assert.ok(sizes.result<sizes.chat,`result text is smaller than chat text: ${JSON.stringify(sizes)}`);
  // The file preview is a separate panel; with both open the subagent panel is the leftmost right-side panel.
  await page.locator('.generated-file').filter({hasText:'测试说明.md'}).click();
  await expect(preview.getByRole('heading',{name:'内置预览标题'})).toBeVisible();await settled(page);
  await expect(sidebar).toBeVisible();
  const both={chat:await page.locator('.preview-conversation').boundingBox(),side:await sidebar.boundingBox(),file:await preview.boundingBox()};
  assert.ok(both.chat.x+both.chat.width<=both.side.x+1&&both.side.x+both.side.width<=both.file.x+1,`order is conversation | 子代理 | 文件预览: ${JSON.stringify(both)}`);
  // Switching subagents and stopping a running one.
  await sidebar.getByRole('tab',{name:/#1 检索配置默认值/}).click();await expect(sidebar.getByRole('log',{name:'子代理操作记录'})).toContainText('调用：Grep');
  await sidebar.getByRole('button',{name:'停止'}).click();await expect(sidebar.locator('.subagent-sidebar-title')).toContainText('已停止');
  await expect(cards.getByRole('button',{name:/子代理 #1：检索配置默认值，已停止/})).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>window.testCalls.filter(call=>call.method==='subagent.stop').map(call=>call.params.id)),['sa']);
  // Closing the preview first, then returning to the main agent; both leave with motion and the subagent panel lands without a jump.
  await preview.getByRole('button',{name:'收起预览侧栏'}).click();await settled(page);await expect(preview).toHaveCount(0);
  const alone=await sidebar.boundingBox(),body=await page.locator('.preview-workspace-body').boundingBox();assert.ok(Math.abs(alone.x+alone.width-(body.x+body.width-8))<=2,'panel rests at the right edge once the preview closes');
  await sidebar.getByRole('button',{name:'返回主代理'}).click();
  await expect.poll(()=>page.evaluate(()=>!!document.querySelector('.subagent-sidebar[data-drawer-moving]'))).toBe(true);
  await expect(sidebar).toHaveCount(0);await settled(page);
  // Escape returns too; live updates reach the cards and the open panel.
  await cards.getByRole('button',{name:/子代理 #1：/}).click();await settled(page);await sidebar.getByRole('tab',{name:/#1/}).focus();await page.keyboard.press('Escape');await expect(sidebar).toHaveCount(0);
  await page.evaluate(()=>window.fixtureFinishAgent());await expect(cards.getByRole('button',{name:/子代理 #1：检索配置默认值，已完成/})).toContainText('默认值为 2');
  // Liquid glass: cards share the reply optics, the panel shares the file preview's backing layer.
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/room-preview-fixture.html?sidebar&glass&subagents');
  await expect(page.locator('html')).toHaveAttribute('data-liquid-glass','true');
  const glassCard=cards.getByRole('button',{name:/子代理 #2/});await expect(glassCard).toBeVisible();
  const cardGlass=await glassCard.evaluate(node=>{const s=getComputedStyle(node);return {filter:s.backdropFilter,background:s.backgroundColor};});
  assert.notEqual(cardGlass.filter,'none','card is glass');assert.notEqual(cardGlass.background,'rgb(255, 253, 249)','card is not an opaque white block');
  await glassCard.click();await settled(page);
  const panelGlass=await sidebar.evaluate(node=>({own:getComputedStyle(node).backgroundColor,backing:getComputedStyle(node,'::before').backdropFilter}));
  assert.equal(panelGlass.own,'rgba(0, 0, 0, 0)');assert.notEqual(panelGlass.backing,'none','panel has the glass backing layer');
  await page.locator('.generated-file').filter({hasText:'测试说明.md'}).click();await settled(page);await page.mouse.move(20,20);
  const folder=path.resolve('tests/ui/results');await mkdir(folder,{recursive:true});await page.screenshot({path:path.join(folder,'subagents-glass.png')});
  for(const width of [1100,800,580]){await page.setViewportSize({width,height:800});await settled(page);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const box=await sidebar.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,`panel fits at ${width}px`);}
  assert.deepEqual(errors,[]);
  console.log('PASS: subagent cards; 子代理 side panel springs in/out; resizable width (drag/keys/limit/reset/remembered); compact result text; conversation | 子代理 | 文件预览 order; tabs; stop; Escape; live updates; liquid glass cards and panel; narrow widths');
}finally{await browser.close();await server.close();}

import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1400,height:950},colorScheme:'dark'}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/room-preview-fixture.html?sidebar&tasks');
  const card=page.locator('.task-list-card'),list=card.getByRole('list',{name:'任务清单'});
  await expect(card).toHaveCount(1);await expect(card.locator('summary')).toContainText('任务清单');
  await expect(card.getByLabel('已完成 2 项，共 4 项')).toHaveText('2/4');
  // An unfinished list starts open; items show their state in text for screen readers too.
  await expect(card).toHaveAttribute('open','');await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list.getByRole('listitem').nth(2)).toContainText('运行冒烟测试');await expect(list.getByRole('listitem').nth(2)).toContainText('进行中');
  await expect(list.getByRole('listitem').first()).toHaveClass(/completed/);
  const bar=await card.locator('.task-list-progress>span').evaluate(node=>node.style.width);assert.equal(bar,'50%');
  // The card sits above the reply and moves with transitions, not instant cuts.
  assert.notEqual(await card.evaluate(node=>getComputedStyle(node).animationDuration),'0s');
  assert.notEqual(await card.locator('.task-list-item svg').first().evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  const order=await page.locator('[data-message-id=result]').evaluate(line=>{const card=line.querySelector('.task-list-card'),bubble=line.querySelector('.room-bubble');return !!card&&!!bubble&&!!(card.compareDocumentPosition(bubble)&Node.DOCUMENT_POSITION_FOLLOWING);});assert.ok(order,'task list precedes the reply');
  await card.locator('summary').click();await expect(card).not.toHaveAttribute('open','');await card.locator('summary').click();await expect(card).toHaveAttribute('open','');
  // Liquid glass shares the activity bar's optics.
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/room-preview-fixture.html?sidebar&glass&tasks');
  await expect(card).toBeVisible();
  const glass=await card.evaluate(node=>getComputedStyle(node).backdropFilter);assert.notEqual(glass,'none','task list is glass');
  await page.mouse.move(5,5);const folder=path.resolve('tests/ui/results');await mkdir(folder,{recursive:true});await card.screenshot({path:path.join(folder,'task-list-glass.png')});
  await page.setViewportSize({width:420,height:820});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
  assert.deepEqual(errors,[]);
  console.log('PASS: task list card above the reply; counts/progress; states; fold/unfold; transitions; liquid glass; narrow width');
}finally{await browser.close();await server.close();}

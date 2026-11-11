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
  const card=page.locator('.plan-card'),summary=card.locator('summary');

  // Codex/DSH: the plan waits under the reply after the turn ended.
  await page.goto(url('sidebar&plan=ready'));
  await expect(card).toHaveCount(1);await expect(card).toHaveAttribute('open','');await expect(card).toHaveAttribute('data-status','ready');
  await expect(summary).toContainText('计划');await expect(summary).toContainText('等你审阅');
  await expect(card.getByRole('heading',{name:'导出按钮计划'})).toBeVisible();
  const order=await page.locator('[data-message-id=result]').evaluate(line=>{const card=line.querySelector('.plan-card'),bubble=line.querySelector('.room-bubble');return !!card&&!!bubble&&!!(bubble.compareDocumentPosition(card)&Node.DOCUMENT_POSITION_FOLLOWING);});
  assert.ok(order,'the plan card follows the reply');
  assert.notEqual(await card.evaluate(node=>getComputedStyle(node).animationDuration),'0s');
  assert.notEqual(await card.evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  assert.notEqual(await card.evaluate(node=>getComputedStyle(node).boxShadow),'none','a plan awaiting review carries the accent rim');
  // Revise: the note field opens focused, Escape closes it, Ctrl+Enter sends the note.
  await card.getByRole('button',{name:'修改计划'}).click();
  const field=card.getByRole('textbox',{name:'修改意见'});await expect(field).toBeFocused();
  await expect(card.getByRole('button',{name:'发送修改意见'})).toBeDisabled();
  await field.press('Escape');await expect(field).toHaveCount(0);await expect(card.getByRole('button',{name:'按计划执行'})).toBeVisible();
  await card.getByRole('button',{name:'修改计划'}).click();await field.fill('按钮放到右上角');await field.press('Control+Enter');
  await expect(card).toHaveAttribute('data-status','revising');await expect(card).not.toHaveAttribute('open','');
  assert.deepEqual(await calls('plan.revise'),[{runId:'r',text:'按钮放到右上角'}]);
  await expect(card.getByRole('button',{name:'按计划执行'})).toHaveCount(0);
  // Approve.
  await page.goto(url('sidebar&plan=ready'));
  await card.getByRole('button',{name:'按计划执行'}).click();
  await expect(card).toHaveAttribute('data-status','approved');await expect(summary).toContainText('已批准');await expect(card).not.toHaveAttribute('open','');
  assert.deepEqual(await calls('plan.execute'),[{runId:'r'}]);
  await summary.click();await expect(card).toHaveAttribute('open','');await expect(card).toContainText('已按这份计划执行');

  // Claude: the review is the pending approval of the running turn.
  await page.goto(url('sidebar&plan=pending'));
  await expect(card).toHaveAttribute('data-status','pending');await expect(card).toContainText('成员已暂停');
  await card.getByRole('button',{name:'修改计划'}).click();await card.getByRole('textbox',{name:'修改意见'}).fill('先补测试');
  await card.getByRole('button',{name:'发送修改意见'}).click();
  assert.deepEqual(await calls('approval.answer'),[{id:'ap1',choice:'revise',answers:{feedback:'先补测试'}}]);
  await page.goto(url('sidebar&plan=pending'));await card.getByRole('button',{name:'按计划执行'}).click();
  assert.deepEqual(await calls('approval.answer'),[{id:'ap1',choice:'execute'}]);await expect(card).toHaveAttribute('data-status','approved');

  // A newer turn makes the old plan stale: no buttons.
  await page.goto(url('sidebar&plan=pending'));
  await page.evaluate(()=>window.fixturePlan(old=>({...old,status:'pending',approvalId:'gone'})));
  await expect(card).toHaveAttribute('data-status','expired');await expect(card.getByRole('button',{name:'按计划执行'})).toHaveCount(0);

  // Composer switch on a desk topic.
  await page.goto(url('sidebar&plan=ready'));await page.evaluate(()=>window.showDesk());
  const toggle=page.getByRole('button',{name:'计划模式'});
  await expect(toggle).toHaveAttribute('aria-pressed','true');await expect(page.locator('.composer-hint')).toContainText('计划模式');
  const onColor=await toggle.evaluate(node=>getComputedStyle(node).color);
  assert.notEqual(await toggle.evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
  await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','false');
  assert.deepEqual((await calls('session.planMode')).at(-1),{sessionId:'s',on:false});
  await page.waitForTimeout(400);assert.notEqual(await toggle.evaluate(node=>getComputedStyle(node).color),onColor,'the switched-on state is visibly different');
  await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');

  // Liquid glass: the card shares the reply optics, keeps its rim; the switch keeps its accent.
  await page.goto(url('sidebar&glass&plan=ready'));
  await expect(card).toBeVisible();
  assert.notEqual(await card.evaluate(node=>getComputedStyle(node).backdropFilter),'none','plan card is glass');
  assert.match(await card.evaluate(node=>getComputedStyle(node).boxShadow),/inset/,'glass card keeps the accent rim');
  await page.mouse.move(5,5);await card.screenshot({path:path.join(folder,'plan-card-glass.png')});
  await page.evaluate(()=>window.showDesk());await expect(toggle).toHaveAttribute('aria-pressed','true');
  await page.locator('.composer-bottom').screenshot({path:path.join(folder,'plan-switch-glass.png')});
  await page.goto(url('sidebar&plan=ready'));await card.screenshot({path:path.join(folder,'plan-card.png')});
  await page.setViewportSize({width:420,height:820});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll at phone width');
  await expect(card.getByRole('button',{name:'按计划执行'})).toBeVisible();
  assert.deepEqual(errors,[]);
  console.log('PASS: plan card after the reply; ready/pending/approved/revising/expired; revise field keys; approve paths for Codex/DSH and Claude; composer switch; motion; liquid glass; narrow width');
}finally{await browser.close();await server.close();}

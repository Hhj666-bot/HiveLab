import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[],evidence=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('hivelab.appearance.liquid-glass','true'));
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/button-rim-fixture.html');
  const panel=page.getByRole('complementary',{name:'话题管理',exact:true});await expect(panel).toBeVisible();
  await panel.getByRole('button',{name:'删除',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'删除话题',exact:true}),cancel=dialog.getByRole('button',{name:'取消',exact:true}),confirm=dialog.getByRole('button',{name:'确认删除',exact:true});
  await expect(dialog).toBeVisible();
  const style=locator=>locator.evaluate(n=>{const s=getComputedStyle(n);const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');c.fillStyle=s.backgroundColor;c.fillRect(0,0,1,1);return {alpha:c.getImageData(0,0,1,1).data[3]/255,filter:s.backdropFilter,shadow:s.boxShadow,border:s.borderColor,radius:s.borderRadius,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height};});
  const folder=path.resolve('tests/ui/results');await mkdir(folder,{recursive:true});
  for(const glass of [true,false])for(const theme of ['light','dark']){
    await page.evaluate(({glass,theme})=>{window.setFixtureGlass(glass);document.documentElement.dataset.theme=theme;},{glass,theme});
    await page.mouse.move(0,0);await expect.poll(async()=>(await style(cancel)).alpha+(await style(confirm)).alpha).toBe(0);
    const [a,b]=await Promise.all([style(cancel),style(confirm)]);
    assert.equal(a.shadow,'none','ordinary controls share their parent pane');assert.equal(b.shadow,'none');assert.equal(a.filter,'none');assert.equal(b.filter,'none');
    assert.equal(a.alpha,0);assert.equal(b.alpha,0);
    assert.equal(a.height,b.height);assert.equal(a.radius,b.radius);
    const controls=await page.locator('.rim-examples').evaluate(n=>[...n.querySelectorAll('button:not(:disabled):not(.glass-action),[role=button],a.button,input[type=button],summary')].map(el=>({text:el.textContent||el.value,shadow:getComputedStyle(el).boxShadow})));
    assert.ok(controls.length>=11);assert.ok(controls.every(c=>c.shadow==='none'),JSON.stringify(controls));
    const independent=await style(page.getByRole('button',{name:'独立玻璃操作'}));assert.notEqual(independent.shadow,'none');assert.ok(independent.alpha>.7);
    await confirm.hover();await expect.poll(async()=>{const s=await style(confirm);return s.alpha>b.alpha;}).toBe(true);
    assert.equal((await style(confirm)).width,b.width,'the glass never changes button geometry');
    await page.keyboard.press('Tab');await cancel.focus();assert.deepEqual(await cancel.evaluate(n=>({style:getComputedStyle(n).outlineStyle,width:getComputedStyle(n).outlineWidth})),{style:'solid',width:'2px'});
    evidence.push({glass,theme,cancel:a,confirm:b,controls:controls.length});
    await page.mouse.move(0,0);await cancel.evaluate(n=>n.blur());
    await page.screenshot({path:path.join(folder,`button-rim-${theme}-${glass?'glass':'plain'}.png`)});
  }
  await page.setViewportSize({width:540,height:740});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await expect(confirm).toBeVisible();
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-contrast',value:'more'}]});
  assert.equal((await style(confirm)).shadow,'none');await expect.poll(async()=>(await style(page.getByRole('button',{name:'独立玻璃操作'}))).shadow).toBe('none');await confirm.focus();assert.equal(await confirm.evaluate(n=>getComputedStyle(n).outlineWidth),'2px');
  await cdp.send('Emulation.setEmulatedMedia',{features:[]});
  await cancel.click();await expect(dialog).toHaveCount(0);assert.equal(await page.evaluate(()=>window.buttonRimCalls.some(c=>c.method==='room.delete')),false,'styling and cancel never delete data');
  await panel.getByRole('button',{name:'删除',exact:true}).click();await confirm.click();await expect(dialog).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.buttonRimCalls.filter(c=>c.method==='room.delete').length),1,'confirmed fixture action dispatches once');
  assert.deepEqual(errors,[]);await writeFile(path.join(folder,'button-rim-metrics.json'),JSON.stringify(evidence,null,2));
  console.log('PASS: actual topic deletion dialog; ordinary buttons share parent material; independent glass actions keep their backing; all control variants; light/dark and glass/plain; hover without layout changes; keyboard focus; high contrast; narrow window; cancel and one explicit mock deletion.');
}finally{await browser.close();await server.close();}

import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const result=[],errors=[];
const luminance=rgb=>{const linear=rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;};
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('hivelab.appearance.liquid-glass','true'));
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/design-system-fixture.html');
  await expect(page.getByTestId('view')).toHaveText('work');
  const initial=await page.evaluate(()=>({...window.stateMetrics}));
  for(let n=1;n<=15;n++){
    await page.evaluate(n=>window.stateActions.setSnapshot(s=>({...s,events:[...s.events,{id:'delta-'+n,kind:'delta',text:'text',runId:'r',at:'2026-10-29T00:00:00Z'}]})),n);
    await expect(page.getByTestId('event-count')).toHaveText(String(n));
  }
  const final=await page.evaluate(()=>({...window.stateMetrics}));
  assert.equal(final.navigation,initial.navigation,'snapshot deltas must not render navigation selectors');
  assert.equal(final.snapshot-initial.snapshot,15);
  const folder=path.resolve('tests/ui/results');await mkdir(folder,{recursive:true});
  for(const width of [320,768,1440])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const reply=page.locator('.room-bubble'),primary=page.locator('.button.primary');
    const layout=await reply.evaluate(n=>({font:parseFloat(getComputedStyle(n).fontSize),radius:getComputedStyle(n).borderRadius,overflow:document.documentElement.scrollWidth>innerWidth}));
    assert.ok(layout.font>=16&&layout.font<=17);if(width===1440)assert.equal(layout.font,17);
    assert.equal(layout.radius,'18px');assert.equal(layout.overflow,false);
    assert.doesNotMatch(await reply.evaluate(n=>getComputedStyle(n).boxShadow),/inset/);
    assert.equal(await primary.evaluate(n=>getComputedStyle(n).borderRadius),'9999px');
    assert.equal(await page.locator('.button.secondary').evaluate(n=>getComputedStyle(n).borderRadius),'8px');
    for(const state of ['normal','hover','pressed']){
      if(state==='normal')await page.mouse.move(width-1,899);else await primary.hover();
      if(state==='pressed')await page.mouse.down();
      await page.waitForTimeout(180);
      const colours=await primary.evaluate(n=>{const c=getComputedStyle(n),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');return [c.color,c.backgroundColor].map(colour=>{ctx.clearRect(0,0,300,150);ctx.fillStyle=colour;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];});});
      if(state==='pressed')await page.mouse.up();
      const a=luminance(colours[0]),b=luminance(colours[1]),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      assert.ok(contrast>=4.5,`${theme} ${state} text contrast ${contrast}`);
    }
    const input=page.getByRole('textbox',{name:'项目名称'});await input.focus();
    const focus=await input.evaluate(n=>{const s=getComputedStyle(n);return {width:s.outlineWidth,style:s.outlineStyle,radius:s.borderRadius,shadow:s.boxShadow};});
    assert.deepEqual(focus,{width:'2px',style:'solid',radius:'8px',shadow:'none'});
    result.push({width,theme,...layout,focus});
    await page.screenshot({path:path.join(folder,`design-system-${width}-${theme}.png`)});
  }
  assert.deepEqual(errors,[]);
  await writeFile(path.join(folder,'design-system-metrics.json'),JSON.stringify({selectors:{navigationRenders:final.navigation-initial.navigation,snapshotRenders:15},layouts:result},null,2));
  console.log('PASS: 15 snapshot updates do not render navigation selectors; 320/768/1440px light/dark layouts, fluid 16–17px body, five-radius tokens, primary button contrast in all states, keyboard focus and input outline.');
}finally{await browser.close();await server.close();}

import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
import {unfoldSettings} from '../helpers/settings-menu.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
const level=page=>page.evaluate(()=>document.documentElement.dataset.motion);
// Reads the rules a real element gets, so a level that only exists on <html> cannot pass.
const css=page=>page.locator('.icon-button').first().evaluate(n=>{const s=getComputedStyle(n);return {property:s.transitionProperty,duration:s.transitionDuration};});
const distance=page=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--motion-distance').trim());
async function open(reducedMotion){
 const page=await browser.newPage({viewport:{width:1500,height:950},reducedMotion}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('hivelab.appearance.adaptive-text','false');localStorage.setItem('hivelab.appearance.liquid-glass','true');});
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/appearance-notice-fixture.html');await page.getByRole('button',{name:'外观',exact:true}).click();await unfoldSettings(page);
 return {page,errors,dialog:page.getByRole('dialog',{name:'外观设置',exact:true})};
}
const choose=(dialog,name)=>dialog.getByRole('radiogroup',{name:'动效',exact:true}).getByRole('radio',{name,exact:true}).click();
try{
 // This machine: Windows animation effects are off and the saved choice is the default.
 const {page,errors,dialog}=await open('reduce');const note=dialog.getByRole('note',{name:'动画提醒',exact:true});
 assert.equal(await level(page),'reduced');await expect(note).toContainText('完整');assert.equal(await distance(page),'0');
 const reduced=await css(page);assert.match(reduced.property,/opacity/);assert.doesNotMatch(reduced.property,/transform/);assert.notEqual(reduced.duration,'0s','简化档必须保留过渡，不能瞬间完成');
 // "Full" wins over the system setting, without touching Windows.
 await choose(dialog,'完整');await expect.poll(()=>level(page)).toBe('full');await expect(note).toHaveCount(0);assert.equal(await distance(page),'1');
 assert.equal(await page.evaluate(()=>localStorage.getItem('hivelab.appearance.motion')),'full');
 await page.reload();await expect.poll(()=>level(page)).toBe('full');await page.getByRole('button',{name:'外观',exact:true}).click();await unfoldSettings(page);
 await expect(dialog.getByRole('radio',{name:'完整',exact:true})).toHaveAttribute('aria-checked','true');
 await choose(dialog,'关闭');await expect.poll(()=>level(page)).toBe('off');await expect.poll(async()=>(await css(page)).duration.split(',').every(v=>parseFloat(v)===0)).toBe(true);
 await choose(dialog,'简化');await expect.poll(()=>level(page)).toBe('reduced');
 assert.deepEqual(errors,[]);await page.close();
 // A machine with animation on is unchanged by default, and can still choose less.
 const normal=await open('no-preference');assert.equal(await level(normal.page),'full');await expect(normal.dialog.getByRole('note',{name:'动画提醒',exact:true})).toHaveCount(0);assert.equal(await distance(normal.page),'1');
 await choose(normal.dialog,'简化');await expect.poll(()=>level(normal.page)).toBe('reduced');assert.deepEqual(normal.errors,[]);await normal.page.close();
 console.log('PASS: motion levels: default follows the system; simplified keeps fades and drops movement; full overrides the system and persists; off is instant.');
}finally{await browser.close();await server.close();}

import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1800,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('hivelab.appearance.adaptive-text','false'));
try{
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/project-polish-fixture.html?acceptance&transition');
 await expect(page.locator('.page-turn-live .room-line')).toHaveCount(2);
 const frames=await page.evaluate(()=>new Promise(resolve=>{
  const frames=[],start=performance.now();window.fixtureDesk(false);
  const tick=now=>{const live=document.querySelector('.page-turn-live'),wall=document.querySelector('.home-background[data-wallpaper-target]'),animation=n=>n?.getAnimations().find(a=>a.effect?.getTiming().duration===420);const pa=animation(live),wa=animation(wall);frames.push({t:now-start,pending:!!live.querySelector('[data-page-loading]'),page:pa?Number(pa.currentTime):null,wall:wa?Number(wa.currentTime):null,ghosts:document.querySelectorAll('.page-turn-ghost').length});if(now-start<1800)requestAnimationFrame(tick);else resolve(frames);};requestAnimationFrame(tick);
 }));
 assert.ok(frames.some(f=>f.pending&&f.t>200),'test must simulate a slow first project read');
 assert.ok(frames.every(f=>!f.pending||!(f.wall>0)),'wallpaper must wait for the project content');
 const moving=frames.filter(f=>f.page>0&&f.page<400&&f.wall>0&&f.wall<400);assert.ok(moving.length>3,'wallpaper and content should turn together');assert.ok(moving.every(f=>Math.abs(f.page-f.wall)<18),JSON.stringify(moving));
 assert.equal(frames.at(-1).ghosts,0);
 const alpha=selector=>page.locator(selector).evaluate(n=>{const c=document.createElement('canvas').getContext('2d');c.fillStyle=getComputedStyle(n).backgroundColor;c.fillRect(0,0,1,1);return c.getImageData(0,0,1,1).data[3]/255;});
 const header=await alpha('.workspace-toolbar-glass');
 for(const value of [0,65,100]){
  await page.evaluate(v=>window.fixtureMenuTransparency(v),value);
  for(const selector of ['.board','.flow-dock'])await expect.poll(()=>alpha(selector)).toBeCloseTo(1-value/100,2);
  assert.equal(await alpha('.workspace-toolbar-glass'),header,'menu transparency must not change the top bar');
 }
 await page.evaluate(()=>window.fixtureMenuTransparency(65));
 await page.getByRole('tab',{name:'项目进度',exact:true}).click();await expect.poll(()=>alpha('.project-progress')).toBeCloseTo(.35,2);
 await page.getByRole('button',{name:'收起看板',exact:true}).click();await expect.poll(()=>alpha('.project-side-rail')).toBeCloseTo(.35,2);
 // A second navigation while the first waits must cancel its pending start and old cleanup timer.
 await page.evaluate(()=>window.fixtureDesk(true));await expect(page.locator('.page-turn-ghost')).toHaveCount(0);
 await page.evaluate(()=>new Promise(resolve=>{window.fixtureDesk(false);setTimeout(()=>{window.fixtureDesk(true);resolve();},100);}));
 await expect(page.locator('.page-turn-live .personal-room')).toBeVisible();await expect(page.locator('.page-turn-ghost')).toHaveCount(0);
 await page.evaluate(()=>window.fixtureDesk(false));await expect(page.locator('.project-room')).toBeVisible();await expect(page.locator('.page-turn-ghost')).toHaveCount(0);
 await page.getByRole('button',{name:'展开看板',exact:true}).click();await expect(page.locator('.board')).toBeVisible();
 await writeFile('tests/ui/results/project-entry-frames.json',JSON.stringify(frames));await page.screenshot({path:'tests/ui/results/project-entry-menu-opacity.png'});assert.deepEqual(errors,[]);console.log('PASS: first project entry waits for content; wallpaper/page timelines agree; board/dock follow menu transparency independently of header.');
}catch(e){console.log(errors);await page.screenshot({path:'tests/ui/results/project-entry-failure.png'});throw e;}finally{await browser.close();await server.close();}

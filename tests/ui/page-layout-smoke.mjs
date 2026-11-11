import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1800,height:1100}}),errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('hivelab.appearance.adaptive-text','false'));
try{
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/page-layout-fixture.html');
 for(const id of ['b','a','b']){
  await page.evaluate(()=>window.switchDesk('home'));await expect(page.locator('.page-turn-ghost')).toHaveCount(0);
  const frames=await page.evaluate(id=>new Promise(resolve=>{
   const frames=[],start=performance.now();window.switchDesk(id);
   const tick=now=>{const room=document.querySelector('.page-turn-live .room'),list=room?.querySelector('.room-messages'),last=room?.querySelector('.room-line:last-child'),c=room?.querySelector('.composer');if(room&&list&&last){const r=last.getBoundingClientRect(),base=list.getBoundingClientRect();frames.push({time:now-start,offset:parseFloat(room.style.getPropertyValue('--glass-top-offset'))||0,top:r.top-base.top,bottom:r.bottom-base.top,scroll:list.scrollTop,height:list.scrollHeight,count:list.querySelectorAll('.room-line').length,composer:c.getBoundingClientRect().top,ghosts:document.querySelectorAll('.page-turn-ghost').length});}if(now-start<1500)requestAnimationFrame(tick);else resolve(frames);};requestAnimationFrame(tick);
  }),id);
  results.push({id,frames});
  assert.ok(Math.max(...frames.map(f=>f.offset))-Math.min(...frames.map(f=>f.offset))<=1,'page movement must not change chat header inset: '+JSON.stringify(frames.filter((_,i)=>i%10===0)));
  const stable=frames;assert.ok(Math.max(...stable.map(f=>f.bottom))-Math.min(...stable.map(f=>f.bottom))<=2,'history hydration must keep latest message anchored');
  assert.equal(frames.at(-1).ghosts,0);assert.equal(frames.at(-1).count,32);
 }
 assert.deepEqual(errors,[]);await mkdir('tests/ui/results',{recursive:true});await writeFile('tests/ui/results/page-layout-frames.json',JSON.stringify(results));await page.screenshot({path:'tests/ui/results/page-layout-final.png'});console.log('PASS: both switch directions preserve header inset and long-history anchor; transitions complete without ghosts.');
}catch(e){console.log(errors);await page.screenshot({path:'tests/ui/results/page-layout-failure.png'});throw e;}finally{await browser.close();await server.close();}

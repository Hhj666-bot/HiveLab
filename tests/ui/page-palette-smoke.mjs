import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
import {emptyTextToneCache,updateTextToneCache} from '../../src/shared/adaptive-text-cache.ts';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'no-preference'}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 let cache=emptyTextToneCache(),blocked=false;
 await page.exposeFunction('fixtureReadTextCache',()=>cache);
 await page.exposeFunction('fixtureWriteTextCache',({context,tones})=>{cache=updateTextToneCache(cache,context,tones);return {saved:true};});
 await page.exposeFunction('fixtureContrastFrame',async()=>blocked?null:{dataUrl:'data:image/png;base64,'+(await page.screenshot()).toString('base64')});
 await page.addInitScript(()=>{localStorage.setItem('hivelab.appearance.adaptive-text','true');localStorage.setItem('hivelab.appearance.adaptive-text.dwell-seconds','3.5');localStorage.setItem('hivelab.appearance.adaptive-text.hold-seconds','12');localStorage.setItem('hivelab.chat-appearance',JSON.stringify({reply:{color:'theme',transparency:75},mine:{color:'theme',transparency:75},input:{color:'theme',transparency:85}}));});
 const url=server.resolvedUrls.local[0]+'tests/ui/room-preview-fixture.html?sidebar&glass&palettes';await page.goto(url);await page.waitForFunction(()=>typeof window.fixtureVisit==='function');
 const selectors=['.sidebar p','.topic-picker select','.topic-more svg','.workspace-icon-actions>button:first-child svg','.composer textarea'];
 const staying=['.sidebar p','.workspace-icon-actions>button:first-child svg'];
 const snapshot=async()=>page.evaluate(selectors=>selectors.map(selector=>{const node=document.querySelector(selector);return {selector,color:getComputedStyle(node).color,tone:node.closest('[data-adaptive-tone]')?.dataset.adaptiveTone};}),selectors);
 const destinations=[{desk:false,theme:'dark',tone:'light'},{desk:true,theme:'dark',tone:'dark'},{desk:false,theme:'light',tone:'dark'},{desk:true,theme:'light',tone:'dark'}],expected=[];
 for(const destination of destinations){
  await page.evaluate(value=>window.fixtureVisit(value),destination);
  await expect(page.locator('.room-topic-bar')).toHaveAttribute('data-adaptive-tone',destination.tone);
  await expect.poll(()=>Object.entries(cache.contexts).some(([key,value])=>{const context=JSON.parse(key);return context.page===(destination.desk?'desk:m1':'lounge')&&context.theme===destination.theme&&value.tones['topic-controls:话题记录']===destination.tone;})).toBe(true);
  await page.waitForTimeout(500);expected.push(await snapshot());
 }
 blocked=true;
 // The tone is known in the synchronous React commit, with background recognition unavailable and
 // nonzero user dwell/hold times; the colour then travels there instead of changing in one frame.
 for(let repeat=0;repeat<3;repeat++)for(let index=0;index<destinations.length;index++){
  const before=await snapshot();
  const result=await page.evaluate(async({destination,selectors})=>{
   const read=()=>selectors.map(selector=>{const node=document.querySelector(selector);return {selector,color:getComputedStyle(node).color,tone:node.closest('[data-adaptive-tone]')?.dataset.adaptiveTone};}),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
   window.fixtureVisit(destination);const commit=read();await wait(170);const midway=read();await wait(420);return {commit,midway,settled:read()};
  },{destination:destinations[index],selectors});
  assert.deepEqual(result.commit.map(item=>item.tone),expected[index].map(item=>item.tone),`destination tone in commit ${repeat}/${index}`);
  assert.deepEqual(result.settled,expected[index],`destination palette settled ${repeat}/${index}`);
  // Page content is replaced and fades with the turn; what stays on screen has to travel.
  expected[index].forEach((item,at)=>{if(staying.includes(item.selector)&&before[at].color!==item.color)assert.ok(result.midway[at].color!==item.color&&result.midway[at].color!==before[at].color,`${item.selector} must pass through a colour between the two tones ${repeat}/${index}`);});
 }
 await page.reload();await page.waitForFunction(()=>typeof window.fixtureVisit==='function');
 for(let index=0;index<destinations.length;index++){
  await page.evaluate(destination=>window.fixtureVisit(destination),destinations[index]);
  await expect.poll(snapshot).toEqual(expected[index]);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: page and day/night tones restore during the React commit and their colours travel there gradually; text and SVG colours agree; repeated navigation and restart work without background recognition or dwell delay.');
}finally{await browser.close();await server.close();}

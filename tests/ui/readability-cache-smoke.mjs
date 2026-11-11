import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
import {emptyTextToneCache,updateTextToneCache} from '../../src/shared/adaptive-text-cache.ts';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
let debugPage;
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
 debugPage=page;
 page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
 let cache=emptyTextToneCache(),blockFrames=false,frames=0;
 await page.exposeFunction('fixtureReadTextCache',()=>cache);
 await page.exposeFunction('fixtureWriteTextCache',({context,tones})=>{cache=updateTextToneCache(cache,context,tones);return {saved:true};});
 await page.exposeFunction('fixtureContrastFrame',async()=>{frames++;return blockFrames?null:{dataUrl:'data:image/png;base64,'+(await page.screenshot()).toString('base64')};});
 await page.addInitScript(()=>{
  if(window.top!==window)return;
  if(document.documentElement)document.documentElement.dataset.theme='dark';
  document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.theme='dark';},{once:true});
  localStorage.setItem('hivelab.appearance.adaptive-text','true');
  localStorage.setItem('hivelab.appearance.adaptive-text.dwell-seconds','0');localStorage.setItem('hivelab.appearance.adaptive-text.hold-seconds','0');
  localStorage.setItem('hivelab.chat-appearance',JSON.stringify({reply:{color:'theme',transparency:60},mine:{color:'theme',transparency:60},input:{color:'theme',transparency:100}}));
 });
 const url=server.resolvedUrls.local[0]+'tests/ui/room-preview-fixture.html?sidebar&glass';await page.goto(url);await page.waitForFunction(()=>typeof window.showDesk==='function');await page.evaluate(()=>window.showDesk());
 const select=page.getByRole('combobox',{name:'话题记录',exact:true}),plus=page.getByRole('button',{name:'开新话题',exact:true}),more=page.getByRole('button',{name:'话题操作',exact:true});
 const tone=control=>control.evaluate(node=>node.closest('[data-adaptive-tone]')?.dataset.adaptiveTone);
 for(const control of [select,plus,more])await expect.poll(()=>tone(control)).toBe('light');
 assert.ok(await more.evaluate(n=>{const b=n.getBoundingClientRect(),s=n.querySelector('svg').getBoundingClientRect();return Math.abs(b.x+b.width/2-s.x-s.width/2)<1&&Math.abs(b.y+b.height/2-s.y-s.height/2)<1;}));
 await expect.poll(()=>select.evaluate(n=>getComputedStyle(n,'::picker-icon').color)).toBe('rgb(248, 250, 252)');
 assert.ok(await select.evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=14&&Number(getComputedStyle(n).fontWeight)>=500));
 await page.getByRole('button',{name:'打开文件预览',exact:true}).click();
 const panel=page.getByRole('complementary',{name:'文件预览侧栏',exact:true}),resizer=page.getByRole('separator',{name:'文件预览宽度',exact:true});
 async function geometry(){return page.evaluate(()=>{const p=document.querySelector('.file-preview-panel'),r=p.getBoundingClientRect(),bar=document.querySelector('.preview-workspace-bar').getBoundingClientRect(),terminal=document.querySelector('.workspace-terminal').getBoundingClientRect(),header=p.querySelector('.preview-panel-header').getBoundingClientRect(),style=getComputedStyle(p);return {top:r.top,bottom:r.bottom,width:r.width,barBottom:bar.bottom,terminalTop:terminal.top,headerTop:header.top,paddingTop:style.paddingTop,radii:[style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomLeftRadius,style.borderBottomRightRadius],backingTop:getComputedStyle(p,'::before').top,backingRadius:getComputedStyle(p,'::before').borderTopLeftRadius};});}
 await expect.poll(async()=>{const g=await geometry();return Math.abs(g.top-g.barBottom-8);}).toBeLessThan(2);
 const before=await geometry();assert.equal(before.paddingTop,'0px');assert.ok(before.terminalTop-before.bottom>=8);assert.ok(before.headerTop-before.top<=2);assert.ok(before.radii.every(radius=>parseFloat(radius)>=16));assert.equal(before.backingTop,'0px');assert.equal(before.backingRadius,before.radii[0]);
 const grip=await resizer.boundingBox();assert.ok(Math.abs(grip.y-before.top)<2&&Math.abs(grip.y+grip.height-before.bottom)<2);
 await resizer.focus();await page.keyboard.press('ArrowLeft');await expect.poll(async()=>Math.round((await geometry()).width)).toBe(Math.round(before.width+24));const resized=await geometry();assert.equal(resized.top,before.top);assert.equal(resized.bottom,before.bottom);
 await mkdir('tests/ui/results',{recursive:true});await page.screenshot({path:'tests/ui/results/preview-geometry.png'});
 await expect.poll(()=>Object.entries(cache.contexts).some(([key,value])=>key.includes('desk:m1')&&key.includes('fixture:dark')&&value.tones['topic-controls:话题记录']==='light')).toBe(true);
 await page.evaluate(()=>window.fixtureWallpaper('bright'));for(const control of [select,plus,more])await expect.poll(()=>tone(control)).toBe('dark');
 await expect.poll(()=>Object.keys(cache.contexts).some(key=>key.includes('desk:m1')&&key.includes('fixture:bright'))).toBe(true);
 await page.evaluate(()=>window.fixtureDesk(false));await expect(page.locator('.page-background')).toHaveAttribute('data-background-page','lounge');
 blockFrames=true;await page.evaluate(()=>window.fixtureDesk(true));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 for(const control of [select,plus,more])await expect.poll(()=>tone(control)).toBe('dark');
 await page.reload();await page.waitForFunction(()=>typeof window.fixtureDesk==='function');await page.evaluate(()=>{window.fixtureWallpaper('bright');window.fixtureDesk(true);});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 for(const control of [select,plus,more])await expect.poll(()=>tone(control)).toBe('dark');
 blockFrames=false;const captured=frames;await page.evaluate(()=>window.fixtureWallpaper('dark'));await expect.poll(()=>tone(select)).toBe('light');
 // Verify the real compositor, rather than only the computed filter string.
 const clip=await page.evaluate(()=>{
  const input=document.querySelector('.composer.room-input').getBoundingClientRect(),log=document.querySelector('.room-messages'),r=log.getBoundingClientRect(),pattern=document.createElement('div');
  const area={x:Math.round(input.left+input.width/2-100),y:Math.round(input.top+input.height*.38),width:200,height:24};
  Object.assign(pattern.style,{position:'absolute',left:area.x-r.left+'px',top:area.y-r.top+log.scrollTop+'px',width:'200px',height:'24px',zIndex:'1',background:'repeating-linear-gradient(90deg,#fff 0 2px,#000 2px 4px)',pointerEvents:'none'});log.append(pattern);
  document.documentElement.style.setProperty('--liquid-finish','blur(0px) contrast(1) brightness(1) saturate(1)');return area;
 });
 const sharp=(await page.screenshot({clip})).toString('base64');await page.evaluate(()=>document.documentElement.style.setProperty('--liquid-finish','blur(6px) contrast(1) brightness(1) saturate(1)'));const blurred=(await page.screenshot({clip})).toString('base64');
 const energy=await page.evaluate(async images=>{const values=[];for(const data of images){const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const c=canvas.getContext('2d');c.drawImage(img,0,0);const p=c.getImageData(0,0,img.width,img.height).data;let total=0;for(let y=0;y<img.height;y++)for(let x=1;x<img.width;x++){const i=(y*img.width+x)*4;total+=Math.abs(p[i]-p[i-4]);}values.push(total/(img.width*img.height));}return values;},[sharp,blurred]);
 assert.ok(energy[0]>10&&energy[1]<energy[0]*.7,JSON.stringify({sharp:energy[0],blurred:energy[1]}));
 await writeFile('tests/ui/results/input-glass-sharp.png',Buffer.from(sharp,'base64'));await writeFile('tests/ui/results/input-glass-blurred.png',Buffer.from(blurred,'base64'));console.log('Input backdrop edge contrast:',JSON.stringify({sharp:energy[0],blurred:energy[1]}));
 await mkdir('tests/ui/results',{recursive:true});await page.screenshot({path:'tests/ui/results/preview-and-cached-text.png'});assert.ok(frames>captured);assert.deepEqual(errors,[]);
 console.log('PASS: complete rounded preview below toolbar and above terminal; independent width; readable topic typography and icons; immediate cached colours on navigation and reload without capture; wallpaper refresh; real input-glass blur.');
}catch(error){if(debugPage){await mkdir('tests/ui/results',{recursive:true});await debugPage.screenshot({path:'tests/ui/results/readability-failure.png'});console.log(await debugPage.evaluate(()=>({theme:document.documentElement.dataset.theme,wallpapers:[...document.querySelectorAll('.home-background')].map(n=>({background:getComputedStyle(n).backgroundColor,id:n.dataset.contrastBackground})),controls:[...document.querySelectorAll('.topic-picker select,.desk-new-topic,.topic-more')].map(n=>({label:n.getAttribute('aria-label'),tone:n.dataset.adaptiveTone,color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor}))})));}throw error;
}finally{await browser.close();await server.close();}

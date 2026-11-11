import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000},reducedMotion:'no-preference'});
 await page.addInitScript(()=>{localStorage.setItem('hivelab.appearance.adaptive-text','false');localStorage.setItem('hivelab.chat-appearance',JSON.stringify({reply:{color:'theme',transparency:85},mine:{color:'theme',transparency:85},input:{color:'theme',transparency:85}}));});
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/room-preview-fixture.html?sidebar&glass');await page.waitForFunction(()=>typeof window.showDesk==='function');await page.evaluate(()=>window.showDesk());
 const bubble=page.locator('.room-line:not(.mine) .room-bubble').first(),input=page.locator('.composer.room-input');await expect(bubble).toHaveAttribute('data-liquid-surface','');await expect(input).toHaveAttribute('data-liquid-surface','');
 await page.evaluate(()=>{document.querySelector('.home-background').style.background='#687f9f';const log=document.querySelector('.room-messages');log.scrollTop=0;});
 // Run real entry animations: their completed effect must release the backdrop.
 await page.waitForTimeout(650);
 // Streaming and thinking DOM updates must not invalidate an unchanged header filter.
 const headerRefreshes=await page.evaluate(async()=>{
  const header=document.querySelector('.workspace-toolbar-glass'),id=header.style.getPropertyValue('--liquid-refraction').match(/#([^\"]+)/)[1],filter=document.getElementById(id);let writes=0;
  const observer=new MutationObserver(records=>writes+=records.length);observer.observe(filter,{subtree:true,attributes:true,attributeFilter:['scale','href']});
  const marker=document.createElement('span');document.querySelector('.room-messages').append(marker);
  for(let i=0;i<8;i++){marker.className='thinking-frame-'+i;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);}
  marker.remove();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);observer.disconnect();return writes;
 });
 assert.equal(headerRefreshes,0,'thinking updates must leave unchanged header optics intact');
 const areas=await page.evaluate(()=>['.workspace-toolbar-glass','.room-line:not(.mine) .room-bubble','.composer.room-input'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,x:Math.round(r.x+6),y:Math.round(Math.min(innerHeight-20,r.y+r.height/2)),width:10,height:10};}));
 async function samples(saturation){
  await page.evaluate(value=>document.documentElement.style.setProperty('--liquid-finish',`blur(3.5px) contrast(1.3) brightness(.95) saturate(${value})`),saturation);
  const result=[];for(const area of areas){const data=(await page.screenshot({clip:area})).toString('base64');result.push(await page.evaluate(async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=10;const c=canvas.getContext('2d');c.drawImage(img,0,0);const p=c.getImageData(0,0,10,10).data,rgb=[0,0,0];for(let i=0;i<p.length;i+=4)for(let channel=0;channel<3;channel++)rgb[channel]+=p[i+channel]/100;return {rgb,chroma:Math.max(...rgb)-Math.min(...rgb)};},data));}return result;
 }
 const neutral=await samples(0),saturated=await samples(2.5),evidence=areas.map((area,i)=>({surface:area.selector,neutral:neutral[i].chroma,saturated:saturated[i].chroma}));console.log('Rendered saturation response:',JSON.stringify(evidence));
 assert.ok(evidence.every(sample=>sample.saturated>sample.neutral+20),'Every glass family must filter wallpaper outside the animated conversation: '+JSON.stringify(evidence));
 // Put identical lettering behind the header and composer, then isolate blur
 // from refraction so the two backing layers can be compared directly.
 await page.evaluate(()=>window.fixtureMaterial({refraction:0,blur:3.5}));
 await expect.poll(()=>input.evaluate(n=>{const id=n.style.getPropertyValue('--liquid-refraction').match(/#([^\"]+)/)[1];return document.getElementById(id).querySelector('feDisplacementMap').getAttribute('scale');})).toBe('0');
 const textAreas=await page.evaluate(()=>{
  const header=document.querySelector('.workspace-toolbar-glass').getBoundingClientRect(),composer=document.querySelector('.composer.room-input').getBoundingClientRect(),log=document.querySelector('.room-messages'),bounds=log.getBoundingClientRect();
  const x=Math.round(composer.x+composer.width/2-130),areas=[{x,y:Math.round(header.y+8),width:260,height:32},{x,y:Math.round(composer.y+46),width:260,height:32}];
  for(const area of areas){const marker=document.createElement('div');marker.textContent='玻璃后方文字 ABC 123';Object.assign(marker.style,{position:'absolute',zIndex:'1',left:area.x-bounds.x+'px',top:area.y-bounds.y+log.scrollTop+'px',width:'260px',height:'32px',color:'#fff',background:'#233243',font:'600 20px/28px "Microsoft YaHei",sans-serif',textShadow:'none',pointerEvents:'none'});log.append(marker);}return areas;
 });
 async function textEnergy(blur){
  await page.evaluate(value=>document.documentElement.style.setProperty('--liquid-finish',`blur(${value}px) contrast(1.3) brightness(.95) saturate(1)`),blur);
  const values=[];for(const area of textAreas){const png=(await page.screenshot({clip:area})).toString('base64');values.push(await page.evaluate(async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const context=canvas.getContext('2d');context.drawImage(img,0,0);const p=context.getImageData(0,0,img.width,img.height).data;let energy=0;for(let y=1;y<img.height;y++)for(let x=1;x<img.width;x++){const i=(y*img.width+x)*4;energy+=Math.abs(p[i]-p[i-4])+Math.abs(p[i]-p[i-img.width*4]);}return energy/(img.width*img.height);},png));}return values;
 }
 const sharp=await textEnergy(0),frosted=await textEnergy(3.5),ratio=frosted.map((value,i)=>value/sharp[i]);console.log('Identical background text:',JSON.stringify({sharp,frosted,ratio}));assert.ok(ratio.every(value=>value<.45)&&Math.abs(ratio[0]-ratio[1])<.2,'header and composer must diffuse the same lettering equally');assert.equal(await input.locator('textarea').evaluate(n=>getComputedStyle(n).filter),'none');
 console.log('PASS: real wallpaper saturation changes navigation, reply bubbles and composer with entry animations enabled.');
}finally{await browser.close();await server.close();}

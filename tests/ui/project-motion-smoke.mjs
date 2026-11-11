import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1800,height:1100},reducedMotion:'no-preference'}),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('hivelab.appearance.adaptive-text','false'));
async function trip(action,surface){
 const result=await page.evaluate(async({action,surface})=>{
  const frames=[];let done=false;
  const sample=()=>{
   const n=document.querySelector(surface),r=n?.getBoundingClientRect(),id=n?.style.getPropertyValue('--liquid-refraction').match(/#([^"\)]+)/)?.[1],f=id&&document.getElementById(id),img=f?.querySelector('feImage');
   const c=document.querySelector('.preview-conversation').getBoundingClientRect(),p=document.querySelector('.file-preview-panel')?.getBoundingClientRect(),g=document.querySelector('.project-room-grid')?.getBoundingClientRect();
   if(document.documentElement.hasAttribute('data-panel-moving')||document.documentElement.hasAttribute('data-sidebar-moving'))frames.push({time:performance.now(),w:r?.width,h:r?.height,map:img?.getAttribute('href'),imageWidth:Number(img?.getAttribute('width')),imageHeight:Number(img?.getAttribute('height')),overlap:p?Math.max(0,c.right-p.left):0,overflow:g?Math.max(0,g.right-c.right):0,left:c.left});
   if(!done)requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  if(action==='preview-open')document.querySelector('[aria-label="打开文件预览"]').click();
  else if(action==='preview-close')document.querySelector('[aria-label="收起预览侧栏"]').click();
  else if(action.startsWith('sidebar'))window.fixtureSidebar(action.endsWith('open')?'expanded':'icons');
  else window.fixtureTerminal(action.endsWith('open'));
  await new Promise(resolve=>setTimeout(resolve,1400));done=true;
  return {action,surface,frames:frames.length,maps:new Set(frames.map(f=>f.map).filter(Boolean)).size,sizes:new Set(frames.map(f=>`${Math.round(f.w)}:${Math.round(f.h)}`)).size,maxGap:Math.max(0,...frames.slice(1).map((f,i)=>f.time-frames[i].time)),overlap:Math.max(0,...frames.map(f=>f.overlap)),overflow:Math.max(0,...frames.map(f=>f.overflow)),left:Math.min(...frames.map(f=>f.left)),dimensionsFollow:frames.every(f=>Math.abs(f.imageWidth-f.w)<3&&Math.abs(f.imageHeight-f.h)<3)};
 },{action,surface});
 results.push(result);assert.ok(result.frames>=3,JSON.stringify(result));assert.ok(result.maps>=3&&result.sizes>=3,JSON.stringify(result));
 assert.ok(result.dimensionsFollow,JSON.stringify(result));
 if(surface!=='.sidebar')assert.ok(result.overlap<=2&&result.overflow<=2&&result.left>=0,JSON.stringify(result));
 await expect(page.locator('[data-drawer-moving]')).toHaveCount(0);
}
try{
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/project-polish-fixture.html?acceptance&motion');
 await expect(page.locator('.flow-dock')).toHaveAttribute('data-liquid-surface','');
 await trip('sidebar-open','.flow-dock');await trip('sidebar-close','.flow-dock');
 await trip('preview-open','.flow-dock');await trip('preview-close','.flow-dock');
 await trip('terminal-open','.board');await trip('terminal-close','.board');
 await page.screenshot({path:'tests/ui/results/project-motion-final.png'});
 await page.setViewportSize({width:1200,height:1000});
 await page.evaluate(()=>window.fixtureDesk(true));
 await expect(page.locator('.room-bubble').first()).toHaveAttribute('data-liquid-surface','');
 await trip('sidebar-open','.sidebar');await trip('sidebar-close','.sidebar');
 // The input follows the drawer even when a short message does not change width.
 await trip('preview-open','.composer');
 await trip('terminal-open','.file-preview-panel');await trip('terminal-close','.file-preview-panel');
 await trip('preview-close','.composer');
 assert.deepEqual(errors,[]);
 await mkdir('tests/ui/results',{recursive:true});await writeFile('tests/ui/results/project-motion-metrics.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
}catch(error){console.log(JSON.stringify(results));await page.screenshot({path:'tests/ui/results/project-motion-failure.png'});throw error;}
finally{await browser.close();await server.close();}

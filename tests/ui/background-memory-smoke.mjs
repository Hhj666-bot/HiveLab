import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({reducedMotion:'reduce'});
 await page.addInitScript(()=>localStorage.setItem('test-background',JSON.stringify({home:{mode:'media',media:{file:'00000000-0000-0000-0000-000000000001.wallpaper',kind:'scene',name:'fixture',source:'local'}},room:{mode:'plain'}})));
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/home-fixture.html');
 await expect(page.locator('.home-background iframe')).toHaveCount(1);
 await expect(page.locator('.home-background[data-arriving]')).toHaveCount(0);
 await page.evaluate(()=>window.setPage('room'));
 await expect(page.locator('.wallpaper-kept iframe')).toHaveCount(1);
 const old=await page.locator('.wallpaper-kept iframe').elementHandle();
 await page.evaluate(()=>window.setPage('home'));
 await expect(page.locator('.home-background iframe')).toHaveCount(1);
 assert.ok(await old.evaluate(node=>node.isConnected),'quick return reuses the scene');
 await page.clock.install();
 await expect(page.locator('.home-background[data-arriving]')).toHaveCount(0);
 await page.evaluate(()=>window.setPage('room'));
 await expect(page.locator('.wallpaper-kept iframe')).toHaveCount(1);
 await page.clock.fastForward(31000);
 await expect(page.locator('.wallpaper-kept iframe')).toHaveCount(1);
 assert.ok(await old.evaluate(node=>node.isConnected),'scene remains warm after 30 seconds');
 await page.evaluate(()=>window.setPage('home'));
 await expect(page.locator('.home-background iframe')).toHaveCount(1);
 const retained=await page.evaluate(async()=>{
  const {warmPageBackground}=await import('/src/renderer/home-background.tsx');
  const originalInvoke=window.hivelab.invoke,create=document.createElement.bind(document),images=[];
  window.hivelab.invoke=async(method,params)=>method==='background.get'&&params.page.startsWith('preload-')?{mode:'media',media:{file:'00000000-0000-0000-0000-00000000000'+params.page.at(-1)+'.png',kind:'image'}}:originalInvoke(method,params);
  document.createElement=function(name,...args){const node=create(name,...args);if(name==='img')images.push(node);return node;};
  try{for(let pass=0;pass<2;pass++)for(let i=0;i<5;i++)await warmPageBackground('preload-'+i);if(images.length!==5)throw Error('returning to a page must reuse its image preload');return images.filter(image=>image.hasAttribute('src')).length;}
  finally{document.createElement=create;window.hivelab.invoke=originalInvoke;}
 });
 assert.equal(retained,5,'visited backgrounds stay decoded for smooth return navigation');
 console.log('PASS: wallpaper survives a 31-second absence; revisiting images reuses preloads without new image elements.');
}finally{await browser.close();await server.close();}


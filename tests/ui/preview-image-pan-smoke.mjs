import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:950}});page.setDefaultTimeout(8000);
 await page.addInitScript(()=>{localStorage.setItem('hivelab.file-preview.width','560');});
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/appearance-notice-fixture.html');await page.evaluate(()=>window.fixtureOpen('large.png'));
 const panel=page.getByRole('complementary',{name:'文件预览侧栏',exact:true}),image=panel.getByRole('img',{name:'large.png',exact:true}),viewport=panel.getByLabel('文件正文',{exact:true}),surface=panel.locator('.panel-image-preview');
 await expect.poll(()=>image.evaluate(n=>n.naturalWidth)).toBe(1600);
 for(let i=0;i<4;i++)await panel.getByRole('button',{name:'放大文件预览',exact:true}).click();
 await expect(panel.getByRole('button',{name:'恢复文件预览为100%',exact:true})).toHaveText('200%');
 await expect.poll(()=>viewport.evaluate(n=>n.scrollWidth>n.clientWidth&&n.scrollHeight>n.clientHeight)).toBe(true);
 const box=await viewport.boundingBox(),start={x:box.x+box.width*.65,y:box.y+box.height*.55};
 await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x-120,start.y-90,{steps:5});
 await expect(surface).toHaveCSS('cursor','grabbing');const dragged=await viewport.evaluate(n=>({left:n.scrollLeft,top:n.scrollTop}));assert.ok(dragged.left>=119&&dragged.top>=89,'left drag pans the image on both axes');
 await page.mouse.up();await expect(surface).toHaveCSS('cursor','grab');await page.mouse.move(start.x-170,start.y-130);assert.deepEqual(await viewport.evaluate(n=>({left:n.scrollLeft,top:n.scrollTop})),dragged,'release stops panning');
 await page.mouse.dblclick(start.x-120,start.y-90);await expect(panel.getByRole('button',{name:'恢复文件预览为100%',exact:true})).toHaveText('100%');
 console.log('PASS: enlarged image follows left-button drag on both axes; release stops movement; double-click zoom still works.');
}finally{await browser.close();await server.close();}

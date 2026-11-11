import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{localStorage.setItem('hivelab.appearance.liquid-glass','true');localStorage.setItem('hivelab.appearance.adaptive-text','false');localStorage.setItem('hivelab.chat-appearance',JSON.stringify({reply:{color:'#183d32',transparency:60},mine:{color:'#314d82',transparency:80},input:{color:'#2a4058',transparency:70}}));});
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/room-preview-fixture.html?sidebar&glass');
 const generated=page.locator('.generated-file-card').first(),sent=page.locator('.attachment-chip.sent').first();await expect(generated).toBeAttached();await expect(sent).toBeAttached();
 const background=node=>node.evaluate(n=>getComputedStyle(n).backgroundColor);
 assert.equal(await background(generated),await background(page.locator('[data-message-id=result] .room-bubble')));
 assert.equal(await background(sent),await background(page.locator('.room-line.mine .room-bubble').first()));
 const alpha=locator=>locator.evaluate(n=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');c.fillStyle=getComputedStyle(n).backgroundColor;c.fillRect(0,0,1,1);return c.getImageData(0,0,1,1).data[3]/255;});
 assert.ok(Math.abs(await alpha(generated)-.4)<.01);assert.ok(Math.abs(await alpha(sent)-.2)<.01);
 const plain=async button=>{await expect(button).not.toHaveAttribute('data-liquid-surface','');assert.deepEqual(await button.evaluate(n=>{const s=getComputedStyle(n);return {background:s.backgroundColor,filter:s.backdropFilter,shadow:s.boxShadow};}),{background:'rgba(0, 0, 0, 0)',filter:'none',shadow:'none'});};
 for(const card of await page.locator('.generated-file-card,.attachment-chip.sent').all()){await expect(card).toHaveAttribute('data-liquid-surface','');for(const button of await card.locator('button').all())await plain(button);}
 await generated.getByRole('button',{name:/^测试说明.md/}).click();
 const panel=page.getByRole('complementary',{name:'文件预览侧栏',exact:true}),tab=panel.locator('.preview-tab.selected');await expect(tab).toHaveAttribute('data-liquid-surface','');
 for(const button of await tab.locator('button').all())await plain(button);
 await expect(panel.getByRole('heading',{name:'内置预览标题',exact:true})).toBeVisible();
 const actions=await panel.locator('.preview-document-actions button:visible,.preview-panel-controls button:visible').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {width:r.width,height:r.height,radius:getComputedStyle(n).borderRadius};}));assert.ok(actions.length>=4);assert.ok(actions.every(n=>n.width===28&&n.height===28&&n.radius==='8px'),JSON.stringify(actions));
 const geometry=await tab.evaluate(n=>{const parent=n.closest('.file-preview-panel'),a=n.getBoundingClientRect(),b=parent.getBoundingClientRect();return {left:a.left-b.left,top:a.top-b.top,inner:parseFloat(getComputedStyle(n).borderRadius),outer:parseFloat(getComputedStyle(parent).borderRadius)};});
 assert.ok(geometry.left>=9&&geometry.top>=9,JSON.stringify(geometry));assert.ok(geometry.inner<=9&&geometry.outer>geometry.inner);assert.ok(Math.abs(geometry.left-(geometry.outer-geometry.inner))<=2,JSON.stringify(geometry));
 for(const width of [500,360]){await page.setViewportSize({width,height:1000});assert.ok(await tab.evaluate(n=>n.getBoundingClientRect().left-n.closest('.file-preview-panel').getBoundingClientRect().left>=9));const sizes=await panel.locator('.preview-document-actions button,.preview-panel-controls button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.width,r.height,getComputedStyle(n).borderRadius];}));assert.ok(sizes.every(([w,h,r])=>w===28&&h===28&&r==='8px'),JSON.stringify(sizes));}
 await page.setViewportSize({width:1440,height:1000});
 await panel.getByRole('tab',{name:'测试说明.md',exact:true}).focus();await expect(panel.getByRole('tab',{name:'测试说明.md',exact:true})).toBeFocused();
 await panel.getByRole('button',{name:'关闭文件 测试说明.md',exact:true}).click();await expect(panel.getByRole('tab')).toHaveCount(0);
 assert.deepEqual(errors,[]);console.log('PASS: downloadable and sent file cards each own one glass surface; preview/download/reveal contents stay transparent; exact reply/mine opacity; file tabs have one glass owner, compact corners, inset spacing and working keyboard/close actions.');
}finally{await browser.close();await server.close();}

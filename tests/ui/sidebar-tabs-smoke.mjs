import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
// Records the bubble on every frame, in fractions of the track, so a jump cannot hide between samples.
const record=(page,ms,reverseAt)=>page.evaluate(([ms,reverseAt])=>new Promise(done=>{
 const track=document.querySelector('.sidebar-workspace-tabs'),bubble=track.querySelector('.sidebar-tab-bubble'),box=track.getBoundingClientRect(),frames=[],start=performance.now();let reversed=false;
 document.querySelector('[aria-label="文件侧栏"]').click();
 const tick=now=>{const r=bubble.getBoundingClientRect();frames.push({t:now-start,left:(r.left-box.left)/box.width,right:(r.right-box.left)/box.width,height:r.height});if(reverseAt&&!reversed&&now-start>reverseAt){reversed=true;document.querySelector('[aria-label="工作台侧栏"]').click();}if(now-start<ms)requestAnimationFrame(tick);else done(frames);};
 requestAnimationFrame(tick);
}),[ms,reverseAt]);
// Records both pages, the rooms and the footer on every frame, in fractions of the page width.
const recordPages=(page,ms,click,reverseAt)=>page.evaluate(([ms,click,reverseAt])=>new Promise(done=>{
 const work=document.querySelector('.sidebar-work-pane'),file=document.querySelector('.sidebar-file-pane'),rooms=document.querySelector('.place-list'),footer=document.querySelector('.sidebar-footer'),home=document.querySelector('.sidebar-scroll').getBoundingClientRect(),frames=[],start=performance.now();let reversed=false;
 document.querySelector(`[aria-label="${click}"]`).click();
 const tick=now=>{const a=work.getBoundingClientRect(),b=file.getBoundingClientRect(),f=footer.getBoundingClientRect();frames.push({t:now-start,work:(a.left-home.left)/home.width,file:(b.left-home.left)/home.width,gap:b.left-a.right,rooms:rooms.getBoundingClientRect().left-a.left,footerX:f.x,footerY:f.y,workOpacity:+getComputedStyle(work).opacity,fileOpacity:+getComputedStyle(file).opacity});if(reverseAt&&!reversed&&now-start>reverseAt){reversed=true;document.querySelector('[aria-label="工作台侧栏"]').click();}if(now-start<ms)requestAnimationFrame(tick);else done(frames);};
 requestAnimationFrame(tick);
}),[ms,click,reverseAt]);
const biggestStep=(frames,edge)=>Math.max(...frames.slice(1).map((f,i)=>Math.abs(f[edge]-frames[i][edge])));
async function open(reducedMotion){
 const page=await browser.newPage({viewport:{width:1500,height:950},reducedMotion}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('hivelab.appearance.adaptive-text','false');localStorage.setItem('hivelab.appearance.liquid-glass','true');});await page.goto(server.resolvedUrls.local[0]+'tests/ui/theme-roster-fixture.html');await expect(page.locator('.team-roster .roster-row')).toHaveCount(3);return {page,errors};
}
try{
 const {page,errors}=await open('no-preference');
 const work=page.getByRole('button',{name:'工作台侧栏',exact:true}),files=page.getByRole('button',{name:'文件侧栏',exact:true}),track=page.locator('.sidebar-workspace-tabs'),bubble=page.locator('.sidebar-tab-bubble');
 const share=async()=>{const t=await track.boundingBox(),w=await work.boundingBox(),f=await files.boundingBox();assert.ok(Math.abs(w.y-f.y)<1,'两个按钮必须共用一行');return {work:(w.width+6)/t.width,files:f.width/t.width};};
 // The chosen side takes about 3/4 of one shared row, and only it shows a label.
 const resting=await share();assert.ok(Math.abs(resting.work-.75)<.03,JSON.stringify(resting));await expect(work.locator('span')).toHaveCSS('opacity','1');await expect(files.locator('span')).toHaveCSS('opacity','0');
 const there=await record(page,900);await expect(files).toHaveAttribute('aria-pressed','true');await expect.poll(async()=>(await share()).files).toBeGreaterThan(.7);await expect(files.locator('span')).toHaveCSS('opacity','1');
 const end=there.at(-1),inside=(await track.boundingBox()).width;assert.ok(Math.abs(end.right-(1-3/inside))<.01&&Math.abs(end.left-(.25+1.5/inside))<.02,JSON.stringify(end));
 // A bubble: the leading edge pulls ahead, the body stretches and thins, and nothing teleports or leaves the track.
 const widest=Math.max(...there.map(f=>f.right-f.left)),thinnest=Math.min(...there.map(f=>f.height));assert.ok(widest>.8,'移动时气泡要被拉长：'+widest);assert.ok(thinnest<there[0].height-1,'拉长时气泡要变薄');
 assert.ok(biggestStep(there,'left')<.07&&biggestStep(there,'right')<.07,'气泡不能瞬移');assert.ok(there.every(f=>f.left>=-.001&&f.right<=1.001),'气泡不能跑出轨道');
 assert.ok(there.filter(f=>Math.abs(f.left-end.left)>.004).length>12,'动画不能瞬间完成');
 // A second click mid-way takes over from the current shape and speed instead of restarting.
 await work.click();await expect(work).toHaveAttribute('aria-pressed','true');await page.waitForTimeout(800);
 const reversed=await record(page,900,140);assert.ok(biggestStep(reversed,'left')<.07&&biggestStep(reversed,'right')<.07,'中途反向不能跳');await expect(work).toHaveAttribute('aria-pressed','true');assert.ok(Math.abs(reversed.at(-1).left-1.5/inside)<.02,JSON.stringify(reversed.at(-1)));
 // Adaptive text narrows transitions in its groups, and it is on in the real app: the track must still move, not jump.
 await page.evaluate(()=>{document.documentElement.dataset.adaptiveText='true';document.querySelector('.sidebar-workspace-tabs').dataset.adaptiveGroup='tabs';});
 await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 const icon=await page.evaluate(()=>new Promise(done=>{const svg=document.querySelector('[aria-label="文件侧栏"] svg'),frames=[],start=performance.now();document.querySelector('[aria-label="文件侧栏"]').click();const tick=now=>{frames.push({at:now,x:svg.getBoundingClientRect().x});if(now-start<500)requestAnimationFrame(tick);else done(frames);};requestAnimationFrame(tick);}));
 // A dropped frame makes a long step too, so only steps that took one frame count: a jump always does.
 const travel=Math.abs(icon.at(-1).x-icon[0].x),jump=Math.max(...icon.slice(1).map((frame,i)=>frame.at-icon[i].at<26?Math.abs(frame.x-icon[i].x):0)),places=new Set(icon.map(frame=>Math.round(frame.x))).size;assert.ok(travel>40&&jump<travel*.4&&places>6,'图标要连续移动，不能一帧到位：'+JSON.stringify({travel,jump,places}));
 await work.click();await expect(work).toHaveAttribute('aria-pressed','true');await page.evaluate(()=>{delete document.documentElement.dataset.adaptiveText;delete document.querySelector('.sidebar-workspace-tabs').dataset.adaptiveGroup;});await page.waitForTimeout(600);
 // The pages turn sideways as one sheet, the way the bubble moves: nothing jumps, and the footer stays put.
 const workPage=page.locator('.sidebar-work-pane'),filePage=page.locator('.sidebar-file-pane');await expect(workPage).toBeVisible();await expect(filePage).toBeHidden();assert.equal(await filePage.getAttribute('inert'),'');
 const turned=await recordPages(page,800,'文件侧栏');const turnEnd=turned.at(-1);
 assert.ok(Math.abs(turnEnd.file)<.001&&turnEnd.work<-1,'翻到文件页后要停在原位：'+JSON.stringify(turnEnd));assert.ok(turned.every(f=>f.file>=-.001&&f.file<=1.2),'页面不能冲过头');
 assert.ok(turned.filter(f=>Math.abs(f.file)>.004).length>12,'翻页不能瞬间完成');assert.ok(biggestStep(turned,'file')<.2,'翻页不能跳变：'+biggestStep(turned,'file'));
 assert.ok(turned.every(f=>Math.abs(f.gap-turned[0].gap)<1),'两页要作为一个整体移动');assert.ok(turned.every(f=>Math.abs(f.rooms-turned[0].rooms)<1),'茶歇室要跟着工作台页走');
 assert.equal(new Set(turned.map(f=>f.footerX+','+f.footerY)).size,1,'底栏不能动');
 await expect(workPage).toBeHidden();await expect(filePage).toBeVisible();assert.equal(await workPage.getAttribute('inert'),'');assert.equal(await filePage.getAttribute('inert'),null);
 // A second click mid-way turns back from where the page is.
 const turnedBack=await recordPages(page,900,'工作台侧栏');assert.ok(Math.abs(turnedBack.at(-1).work)<.001);await expect(workPage).toBeVisible();
 const flipped=await recordPages(page,900,'文件侧栏',140);assert.ok(biggestStep(flipped,'work')<.2,'中途反向不能跳：'+biggestStep(flipped,'work'));assert.ok(Math.abs(flipped.at(-1).work)<.001);await expect(work).toHaveAttribute('aria-pressed','true');await expect(filePage).toBeHidden();
 // 茶歇室 and 圆桌 are compact single-line rows.
 assert.equal(await page.locator('.place-list>.room-entry small').count(),0);for(const box of await page.locator('.place-list>.room-entry,.sidebar-settings').evaluateAll(n=>n.map(e=>e.getBoundingClientRect().height)))assert.equal(box,36);
 // Collapsed, only the current page shows; its one button opens the sidebar again.
 await files.click();await expect(files).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'收起侧栏',exact:true}).click();await expect(page.locator('.app-shell')).toHaveClass(/sidebar-icons/);await expect(work).toBeHidden();await expect(files).toBeVisible();await expect(files.locator('span')).toBeHidden();await expect(bubble).toBeVisible();
 await files.click();await expect(page.locator('.app-shell')).toHaveClass(/sidebar-expanded/);await work.click();
 await page.getByRole('button',{name:'收起侧栏',exact:true}).click();await expect(files).toBeHidden();await expect(work).toBeVisible();await page.getByRole('button',{name:'展开侧栏',exact:true}).click();
 assert.deepEqual(errors,[]);await page.close();
 const calm=await open('reduce');const calmFrames=await record(calm.page,240);assert.ok(new Set(calmFrames.map(f=>f.left.toFixed(3))).size<=2,'减少动效时气泡直接到位：'+JSON.stringify(calmFrames.slice(0,6)));await calm.page.waitForTimeout(300);const calmPages=await recordPages(calm.page,320,'工作台侧栏');assert.ok(calmPages.every(f=>Math.abs(f.work)<.001),'简化档不做位移：'+JSON.stringify(calmPages.slice(0,4)));assert.ok(calmPages.every(f=>Math.abs(f.file)<.001),'简化档两页都留在原位');assert.ok(calmPages[0].workOpacity<.9&&calmPages.at(-1).workOpacity===1&&calmPages.at(-1).fileOpacity===0,'简化档翻页靠交叉淡化：'+JSON.stringify(calmPages.map(f=>f.workOpacity).slice(0,6)));assert.ok(calmPages.some(f=>f.fileOpacity>.1&&f.fileOpacity<.9),'旧页不能瞬间消失：'+JSON.stringify(calmPages.map(f=>f.fileOpacity).slice(0,8)));assert.deepEqual(calm.errors,[]);await calm.page.close();
 console.log('PASS: workbench and files share one track at 3/4 and 1/4; the bubble stretches, thins, stays inside and takes over mid-way; pages turn sideways as one sheet and turn back from where they are; compact rooms; collapsed shows only the current page; reduced motion places it directly.');
}finally{await browser.close();await server.close();}

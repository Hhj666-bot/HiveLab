import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
// The hover plate is the only thing lit, and it must span the whole card from any point inside.
const plate=(page,card)=>card.evaluate(node=>{const main=node.querySelector('.action-card-main'),painted=getComputedStyle(main,'::after'),own=getComputedStyle(main).backgroundColor,box=node.getBoundingClientRect();return {own,color:painted.backgroundColor,width:Math.round(parseFloat(painted.width)),card:Math.round(box.width-(node.offsetWidth-node.clientWidth)),height:Math.round(parseFloat(painted.height))};});
const lit=async(page,card,point)=>{await page.mouse.move(point.x,point.y);await page.waitForTimeout(220);const value=await plate(page,card);assert.notEqual(value.color,'rgba(0, 0, 0, 0)');assert.equal(value.own,'rgba(0, 0, 0, 0)','主按钮不能再单独铺一块底色');assert.equal(value.width,value.card,'高亮必须铺满整张卡片');return value;};
// In the sidebar one bubble lights every control instead of a plate, and it has the shape of every control's own plate.
const onControl=async(pointer,card)=>{const box=await card.boundingBox();await expect.poll(async()=>{const at=await pointer.boundingBox();return Math.abs(at.x-box.x)+Math.abs(at.y-box.y)+Math.abs(at.width-box.width)+Math.abs(at.height-box.height);}).toBeLessThan(2);return box;};
async function pointedAt(page,selector,action){
 const card=page.locator(selector).first(),pointer=page.locator('.sidebar-pointer');await card.scrollIntoViewIfNeeded();const box=await card.boundingBox();
 await page.mouse.move(box.x+24,box.y+box.height/2);await expect(pointer).toHaveAttribute('data-shown','true');await onControl(pointer,card);
 assert.equal(await card.evaluate(node=>getComputedStyle(node).borderRadius),await pointer.evaluate(node=>getComputedStyle(node).borderRadius),'按钮底板要和气泡同形');
 if(!action)return {card,box};
 const side=await card.locator(action).first().boundingBox();await page.mouse.move(side.x+side.width/2,side.y+side.height/2);await page.waitForTimeout(120);await onControl(pointer,card);
 return {card,box,side};
}
async function unified(page,selector,action){
 const card=page.locator(selector).first();await card.scrollIntoViewIfNeeded();const box=await card.boundingBox(),side=await card.locator(action).first().boundingBox();assert.ok(box&&side);
 const main=await lit(page,card,{x:box.x+24,y:box.y+box.height/2}),onAction=await lit(page,card,{x:side.x+side.width/2,y:side.y+side.height/2});
 assert.equal(onAction.color,main.color,'移到右侧按钮上，卡片高亮不能变化');
 return {card,box,side};
}
try{
 const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('hivelab.appearance.adaptive-text','false');localStorage.setItem('hivelab.appearance.liquid-glass','true');});await page.goto(server.resolvedUrls.local[0]+'tests/ui/theme-roster-fixture.html');
 await page.evaluate(()=>window.fixtureWorking(true));await expect(page.locator('.roster-member-stop').first()).toBeVisible();
 // A person's row is lit by the pointer's bubble instead of a plate, which melts into the chosen row's own bubble.
 const person=page.locator('.roster-with-desk:not(.selected)').first(),pointer=page.locator('.sidebar-pointer'),seat=await person.boundingBox(),chosen=await page.locator('.roster-with-desk.selected').boundingBox();
 await page.mouse.move(seat.x+24,seat.y+seat.height/2);await expect(pointer).toHaveAttribute('data-shown','true');
 await expect.poll(async()=>{const box=await pointer.boundingBox();return Math.abs(box.y-seat.y)+Math.abs(box.width-seat.width);}).toBeLessThan(2);
 await page.mouse.move(chosen.x+24,chosen.y+chosen.height/2);await expect(pointer).toHaveAttribute('data-shown','false');
 // Rows keep clear of each other, and a working avatar's glow, at the top of its breath, stops short of the next.
 const crowding=await page.evaluate(()=>{const rows=[...document.querySelectorAll('.roster-with-desk')].map(node=>node.getBoundingClientRect()),ring=document.querySelector('.avatar-breath'),scale=1.06,[,spread,blur]=/\d+px \d+px (\d+(?:\.\d+)?)px (\d+(?:\.\d+)?)px/.exec(getComputedStyle(ring).boxShadow).map(Number);return {gaps:rows.slice(1).map((row,i)=>row.top-rows[i].bottom),pitch:rows[1].top-rows[0].top,glow:(ring.offsetWidth+(spread+blur)*2)*scale};});
 assert.ok(crowding.gaps.length&&crowding.gaps.every(gap=>gap>=4),'侧栏底板不能重叠');assert.ok(crowding.pitch<=56,'头像不能排得太散');assert.ok(crowding.glow<=crowding.pitch,'思考光晕不能重叠');
 const project=await pointedAt(page,'.project-tree-row','.row-more');
 for(const control of ['.room-entry','.sidebar-settings','.sidebar-workspace-tabs button[aria-pressed=false]'])await pointedAt(page,control);
 assert.equal(await page.locator('.brand').evaluate(node=>getComputedStyle(node).borderRadius),await page.locator('.sidebar-pointer').evaluate(node=>getComputedStyle(node).borderRadius));
 await page.locator('.sidebar-settings').first().hover();await page.waitForTimeout(220);assert.equal(await page.locator('.sidebar-settings').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)','气泡之外不能再有悬停底色');
 // The strip beside and above the side action belongs to the card, not to a dead zone.
 const opened=await page.evaluate(()=>window.rosterCalls.length);await page.mouse.click(project.box.x+project.box.width-project.box.height/2-4,project.box.y+2);await page.mouse.move(600,600);
 const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.className??'',{x:project.box.x+project.box.width-project.box.height/2-4,y:project.box.y+2});assert.match(hit,/action-card-main/,'卡片边角也要落在主按钮上');
 assert.equal(await page.evaluate(n=>window.rosterCalls.length-n,opened),0);
 await page.hover('.roster-member-stop');await expect.poll(()=>page.locator('.roster-member-stop').first().evaluate(n=>getComputedStyle(n).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
 // Pressing the card moves the card, so the plate and the content cannot drift apart.
 const roster=page.locator('.roster-with-desk:has(.roster-member-stop)').first(),rosterBox=await roster.boundingBox();await page.mouse.move(rosterBox.x+24,rosterBox.y+rosterBox.height/2);await page.mouse.down();await expect.poll(()=>roster.evaluate(n=>n.hasAttribute('data-liquid-pressed'))).toBe(true);assert.equal(await page.locator('.roster-row').first().evaluate(n=>n.hasAttribute('data-liquid-pressed')),false);await page.mouse.up();
 const stop=await page.locator('.roster-member-stop').first().boundingBox();await page.mouse.move(stop.x+stop.width/2,stop.y+stop.height/2);await page.mouse.down();await expect.poll(()=>page.locator('.roster-member-stop').first().evaluate(n=>n.hasAttribute('data-liquid-pressed'))).toBe(true);assert.equal(await roster.evaluate(n=>n.hasAttribute('data-liquid-pressed')),false);await page.mouse.move(600,600);await page.mouse.up();
 await page.keyboard.press('Escape');
 const main=page.locator('.project-tree-row .action-card-main').first();await main.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');await expect(main).toBeFocused();const ring=await main.evaluate(n=>({own:getComputedStyle(n).outlineStyle,plate:getComputedStyle(n,'::after').outlineStyle}));assert.deepEqual(ring,{own:'none',plate:'solid'});

 await page.goto(server.resolvedUrls.local[0]+'tests/ui/room-preview-fixture.html?sidebar&glass');
 await expect(page.locator('.generated-file-card').first()).toBeAttached();
 await unified(page,'.generated-file-card:has(.generated-file-download)','.generated-file-download');
 const sent=await unified(page,'.attachment-chip.sent',':scope>button:not(.attachment-file-preview)');
 const icon=await sent.card.locator('.attachment-icon').boundingBox();assert.match(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.className??'',{x:icon.x+icon.width/2,y:icon.y+icon.height/2}),/action-card-main/,'附件图标也属于卡片主体');

 await page.goto(server.resolvedUrls.local[0]+'tests/ui/glass-controls-fixture.html');
 await expect(page.locator('.member-notice').first()).toBeVisible();
 await unified(page,'.member-notice','.member-notice-dismiss');

 assert.deepEqual(errors,[]);console.log('PASS: cards with side actions stay one object: a full-card hover plate from any point inside, no dead corners, whole-card press and focus ring, nested highlight on the action.');
}finally{await browser.close();await server.close();}

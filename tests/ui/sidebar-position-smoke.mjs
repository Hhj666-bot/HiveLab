import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
// Every element that exists in both sidebar states, measured by the vertical centre of what the eye follows.
const PARTS={
 logo:'.brand-image',tab:'.sidebar-workspace-tabs [aria-pressed=true] svg',labels:'.sidebar-section-label',
 members:'.roster-with-desk .avatar',projects:'.project-tree-row .list-row-main>svg',add:'.project-add>svg',rooms:'.room-entry>svg',status:'.backend-state .status-dot',tools:'.sidebar-settings svg',
};
const centres=page=>page.evaluate(parts=>Object.fromEntries(Object.entries(parts).map(([name,selector])=>[name,[...document.querySelectorAll(selector)].map(n=>{const r=n.getBoundingClientRect();return r.height?+(r.y+r.height/2).toFixed(1):null;})])),PARTS);
try{
 for(const size of [{width:1500,height:950},{width:1100,height:680}]){
  const page=await browser.newPage({viewport:size,reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('hivelab.appearance.adaptive-text','false');localStorage.setItem('hivelab.appearance.liquid-glass','true');});await page.goto(server.resolvedUrls.local[0]+'tests/ui/theme-roster-fixture.html');
  await expect(page.locator('.team-roster .roster-row')).toHaveCount(3);await expect(page.locator('.app-shell')).toHaveClass(/sidebar-expanded/);
  const expanded=await centres(page);
  await page.getByRole('button',{name:'收起侧栏',exact:true}).click();await expect(page.locator('.app-shell')).toHaveClass(/sidebar-icons/);await expect.poll(()=>page.locator('.sidebar').evaluate(n=>n.getBoundingClientRect().width)).toBe(76);
  const collapsed=await centres(page);
  console.log(JSON.stringify({size,expanded,collapsed}));
  for(const name of Object.keys(PARTS)){assert.ok(expanded[name].length,name+' 没有量到元素');assert.deepEqual(collapsed[name].map(y=>Math.round(y)),expanded[name].map(y=>Math.round(y)),name+' 在折叠和展开状态下纵向位置不一致');}
  await page.getByRole('button',{name:'展开侧栏',exact:true}).click();await expect(page.locator('.app-shell')).toHaveClass(/sidebar-expanded/);await expect.poll(()=>centres(page)).toEqual(expanded);
  // Turning to the files page keeps the divider and the footer exactly where they were.
  const divider=async()=>page.evaluate(()=>{const footer=document.querySelector('.sidebar-footer').getBoundingClientRect().y,line=document.querySelector('.sidebar-file-pane.current')?document.querySelector('.sidebar-file-pane').getBoundingClientRect().bottom:null;return {footer,line};});
  const before=await divider();await page.getByRole('button',{name:'文件侧栏',exact:true}).click();await expect(page.locator('.sidebar-file-pane')).toHaveClass(/current/);const after=await divider();assert.equal(after.footer,before.footer,'翻页后底栏不能动');assert.ok(Math.abs(after.footer-after.line-8)<1,JSON.stringify(after));
  await page.getByRole('button',{name:'工作台侧栏',exact:true}).click();await expect.poll(()=>centres(page)).toEqual(expanded);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: every sidebar element keeps its vertical position between the expanded and collapsed states.');
}finally{await browser.close();await server.close();}

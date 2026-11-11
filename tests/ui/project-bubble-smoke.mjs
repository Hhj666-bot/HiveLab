import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 for(const reducedMotion of ['no-preference','reduce']){
 const page=await browser.newPage({viewport:{width:1500,height:950},reducedMotion});await page.addInitScript(()=>localStorage.setItem('hivelab.appearance.adaptive-text','false'));await page.goto(server.resolvedUrls.local[0]+'tests/ui/theme-roster-fixture.html');
 await page.getByRole('button',{name:'公共项目',exact:true}).click();await page.waitForTimeout(450);
 await expect(page.getByRole('button',{name:'添加项目',exact:true})).toHaveText('');
 for(const scenario of ['fold-during-selection','unfold','reverse']){
 const frames=await page.evaluate(scenario=>new Promise(done=>{
 const frames=[],start=performance.now(),toggle=document.querySelector('.sidebar-edge-toggle');let reversed=false;
 if(scenario==='fold-during-selection')document.querySelector('[data-project-id="two"] .list-row-main').click();
 const box=selector=>{const node=document.querySelector(selector),r=node.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
 const trigger=()=>toggle.click();if(scenario==='fold-during-selection')setTimeout(trigger,40);else trigger();
 const tick=()=>{const t=performance.now()-start;if(scenario==='reverse'&&!reversed&&t>130){reversed=true;trigger();}
 const bubble=document.querySelector('.project-list>.roster-bubble');frames.push({t,moving:'sidebarMoving' in document.documentElement.dataset,bubble:box('.project-list>.roster-bubble'),add:box('.project-add'),plus:box('.project-add>svg'),scale:new DOMMatrixReadOnly(getComputedStyle(bubble).transform).d});
 if(t<1100)requestAnimationFrame(tick);else done(frames);};requestAnimationFrame(tick);
 }),scenario);
 const moving=frames.filter(f=>f.moving);assert.ok(moving.length>4,scenario);
 for(const f of moving){assert.ok(Math.abs(f.bubble.w-f.add.w)<1,scenario+' widths diverged: '+JSON.stringify(f));assert.ok(Math.abs(f.scale-1)<.01,'selection stretch must not overlap sidebar morph');}
 for(const f of frames){assert.ok(Math.abs(f.add.x+f.add.w/2-f.plus.x-f.plus.w/2)<1,'plus stays horizontally centered');assert.ok(Math.abs(f.add.y+f.add.h/2-f.plus.y-f.plus.h/2)<1,'plus stays vertically centered');}
 const last=frames.at(-1);assert.equal(last.moving,false);if(scenario==='fold-during-selection'){assert.ok(Math.abs(last.bubble.w-last.bubble.h)<1);assert.ok(Math.abs(last.add.w-last.add.h)<1);}
 }
 await page.close();
 }
 console.log('PASS: project selection and add plate morph together, including selection interrupted by folding and mid-flight reversal; plus centered without text; full/reduced motion.');
}finally{await browser.close();await server.close();}

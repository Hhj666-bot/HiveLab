import assert from 'node:assert/strict';
import {unfoldSettings} from '../helpers/settings-menu.mjs';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('hivelab.appearance.adaptive-text','false');});
 const url=server.resolvedUrls.local[0]+'tests/ui/appearance-notice-fixture.html';await page.goto(url);
 const bubble=page.locator('.room-bubble').first();await expect(bubble).toHaveAttribute('data-liquid-surface','');
 const navigation=[page.locator('.sidebar'),page.locator('.workspace-toolbar-glass')];
 for(const surface of navigation)await expect(surface).toHaveAttribute('data-liquid-surface','');
 const alpha=locator=>locator.evaluate(node=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');c.fillStyle=getComputedStyle(node).backgroundColor;c.fillRect(0,0,1,1);return c.getImageData(0,0,1,1).data[3]/255;});
 assert.ok(Math.abs(await alpha(bubble)-.3)<.01);assert.equal(await alpha(page.locator('.sidebar')),1);
 const filter=await bubble.evaluate(n=>getComputedStyle(n).backdropFilter);assert.match(filter,/blur\(1\.25px\)/);assert.match(filter,/contrast\(1\.2\)/);assert.match(filter,/brightness\(0\.95\)/);assert.match(filter,/saturate\(0\.95\)/);
 const filterId=await bubble.evaluate(n=>n.style.getPropertyValue('--liquid-refraction'));
 await page.getByRole('button',{name:'外观',exact:true}).click();await unfoldSettings(page);
 const dialog=page.getByRole('dialog',{name:'外观设置',exact:true}),material=dialog.getByRole('region',{name:'界面材质',exact:true});
 await expect(dialog.getByRole('heading',{name:'自适应文本',exact:true})).toBeVisible();
 const advanced=material.locator('.appearance-advanced');
 async function expandMaterial(){if(!await advanced.evaluate(node=>node.open))await advanced.locator('summary').click();}
 await expandMaterial();
 await expect(advanced.getByRole('slider')).toHaveCount(7);await expect(dialog.getByRole('note',{name:'动画提醒',exact:true})).toHaveCount(0);
 for(const label of ['控件透明度','消息与输入框透明度','玻璃侧栏透明度'])await expect(material.getByRole('slider',{name:label,exact:true})).toHaveCount(0);
 async function set(label,value){await dialog.getByRole('slider',{name:label,exact:true}).evaluate((node,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,String(value));node.dispatchEvent(new Event('input',{bubbles:true}));},value);}
 await dialog.getByLabel('回复气泡与思考栏背景颜色',{exact:true}).fill('#496e8c');
 await set('回复气泡与思考栏透明度',35);await expect.poll(()=>alpha(bubble)).toBeGreaterThan(.64);await expect.poll(()=>alpha(bubble)).toBeLessThan(.66);
 await set('左侧栏透明度',60);assert.ok(Math.abs(await alpha(page.locator('.sidebar'))-.4)<.01);
 assert.ok(Math.abs(await alpha(page.locator('.workspace-toolbar-glass'))-.05)<.01);
 await set('玻璃背景模糊',4.5);await expect.poll(()=>bubble.evaluate(n=>getComputedStyle(n).backdropFilter)).toContain('blur(4.5px)');assert.equal(await bubble.evaluate(n=>n.style.getPropertyValue('--liquid-refraction')),filterId,'material sliders must not recreate every SVG filter');
 for(const surface of [...navigation,page.locator('.chat-preview-reply'),page.locator('.chat-preview-mine'),page.locator('.chat-preview-input')]){await expect(surface).toHaveAttribute('data-liquid-surface','');assert.match(await surface.evaluate(n=>getComputedStyle(n).backdropFilter),/blur\(4\.5px\)/);}
 const map=()=>bubble.evaluate(n=>{const id=n.style.getPropertyValue('--liquid-refraction').match(/#([^\"]+)/)[1];return document.getElementById(id).querySelector('feImage').getAttribute('href');});
 const oldMap=await map();await set('玻璃折射圈厚度',2);assert.notEqual(await map(),oldMap);
 await set('玻璃折射强度',0);assert.equal(await bubble.evaluate(n=>{const id=n.style.getPropertyValue('--liquid-refraction').match(/#([^\"]+)/)[1];return document.getElementById(id).querySelector('feDisplacementMap').getAttribute('scale');}),'0');
 for(const surface of navigation)assert.equal(await surface.evaluate(n=>{const id=n.style.getPropertyValue('--liquid-refraction').match(/#([^\"]+)/)[1];return document.getElementById(id).querySelector('feDisplacementMap').getAttribute('scale');}),'0');
 await page.reload();await expect.poll(()=>bubble.evaluate(n=>getComputedStyle(n).backdropFilter)).toContain('blur(4.5px)');assert.ok(Math.abs(await alpha(bubble)-.65)<.01);
 await page.getByRole('button',{name:'外观',exact:true}).click();await unfoldSettings(page);await expandMaterial();await material.getByRole('button',{name:'恢复默认玻璃参数',exact:true}).click();await expect(material.getByRole('slider',{name:'玻璃背景模糊',exact:true})).toHaveValue('1.25');assert.ok(Math.abs(await alpha(bubble)-.65)<.01);
 await dialog.getByRole('button',{name:'关闭对话框',exact:true}).click();
 const control=page.getByRole('button',{name:'终端',exact:true}),box=await control.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await expect(control).toHaveAttribute('data-liquid-pressed','');assert.notEqual(await control.evaluate(n=>n.style.transform),'');
 await page.mouse.up();await expect.poll(()=>control.evaluate(n=>n.style.transform)).toBe('');
 await page.getByRole('button',{name:'外观',exact:true}).click();await unfoldSettings(page);await expandMaterial();await set('玻璃按压动效',0);await expect(dialog.getByText('玻璃光效强度')).toHaveCount(0);await dialog.getByRole('button',{name:'关闭对话框',exact:true}).click();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();assert.equal(await control.evaluate(n=>n.style.transform),'');await page.mouse.up();
 const cdp=await page.context().newCDPSession(page);
 for(const feature of ['prefers-reduced-transparency','prefers-contrast']){
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:feature,value:feature==='prefers-contrast'?'more':'reduce'}]});await expect(page.locator('[data-liquid-surface]')).toHaveCount(0);assert.equal(await bubble.evaluate(n=>getComputedStyle(n).backdropFilter),'none');assert.equal(await alpha(bubble),1);
 }
 await cdp.send('Emulation.setEmulatedMedia',{features:[]});await expect(bubble).toHaveAttribute('data-liquid-surface','');
 await page.getByRole('button',{name:'外观',exact:true}).click();await unfoldSettings(page);await expandMaterial();await material.getByRole('checkbox',{name:'液态玻璃',exact:true}).uncheck();await expect(page.locator('[data-liquid-surface]')).toHaveCount(0);await expect(material.getByRole('slider',{name:'玻璃背景模糊',exact:true})).toBeDisabled();assert.equal(await bubble.evaluate(n=>n.style.getPropertyValue('--liquid-refraction')),'');assert.ok(Math.abs(await alpha(bubble)-.65)<.01);
 await material.getByRole('checkbox',{name:'液态玻璃',exact:true}).check();await material.getByRole('button',{name:'恢复默认玻璃参数',exact:true}).click();
 for(const width of [1440,650]){await page.setViewportSize({width,height:1000});const fits=await material.evaluate(n=>n.scrollWidth<=n.clientWidth+1);assert.ok(fits,'glass controls fit '+width+'px');}
 await page.setViewportSize({width:1440,height:1000});await mkdir('tests/ui/results',{recursive:true});await page.screenshot({path:'tests/ui/results/liquid-glass-appearance.png'});
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await expect(dialog.getByRole('note',{name:'动画提醒',exact:true})).toContainText('动画效果');await dialog.getByRole('button',{name:'关闭对话框',exact:true}).click();await control.click();assert.equal(await control.evaluate(n=>n.style.transform),'');
 const optedOut=await browser.newPage();await optedOut.addInitScript(()=>{localStorage.setItem('hivelab.appearance.liquid-glass','false');localStorage.setItem('hivelab.appearance.liquid-glass.settings','invalid json');});await optedOut.goto(url);await expect(optedOut.locator('.room-bubble').first()).toBeVisible();await expect(optedOut.locator('[data-liquid-surface]')).toHaveCount(0);
 const adaptive=await browser.newPage({viewport:{width:1200,height:850}});adaptive.on('pageerror',error=>errors.push(error.message));
 await adaptive.exposeFunction('fixtureContrastFrame',async()=>({dataUrl:'data:image/png;base64,'+(await adaptive.screenshot()).toString('base64')}));
 await adaptive.addInitScript(()=>{localStorage.setItem('hivelab.appearance.adaptive-text','true');});await adaptive.goto(url);
 await adaptive.evaluate(()=>{const first=document.querySelector('.roster-with-desk'),second=first.cloneNode(true);first.style.background='#fafafa';second.style.background='#151515';second.querySelector('strong').textContent='Astra';first.after(second);});
 const rows=adaptive.locator('.roster-with-desk'),roster=adaptive.locator('.team-roster');await expect(roster).toHaveAttribute('data-adaptive-group','people');assert.equal(await rows.locator('[data-adaptive-group=people]').count(),0);assert.equal((await rows.locator('strong').evaluateAll(nodes=>new Set(nodes.map(n=>getComputedStyle(n).color)).size)),1);
 await adaptive.evaluate(()=>window.fixturePhase('working'));assert.equal(await rows.first().locator('.avatar-breath').evaluate(n=>getComputedStyle(n).animationDuration),'2.6s');assert.equal(await rows.first().evaluate(n=>getComputedStyle(n,'::after').content),'none');
 await adaptive.getByRole('button',{name:'外观',exact:true}).click();await unfoldSettings(adaptive);const adaptiveDialog=adaptive.getByRole('dialog',{name:'外观设置',exact:true});await adaptiveDialog.getByRole('checkbox',{name:'自适应文本对比色',exact:true}).uncheck();
 await expect.poll(()=>adaptive.locator('.room-bubble').first().evaluate(n=>getComputedStyle(n).color)).toBe('rgb(255, 255, 255)');
 await adaptiveDialog.getByRole('radio',{name:'白天',exact:true}).click();await expect.poll(()=>adaptive.locator('.room-bubble').first().evaluate(n=>getComputedStyle(n).color)).toBe('rgb(29, 29, 31)');
 await adaptiveDialog.getByRole('checkbox',{name:'自适应文本对比色',exact:true}).check();await adaptiveDialog.getByRole('button',{name:'关闭对话框',exact:true}).click();await expect(roster).toHaveAttribute('data-adaptive-group','people');assert.equal((await rows.locator('strong').evaluateAll(nodes=>new Set(nodes.map(n=>getComputedStyle(n).color)).size)),1);
 await adaptive.screenshot({path:'tests/ui/results/glass-adaptive-readability.png'});await adaptive.close();

 const home=await browser.newPage({viewport:{width:1400,height:850}});home.on('pageerror',error=>errors.push(error.message));
 await home.exposeFunction('fixtureContrastFrame',async()=>({dataUrl:'data:image/png;base64,'+(await home.screenshot()).toString('base64')}));
 await home.addInitScript(()=>{localStorage.setItem('hivelab.appearance.adaptive-text','true');localStorage.setItem('hivelab.appearance.adaptive-text.dwell-seconds','0');localStorage.setItem('hivelab.appearance.adaptive-text.hold-seconds','0');document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent=':root .file-preview-workspace>.preview-workspace-bar{background:linear-gradient(90deg,#080808 0 60%,#fafafa 60%)!important}.workspace-icon-actions{background:#fafafa!important;padding:8px}.home-action,.workspace-icon-actions button,.workspace-icon-actions summary{background:transparent!important;box-shadow:none!important;backdrop-filter:none!important}.workspace-toolbar-glass{display:none}';document.head.append(style);});});
 await home.goto(server.resolvedUrls.local[0]+'tests/ui/home-fixture.html?toolbar');
 await expect(home.locator('.home-toolbar-greeting')).toHaveAttribute('data-adaptive-group','toolbar-leading');
 await expect(home.locator('.home-toolbar-greeting')).toHaveAttribute('data-adaptive-tone','light');
 await expect(home.locator('.workspace-icon-actions')).toHaveAttribute('data-adaptive-tone','dark');
 await expect.poll(()=>home.locator('.home-toolbar-greeting').evaluate(n=>getComputedStyle(n).color)).toBe('rgb(248, 250, 252)');
 await home.screenshot({path:'tests/ui/results/home-independent-contrast.png'});await home.close();
 assert.deepEqual(errors,[]);
 console.log('PASS: shared material controls on navigation, bubbles and previews; exact opacity and selected tint; persistence/reset; native button feedback; accessibility; theme ink preference; unified roster text; continuous breathing thinking indicator; independent home leading/actions contrast; narrow settings layout.');
}finally{await browser.close();await server.close();}

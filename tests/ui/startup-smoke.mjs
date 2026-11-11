import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
await import('../../scripts/build-startup.mjs');
const html=(await readFile('index.html','utf8')).replace('/src/renderer/main.tsx','/tests/ui/startup-fixture.tsx');
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1340,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(server.resolvedUrls.local[0],route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto(server.resolvedUrls.local[0]);
  const splash=page.getByRole('dialog',{name:'HiveLab 启动动画'}),video=page.locator('.startup-film'),pixels=page.locator('.startup-logo'),root=page.locator('#root');
  const painted=()=>pixels.evaluate(canvas=>{const data=canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2-canvas.height*.06,1,1).data;return data[3];});
  await expect(splash).toBeVisible();await expect(splash).toHaveAttribute('data-mode','tunnel');
  await expect(pixels).toBeVisible();assert.equal(await painted(),255,'the first frame already shows the button');
  assert.equal(await video.getAttribute('src'),null,'the built-in opening needs no video');
  assert.equal(await root.evaluate(node=>node.inert),true);
  await expect(root).toHaveClass(/startup-stage/);
  await page.waitForTimeout(900);
  await expect(splash).not.toHaveClass(/startup-revealing/,{timeout:100}).catch(()=>{throw Error('an unready app with no stored scene must not reveal anything');});
  await expect(splash).toHaveAttribute('data-waiting','true',{timeout:3000}).catch(()=>{});
  await page.keyboard.press('Escape');await expect(splash).toHaveAttribute('data-mode','loading');
  assert.equal(await root.evaluate(node=>node.inert),true,'skip must not reveal an unready application');
  await page.evaluate(()=>window.hivelabStartup.ready());await expect(splash).toBeHidden();
  assert.equal(await root.evaluate(node=>node.inert),false);

  await page.reload();await expect(splash).toHaveAttribute('data-mode','tunnel');
  await page.evaluate(()=>window.hivelabStartup.ready());
  await expect(splash).toHaveClass(/startup-revealing/,{timeout:4000});
  await expect(splash).toHaveAttribute('data-renderer',/^(webgl|canvas)$/);
  await expect(splash).toBeHidden({timeout:5000});
  await expect(root).toHaveClass(/startup-entering/,{timeout:3000});
  await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:4000});

  // A stored scene needs no backend: the wave runs and the frame holds until the app is ready.
  const scene=await page.evaluate(()=>new Promise(resolve=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=40;const context=canvas.getContext('2d');context.fillStyle='#3366cc';context.fillRect(0,0,64,40);resolve(canvas.toDataURL('image/webp'));}));
  await page.evaluate(url=>localStorage.setItem('hivelab.startup-scene',JSON.stringify({key:'test',rooms:{morning:url,afternoon:url,evening:url,night:url},dim:.1,blur:0,fit:'cover'})),scene);
  await page.reload();await expect(splash).toHaveClass(/startup-revealing/,{timeout:4000});
  await expect(page.locator('.startup-scene')).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(splash).toBeVisible();await page.keyboard.press('Escape');await expect(splash).toBeVisible();
  assert.equal(await root.evaluate(node=>node.inert),true,'the wallpaper frame holds until the app can take over');
  await page.evaluate(()=>window.hivelabStartup.ready());await expect(splash).toBeHidden({timeout:5000});
  await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:5000});
  await page.evaluate(()=>localStorage.removeItem('hivelab.startup-scene'));

  await page.getByRole('button',{name:'预览启动动画'}).click();await expect(splash).toBeVisible();await expect(splash).toHaveAttribute('data-mode','tunnel');
  await page.keyboard.press('Escape');await expect(splash).toBeHidden();
  await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:5000});
  assert.equal(await page.getByRole('checkbox',{name:'播放动画声音'}).count(),0,'the silent built-in opening offers no sound settings');
  // The film is gone: no style choice, and no playback or sound settings without a custom video.
  assert.equal(await page.getByRole('combobox',{name:'启动动画样式'}).count(),0);assert.equal(await page.getByRole('combobox',{name:'启动动画播放方式'}).count(),0);
  await page.getByRole('checkbox',{name:'启动时播放动画'}).uncheck();
  await page.reload();await expect(splash).toHaveAttribute('data-mode','loading');
  await page.evaluate(()=>window.hivelabStartup.ready());await expect(splash).toBeHidden();
  await expect(root).toHaveClass(/startup-entering/,{timeout:3000});
  await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:4000});
  await expect(page.getByRole('checkbox',{name:'启动时播放动画'})).not.toBeChecked();
  await page.getByRole('checkbox',{name:'启动时播放动画'}).check();
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await expect(splash).toHaveAttribute('data-mode','tunnel');
  await page.evaluate(()=>window.hivelabStartup.ready());await page.keyboard.press('Escape');await expect(splash).toBeHidden({timeout:5000});
  await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:5000});
  await page.getByRole('checkbox',{name:'跟随系统减少动态效果'}).check();await page.reload();
  await expect(splash).toHaveAttribute('data-mode','loading');assert.equal(await root.evaluate(node=>node.classList.contains('startup-stage')),false,'reduced motion keeps the interface in place');
  await page.evaluate(()=>window.hivelabStartup.ready());await expect(splash).toBeHidden();
  await page.getByRole('button',{name:'预览启动动画'}).click();await expect(splash).toHaveAttribute('data-mode','tunnel');
  await page.keyboard.press('Escape');await expect(splash).toBeHidden();
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>localStorage.setItem('hivelab.startup-animation','bad json'));await page.reload();
  await expect(splash).toHaveAttribute('data-mode','tunnel');
  await mkdir('tests/ui/results',{recursive:true});await page.screenshot({path:path.resolve('tests/ui/results/startup-animation.png')});
  await page.evaluate(()=>window.hivelabStartup.fail());await expect(splash).toBeHidden({timeout:5000});
  assert.equal(await root.evaluate(node=>node.classList.contains('startup-stage')),false,'a failed start shows its error immediately');
  assert.deepEqual(errors,[]);
  console.log('PASS: first frame; no reveal before ready; safe Escape; live reveal; stored scene before the backend; preview; loading path entrance; reduced motion; bad preferences; backend failure.');
}finally{await browser.close();await server.close();}

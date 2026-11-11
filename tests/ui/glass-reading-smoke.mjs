import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const markdown=await readFile(new URL('../fixtures/glass-reading.md',import.meta.url),'utf8');
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.exposeFunction('fixtureContrastFrame',async()=>({dataUrl:'data:image/png;base64,'+(await page.screenshot()).toString('base64')}));
 await page.addInitScript(text=>{window.previewMarkdown=text;localStorage.setItem('hivelab.appearance.adaptive-text','true');document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.theme='dark';},{once:true});},markdown);
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/room-preview-fixture.html?sidebar&glass');await page.locator('.generated-file').filter({hasText:'测试说明.md'}).click();
 const panel=page.getByRole('complementary',{name:'文件预览侧栏',exact:true});await expect(panel.getByRole('heading',{name:'图片输出链路：现状、加速方案与验证记录',exact:true})).toBeVisible();
 const code=panel.locator('.preview-markdown .md-code').first(),quote=panel.locator('blockquote').first(),table=panel.locator('.preview-markdown table').first();
 async function alpha(locator){return locator.evaluate(n=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');c.fillStyle=getComputedStyle(n).backgroundColor;c.fillRect(0,0,1,1);return c.getImageData(0,0,1,1).data[3]/255;});}
 for(const surface of [code,quote,table]){await expect(surface).toHaveAttribute('data-liquid-surface','');assert.ok(Math.abs(await alpha(surface)-.6)<.01,'reading details use preview opacity');assert.match(await surface.evaluate(n=>getComputedStyle(n).backdropFilter),/blur\(1\.25px\)/);}
 await expect(code).toHaveAttribute('data-adaptive-group','code');assert.equal(await alpha(code.locator('.syntax-code')),0);assert.equal(await alpha(code.locator('.md-code-bar')),0);assert.equal(await alpha(table.locator('th').first()),0);assert.equal(await code.locator('.syntax-code').evaluate(n=>getComputedStyle(n).color),await code.evaluate(n=>getComputedStyle(n).color));
 await page.evaluate(()=>window.fixtureMaterial({saturation:2.5,blur:3.5}));for(const surface of [code,quote,table]){const filter=await surface.evaluate(n=>getComputedStyle(n).backdropFilter);assert.match(filter,/saturate\(2\.5\)/);assert.match(filter,/blur\(3\.5px\)/);}
 await panel.getByRole('button',{name:'查看源码',exact:true}).click();const source=panel.locator('.preview-content-code'),numbers=source.locator('.syntax-line-numbers');await expect(source).toHaveAttribute('data-adaptive-group','code');assert.equal(await alpha(source),0);assert.equal(await alpha(source.locator('.syntax-code')),0);assert.ok(Math.abs(await alpha(numbers)-.6)<.01);await expect(numbers).toHaveAttribute('data-liquid-surface','');
 await panel.getByRole('button',{name:'排版预览',exact:true}).click();await page.evaluate(()=>window.fixtureGlass(false));await expect(code).not.toHaveAttribute('data-liquid-surface');assert.equal(await alpha(code.locator('.syntax-code')),1,'opting out preserves the original source theme');
 await page.evaluate(()=>window.fixtureGlass(true));await expect(code).toHaveAttribute('data-liquid-surface','');
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});await expect.poll(()=>alpha(code)).toBe(1);assert.equal(await code.evaluate(n=>getComputedStyle(n).backdropFilter),'none');
 await cdp.send('Emulation.setEmulatedMedia',{features:[]});await mkdir('tests/ui/results',{recursive:true});await page.screenshot({path:'tests/ui/results/generated-markdown-glass.png'});assert.deepEqual(errors,[]);
 console.log('PASS: isolated Markdown fixture; glass fences, quotes and table headers; clear source and code layers; glass line numbers; shared material controls; opt-out and reduced transparency.');
}finally{await browser.close();await server.close();}

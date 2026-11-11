import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';

const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1180,height:850}});
  page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('hivelab.message-skills.test-isolated:desk:test-member:test-topic',JSON.stringify({confirm:true,remember:false})));
  await page.goto(server.resolvedUrls.local[0]+'tests/ui/chat-fixture.html');
  const input=page.getByRole('textbox',{name:'在工位里说话'}),send=page.getByRole('button',{name:'发送到工位'});
  await input.fill('运行中补充一条要求');await send.click();
  await page.getByText('执行端已接收补充，采用情况请核对回复。',{exact:true}).waitFor();assert.equal(await input.inputValue(),'');
  await input.fill('保留这段文字');
  await input.evaluate(element=>{
    const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
    const clipboard=new DataTransfer();clipboard.items.add(new File([bytes],'截图.png',{type:'image/png'}));
    element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
  });
  await page.getByRole('button',{name:'移除附件 截图.png'}).waitFor();assert.equal(await input.inputValue(),'保留这段文字');
  const plainHandled=await input.evaluate(element=>{const clipboard=new DataTransfer();clipboard.setData('text/plain','hello');return element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));});
  assert.equal(plainHandled,true,'plain text paste must not be prevented');
  await page.evaluate(()=>window.setQueued(true));await send.click();
  await page.getByText('已排到下一轮，当前工作继续；本次补充不会中断成员。',{exact:true}).waitFor();
  const sends=await page.evaluate(()=>window.testCalls.filter(call=>call.method==='room.send'));assert.equal(sends.length,2);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>window.testCalls.filter(c=>c.method==='messageSkills.list').length),0);assert.equal(sends[1].params.attachments.length,1);
  assert.deepEqual(errors,[]);
  const folder=path.resolve('tests/ui/results');await mkdir(folder,{recursive:true});await page.screenshot({path:path.join(folder,'chat-input.png')});
  console.log('PASS: active desk send; image paste and preview; text preserved; plain text paste; next-turn feedback; no renderer errors');
}finally{await browser.close();await server.close();}

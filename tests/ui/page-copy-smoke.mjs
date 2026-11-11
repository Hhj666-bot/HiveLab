import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]+'tests/ui/home-fixture.html');
 const result=await page.evaluate(async()=>{
  const {cloneVisiblePage}=await import('/src/renderer/app/page-turn.tsx');
  const source=document.createElement('section');source.style.cssText='position:fixed;inset:0;width:600px;background:white;z-index:1000';
  source.innerHTML='<header>toolbar</header><div class="history" style="height:400px;overflow:auto"><div class="room-message-content" style="padding:10px;display:flex;flex-direction:column"></div></div><footer><textarea>draft</textarea></footer>';
  const content=source.querySelector('.room-message-content');
  for(let i=0;i<1000;i++){const row=document.createElement('article');row.style.cssText='height:80px;flex:none';row.dataset.row=String(i);row.innerHTML='<pre>'+('<span>code </span>'.repeat(40))+'</pre>';content.append(row);}
  document.body.append(source);const list=source.querySelector('.history');list.scrollTop=40000;
  const before=list.scrollHeight,view=list.getBoundingClientRect(),visible=[...content.children].filter(row=>{const b=row.getBoundingClientRect();return b.bottom>view.top&&b.top<view.bottom;}).map(row=>row.dataset.row);
  const start=performance.now(),{copy,from,to}=cloneVisiblePage(source),elapsed=performance.now()-start;
  const scrolls=from.flatMap((node,i)=>node.scrollTop?[{node:to[i],top:node.scrollTop}]:[]);
  document.body.append(copy);for(const {node,top} of scrolls)node.scrollTop=top;
  const after=copy.querySelector('.history').scrollHeight;
  const result={visible,copied:[...copy.querySelectorAll('article')].map(row=>row.dataset.row),before,after,paired:from.every((node,i)=>node.tagName===to[i].tagName&&node.getAttribute('data-row')===to[i].getAttribute('data-row')),elapsed,sourceNodes:source.querySelectorAll('*').length,copyNodes:copy.querySelectorAll('*').length,draft:copy.querySelector('textarea').value};source.remove();copy.remove();return result;
 });
 assert.deepEqual(result.copied,result.visible);assert.equal(result.before,result.after);assert.ok(result.paired);assert.equal(result.draft,'draft');assert.ok(result.copyNodes<result.sourceNodes/50);
 console.log('PASS: long chat transition copies only visible content, preserves scroll extent, node pairing and draft.',JSON.stringify(result));
}finally{await browser.close();await server.close();}

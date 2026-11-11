import {DatabaseSync} from 'node:sqlite';
import {chromium,expect} from '@playwright/test';
import {createServer} from '../../scripts/ui-test-server.mjs';
const db=new DatabaseSync(process.env.HIVELAB_HISTORY_DB,{readOnly:true});
const top=db.prepare("select json_extract(value,'$.threadId') as id,count(*) as count,sum(length(json_extract(value,'$.text'))) as chars from entities where entity='room_messages' group by 1 order by 3 desc limit 1 offset ?").get(Number(process.env.HIVELAB_HISTORY_RANK??0));
const messages=db.prepare("select value from entities where entity='room_messages' and json_extract(value,'$.threadId')=? order by rowid").all(top.id).map(r=>JSON.parse(r.value));db.close();
const room={roomId:'desk:sol',sessionId:'sol-session',currentThreadId:top.id,threads:[{id:top.id,roomId:'desk:sol',title:'历史副本',createdAt:'2026-11-04T00:00:00Z'}],messages,hasMore:false,state:{active:false,mode:'chat'}};
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:950}});await page.addInitScript(({room,adaptive})=>{window.historyRoom=room;localStorage.setItem('hivelab.appearance.adaptive-text',adaptive);},{room,adaptive:process.env.HIVELAB_PROFILE_ADAPTIVE??'true'});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(server.resolvedUrls.local[0]+'tests/ui/history-sidebar-fixture.html');
 await expect(page.locator('.room-line').first()).toBeVisible();await page.waitForTimeout(2000);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 const samples=[];
 for(let i=0;i<4;i++){
 samples.push(await page.evaluate(()=>new Promise(done=>{const start=performance.now(),frames=[],side=document.querySelector('.sidebar'),initial=side.getBoundingClientRect().width;document.querySelector('.sidebar-edge-toggle').click();const click=performance.now()-start;const tick=()=>{const t=performance.now()-start,width=side.getBoundingClientRect().width;frames.push({t,width});if(t<1500)requestAnimationFrame(tick);else done({click,firstMovement:frames.find(f=>Math.abs(f.width-initial)>1)?.t,maxGap:Math.max(...frames.map((f,i)=>i?f.t-frames[i-1].t:f.t)),frames:frames.length});};requestAnimationFrame(tick);})));await page.waitForTimeout(300);await expect(page.locator('[data-motion-resting]')).toHaveCount(0);await expect(page.locator('html')).not.toHaveAttribute('data-sidebar-moving','');
 }
 const {profile}=await cdp.send('Profiler.stop'),counts=new Map();for(const id of profile.samples??[])counts.set(id,(counts.get(id)??0)+1);
 const parents=new Map();for(const n of profile.nodes)for(const child of n.children??[])parents.set(child,n);const stack=id=>{const names=[];let n=parents.get(id);while(n&&names.length<5){names.push(n.callFrame.functionName);n=parents.get(n.id);}return names;};
 console.log(JSON.stringify({history:{messages:top.count,chars:top.chars},dom:await page.locator('*').count(),samples,hot:process.env.HIVELAB_PROFILE_STACKS?profile.nodes.map(n=>({name:n.callFrame.functionName,stack:stack(n.id),file:n.callFrame.url.split('/').at(-1),n:counts.get(n.id)??0})).sort((a,b)=>b.n-a.n).slice(0,20):undefined},null,2));
}finally{await browser.close();await server.close();}

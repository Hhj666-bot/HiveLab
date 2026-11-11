// Settings → Language in the real Electron app: switch to English and back, check the main pages,
// the cross-fade frames, persistence across a process restart, and that no model is called.
// Build first (node scripts/build.mjs), then: node tests/language-electron-smoke.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {_electron,expect} from '@playwright/test';
import {unfoldSettings} from './helpers/settings-menu.mjs';
import {isolatedTestEnvironment,cleanupTestEnvironment} from '../scripts/test-environment.mjs';

const {directory,env}=isolatedTestEnvironment(process.env,process.cwd());delete env.ELECTRON_RUN_AS_NODE;
const db=new DatabaseSync(path.join(env.HIVELAB_DATA_DIR,'hivelab.sqlite'));
db.exec('CREATE TABLE entities(entity TEXT,id TEXT,value TEXT,PRIMARY KEY(entity,id))');
const put=(entity,id,value)=>db.prepare('INSERT INTO entities VALUES(?,?,?)').run(entity,id,JSON.stringify(value));
put('members','test-member',{id:'test-member',name:'测试成员',executor:'codex',color:'#7b6fd6',motto:'成员自己的介绍'});
for(const [id,author,text] of [['m1','user','这是我的消息'],['m2','test-member','这是一条回复。']])put('room_messages',id,{id,author,text,threadId:'room-main',at:new Date().toISOString(),status:'done'});
db.close();
const executablePath=process.env.HIVELAB_TEST_EXECUTABLE??path.resolve('node_modules/electron/dist/electron.exe');
const args=process.env.HIVELAB_TEST_APP?[path.resolve(process.env.HIVELAB_TEST_APP)]:process.env.HIVELAB_TEST_EXECUTABLE?[]:[path.resolve('.')];
const shots=process.env.HIVELAB_TEST_SHOTS??path.resolve('tests/ui/results');mkdirSync(path.join(shots,'language-turn'),{recursive:true});
let app;const errors=[];
async function launch(){app=await _electron.launch({executablePath,args,env,timeout:30000});const page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await expect.poll(()=>page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.backendReady).catch(()=>false)),{timeout:25000}).toBe(true);return page;}
/** Visible text in the window that is still Chinese, apart from what the user or a member wrote. */
async function chineseLeft(page){
 return page.evaluate(()=>{
  // The seeded member's name (and its initial on a standee) is the user's own data; the Language
  // tab is labelled in both languages on purpose so it can be found from either side.
  const own=/测试成员|^测$|这是我的消息|这是一条回复|成员自己的介绍|HiveLab 合屋|中文|简体中文|Language · 语言/;const left=new Set();
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   const text=node.nodeValue.trim(),parent=node.parentElement;
   if(!text||!/[㐀-鿿]/.test(text)||!parent||parent.closest('[lang="zh-CN"],.markdown,.room-bubble,.member-name,[class*="avatar"]'))continue;
   const box=parent.getBoundingClientRect(),style=getComputedStyle(parent);
   if(!box.width||!box.height||style.visibility==='hidden'||style.display==='none')continue;
   if(!own.test(text))left.add(text.slice(0,60));
  }
  for(const element of document.querySelectorAll('[title],[aria-label],[placeholder]'))for(const name of ['title','aria-label','placeholder']){const value=element.getAttribute(name);if(value&&/[㐀-鿿]/.test(value)&&!own.test(value)&&element.getBoundingClientRect().width)left.add(name+': '+value.slice(0,60));}
  return [...left];
 });
}
async function openLanguage(page,settingsName,tabName){await page.getByRole('button',{name:settingsName,exact:true}).first().click();await unfoldSettings(page);await page.getByRole('button',{name:tabName,exact:true}).click();}
try{
 let page=await launch();
 const lounge=()=>page.getByRole('button',{name:'茶歇室',exact:true});
 await expect(lounge()).toBeVisible();
 assert.equal(await page.evaluate(()=>document.documentElement.lang),'zh-CN');
 assert.equal(await page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.settings.language)),'zh-CN','existing users stay in Chinese');

 await openLanguage(page,'设置','语言 · Language');
 await expect(page.getByRole('radio',{name:/中文/})).toHaveAttribute('aria-checked','true');
 await page.screenshot({path:path.join(shots,'language-settings-zh.png'),animations:'disabled'});

 // Record the switch as the compositor paints it, to check the cross-fade has middle frames.
 const cdp=await page.context().newCDPSession(page),frames=[];
 cdp.on('Page.screencastFrame',async frame=>{frames.push({data:frame.data,at:frame.metadata.timestamp});await cdp.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});});
 await cdp.send('Page.startScreencast',{format:'png',everyNthFrame:1});
 await page.waitForTimeout(250);
 const timing=page.evaluate(()=>new Promise(resolve=>{
  const seen=[];const started=performance.now();
  const sample=()=>{for(const animation of document.getAnimations())if(String(animation.effect?.pseudoElement??'').includes('view-transition'))seen.push({pseudo:animation.effect.pseudoElement,name:animation.animationName,duration:animation.effect.getTiming().duration,marked:document.documentElement.hasAttribute('data-language-turn')});
   if(performance.now()-started<600)requestAnimationFrame(sample);else resolve({seen,motion:document.documentElement.dataset.motion});};
  requestAnimationFrame(sample);
 }));
 await page.getByRole('radio',{name:/English/}).click();
 const turn=await timing;
 await page.waitForTimeout(400);
 await cdp.send('Page.stopScreencast');
 frames.forEach((frame,index)=>writeFileSync(path.join(shots,'language-turn',`frame-${String(index).padStart(2,'0')}.png`),Buffer.from(frame.data,'base64')));
 if(turn.motion!=='off'){
  const durations=[...new Set(turn.seen.map(entry=>entry.duration))];
  assert.ok(turn.seen.length,'the switch runs inside a view transition');
  assert.ok(durations.every(duration=>duration>=120&&duration<=180),`cross-fade durations stay within 120–180ms: ${JSON.stringify(turn.seen.slice(0,8))}`);
  const distinct=new Set(frames.map(frame=>frame.data)).size;
  assert.ok(distinct>=3,`start, middle and end frames differ (${distinct} distinct of ${frames.length})`);
 }

 await expect(page.getByRole('radio',{name:/English/})).toHaveAttribute('aria-checked','true');
 await expect(page.getByRole('heading',{name:'Interface language'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Language · 语言',exact:true})).toBeVisible();
 assert.equal(await page.evaluate(()=>document.documentElement.lang),'en');
 assert.equal(await page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.settings.language)),'en');
 await page.screenshot({path:path.join(shots,'language-settings-en.png'),animations:'disabled'});
 const leftSettings=await chineseLeft(page);
 await page.getByRole('button',{name:'Done',exact:true}).click();

 await expect(page.getByRole('button',{name:'Lounge',exact:true})).toBeVisible();
 const leftHome=await chineseLeft(page);await page.screenshot({path:path.join(shots,'language-home-en.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Lounge',exact:true}).click();
 await expect(page.getByRole('textbox').first()).toHaveAttribute('placeholder',/Say something|Write/);
 const leftLounge=await chineseLeft(page);await page.screenshot({path:path.join(shots,'language-lounge-en.png'),animations:'disabled'});
 await page.getByRole('button',{name:'测试成员 · Open desk',exact:true}).click();
 await expect(page.getByRole('main',{name:'Personal desk'})).toBeVisible();
 const leftDesk=await chineseLeft(page);await page.screenshot({path:path.join(shots,'language-desk-en.png'),animations:'disabled'});
 const left={settings:leftSettings,home:leftHome,lounge:leftLounge,desk:leftDesk};
 writeFileSync(path.join(shots,'language-untranslated.json'),JSON.stringify(left,null,1));
 assert.deepEqual(left,{settings:[],home:[],lounge:[],desk:[]},'no interface text is left in Chinese on the main pages');

 // A fresh process starts in English straight away, before and after the snapshot arrives.
 await app.close();app=undefined;page=await launch();
 await expect(page.getByRole('button',{name:'Lounge',exact:true})).toBeVisible();
 assert.equal(await page.evaluate(()=>document.documentElement.lang),'en');

 await openLanguage(page,'Settings','Language · 语言');
 await page.getByRole('radio',{name:/中文/}).click();
 await expect(page.getByRole('button',{name:'语言 · Language',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await expect(lounge()).toBeVisible();
 assert.equal(await page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.settings.language)),'zh-CN');
 assert.equal(await page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.runs.length)),0,'switching languages calls no model');
 assert.deepEqual(errors,[]);
 console.log(`PASS: actual Electron; Settings → Language switches to English and back; settings, home, lounge and desk fully in English; cross-fade ${turn.motion==='off'?'skipped (motion off)':'recorded in '+frames.length+' frames'}; language kept across a process restart; no model calls.`);
}finally{if(app)await app.close();cleanupTestEnvironment(directory,process.cwd());}

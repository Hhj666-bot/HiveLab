import assert from 'node:assert/strict';
import {unfoldSettings} from './helpers/settings-menu.mjs';
import path from 'node:path';
import {copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {_electron,expect} from '@playwright/test';
import {enterWorkspace,openConnection} from './helpers/desktop-ready.mjs';
import {DEFAULT_SETTINGS,ACP_DEFAULT_PERMISSIONS} from '../src/shared/defaults.ts';
import {DEFAULT_BACKGROUND} from '../src/shared/background.ts';
if(!process.env.HIVELAB_TEST_PROFILE)throw Error('Requires isolated desktop data');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const data=env.HIVELAB_DATA_DIR;mkdirSync(data,{recursive:true});
const db=new DatabaseSync(path.join(data,'hivelab.sqlite'));db.exec('CREATE TABLE IF NOT EXISTS entities(entity TEXT,id TEXT,value TEXT,PRIMARY KEY(entity,id))');
const put=(kind,id,value)=>db.prepare('INSERT OR REPLACE INTO entities VALUES(?,?,?)').run(kind,id,JSON.stringify(value));
const executor={id:'acp-deskuitest',name:'工位测试连接',catalogId:'kimi',authentication:'kimi-api-cn',command:path.resolve('tests/fixtures/kimi-api-model-acp.mjs'),args:[],env:{KIMI_MODEL_PROVIDER_TYPE:'kimi',KIMI_MODEL_BASE_URL:'https://api.moonshot.cn/v1'},permissions:ACP_DEFAULT_PERMISSIONS,createdAt:new Date().toISOString()};
put('executors',executor.id,executor);put('settings','main',{...DEFAULT_SETTINGS,networkMode:'proxy',proxyUrl:'http://127.0.0.1:1'});
for(const [id,name] of [['m-deskone','测试甲'],['m-desktwo','测试乙']])put('members',id,{id,name,executor:executor.id,motto:'元气满满的测试伙伴',color:id==='m-deskone'?'#668877':'#aa4433'});db.close();
// Pages may disagree on this switch, and walking between them must not change how the background renders.
mkdirSync(path.join(data,'backgrounds'),{recursive:true});writeFileSync(path.join(data,'backgrounds','preferences.json'),JSON.stringify({version:2,pages:{home:{...DEFAULT_BACKGROUND,respectReducedMotion:false},'desk:m-deskone':DEFAULT_BACKGROUND}}));
const executablePath=env.HIVELAB_ELECTRON_EXE??path.resolve('node_modules/electron/dist/electron.exe'),args=env.HIVELAB_SMOKE_APP_ROOT?[]:[path.resolve('.')];
let app;const errors=[];
async function launch(){app=await _electron.launch({executablePath,args,env,timeout:45000});await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].isFocused=()=>true;});const page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));await expect.poll(()=>page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.backendReady).catch(()=>false)),{timeout:30000}).toBe(true);await enterWorkspace(page);return page;}
const room=(page,id)=>page.evaluate(roomId=>window.hivelab.invoke('room.get',{roomId}),id);
const snapshot=page=>page.evaluate(()=>window.hivelab.invoke('snapshot'));
async function send(page,text,roomId){const before=(await snapshot(page)).runs.length;if(roomId)await page.evaluate(({roomId,text})=>window.hivelab.invoke('room.send',{roomId,text}),{roomId,text});else{await page.locator('.page-turn-live .room-input textarea').fill(text);await page.getByRole('button',{name:'发送到工位',exact:true}).click();}await expect.poll(async()=>{const state=await snapshot(page);return state.runs.length>before&&state.runs.every(run=>!!run.completedAt);},{timeout:18000}).toBe(true);}
try{
 let page=await launch();
 const portrait=page.getByRole('button',{name:'与 测试甲 聊天',exact:true});await expect(portrait).toBeVisible();await portrait.click({button:'right'});
 const card=page.getByRole('dialog',{name:'测试甲 的人物卡片',exact:true});await expect(card).toBeVisible();await expect(card).toContainText('元气满满的测试伙伴');await portrait.click();await expect(card).toHaveCount(0);await expect(page.getByRole('heading',{name:'测试甲 的工位',exact:true})).toBeVisible();
 const settings=page.getByRole('dialog',{name:'设置与成员连接',exact:true});
 // Both cards share one connection: editing must follow the member identity.
 await page.getByRole('button',{name:'回到团队主页',exact:true}).click();await portrait.click({button:'right'});
 await card.getByRole('button',{name:'编辑 测试甲 的人物卡',exact:true}).click();await expect(card).toHaveCount(0);
 await expect(settings.getByRole('heading',{name:'测试甲 的人物卡',exact:true})).toBeVisible();await expect(settings.getByLabel('名字',{exact:true})).toHaveValue('测试甲');
 await settings.getByLabel('一句话介绍',{exact:true}).fill('从主页编辑并保存');await settings.getByRole('button',{name:'保存人物卡',exact:true}).click();
 await expect.poll(async()=>(await snapshot(page)).members.find(member=>member.id==='m-deskone')?.motto).toBe('从主页编辑并保存');await settings.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'设置',exact:true}).click();await unfoldSettings(page);await page.getByRole('button',{name:'连接与版本',exact:true}).click();
 const section=await openConnection(page,'工位测试连接');await expect(section.getByRole('button',{name:'设置',exact:true})).toHaveCount(0);
 await section.locator('details.acp-editor > summary').click();await expect(section.getByLabel('程序名称',{exact:true})).toBeVisible();await section.locator('details.acp-editor > summary').click();
 await section.getByLabel('Kimi Code CLI API Key',{exact:true}).fill('mock-desk-only-key');await section.getByRole('button',{name:'保存密钥并检查',exact:true}).click();await expect(section.getByRole('button',{name:'保存密钥并检查',exact:true})).toBeEnabled();
 await page.getByRole('dialog',{name:'设置与成员连接',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'测试乙 · 进入工位',exact:true}).click({button:'right'});
 const secondCard=page.getByRole('dialog',{name:'测试乙 的人物卡片',exact:true});await expect(secondCard.getByRole('button',{name:'去 测试乙 的工位聊天',exact:true})).toBeEnabled();
 if(env.HIVELAB_CARD_EDIT_CAPTURE)await page.screenshot({path:env.HIVELAB_CARD_EDIT_CAPTURE,fullPage:true,animations:'disabled'});
 await secondCard.getByRole('button',{name:'编辑 测试乙 的人物卡',exact:true}).click();await expect(secondCard).toHaveCount(0);
 await expect(settings.getByRole('heading',{name:'测试乙 的人物卡',exact:true})).toBeVisible();await expect(settings.getByLabel('名字',{exact:true})).toHaveValue('测试乙');
 await settings.getByLabel('名字',{exact:true}).fill('取消的修改');await settings.getByRole('button',{name:'取消',exact:true}).click();await settings.getByRole('button',{name:'取消',exact:true}).click();
 assert.equal((await snapshot(page)).members.find(member=>member.id==='m-desktwo').name,'测试乙');assert.equal((await snapshot(page)).runs.length,0);
 const created=[];
 for(const [id,name,text] of [['m-deskone','测试甲','帮我整理接口说明'],['m-desktwo','测试乙','看看这个项目结构']]){
  await page.getByRole('button',{name:name+' · 进入工位',exact:true}).click();await expect(page.getByRole('heading',{name:name+' 的工位',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'开新话题',exact:true}).click();await expect(page.getByRole('dialog',{name:'开新话题',exact:true})).toHaveCount(0);
  const current=await room(page,'desk:'+id);assert.equal(current.threads.find(thread=>thread.id===current.currentThreadId).title,'新话题');created.push({roomId:'desk:'+id,threadId:current.currentThreadId});
  await send(page,text);await expect.poll(async()=>(await room(page,'desk:'+id)).threads.find(thread=>thread.id===current.currentThreadId)?.title).toBe(text);
  // Viewing the matching topic reads its notice automatically.
  await expect(page.getByRole('status',{name:name+' 完成了',exact:true})).toHaveCount(0);
  await page.evaluate(({roomId,threadId})=>window.hivelab.invoke('room.rename',{roomId,threadId,title:'手动保留的标题'}),created.at(-1));
  await send(page,'后续内容不会覆盖手动标题');assert.equal((await room(page,'desk:'+id)).threads.find(thread=>thread.id===current.currentThreadId).title,'手动保留的标题');
 }
 // Two desks with different pictures: the bubble and the page turn together, and the composer stays put.
 const turnTo=(name,back)=>page.evaluate(({name,back})=>new Promise(done=>{
  const frames=[],bubble=document.querySelector('.team-roster>.roster-bubble'),composer=()=>document.querySelector('.page-turn-live .room-composer')?.getBoundingClientRect().top;
  const row=label=>document.querySelector(`[aria-label="${label} · 进入工位"]`),start=performance.now(),before=composer(),colour=getComputedStyle(bubble).backgroundColor;let turned=false;
  row(name).click();
  const tick=now=>{
   if(back&&!turned&&now-start>140){turned=true;row(back).click();}
   frames.push({composer:composer(),bubble:bubble.getBoundingClientRect().top,ghosts:document.querySelectorAll('.page-turn-ghost').length,welcome:!!document.querySelector('.page-turn-live .room-empty'),messages:document.querySelectorAll('.page-turn-live .room-line').length,walls:[...document.querySelectorAll('.home-background')].map(node=>new DOMMatrixReadOnly(getComputedStyle(node).transform).m42)});
   if(now-start<1000)requestAnimationFrame(tick);else done({before,colour,after:getComputedStyle(bubble).backgroundColor,frames,rowTop:row(back??name).closest('[data-roster-id]').getBoundingClientRect().top});
  };requestAnimationFrame(tick);
 }),{name,back});
 const first=await turnTo('测试甲');
 for(const result of [first,await turnTo('测试乙','测试甲')]){
  const {before,frames,rowTop}=result,last=frames.at(-1);
  assert.ok(frames.every(frame=>Math.abs(frame.composer-before)<1),'发送框翻页时不能移动');
  assert.ok(frames.every(frame=>!frame.welcome&&frame.messages>0),'有记录的工位不能先显示欢迎卡片');
  assert.ok(frames.some(frame=>frame.ghosts>0),'翻页时要有旧页');assert.equal(last.ghosts,0,'翻完不能留下旧页');
  assert.ok(new Set(frames.map(frame=>Math.round(frame.bubble))).size>3,'气泡不能瞬间到位');assert.ok(Math.abs(last.bubble-rowTop)<1,'气泡要停在选中的头像上');
  assert.ok(frames.some(frame=>frame.walls.length>1&&frame.walls.every(y=>y!==0)),'壁纸要跟着翻页');assert.equal(last.walls.length,1,'翻完只留一层壁纸');assert.equal(last.walls[0],0);
  if(result===first)assert.notEqual(result.after,result.colour,'气泡要换成成员特征色');
 }
 // Conversation pages reflow continuously with the sidebar and settle without a final width jump.
 const spring=()=>page.evaluate(()=>new Promise(done=>{
  const side=document.querySelector('.app-shell>.sidebar'),turn=document.querySelector('.page-turn'),roster=document.querySelector('.sidebar-roster-scroll'),composer=()=>document.querySelector('.page-turn-live .composer').getBoundingClientRect().left,frames=[];
  // The page tab's icon stays inside its button, and the chosen member's bubble inside the list that holds it.
  const within=(inner,outer)=>{const a=inner.getBoundingClientRect(),b=outer.getBoundingClientRect();return a.left>=b.left-.5&&a.right<=b.right+.5;},shown=()=>{const tab=document.querySelector('.sidebar-workspace-tabs button[aria-pressed=true]');const box=node=>{const r=node.getBoundingClientRect();return [Math.round(r.left),Math.round(r.right)];};return within(tab.querySelector('svg'),tab)&&within(document.querySelector('.team-roster>.roster-bubble'),roster)||{icon:box(tab.querySelector('svg')),tab:box(tab),bubble:box(document.querySelector('.team-roster>.roster-bubble')),list:box(roster)};},start=performance.now(),from=side.getBoundingClientRect().width,fromLayout=turn.clientWidth;
  document.querySelector('.sidebar-edge-toggle').click();
  const tick=now=>{frames.push({at:now-start,moving:document.documentElement.dataset.sidebarMoving!==undefined,side:side.getBoundingClientRect().width,layout:turn.clientWidth,composer:composer(),roster:roster.getBoundingClientRect().bottom,tab:document.querySelector('.sidebar-tab-bubble').getBoundingClientRect().x,chosen:document.querySelector('.team-roster>.roster-bubble').getBoundingClientRect().y,shown:shown()});if(now-start<900)requestAnimationFrame(tick);else done({from,fromLayout,frames,left:document.querySelectorAll('[data-sidebar-fade],[data-sidebar-icon]').length,style:turn.getAttribute('style'),grid:document.querySelector('.app-shell').style.gridTemplateColumns});};requestAnimationFrame(tick);
 }));
 for(const opening of [false,true]){
  const {from,fromLayout,frames,left,style,grid}=await spring(),moving=frames.filter(frame=>frame.moving),last=frames.at(-1),to=last.side;
  assert.ok(moving.length>6,'侧栏不能瞬间收放');assert.ok(moving.at(-1).at<650,'侧栏收放要快');
  assert.ok(new Set(moving.map(frame=>frame.layout)).size>6,'侧栏收放时聊天页面要逐帧调整宽度');
  assert.ok(frames.slice(1).every((frame,index)=>Math.abs(frame.layout-frames[index].layout)<70),'聊天页面宽度要连续变化，不能在动画结束时跳变');
  const occupied=frames.map(frame=>frame.side+frame.layout);assert.ok(Math.max(...occupied)-Math.min(...occupied)<2,'聊天页面宽度要跟随侧栏实际占用的空间');
  assert.ok(opening?last.layout<fromLayout:last.layout>fromLayout,'聊天页面应随侧栏展开变窄、收起变宽');
  assert.ok(!last.moving&&frames.slice(-3).every(frame=>frame.layout===last.layout),'侧栏结束后聊天页面宽度应稳定');assert.equal(grid,'','侧栏结束后不能留下临时网格宽度');
  assert.ok(frames.slice(1).every((frame,index)=>Math.abs(frame.composer-frames[index].composer)<70),'主界面落定时不能跳变');
  assert.ok(frames.slice(1).every((frame,index)=>Math.abs(frame.roster-frames[index].roster)<70),'头像区高度要连续变化，下方头像不能一下出现');
  assert.ok(frames.slice(1).every((frame,index)=>Math.abs(frame.tab-frames[index].tab)<16&&Math.abs(frame.chosen-frames[index].chosen)<16),'气泡不能跳变');
  assert.ok(frames.every(frame=>frame.shown===true),'收放时页签图标和成员气泡不能被裁掉 '+JSON.stringify(frames.filter(frame=>frame.shown!==true).slice(0,3)));
  if(!opening){const round=await page.locator('.team-roster>.roster-bubble').evaluate(node=>{const r=node.getBoundingClientRect();return Math.abs(r.width-r.height);});assert.ok(round<1,'折叠后气泡要回到正圆');}
  assert.notEqual(from,to);assert.equal(left,0,'收放后不能留下过渡状态');assert.ok(!style?.includes('translate'));
 }
 // The pointer's bubble takes a row's shape, stays across the gap between rows and is drawn on to the next.
 const pointer=page.locator('.sidebar-pointer'),rowBox=name=>page.getByRole('button',{name:name+' · 进入工位',exact:true}).locator('xpath=ancestor::*[@data-roster-id]').boundingBox(),chosenOne=await rowBox('测试乙');
 await page.mouse.move(chosenOne.x+chosenOne.width/2,chosenOne.y+chosenOne.height/2);await expect(pointer).toHaveAttribute('data-shown','true');
 await expect.poll(async()=>Math.abs((await pointer.boundingBox()).y-chosenOne.y)).toBeLessThan(1);
 assert.equal(await pointer.evaluate(n=>getComputedStyle(n).borderRadius),await page.locator('.team-roster>.roster-bubble').evaluate(n=>getComputedStyle(n).borderRadius),'悬停气泡要和选中气泡同形');
 const gap=await page.evaluate(()=>{const area=document.querySelector('.sidebar-roster-scroll').getBoundingClientRect(),rows=[...document.querySelectorAll('.team-roster>[data-roster-id]')].map(node=>node.getBoundingClientRect()).sort((a,b)=>a.top-b.top);for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i],y=(a.bottom+b.top)/2;if(b.top>a.bottom&&y>area.top&&y<area.bottom)return {x:b.left+b.width/2,y};}return null;});assert.ok(gap,'悬停测试点应位于真实且可见的行间空隙');
 await page.mouse.move(gap.x,gap.y);await page.waitForTimeout(120);assert.equal(await pointer.getAttribute('data-shown'),'true','行间空隙不能丢失悬停气泡');
 await page.mouse.move(800,300);await expect(pointer).toHaveAttribute('data-shown','false');
 // The preview panel also resizes the conversation continuously and releases its temporary layout at rest.
 const drawer=label=>page.evaluate(label=>new Promise(done=>{
  const turn=document.querySelector('.page-turn'),refraction=()=>{const panel=document.querySelector('.file-preview-panel'),id=/#([^")]+)/.exec(panel?.style.getPropertyValue('--liquid-refraction')??'')?.[1];return id?Number(document.getElementById(id)?.querySelector('feDisplacementMap')?.getAttribute('scale')):undefined;},shape=()=>document.querySelector('.page-turn-live .composer').getBoundingClientRect(),composer=()=>{const r=shape();return r.left+r.width/2;},frames=[],start=performance.now(),fromLayout=turn.clientWidth;
  document.querySelector(`[aria-label="${label}"]`).click();
  const tick=now=>{frames.push({moving:!!document.querySelector('[data-drawer-moving]'),layout:turn.clientWidth,composer:composer(),width:shape().width,height:shape().height,column:document.querySelector('.page-turn-live .room-message-content').getBoundingClientRect().width,refraction:refraction()});if(now-start<1000)requestAnimationFrame(tick);else done({fromLayout,frames,style:turn.getAttribute('style'),conversationStyle:document.querySelector('.preview-conversation').getAttribute('style'),root:document.documentElement.dataset.panelMoving,panels:document.querySelectorAll('.file-preview-panel').length});};requestAnimationFrame(tick);
 }),label);
 for(const [label,panels] of [['打开文件预览',1],['收起文件预览',0]]){
  const result=await drawer(label),moving=result.frames.filter(frame=>frame.moving);
  assert.ok(moving.length>6,'右侧栏不能瞬间收放');assert.ok(new Set(moving.map(frame=>frame.layout)).size>6,'右侧栏收放时聊天页面要逐帧调整宽度');
  assert.ok(result.frames.slice(1).every((frame,index)=>Math.abs(frame.layout-result.frames[index].layout)<140),'右侧栏收放时聊天页面宽度要连续变化');
  const last=result.frames.at(-1);assert.ok(panels?last.layout<result.fromLayout:last.layout>result.fromLayout,'聊天页面应随预览栏打开变窄、关闭变宽');
  assert.ok(!last.moving&&result.frames.slice(-3).every(frame=>frame.layout===last.layout),'预览栏结束后聊天页面宽度应稳定');assert.ok(!/width|flex/.test(result.conversationStyle??''),'预览栏结束后不能留下临时聊天宽度');
  assert.ok(result.frames.slice(1).every((frame,index)=>Math.abs(frame.composer-result.frames[index].composer)<120),'主界面不能跳变');
  assert.ok(result.frames.slice(1).every((frame,index)=>Math.abs(frame.width-result.frames[index].width)<140&&Math.abs(frame.column-result.frames[index].column)<140),'聊天框和消息列的宽度要连续变化');
  // A narrow window may leave the composer two rows at rest; what must not happen is a wrap only on the way.
  if(Math.abs(result.frames[0].height-result.frames.at(-1).height)<1)assert.equal(new Set(result.frames.map(frame=>Math.round(frame.height))).size,1,'聊天框收放时不能换行');
  if(panels&&await page.evaluate(()=>document.documentElement.dataset.liquidGlass==='true')){assert.ok(moving.slice(4).some(frame=>frame.refraction>0),'面板移动时玻璃要有折射，不能到终点才出现');assert.ok(await page.evaluate(()=>{const panel=document.querySelector('.file-preview-panel'),id=/#([^")]+)/.exec(panel.style.getPropertyValue('--liquid-refraction'))?.[1],image=document.getElementById(id).querySelector('feImage');return image.getAttribute('width')===String(panel.offsetWidth)&&image.getAttribute('height')===String(panel.offsetHeight);}),'折射贴图要按玻璃的像素尺寸铺满，否则玻璃下的画面会整体错位');}
  assert.equal(result.panels,panels);assert.ok(!result.style?.includes('translate'),'右侧栏收放后不能留下位移');assert.equal(result.root,undefined);
 }
 await page.getByRole('button',{name:'测试乙 · 进入工位',exact:true}).click();await expect(page.getByRole('heading',{name:'测试乙 的工位',exact:true})).toBeVisible();
 await send(page,'从另一个工位核对完成提醒','desk:m-deskone');
 const completedNotice=page.getByRole('status',{name:'测试甲 完成了',exact:true});await expect(completedNotice).toBeVisible();
 await completedNotice.getByRole('button',{name:'查看对话：测试甲 完成了',exact:true}).click();await expect(page.getByRole('heading',{name:'测试甲 的工位',exact:true})).toBeVisible();await expect(completedNotice).toHaveCount(0);
 const before=(await snapshot(page)).runs.length;await app.close();app=undefined;page=await launch();assert.equal((await snapshot(page)).runs.length,before);
 await expect(page.getByRole('region',{name:'消息提醒',exact:true})).toHaveCount(0);
 for(const item of created)assert.equal((await room(page,item.roomId)).threads.find(thread=>thread.id===item.threadId).title,'手动保留的标题');
 await page.getByRole('button',{name:'测试甲 · 进入工位',exact:true}).click();
 const firstRoom=await room(page,'desk:m-deskone');await page.evaluate(sessionId=>window.hivelab.invoke('session.approvals',{sessionId,autoApprove:false,clearRules:true}),firstRoom.sessionId);
 await page.getByRole('combobox',{name:'成员权限等级',exact:true}).selectOption('request');
 await page.getByRole('button',{name:'测试乙 · 进入工位',exact:true}).click();
 await page.evaluate(()=>window.hivelab.invoke('room.send',{roomId:'desk:m-deskone',text:'__approval_notice__'}));
 const approvalNotice=page.getByRole('alert',{name:'测试甲 在等你回应',exact:true});await expect(approvalNotice).toBeVisible();await expect(approvalNotice).toHaveCount(1);
 if(env.HIVELAB_NOTICE_CAPTURE)await page.screenshot({path:env.HIVELAB_NOTICE_CAPTURE,fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByRole('dialog',{name:'设置与成员连接',exact:true})).toBeVisible();await expect(approvalNotice).toBeAttached();
 await page.getByRole('button',{name:'空闲后保存设置',exact:true}).click({trial:true});await page.getByRole('dialog',{name:'设置与成员连接',exact:true}).getByRole('button',{name:'取消',exact:true}).click();await expect(approvalNotice).toBeVisible();
 await approvalNotice.getByRole('button',{name:'去处理：测试甲 在等你回应',exact:true}).click();await expect(approvalNotice).toHaveCount(0);
 await page.getByRole('button',{name:'拒绝 · 仅本次拒绝',exact:true}).click();await expect.poll(async()=>(await snapshot(page)).runs.every(run=>!!run.completedAt),{timeout:18000}).toBe(true);
 await page.getByRole('button',{name:'测试乙 · 进入工位',exact:true}).click();await send(page,'__error_notice__','desk:m-deskone');const errorNotice=page.getByRole('alert',{name:'测试甲 需要你核对结果',exact:true});await expect(errorNotice).toBeVisible();await errorNotice.getByRole('button',{name:'去处理：测试甲 需要你核对结果',exact:true}).click();await expect(errorNotice).toHaveCount(0);
 await page.getByRole('button',{name:'测试乙 · 进入工位',exact:true}).click();const navigationRuns=(await snapshot(page)).runs.length;
 await app.evaluate(({BrowserWindow,Notification})=>{BrowserWindow.getAllWindows()[0].isFocused=()=>false;globalThis.nativeNoticeRecords=[];globalThis.originalNoticeShow=Notification.prototype.show;Notification.prototype.show=function(){globalThis.nativeNoticeRecords.push(this);};});
 const delivery=await page.evaluate(sessionId=>window.hivelab.invoke('window.notify',{id:'native-offline-notice',kind:'completed',title:'后台提醒测试',body:'mock-desk-only-key 不应显示',target:{sessionId}}),firstRoom.sessionId);assert.equal(delivery.delivery,'desktop');
 const native=await app.evaluate(()=>({count:globalThis.nativeNoticeRecords.length,body:globalThis.nativeNoticeRecords[0].body}));assert.equal(native.count,1);assert.ok(!native.body.includes('mock-desk-only-key'));
 await app.evaluate(()=>globalThis.nativeNoticeRecords[0].emit('click'));await expect(page.getByRole('heading',{name:'测试甲 的工位',exact:true})).toBeVisible();assert.equal((await snapshot(page)).runs.length,navigationRuns);
 await app.evaluate(({Notification,BrowserWindow})=>{Notification.prototype.show=globalThis.originalNoticeShow;BrowserWindow.getAllWindows()[0].isFocused=()=>true;});
 await page.getByRole('button',{name:'回到团队主页',exact:true}).click();await page.getByRole('button',{name:'与 测试甲 聊天',exact:true}).click({button:'right'});await expect(page.getByRole('dialog',{name:'测试甲 的人物卡片',exact:true})).toBeVisible();
 // A desk whose moving wallpaper is still on its way holds its page still until the wallpaper turns in with it; the
 // one left behind waits paused and out of sight, so going back is immediate.
 await page.keyboard.press('Escape');
 const videoFile=path.join(process.env.HIVELAB_TEST_PROFILE,'desk-wallpaper.webm');copyFileSync(path.resolve('tests/fixtures/background.webm'),videoFile);
 await app.evaluate(({dialog},file)=>{globalThis.deskOpenDialog=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},videoFile);
 const deskTwo=await page.getByRole('button',{name:'测试乙 · 进入工位',exact:true}).evaluate(node=>node.closest('[data-roster-id]').dataset.rosterId);
 for(const wallPage of ['home','desk:'+deskTwo])assert.equal((await page.evaluate(wallPage=>window.hivelab.invoke('background.import',{page:wallPage}),wallPage)).media.kind,'video');
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=globalThis.deskOpenDialog;});
 await page.reload();await expect.poll(()=>page.locator('.home-background video').evaluate(node=>node.readyState>=2).catch(()=>false),{timeout:15000}).toBe(true);
 const walk=label=>page.evaluate(label=>new Promise(done=>{
  const frames=[],start=performance.now();document.querySelector(`[aria-label="${label}"]`).click();
  const tick=now=>{frames.push({arriving:!!document.querySelector('.home-background[data-arriving]'),page:new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.page-turn-live')).transform).m42,ghosts:document.querySelectorAll('.page-turn-ghost').length});if(now-start<2500)requestAnimationFrame(tick);else done(frames);};
  requestAnimationFrame(tick);
 }),label);
 const toDesk=await walk('测试乙 · 进入工位'),waiting=toDesk.filter(frame=>frame.arriving);
 assert.ok(waiting.length>0,'工位的视频壁纸要先加载');assert.ok(waiting.every(frame=>Math.abs(frame.page-waiting[0].page)<.5),'壁纸到位前页面不能先翻');
 assert.ok(toDesk.some(frame=>!frame.arriving&&Math.abs(frame.page)>1),'壁纸到位后页面要翻');assert.equal(toDesk.at(-1).ghosts,0);
 const toHome=await walk('回到团队主页');
 assert.ok(toHome.every(frame=>!frame.arriving),'回到主页时留下的壁纸要立即翻入');assert.ok(toHome.some(frame=>Math.abs(frame.page)>1));assert.equal(toHome.at(-1).ghosts,0);
 assert.equal(await page.locator('.home-background video').count(),1);
 assert.deepEqual(await page.locator('.wallpaper-kept video').evaluate(node=>({paused:node.paused,shown:getComputedStyle(node.parentElement).visibility})),{paused:true,shown:'hidden'});
 if(env.HIVELAB_DESK_CAPTURE)await page.screenshot({path:env.HIVELAB_DESK_CAPTURE,fullPage:true,animations:'disabled'});
 assert.deepEqual(errors,[]);console.log('PASS: actual Electron; home right/left click; home/sidebar member-card editing, save and cancellation with a shared connection; direct topics and persistent titles; inline editor; foreground completion/approval/error reminders; no history replay; native background delivery and click navigation; notification redaction; isolated mock members only.');
}finally{await app?.close();}

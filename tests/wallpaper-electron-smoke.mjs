import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {_electron,expect} from '@playwright/test';
import {enterWorkspace} from './helpers/desktop-ready.mjs';

if(!process.env.HIVELAB_TEST_PROFILE)throw Error('Requires an isolated desktop test environment');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
await mkdir(env.HIVELAB_DATA_DIR,{recursive:true});const db=new DatabaseSync(path.join(env.HIVELAB_DATA_DIR,'hivelab.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS entities(entity TEXT,id TEXT,value TEXT,PRIMARY KEY(entity,id))');
for(const [id,name] of [['m-wallpaper-one','壁纸测试甲'],['m-wallpaper-two','壁纸测试乙']])db.prepare('INSERT OR REPLACE INTO entities VALUES(?,?,?)').run('members',id,JSON.stringify({id,name,executor:'codex',color:'#668877'}));db.close();
const electron=await _electron.launch({executablePath:process.env.HIVELAB_ELECTRON_EXE??path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.HIVELAB_SMOKE_APP_ROOT?[]:[path.resolve('.')],env,timeout:45000});
try{
  const page=await electron.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'||message.text().startsWith('Wallpaper renderer:'))console.log('Wallpaper console:',message.text().slice(0,600));});
  await expect.poll(()=>page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.backendReady).catch(()=>false)),{timeout:30000}).toBe(true);
  // Backend readiness can precede the initial loadFile completion. Finish that
  // navigation before testing wallpaper reloads to avoid a startup ERR_ABORTED.
  await page.waitForLoadState('load');
  if(process.platform==='win32')assert.equal(await electron.evaluate(({app})=>app.commandLine.hasSwitch('disable-accelerated-video-decode')),true);
  const select=async file=>electron.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  const root=path.join(process.env.HIVELAB_TEST_PROFILE,'web-wallpaper');await mkdir(root,{recursive:true});
  await writeFile(path.join(root,'project.json'),JSON.stringify({type:'web',file:'index.html',title:'本地网页壁纸'}));
  await writeFile(path.join(root,'index.html'),'<html><body style="margin:0;background:#176789"><canvas id="demo" width="100" height="100"></canvas><script>window.bridgeState={node:typeof process,bridge:typeof window.hivelab};let n=0;function draw(){const c=document.getElementById("demo").getContext("2d");c.fillStyle="rgb("+(++n%255)+",150,80)";c.fillRect(0,0,100,100);requestAnimationFrame(draw)}draw();</script></body></html>');
  const importProject=async(file,method='background.wallpaper')=>{await select(file);const result=await page.evaluate(method=>window.hivelab.invoke(method,{page:'home'}),method);await page.reload();await Promise.race([expect(page.locator('iframe[title="动态壁纸"]')).toHaveAttribute('data-wallpaper-state','ready',{timeout:90000}),expect(page.locator('.workspace-toast.error').filter({hasText:'背景无法播放'})).toBeVisible({timeout:90000}).then(()=>{throw Error('Wallpaper failed to render; see renderer diagnostics');})]);return result;};
  const web=await importProject(path.join(root,'project.json'),'background.import');assert.equal(web.media.kind,'web');
  const outer=page.frames().find(frame=>frame.url().startsWith('hivelab-wallpaper://player/'));assert.ok(outer);assert.deepEqual(await outer.evaluate(()=>({node:typeof process,bridge:typeof window.hivelab})),{node:'undefined',bridge:'undefined'});
  // Permission isolation uses real clipboard APIs in the packaged app session.
  await page.evaluate(()=>navigator.clipboard.writeText('P0-copy-check'));
  assert.equal(await electron.evaluate(({clipboard})=>clipboard.readText()),'P0-copy-check');
  assert.equal(await page.evaluate(async()=>{try{await navigator.clipboard.readText();return true;}catch{return false;}}),false);
  assert.equal(await outer.evaluate(async()=>{try{await navigator.clipboard.writeText('wallpaper-overwrite');return true;}catch{return false;}}),false);
  assert.equal(await outer.evaluate(async()=>{try{await navigator.clipboard.readText();return true;}catch{return false;}}),false);
  await electron.evaluate(({clipboard})=>clipboard.writeText('P0-native-paste'));
  await page.evaluate(()=>{const input=document.createElement('textarea');input.id='p0-native-paste';input.style.cssText='position:fixed;top:10px;left:400px;z-index:99999';document.body.append(input);});
  await page.locator('#p0-native-paste').focus();await page.locator('#p0-native-paste').press('Control+V');await expect(page.locator('#p0-native-paste')).toHaveValue('P0-native-paste');await page.locator('#p0-native-paste').evaluate(n=>n.remove());
  await outer.evaluate(()=>{window.p0Controls=[];addEventListener('message',event=>{if(event.data?.type==='hivelab-wallpaper-control')window.p0Controls.push(event.data.paused);});});
  await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(()=>outer.evaluate(()=>window.p0Controls.at(-1))).toBe(true);
  await page.emulateMedia({reducedMotion:'no-preference'});await expect.poll(()=>outer.evaluate(()=>window.p0Controls.at(-1))).toBe(false);
  console.log('PASS: top-level copy and native paste; main/iframe clipboard read denied; wallpaper clipboard write denied; reduced motion pauses/resumes wallpaper control.');
  await expect.poll(()=>page.frames().some(frame=>frame!==outer&&frame.url().startsWith('blob:')),{timeout:10000}).toBe(true);
  const webFrame=page.frames().find(frame=>frame!==outer&&frame.url().startsWith('blob:'));
  await expect.poll(()=>webFrame.evaluate(()=>window.bridgeState).catch(()=>null)).toEqual({node:'undefined',bridge:'undefined'});
  const blocked=await outer.evaluate(async()=>{try{await fetch('hivelab-background://local/preferences.json');return false;}catch{return true;}});assert.equal(blocked,true);
  console.log('PASS: native JSON picker; web project assets and scripts render; opaque sandbox has no Node/preload access; workbench media blocked.');
  // Generated, owned fixture: no workshop artwork is checked into the repository.
  const sceneRoot=path.join(process.env.HIVELAB_TEST_PROFILE,'scene-wallpaper');await mkdir(sceneRoot);
  await writeFile(path.join(sceneRoot,'project.json'),JSON.stringify({type:'scene',file:'scene.json',title:'场景颜色测试',preview:'preview.png'}));
  await writeFile(path.join(sceneRoot,'preview.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'));
  await writeFile(path.join(sceneRoot,'scene.json'),JSON.stringify({general:{orthogonalprojection:{width:640,height:360},clearcolor:'0.15 0.4 0.6'},objects:[]}));
  const scene=await importProject(path.join(sceneRoot,'project.json'));assert.equal(scene.media.kind,'scene');
  assert.equal(await page.locator('iframe[title="动态壁纸"]').getAttribute('sandbox'),'allow-scripts');
  await page.emulateMedia({reducedMotion:'reduce'});
  const poster=page.frameLocator('iframe[title="动态壁纸"]').locator('[data-wallpaper-poster]');
  await expect(poster).toBeVisible();assert.match(await poster.getAttribute('src'),/^data:image\/png;base64,/);
  const staticSource=await poster.getAttribute('src');await page.waitForTimeout(400);assert.equal(await poster.getAttribute('src'),staticSource);
  await page.emulateMedia({reducedMotion:'no-preference'});await expect(poster).toBeHidden();
  await page.evaluate(()=>window.hivelab.invoke('background.save',{page:'home',paused:true,fit:'contain'}));await page.reload();await expect(page.locator('iframe[title="动态壁纸"]')).toHaveAttribute('data-wallpaper-state','ready',{timeout:30000});
  assert.equal((await page.evaluate(()=>window.hivelab.invoke('background.get',{page:'home'}))).paused,true);
  console.log('PASS: loose scene WebGL first frame; persisted pause and fit; reload; generated local fixture.');
  if(process.env.HIVELAB_WALLPAPER_PROJECT){
    await page.emulateMedia({reducedMotion:'reduce'});
    const actual=await importProject(process.env.HIVELAB_WALLPAPER_PROJECT);assert.equal(actual.media.kind,'scene');
    const actualPoster=page.frameLocator('iframe[title="动态壁纸"]').locator('[data-wallpaper-poster]');await expect(actualPoster).toBeVisible({timeout:15000});
    const folder=path.resolve('tests/ui/results');await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'wallpaper-static-preview.png'),Buffer.from((await actualPoster.getAttribute('src')).split(',')[1],'base64'));
    // The explicit page override must survive restart and override the player's
    // own media query too. Otherwise the introduction stays black indefinitely.
    await page.evaluate(()=>window.hivelab.invoke('background.save',{page:'home',respectReducedMotion:false}));await page.reload();
    await expect(page.locator('iframe[title="动态壁纸"]')).toHaveAttribute('data-wallpaper-state','ready',{timeout:90000});
    await expect(page.frameLocator('iframe[title="动态壁纸"]').locator('[data-wallpaper-poster]')).toBeHidden();
    const canvas=page.frameLocator('iframe[title="动态壁纸"]').locator('canvas');await expect(canvas).toBeVisible();
    // Exclude fit:contain letterboxing, whose light pixels could otherwise pass
    // this check while the central artwork is still the black introduction.
    await expect.poll(()=>canvas.evaluate(c=>{const gl=c.getContext('webgl2'),h=Math.floor(c.height*.6),p=new Uint8Array(c.width*h*4);gl.readPixels(0,Math.floor(c.height*.2),c.width,h,gl.RGBA,gl.UNSIGNED_BYTE,p);let colored=0,total=0;for(let i=0;i<p.length;i+=400){total++;if(p[i]+p[i+1]+p[i+2]>60)colored++;}return colored/total;}),{timeout:30000,intervals:[500,1000]}).toBeGreaterThan(.2);
    const pixels=()=>canvas.evaluate(c=>c.toDataURL('image/png')),digest=bytes=>createHash('sha256').update(bytes).digest('hex'),first=digest(await pixels());
    await expect.poll(async()=>digest(await pixels()),{timeout:10000,intervals:[500,1000]}).not.toBe(first);
    await writeFile(path.join(folder,'wallpaper-scene-actual.png'),Buffer.from((await pixels()).split(',')[1],'base64'));
    await page.evaluate(()=>window.hivelab.invoke('background.save',{page:'home',paused:true}));await page.reload();await expect(page.locator('iframe[title="动态壁纸"]')).toHaveAttribute('data-wallpaper-state','ready',{timeout:90000});
    const frozen=page.frameLocator('iframe[title="动态壁纸"]').locator('[data-wallpaper-poster]');await expect(frozen).toBeVisible();const still=await frozen.getAttribute('src');assert.match(still,/^data:image\/png;base64,/);await page.waitForTimeout(400);assert.equal(await frozen.getAttribute('src'),still);
    console.log('PASS: user scene.pkg renders the artwork beyond its black introduction with OS reduced motion enabled and explicit playback override; static preview and manual pause stable; source untouched; isolated profile only.');
  }
  // Real video playback is distinct from scene/web rendering. A 4K user file can
  // exercise the Windows decoder regression without committing workshop media.
  const videoFile=process.env.HIVELAB_WALLPAPER_VIDEO??path.resolve('tests/fixtures/background.webm');
  await select(videoFile);const videoBackground=await page.evaluate(()=>window.hivelab.invoke('background.import',{page:'home'}));assert.equal(videoBackground.media.kind,'video');
  await page.evaluate(()=>window.hivelab.invoke('background.save',{page:'home',paused:false,respectReducedMotion:false,fit:'cover'}));await page.reload();
  const video=page.locator('.home-background video');await expect(video).toBeVisible({timeout:15000});
  await expect.poll(()=>video.evaluate(v=>!v.paused&&v.readyState>=2).catch(()=>false),{timeout:15000}).toBe(true);
  const startTime=await video.evaluate(v=>v.currentTime);
  if(process.env.HIVELAB_WALLPAPER_VIDEO){
    for(let i=0;i<12;i++){await page.waitForTimeout(1000);assert.equal(await video.evaluate(v=>v.error?.message??null),null);}
    assert.ok(await video.evaluate((v,start)=>v.currentTime>start+8,startTime),'4K wallpaper must keep playing beyond the decoder crash');
  }else await expect.poll(()=>video.evaluate(v=>v.currentTime)).not.toBe(startTime);
  await page.evaluate(()=>window.hivelab.invoke('background.save',{page:'home',paused:true}));await page.reload();
  await expect(video).toHaveAttribute('data-paused','');assert.equal(await video.evaluate(v=>v.paused),true);
  console.log('PASS: video wallpaper plays without decoder failure; explicit playback override and manual pause survive reload.');
  await enterWorkspace(page);
  const members=(await page.evaluate(()=>window.hivelab.invoke('snapshot'))).members,visibleMembers=members.filter(member=>!member.cardHidden);assert.ok(visibleMembers.length>1);
  const hiddenNote=page.locator('.standee-hidden-note');await expect(hiddenNote).toHaveCount(0);
  await page.evaluate(id=>window.hivelab.invoke('team.visibility',{id,hidden:true}),visibleMembers[0].id);await expect(hiddenNote).toHaveCount(0);
  for(const member of visibleMembers.slice(1))await page.evaluate(id=>window.hivelab.invoke('team.visibility',{id,hidden:true}),member.id);
  await expect(hiddenNote).toContainText('所有人物已被隐藏');await expect(page.locator('.standee-chat')).toHaveCount(0);await expect(page.locator('.standee-onboarding')).toHaveCount(0);
  assert.equal(await hiddenNote.evaluate(node=>getComputedStyle(node).position),'absolute','hidden reminder overlays the wallpaper without reserving a footer');
  const noteBox=await hiddenNote.boundingBox(),homeBox=await page.locator('.standee-home').boundingBox();assert.ok(noteBox.y>homeBox.y+homeBox.height*.75,'hidden reminder belongs at the bottom of home');
  await mkdir('tests/ui/results',{recursive:true});await page.screenshot({path:'tests/ui/results/wallpaper-hidden-home.png'});
  await hiddenNote.getByRole('button',{name:'管理人物卡',exact:true}).click();const settings=page.getByRole('dialog',{name:'设置与成员连接',exact:true});await expect(settings).toBeVisible();
  await settings.getByRole('button',{name:'显示 '+visibleMembers[0].name+' 的人物卡',exact:true}).click();await expect(hiddenNote).toHaveCount(0);await settings.getByRole('button',{name:'取消',exact:true}).click();
  console.log('PASS: home all-hidden reminder stays at the bottom; a partially visible team has no reminder; member settings restores a card.');
  assert.deepEqual(errors,[]);assert.equal((await page.evaluate(()=>window.hivelab.invoke('snapshot'))).runs.length,0);
}finally{await electron.close();}

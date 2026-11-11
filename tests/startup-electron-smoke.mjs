import assert from 'node:assert/strict';
import {unfoldSettings} from './helpers/settings-menu.mjs';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {_electron,expect} from '@playwright/test';
if(!process.env.HIVELAB_TEST_PROFILE)throw Error('Requires isolated desktop test environment');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const seed=new DatabaseSync(path.join(env.HIVELAB_DATA_DIR,'hivelab.sqlite'));
seed.exec('CREATE TABLE IF NOT EXISTS entities(entity TEXT,id TEXT,value TEXT,PRIMARY KEY(entity,id))');
seed.prepare('INSERT OR REPLACE INTO entities VALUES(?,?,?)').run('members','startup-member',JSON.stringify({id:'startup-member',name:'启动测试成员',executor:'codex',templateId:'codex',color:'#174c42'}));
seed.prepare('INSERT OR REPLACE INTO entities VALUES(?,?,?)').run('team_migrations','explicit-members-v1',JSON.stringify({done:true}));seed.close();
const electron=await _electron.launch({executablePath:process.env.HIVELAB_ELECTRON_EXE??path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.HIVELAB_SMOKE_APP_ROOT?[]:[path.resolve('.')],env,timeout:45000});
try{
  const page=await electron.firstWindow();
  const shots=path.resolve('tests/ui/results/startup-frames');await mkdir(shots,{recursive:true});
  /** Screenshots run alongside the animation; each name records when it was taken. */
  const burst=async(label,count,stop)=>{const start=Date.now();for(let i=0;i<count&&!(await stop?.());i++)await page.screenshot({path:path.join(shots,`${label}-${String(Date.now()-start).padStart(5,'0')}.png`)}).catch(()=>{});};
  const splash=page.locator('#hivelab-startup'),video=page.locator('.startup-film'),pixels=page.locator('.startup-logo'),root=page.locator('#root');
  const side=page.locator('aside.sidebar'),cast=page.locator('.standee-cast'),bar=page.locator('.preview-workspace-bar');
  await expect(splash).toBeVisible();
  await expect(splash).toHaveAttribute('data-mode','tunnel');
  await expect(pixels).toBeVisible();
  assert.equal(await video.getAttribute('src'),null,'the built-in opening is not a video');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('hivelab-startup')).backgroundColor),'rgb(255, 255, 255)','a light system opens on pure white');
  await expect.poll(()=>electron.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));const [width,height]=w.getContentSize();return w.isVisible()?Math.abs(width/height-1832/1168):1;}),{timeout:10000}).toBeLessThan(.005);
  const geometry=await electron.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));return {fullscreen:w.isFullScreen(),content:w.getContentSize(),bounds:w.getBounds(),display:screen.getDisplayMatching(w.getBounds()),minimum:w.getMinimumSize()};});
  assert.equal(geometry.fullscreen,false);
  assert.equal(await root.evaluate(node=>node.inert),true);
  // The stage lasts 480ms and expect() polls up to a second apart, so watch for it on every frame.
  const stageAlone=()=>page.waitForFunction(()=>document.getElementById('hivelab-startup').hidden&&document.getElementById('root').classList.contains('startup-stage'),null,{polling:'raf',timeout:30000});
  let closed=false;const firstRun=burst('first-run',60,()=>closed);
  await stageAlone();closed=true;
  assert.equal(await root.evaluate(node=>node.inert),false);
  /** A wallpaper stands alone, then each part arrives from its own edge, without fading. */
  const entrance=async label=>{
    await expect(root).toHaveClass(/startup-stage/);
    // The wallpaper is the bottom layer: the whole window, whatever the interface is doing above it.
    const wallpaperBox=()=>page.evaluate(()=>{const r=document.querySelector('.home-background').getBoundingClientRect();return [r.x,r.y,r.width-innerWidth,r.height-innerHeight].map(value=>Math.abs(Math.round(value)));});
    assert.deepEqual(await wallpaperBox(),[0,0,0,0],'the wallpaper fills the window before the interface arrives');
    // Read together, or the stage can end between two parts.
    const alone=await page.evaluate(()=>({staged:document.getElementById('root').classList.contains('startup-stage'),parts:Object.fromEntries([['sidebar','aside.sidebar'],['top bar','.preview-workspace-bar'],['cast','.standee-cast']].map(([name,selector])=>[name,getComputedStyle(document.querySelector(selector)).opacity]))}));
    if(alone.staged)assert.deepEqual(alone.parts,{sidebar:'0','top bar':'0',cast:'0'},'the interface is not shown while the wallpaper stands alone');
    assert.equal(await side.evaluate(node=>getComputedStyle(node).pointerEvents),'none','what cannot be seen cannot be clicked');
    await page.screenshot({path:path.join(shots,label+'-wallpaper-alone.png')});
    await expect(root).not.toHaveClass(/startup-stage/,{timeout:4000});await expect(root).toHaveClass(/startup-entering/);
    // Colours are settled before anything is on screen and hold from here on.
    const tones=()=>page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('[data-adaptive-tone]')].map(node=>[(node.className||node.tagName)+':'+(node.getAttribute('aria-label')??''),node.dataset.adaptiveTone])));
    const toneCheck=await tones();
    assert.ok(Object.keys(toneCheck).some(name=>name.includes('team-roster'))||Object.keys(toneCheck).length>4,'the arriving interface already has its colours: '+JSON.stringify(toneCheck));
    const moving=await page.evaluate(()=>{
      const sidebar=document.querySelector('aside.sidebar'),style=getComputedStyle(sidebar),chain=[];
      for(let node=sidebar;node;node=node.parentElement){const s=getComputedStyle(node);chain.push(s.opacity==='1'&&s.filter==='none'&&s.mixBlendMode==='normal');}
      return {opacity:style.opacity,backdrop:style.backdropFilter,clear:chain.every(Boolean),x:sidebar.getBoundingClientRect().x};
    });
    assert.equal(moving.opacity,'1','the sidebar moves in, it does not fade in');
    assert.ok(moving.clear,'nothing above the sidebar cuts its glass off from the wallpaper');
    assert.notEqual(moving.backdrop,'none','glass keeps sampling the wallpaper while it moves');
    const overlay=await page.evaluate(()=>{const node=document.getElementById('hivelab-startup');return {backdrop:getComputedStyle(node).backdropFilter,surface:'liquidSurface' in node.dataset};});
    assert.deepEqual(overlay,{backdrop:'none',surface:false},'the opening looks straight at the wallpaper, not through a pane of glass that would displace it');
    // Caught mid-flight from inside the page, so the proof of a moving part does not depend on screenshot timing.
    const partial=await page.evaluate(()=>new Promise(resolve=>{const sidebar=document.querySelector('aside.sidebar'),look=()=>{const box=sidebar.getBoundingClientRect();if(box.x<0&&box.right>0)resolve({x:box.x,right:box.right,opacity:getComputedStyle(sidebar).opacity});else requestAnimationFrame(look);};look();}));
    assert.equal(partial.opacity,'1','the sidebar slides in, it does not fade in');
    assert.deepEqual(await wallpaperBox(),[0,0,0,0],'a moving sidebar leaves the wallpaper alone');
    await expect(root).not.toHaveClass(/startup-entering/,{timeout:8000});
    await expect(root).not.toHaveClass(/startup-stage/);
    assert.ok((await side.boundingBox()).x>=0);assert.ok((await bar.boundingBox()).y>=0);
    const arrived=await tones();
    for(const [name,tone] of Object.entries(toneCheck))if(name in arrived)assert.equal(arrived[name],tone,'colour changed during the entrance: '+name);
  };
  await entrance('first-run');await firstRun;
  // Opening folded: expanding lasts for this run, the next launch folds it again and keeps the width.
  const shell=page.locator('.app-shell');
  await expect(shell).toHaveClass(/sidebar-icons/);
  await page.getByRole('button',{name:'展开侧栏',exact:true}).click();await expect(shell).toHaveClass(/sidebar-expanded/);
  await page.locator('.sidebar-resizer').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('hivelab.sidebar.layout')).width)).toBe(288);
  await page.reload();await expect(shell).toHaveClass(/sidebar-icons/);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('hivelab.sidebar.layout'))),{mode:'icons',width:288});
  await page.keyboard.press('Escape');await expect(splash).toBeHidden({timeout:15000});await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:6000});
  await page.screenshot({path:path.join(shots,'first-run-final.png')});
  // Liquid glass is a material: turning it off changes how the interface looks, never where it sits.
  const layout=()=>page.evaluate(()=>Object.fromEntries(['aside.sidebar','.preview-workspace-bar','.standee-cast','.standee-home-footer','.home-background'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [selector,[r.x,r.y,r.width,r.height].map(Math.round).join()];})));
  const withGlass=await layout();
  await page.evaluate(()=>localStorage.setItem('hivelab.appearance.liquid-glass','false'));await page.reload();await expect(splash).toBeVisible();
  await page.keyboard.press('Escape');await expect(splash).toBeHidden({timeout:15000});await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:8000});
  assert.deepEqual(await layout(),withGlass);
  await page.evaluate(()=>localStorage.setItem('hivelab.appearance.liquid-glass','true'));await page.reload();await expect(splash).toBeVisible();
  await page.keyboard.press('Escape');await expect(splash).toBeHidden({timeout:15000});await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:8000});
  await expect(side).toBeVisible();
  const density=page.getByRole('slider',{name:'人物疏密',exact:true});
  await expect(density).toHaveValue('0.75');
  await density.fill('0.95');
  await page.reload();await expect(splash).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(splash).toBeHidden({timeout:15000});
  await expect(density).toHaveValue('0.95');
  await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:8000});
  await page.getByRole('button',{name:'自动',exact:true}).click();
  await expect(density).toHaveValue('0.75');
  // While the sidebar springs, the standees walk to their new places and keep their shape, and landing moves none of them.
  for(const name of ['展开侧栏','收起侧栏']){
   const frames=await page.evaluate(label=>new Promise(done=>{
    const figures=[...document.querySelectorAll('.standee')],frames=[],start=performance.now();
    document.querySelector(`[aria-label="${label}"]`).click();
    const tick=now=>{frames.push({moving:document.documentElement.dataset.sidebarMoving!==undefined,boxes:figures.map(node=>{const r=node.getBoundingClientRect();return {x:r.x+r.width/2,shape:r.width/r.height};})});if(now-start<1200)requestAnimationFrame(tick);else done(frames);};requestAnimationFrame(tick);
   }),name);
   assert.ok(frames[0].boxes.length>0&&frames.some(frame=>frame.moving)&&!frames.at(-1).moving);
   assert.ok(frames.every(frame=>frame.boxes.every((box,index)=>Math.abs(box.shape/frames[0].boxes[index].shape-1)<.01)),'收放时立绘不能被压扁或拉长');
   assert.ok(frames.slice(1).every((frame,index)=>frame.boxes.every((box,figure)=>Math.abs(box.x-frames[index].boxes[figure].x)<40)),'立绘落定时不能跳变');
  }

  // Uploading a wallpaper is all it takes: the next launch opens on a frame of it.
  const wallpaper=path.resolve('src/renderer/assets/rooms/night.webp');
  await electron.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},wallpaper);
  const uploaded=await page.evaluate(()=>window.hivelab.invoke('background.import',{page:'home'}));
  assert.equal(uploaded.mode,'media');
  await page.evaluate(async()=>{await window.hivelab.invoke('background.save',{page:'home',headerTransparency:80});localStorage.setItem('hivelab.sidebar.transparency','85');});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.reload();await expect(splash).toBeVisible();await expect(splash).toBeHidden({timeout:30000});
  const scene=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('hivelab.startup-scene')));
  await expect.poll(async()=>(await scene())?.key,{timeout:15000}).toBe('media:'+uploaded.media.file);
  await expect.poll(async()=>(await scene())?.file,{timeout:15000}).toMatch(/\.webp$/);
  const frame=(await scene()).file,served=await page.evaluate(async file=>{const r=await fetch('hivelab-startup://local/'+file);const image=await createImageBitmap(await r.blob());return {status:r.status,width:image.width};},frame);
  assert.deepEqual(served,{status:200,width:(await page.evaluate(async file=>{const r=await fetch('hivelab-background://local/'+file);return (await createImageBitmap(await r.blob())).width;},uploaded.media.file))});
  await page.waitForTimeout(2200);
  await page.reload();await expect(splash).toBeVisible();
  await expect.poll(()=>page.locator('.startup-scene img').evaluate(i=>i.complete&&i.naturalWidth>0),{timeout:5000}).toBe(true);
  await expect(splash).toHaveClass(/startup-revealing/,{timeout:6000});
  assert.equal(await page.locator('.startup-scene').isVisible(),true,'the window opens onto the wallpaper frame');
  closed=false;const sceneRun=burst('scene',40,()=>closed);
  await stageAlone();closed=true;
  await entrance('scene');await sceneRun;
  await page.screenshot({path:path.join(shots,'scene-final.png')});
  await page.emulateMedia({colorScheme:'dark'});await page.evaluate(()=>localStorage.setItem('hivelab.theme','dark'));
  await page.reload();await expect(splash).toHaveAttribute('data-theme','dark');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('hivelab-startup')).backgroundColor),'rgb(0, 0, 0)','the dark theme opens on black');
  await burst('dark',60,()=>splash.isHidden());
  await expect(splash).toBeHidden({timeout:30000});
  await page.evaluate(()=>localStorage.setItem('hivelab.theme','light'));await page.emulateMedia({colorScheme:'light'});
  await page.waitForTimeout(2200);
  await page.evaluate(()=>window.dispatchEvent(new Event('hivelab:open-appearance')));await unfoldSettings(page);
  const settings=page.getByRole('region',{name:'启动动画设置'});
  await expect(settings).toBeVisible();
  // The built-in opening is the tunnel; there is no style choice any more.
  assert.equal(await settings.getByRole('combobox',{name:'启动动画样式'}).count(),0);
  await settings.getByRole('button',{name:'预览启动动画'}).click();
  await expect(splash).toBeVisible();await expect(splash).toHaveAttribute('data-mode','tunnel');
  await expect(splash).toHaveClass(/startup-revealing/,{timeout:6000});await expect(splash).toHaveAttribute('data-renderer','webgl');
  await page.keyboard.press('Escape');await expect(splash).toBeHidden();await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:5000});
  await expect(settings).toBeVisible();
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();
  await expect(splash).toHaveAttribute('data-mode','tunnel');
  await page.keyboard.press('Escape');await expect(splash).toBeHidden({timeout:15000});
  await page.evaluate(()=>window.dispatchEvent(new Event('hivelab:open-appearance')));await unfoldSettings(page);
  await expect(settings.getByRole('checkbox',{name:'跟随系统减少动态效果'})).not.toBeChecked();
  await settings.getByRole('checkbox',{name:'启动时播放动画'}).uncheck();
  await page.reload();await expect(splash).toHaveAttribute('data-mode','loading');await expect(splash).toBeHidden({timeout:15000});
  assert.equal(await video.getAttribute('src'),null,'disabled animation must not load the video');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:6000});
  await page.evaluate(()=>window.dispatchEvent(new Event('hivelab:open-appearance')));await unfoldSettings(page);
  await expect(page.getByRole('checkbox',{name:'启动时播放动画'})).not.toBeChecked();
  await settings.getByRole('checkbox',{name:'启动时播放动画'}).check();
  await electron.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
  await settings.getByRole('button',{name:'上传本地视频',exact:true}).click();
  await expect(settings.getByRole('button',{name:'恢复默认动画'})).toHaveCount(0);
  const localVideo=path.resolve('tests/fixtures/background.webm'),localImage=path.resolve('docs/media/h01-hero.png');
  await electron.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},localVideo);
  await settings.getByRole('button',{name:'上传本地视频',exact:true}).click();
  await expect(settings.getByRole('button',{name:'恢复默认动画'})).toBeVisible({timeout:20000});
  const imported=await page.evaluate(()=>JSON.parse(localStorage.getItem('hivelab.startup-animation')).customVideo);
  const range=await page.evaluate(async file=>{const r=await fetch('hivelab-startup://local/'+file,{headers:{Range:'bytes=0-63'}});return {status:r.status,length:(await r.arrayBuffer()).byteLength};},imported.file);
  assert.deepEqual(range,{status:206,length:64});
  await electron.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},localImage);
  await settings.getByRole('button',{name:'上传本地视频',exact:true}).click();
  await expect(settings.getByRole('alert')).toContainText('支持的启动素材格式');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hivelab.startup-animation')).customVideo.file),imported.file);
  await settings.getByRole('button',{name:'上传主页截图',exact:true}).click();
  await expect(settings.getByRole('button',{name:'移除主页截图'})).toBeVisible();
  await settings.getByRole('button',{name:'预览启动动画'}).click();
  await expect(splash).toHaveAttribute('data-source','custom');await expect(splash).toHaveAttribute('data-mode','video');
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(.2);
  assert.equal(await video.evaluate(v=>getComputedStyle(v).objectFit),'contain');
  await expect.poll(()=>page.locator('.startup-handoff-frame').evaluate(v=>v.complete&&v.naturalWidth>0)).toBe(true);
  await video.evaluate(v=>{v.currentTime=v.duration-.001;});
  await expect(splash).toHaveClass(/startup-matching-home/);
  await expect(splash).toBeHidden();
  await page.reload();await expect(splash).toHaveAttribute('data-source','custom');
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(.2);
  await page.keyboard.press('Escape');await expect(splash).toBeHidden();
  await expect(splash).not.toHaveClass(/startup-matching-home/);
  await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('hivelab.startup-animation'));p.customVideo.file='00000000-0000-4000-8000-000000000000.mp4';localStorage.setItem('hivelab.startup-animation',JSON.stringify(p));});
  await page.reload();await expect(splash).toHaveAttribute('data-source','builtin',{timeout:10000});await expect(splash).toHaveAttribute('data-mode','tunnel');
  await page.keyboard.press('Escape');await expect(splash).toBeHidden({timeout:15000});await expect(root).not.toHaveClass(/startup-(stage|entering)/,{timeout:5000});
  await page.evaluate(()=>window.dispatchEvent(new Event('hivelab:open-appearance')));await unfoldSettings(page);
  await settings.getByRole('button',{name:'恢复默认动画'}).click();
  await expect(settings.getByRole('button',{name:'恢复默认动画'})).toHaveCount(0);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('hivelab.startup-animation')).homeScreenshot),undefined);
  await mkdir('tests/ui/results',{recursive:true});await page.screenshot({path:path.resolve('tests/ui/results/startup-settings-electron.png')});
  assert.equal((await page.evaluate(()=>window.hivelab.invoke('snapshot'))).runs.length,0);
  console.log('PASS: packaged startup; tunnel opening; wallpaper alone; edge entrance with live glass; wallpaper layer fixed; glass changes no layout; sidebar folded at each launch; automatic scene from an uploaded wallpaper; dark opening; compact density; native custom video/image import; cancellation and format rejection; local Range streaming; screenshot handoff; custom persistence; Escape; missing media fallback; builtin reset; zero model runs.');
}finally{await electron.close();}

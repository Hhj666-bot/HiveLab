import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {_electron,expect} from '@playwright/test';

if(!process.env.HIVELAB_TEST_PROFILE)throw Error('Requires isolated desktop test environment');
const helper=path.resolve('.test-cache/computer-indicator-test.cjs');
await build({entryPoints:['src/main/computer-indicator.ts'],outfile:helper,bundle:true,platform:'node',format:'cjs',packages:'external',target:'node24',define:{'import.meta.url':JSON.stringify(pathToFileURL(path.resolve(process.env.HIVELAB_SMOKE_APP_ROOT??'.','dist/main.mjs')).href)}});
const executable=process.env.HIVELAB_ELECTRON_EXE??path.resolve('node_modules/electron/dist/electron.exe');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const electron=await _electron.launch({executablePath:executable,args:process.env.HIVELAB_SMOKE_APP_ROOT?[]:[path.resolve('.')],env,timeout:45000});
try{
  const page=await electron.firstWindow();
  await expect.poll(async()=>page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.backendReady!==false).catch(()=>false)),{timeout:30000}).toBe(true);
  const snapshot=await page.evaluate(()=>window.hivelab.invoke('snapshot'));
  assert.equal(snapshot.members.length,0);assert.equal(snapshot.runs.length,0);
  const diagnostics=await page.evaluate(()=>window.hivelab.invoke('provider.diagnostics',{provider:'codex'}));
  assert.equal(diagnostics.provider,'codex');assert.equal(diagnostics.sections.length,7);assert.ok(diagnostics.sections.some(section=>section.id==='skill-evidence'));assert.ok(diagnostics.sections.every(section=>section.items.every(item=>item.source&&Object.hasOwn(item,'observedAt'))));
  assert.equal((await page.evaluate(()=>window.hivelab.invoke('snapshot'))).runs.length,0,'diagnostic IPC must not start a model run');
  // Backend readiness precedes ready-to-show on a cold disposable installation.
  await expect.poll(()=>electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(window=>window.webContents.getURL().startsWith('file:')&&window.isVisible())),{timeout:20000}).toBe(true);
  const images=await page.evaluate(()=>window.hivelab.invoke('attachment.paste',{images:[{name:'截图.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='}]}));
  assert.equal(images[0].kind,'image');
  const backgroundFile=path.join(process.env.HIVELAB_TEST_PROFILE,'background.png');
  await writeFile(backgroundFile,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'));
  await electron.evaluate(({dialog},file)=>{globalThis.originalOpenDialog=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},backgroundFile);
  const background=await page.evaluate(()=>window.hivelab.invoke('background.import'));
  assert.equal(background.mode,'media');assert.equal(background.media.kind,'image');
  const range=await page.evaluate(async file=>{const r=await fetch('hivelab-background://local/'+file,{headers:{Range:'bytes=0-7'}});return {status:r.status,bytes:[...new Uint8Array(await r.arrayBuffer())],type:r.headers.get('content-type')};},background.media.file);
  assert.equal(range.status,206);assert.deepEqual(range.bytes,[137,80,78,71,13,10,26,10]);assert.equal(range.type,'image/png');
  await page.evaluate(()=>window.hivelab.invoke('background.save',{mode:'plain',dim:0.4}));
  assert.equal((await page.evaluate(()=>window.hivelab.invoke('background.get'))).dim,0.4);
  await page.evaluate(()=>window.hivelab.invoke('background.save',{page:'desk:sol',mode:'studio',blur:7}));
  await page.evaluate(()=>window.hivelab.invoke('background.save',{page:'desk:astra',mode:'plain',blur:2}));
  assert.equal((await page.evaluate(()=>window.hivelab.invoke('background.get',{page:'desk:sol'}))).blur,7);
  assert.equal((await page.evaluate(()=>window.hivelab.invoke('background.get',{page:'desk:astra'}))).blur,2);
  assert.equal((await page.evaluate(()=>window.hivelab.invoke('background.get'))).dim,0.4);
  // Checked-in VP8 fixture avoids canvas capture being throttled while test windows are occluded.
  const videoFile=path.join(process.env.HIVELAB_TEST_PROFILE,'background.webm');await copyFile(path.resolve('tests/fixtures/background.webm'),videoFile);
  await electron.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},videoFile);
  const videoBackground=await page.evaluate(()=>window.hivelab.invoke('background.import',{page:'home'}));assert.equal(videoBackground.media.kind,'video');
  const videoResponse=await page.evaluate(async file=>{const response=await fetch('hivelab-background://local/'+file);return {status:response.status,length:(await response.arrayBuffer()).byteLength,type:response.headers.get('content-type')};},videoBackground.media.file);assert.equal(videoResponse.status,200);assert.ok(videoResponse.length>1000);
  await page.addInitScript(()=>{globalThis.mediaFailures=[];document.addEventListener('error',e=>{if(e.target instanceof HTMLVideoElement)globalThis.mediaFailures.push({error:e.target.error?.message,code:e.target.error?.code,state:e.target.readyState});},true);const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){return play.call(this).catch(error=>{globalThis.mediaFailures.push({play:error.name,message:error.message});throw error;});};});
  await page.reload();try{await expect.poll(()=>page.locator('.home-background video').evaluate(node=>node.readyState>=2&&node.currentTime>0).catch(()=>false),{timeout:15000}).toBe(true);}catch(error){console.error('Background video diagnostics:',await page.evaluate(()=>({hidden:document.hidden,failures:globalThis.mediaFailures,videos:[...document.querySelectorAll('video')].map(v=>({src:v.src,state:v.readyState,time:v.currentTime,paused:v.paused,error:v.error?.message})),fallback:document.querySelector('.workspace-toast.error')?.textContent})));throw error;}
  assert.equal(await page.locator('.home-background video').evaluate(node=>node.muted&&node.loop),true);
  await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(()=>page.locator('.home-background video').evaluate(node=>node.paused)).toBe(true);
  await page.emulateMedia({reducedMotion:'no-preference'});await expect.poll(()=>page.locator('.home-background video').evaluate(node=>!node.paused)).toBe(true);
  await page.evaluate(()=>window.hivelab.invoke('background.save',{page:'home',paused:true}));await page.reload();await expect.poll(()=>page.locator('.home-background video').evaluate(node=>node.paused).catch(()=>false)).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});await page.emulateMedia({reducedMotion:'no-preference'});await expect.poll(()=>page.locator('.home-background video').evaluate(node=>node.paused)).toBe(true);
  console.log('PASS: reduced motion pauses video and resumes only when the saved manual pause is off.');
  await electron.evaluate(({dialog})=>{dialog.showOpenDialog=globalThis.originalOpenDialog;});
  console.log('PASS: native picker; per-page persistence; custom media protocol/ranges; real local WebM decode, muted loop and pause');
  await electron.evaluate(async({BrowserWindow},modulePath)=>{
    const {ComputerIndicator}=process.getBuiltinModule('module').createRequire(modulePath)(modulePath);
    globalThis.testStops=[];
    globalThis.testIndicator=new ComputerIndicator(async id=>{globalThis.testStops.push(id);},()=>{},error=>{globalThis.indicatorError=String(error);});
    globalThis.testIndicator.update({runs:[{id:'a',sessionId:'sa',status:'running',provider:'codex'},{id:'d',sessionId:'sd',status:'running',provider:'dsh'},{id:'unrelated',sessionId:'su',status:'running',provider:'claude'}],sessions:[{id:'sa',memberId:'astra'},{id:'sd',memberId:'ds'}],members:[{id:'astra',name:'Astra'},{id:'ds',name:'DeepSeek'}]});
    globalThis.mainTestWindow=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().startsWith('file:'));
    if(!globalThis.mainTestWindow)throw Error('Isolated main window was not found');
    globalThis.mainTestWindow.hide();
    globalThis.testIndicator.event({runId:'a',kind:'tool',data:{id:'one',type:'mcpToolCall',tool:'computer',hivelabPhase:'started'}});
    globalThis.testIndicator.event({runId:'d',kind:'tool',data:{toolCallId:'two',title:'pwsh',status:'in_progress'}});
  },helper);
  let overlay;
  await expect.poll(async()=>{
    // Only the indicator: asking a hidden or busy window can hang past the poll's timeout.
    for(const window of electron.windows())if(window.url().startsWith('data:text/html')&&await window.locator('#stop').count()){overlay=window;return true;}return false;
  },{timeout:12000}).toBe(true);
  try{await expect(overlay.locator('#label')).toHaveText('HiveLab 合屋 · Astra、DeepSeek 正在操作电脑');}
  catch(error){console.error(await electron.evaluate(()=>({error:globalThis.indicatorError,signature:globalThis.testIndicator.signature,loading:globalThis.testIndicator.window.webContents.isLoading(),visible:globalThis.testIndicator.window.isVisible(),activity:globalThis.testIndicator.tracker.current()})));throw error;}
  assert.equal(await electron.evaluate(()=>globalThis.mainTestWindow.isVisible()),false,'indicator must remain independent of the minimized/hidden workbench');
  const output=path.resolve('tests/ui/results');await mkdir(output,{recursive:true});await overlay.screenshot({path:path.join(output,'computer-indicator.png')});
  await overlay.locator('#stop').click();
  await expect.poll(()=>electron.evaluate(()=>globalThis.testStops)).toEqual(['a','d']);
  await electron.evaluate(()=>{
    globalThis.testIndicator.event({runId:'a',kind:'tool',data:{id:'one',hivelabPhase:'completed'}});
    globalThis.testIndicator.event({runId:'d',kind:'tool',data:{toolCallId:'two',status:'completed'}});
  });
  await expect.poll(()=>electron.evaluate(()=>globalThis.testIndicator.window.isVisible())).toBe(false);
  await electron.evaluate(()=>{globalThis.testIndicator.event({runId:'d',kind:'tool',data:{toolCallId:'new',title:'browser',status:'in_progress'}});});
  await expect.poll(()=>electron.evaluate(()=>globalThis.testIndicator.window.isVisible())).toBe(true);
  await electron.evaluate(()=>globalThis.testIndicator.clear());
  assert.equal(await electron.evaluate(()=>globalThis.testIndicator.window.isVisible()),false);
  assert.equal(await electron.evaluate(()=>globalThis.indicatorError),undefined);
  await electron.evaluate(()=>globalThis.testIndicator.destroy());
  console.log('PASS: isolated Electron startup; real clipboard-image IPC; topmost member indicator while main hidden; scoped stop; automatic hide; worker-loss cleanup');
}finally{await electron.close();}

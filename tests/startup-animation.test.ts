import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_STARTUP,foldedSidebarLayout,parseStartupPreferences,parseStartupMedia,parseStartupScene,startupMediaUrl,startupAction,startupCanPress,startupReducedMotion,startupSceneImage,startupScenePlan,startupTheme,startupTiming,entranceEase,entranceOffset,STARTUP_ENTRANCE,STARTUP_ENTRANCE_MS} from '../src/shared/startup-animation';
import {logoSize,TUNNEL_MS,tunnelHalf,tunnelRadius,worldScale} from '../src/renderer/startup-logo';
import {BackgroundLibrary} from '../src/main/background-library';
import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('old or malformed startup preferences keep the usable defaults',()=>{
  for(const value of [null,undefined,42,'bad',{enabled:'false',sound:1,volume:NaN,playback:'other'}])assert.deepEqual(parseStartupPreferences(value),DEFAULT_STARTUP);
  assert.deepEqual(parseStartupPreferences({enabled:false,sound:true,volume:150,playback:'ready'}),{enabled:false,sound:true,volume:100,playback:'ready',respectReducedMotion:false});
  assert.equal(parseStartupPreferences({volume:-20}).volume,0);
});
test('a retired built-in choice in saved preferences is ignored',()=>{
  assert.equal('builtin' in DEFAULT_STARTUP,false);
  for(const saved of ['dragon','tunnel','pixel'])assert.deepEqual(parseStartupPreferences({builtin:saved}),DEFAULT_STARTUP);
});
test('the explicit startup preference plays by default even when Windows animations are off',()=>{
  assert.equal(startupReducedMotion(parseStartupPreferences(null),true),false);
  const following=parseStartupPreferences({respectReducedMotion:true});
  assert.equal(startupReducedMotion(following,true),true);
  assert.equal(startupReducedMotion(following,false),false);
  assert.equal(startupReducedMotion(following,true,true),false,'manual preview remains playable');
});
const state={ready:false,skipped:false,failed:false,enabled:true,playback:'full' as const,time:0};
test('local startup media uses only copied media IDs and survives preferences round trips',()=>{
  const video={file:'00000000-0000-4000-8000-000000000000.mp4',name:'本地片头'},image={file:'00000000-0000-4000-8000-000000000001.png',name:'主页'};
  assert.deepEqual(parseStartupPreferences({...DEFAULT_STARTUP,customVideo:video,homeScreenshot:image}),{...DEFAULT_STARTUP,customVideo:video,homeScreenshot:image});
  assert.equal(startupMediaUrl(video),'hivelab-startup://local/'+video.file);
  for(const bad of [null,{file:'../../secret.mp4'},{file:'https://example.com/video.mp4'},image])assert.equal(parseStartupMedia(bad,'video'),undefined);
  assert.deepEqual(parseStartupPreferences({customVideo:{file:'bad'},homeScreenshot:{file:'bad'}}),DEFAULT_STARTUP);
});
test('a custom video keeps its actual last frame and can be a short clip',()=>{
  assert.equal(startupTiming(.5).finish,.499);
  assert.equal(startupAction({...state,duration:.5,time:.49}),'play');
  assert.equal(startupAction({...state,duration:.5,time:.5}),'wait');
  assert.equal(startupAction({...state,duration:.5,time:.5,ready:true}),'finish');
  assert.equal(startupAction({...state,duration:90,time:16,ready:true}),'play');
});
test('skip, disabled animation and unavailable media keep the loading screen until ready',()=>{
  for(const patch of [{skipped:true},{failed:true},{enabled:false}]){
    assert.equal(startupAction({...state,...patch}),'wait');
    assert.equal(startupAction({...state,...patch,ready:true}),'finish');
  }
});
test('fast entry respects readiness while full playback preserves the ending',()=>{
  assert.equal(startupAction({...state,playback:'ready'}),'play');
  assert.equal(startupAction({...state,playback:'ready',ready:true}),'finish');
  assert.equal(startupAction({...state,ready:true,time:3}),'play');
});
test('the button is pressed once something real can be revealed',()=>{
  assert.equal(startupCanPress({rested:false,sceneReady:true,appReady:true}),false,'the button is always seen at rest first');
  assert.equal(startupCanPress({rested:true,sceneReady:false,appReady:false}),false,'a live reveal waits for the app');
  assert.equal(startupCanPress({rested:true,sceneReady:true,appReady:false}),true,'a stored scene needs no backend');
  assert.equal(startupCanPress({rested:true,sceneReady:false,appReady:true}),true);
});
test('each launch folds the sidebar and keeps its width',()=>{
  assert.deepEqual(JSON.parse(foldedSidebarLayout(null)),{mode:'icons'});
  assert.deepEqual(JSON.parse(foldedSidebarLayout('{"mode":"expanded","width":320}')),{mode:'icons',width:320});
  assert.deepEqual(JSON.parse(foldedSidebarLayout('{"mode":"icons","width":240}')),{mode:'icons',width:240});
  assert.deepEqual(JSON.parse(foldedSidebarLayout('{"mode":"hidden","width":300}')),{mode:'hidden',width:300},'a hidden sidebar is not brought back');
  for(const bad of ['not json','[]','5'])assert.deepEqual(JSON.parse(foldedSidebarLayout(bad)),{mode:'icons'});
});
test('the opening follows the saved theme, then the system',()=>{
  assert.equal(startupTheme('dark',false),'dark');assert.equal(startupTheme('light',true),'light');
  assert.equal(startupTheme('system',true),'dark');assert.equal(startupTheme(null,false),'light');
});
test('each wallpaper kind gets the scene it can support',()=>{
  const media=(kind:'image'|'video'|'scene'|'web',file:string)=>({mode:'media' as const,media:{file,name:'x',kind,source:'local' as const}});
  assert.deepEqual(startupScenePlan(media('image','a.png')),{key:'media:a.png',source:'frame'});
  // Whatever moves is shown live: a still frame of it would jump when the real thing took over.
  assert.deepEqual(startupScenePlan(media('video','b.mp4')),{key:'media:b.mp4',source:'live'});
  assert.deepEqual(startupScenePlan(media('scene','c.wallpaper')),{key:'media:c.wallpaper',source:'live'});
  assert.deepEqual(startupScenePlan(media('web','d.wallpaper')),{key:'media:d.wallpaper',source:'live'});
  assert.deepEqual(startupScenePlan(media('image','e.GIF')),{key:'media:e.GIF',source:'live'},'an animated image moves too');
  assert.notEqual(startupScenePlan(media('image','a.png')).key,startupScenePlan(media('image','other.png')).key,'a new upload always regenerates');
  assert.deepEqual(startupScenePlan({mode:'studio'}),{key:'rooms',source:'rooms'});
  assert.deepEqual(startupScenePlan({mode:'plain'}),{key:'plain',source:'plain'});
  assert.equal(startupScenePlan({...media('image','a.png'),mode:'studio'}).key,'rooms','an unused import is not the wallpaper');
});
test('stored scenes accept only library frames and pick the room for the hour',()=>{
  const file='00000000-0000-4000-8000-000000000002.webp',frame=parseStartupScene({key:'media:x',file,dim:2,blur:-1,fit:'other'});
  assert.deepEqual(frame,{key:'media:x',file,dim:.95,blur:0,fit:'cover'});
  assert.equal(startupSceneImage(frame,'night'),'hivelab-startup://local/'+file);
  assert.equal(parseStartupScene({key:'x',file:'../../secret.webp'})?.file,undefined);
  for(const bad of [null,5,{},{key:''}])assert.equal(parseStartupScene(bad),undefined);
  const rooms=parseStartupScene({key:'rooms',rooms:{morning:'m.webp',night:'n.webp'}});
  assert.equal(startupSceneImage(rooms,'night'),'n.webp');assert.equal(startupSceneImage(rooms,'evening'),undefined,'a missing room falls back to the live wallpaper');
  assert.equal(startupSceneImage(undefined,'night'),undefined);
});
test('each part of the interface leaves from outside the page and comes to rest, one after another',()=>{
  assert.equal(entranceEase(0),0);assert.equal(entranceEase(1),1);
  for(let i=1;i<=100;i++)assert.ok(entranceEase(i/100)>=entranceEase((i-1)/100),'it never moves backwards');
  assert.ok(entranceEase(.15)<.2,'it starts gently');assert.ok(entranceEase(.5)>.6&&entranceEase(.9)>.97,'and settles slowly');
  const largest=Math.max(...Array.from({length:115},(_,i)=>entranceEase((i+1)/115)-entranceEase(i/115)));
  assert.ok(largest<.03,'no single frame covers more than a small part of the way: '+largest);
  for(const part of STARTUP_ENTRANCE){
    assert.equal(entranceOffset(0,part.delay,part.duration),1,'it waits outside until its turn');
    assert.equal(entranceOffset(part.delay+part.duration,part.delay,part.duration),0,'and ends at home');
  }
  assert.equal(new Set(STARTUP_ENTRANCE.map(part=>part.delay)).size,STARTUP_ENTRANCE.length,'parts arrive in turn');
  assert.equal(STARTUP_ENTRANCE_MS,2260);
});
test('the logo sits small in the middle of the plane',()=>{
  assert.equal(logoSize(1470,938),108);assert.equal(logoSize(1000,562),72,'a small window keeps it legible');
  assert.equal(logoSize(1470,938,2),216,'it keeps its size on a sharper screen');
});
test('the window opens from the button and widens without ever jumping',()=>{
  const plate=54,full=810,steps=Array.from({length:101},(_,i)=>tunnelHalf(plate,full,i/100));
  assert.equal(steps[0],plate,'it starts as the button');assert.ok(Math.abs(steps[100]-full)<1e-9,'and ends past the window edge');
  for(let i=1;i<steps.length;i++)assert.ok(steps[i]>=steps[i-1],'it only ever widens');
  assert.ok(steps[25]<plate*3,'the first quarter stays slow');
  assert.ok(tunnelRadius(54,54,0)>20,'it keeps the button\'s rounded shape at first');assert.equal(tunnelRadius(800,500,1),0,'and fills the corners at the end');
});
test('the wallpaper arrives from afar and its edge never shows through the window',()=>{
  assert.equal(worldScale(0),.72);assert.equal(worldScale(1),1);assert.equal(worldScale(.95),1,'it has arrived before the window finishes');
  for(let i=1;i<=100;i++)assert.ok(worldScale(i/100)>=worldScale((i-1)/100),'it only ever comes closer');
  for(const [width,height] of [[1838,1172],[1000,562]])for(let i=0;i<=90;i++){
    const t=i/100,plate=logoSize(width,height);
    // Only what lies on screen can reveal an edge; the window passes the screen's edge before it finishes.
    assert.ok(Math.min(tunnelHalf(plate/2,width*.55,t),width/2)<=worldScale(t)*width/2*1.01,'width at '+t);
    assert.ok(Math.min(tunnelHalf(plate/2,height*.55,t),height/2)<=worldScale(t)*height/2*1.01,'height at '+t);
  }
  assert.ok(TUNNEL_MS>=2000,'the opening is unhurried');
});
test('wallpaper frames replace the previous one and accept only images',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hivelab-startup-frame-')),library=new BackgroundLibrary(root),folder=path.join(root,'backgrounds');
  try{
    const webp=new Uint8Array(Buffer.from('RIFF\0\0\0\0WEBPVP8 ','latin1'));
    const first=await library.saveFrame(webp);assert.match(first!.file,/\.webp$/);
    const second=await library.saveFrame(webp,first!.file);assert.match(second!.file,/\.webp$/);
    assert.deepEqual(await readdir(folder),[second!.file],'only the current frame stays on disk');
    await writeFile(path.join(root,'keep.txt'),'x');
    await library.saveFrame(webp,'../keep.txt');assert.deepEqual((await readdir(root)).includes('keep.txt'),true,'previous can only name a frame');
    await assert.rejects(library.saveFrame(new Uint8Array(Buffer.from('<html>'))),/格式无效/);
    await assert.rejects(library.saveFrame('text'),/画面无效/);
    await library.saveFrame(undefined,second!.file);assert.ok(!(await readdir(folder)).includes(second!.file));
  }finally{await rm(root,{recursive:true,force:true});}
});

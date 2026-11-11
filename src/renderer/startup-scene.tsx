import {t} from './i18n';
import {useEffect} from 'react';
import {backgroundUrl,useHomeBackground} from './home-background';
import {readStartupScene,saveStartupScene,startupScenePlan,type StartupScene} from '../shared/startup-animation';
import type {BackgroundPreferences} from '../shared/background';
import morning from './assets/rooms/morning.webp';
import afternoon from './assets/rooms/afternoon.webp';
import evening from './assets/rooms/evening.webp';
import night from './assets/rooms/night.webp';

const FRAME_WIDTH=2560;
/** Draws the wallpaper itself, not the page: the boot script applies fit, blur and shade for the window it opens in. */
async function wallpaperFrame(media:NonNullable<BackgroundPreferences['media']>){
 const image=new Image();image.crossOrigin='anonymous';image.src=backgroundUrl(media.file);await image.decode();
 const scale=Math.min(1,FRAME_WIDTH/image.naturalWidth),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
 canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);
 const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',.9));if(!blob)throw Error(t("启动场景画面生成失败。"));
 return new Uint8Array(await blob.arrayBuffer());
}
let ticket=0;
/** Every wallpaper change lands here, so the next launch opens on the wallpaper that is in use now. */
export async function refreshStartupScene(p:BackgroundPreferences){
 const plan=startupScenePlan(p),old=readStartupScene(),look={dim:p.dim,blur:p.blur,fit:p.fit},id=++ticket;
 if(plan.source==='frame'&&old?.key===plan.key&&old.file){saveStartupScene({...old,...look});return;}
 // A stale picture must never open the app: until the new frame exists, the reveal uses the live wallpaper.
 const scene:StartupScene={key:plan.key,...look};
 if(plan.source==='frame'){
  saveStartupScene(scene);
  const data=await wallpaperFrame(p.media!);if(id!==ticket)return;
  const saved=await window.hivelab.invoke<{file:string}>('startup.saveScene',{data,previous:old?.file});
  if(id===ticket)saveStartupScene({...scene,file:saved.file});
  return;
 }
 saveStartupScene(plan.source==='plain'?{...scene,plain:true}:plan.source==='rooms'?{...scene,rooms:{morning,afternoon,evening,night}}:scene);
 if(old?.file)void window.hivelab.invoke('startup.saveScene',{previous:old.file}).catch(()=>{});
}
/** Runs beside the app and only acts when the home wallpaper or its look changes. */
export function StartupSceneSync(){
 const home=useHomeBackground('home'),p=home.preferences;
 useEffect(()=>{
  if(!window.hivelab||home.error||home.busy)return;
  void refreshStartupScene(p).catch(error=>{console.warn('启动场景未能生成，下次启动使用实时壁纸。',error);});
 },[p.mode,p.media?.file,p.dim,p.blur,p.fit,home.error,home.busy]);
 return null;
}

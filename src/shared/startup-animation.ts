import type {BackgroundPreferences} from './background';
import type {RoutinePeriod} from './types';

export interface StartupMedia {file:string;name:string;}
export function startupMediaUrl(media:StartupMedia){return `hivelab-startup://local/${encodeURIComponent(media.file)}`;}
export function parseStartupMedia(value:unknown,kind:'video'|'image'):StartupMedia|undefined {
  if(!value||typeof value!=='object')return;
  const p=value as Partial<StartupMedia>,extensions=kind==='video'?'mp4|webm|mov|m4v':'png|jpg|jpeg|webp';
  if(typeof p.file!=='string'||!new RegExp(`^[a-f0-9-]{36}\\.(${extensions})$`,'i').test(p.file))return;
  return {file:p.file,name:typeof p.name==='string'?p.name.slice(0,180):p.file};
}
/** The built-in opening: the logo is a switch that opens a tunnel onto the home wallpaper. A custom video replaces it. */
export interface StartupPreferences {
  enabled: boolean;
  sound: boolean;
  volume: number;
  playback: 'full' | 'ready';
  respectReducedMotion: boolean;
  customVideo?:StartupMedia;
  homeScreenshot?:StartupMedia;
}
export const STARTUP_KEY = 'hivelab.startup-animation';
export const STARTUP_CHANGED = 'hivelab:startup-preferences';
/** A video of unknown length (metadata not read yet) is treated as this long. */
const UNKNOWN_VIDEO_SECONDS=16;
/** A custom video keeps its actual last frame; it can be a short clip. */
export function startupTiming(duration=UNKNOWN_VIDEO_SECONDS){
  const end=Number.isFinite(duration)&&duration>0?duration:UNKNOWN_VIDEO_SECONDS;
  return {hold:end-.001,finish:end-.001,fillStart:Math.max(0,end-.65),fillEnd:end};
}
/** The button rests this long, then the wallpaper stands alone before the interface enters. */
export const STARTUP_REST_MS=520;
export const STARTUP_QUIET_MS=160;
/** The wallpaper holds until the interface's colours are settled, within this limit. */
export const STARTUP_COLOURS_LIMIT_MS=1400;
/** The same for the member artwork, so no figure is still decoding as it slides in. */
export const STARTUP_ART_LIMIT_MS=2500;
export const STARTUP_REST_LIMIT_MS=2800;
export const STARTUP_STAGE_MS=480;
/** When each part of the interface sets off and how long it takes to arrive. */
export const STARTUP_ENTRANCE=[{name:'--enter-sidebar',delay:0,duration:1900},{name:'--enter-top',delay:120,duration:1900},{name:'--enter-cast',delay:200,duration:2000},{name:'--enter-foot',delay:360,duration:1900}] as const;
export const STARTUP_ENTRANCE_MS=Math.max(...STARTUP_ENTRANCE.map(part=>part.delay+part.duration));
const bezier=(t:number,a:number,b:number)=>3*a*(1-t)**2*t+3*b*(1-t)*t*t+t**3;
/** cubic-bezier(.34,.02,.16,1): a gentle start, then a long settling. */
export function entranceEase(x:number){
  if(x<=0)return 0;if(x>=1)return 1;
  let low=0,high=1;
  for(let i=0;i<24;i++){const middle=(low+high)/2;if(bezier(middle,.34,.16)<x)low=middle;else high=middle;}
  return bezier((low+high)/2,.02,1);
}
/** How far outside the page a part still is: 1 before it sets off, 0 once it has arrived. */
export function entranceOffset(elapsed:number,delay:number,duration:number){return 1-entranceEase((elapsed-delay)/duration);}
export const DEFAULT_STARTUP: StartupPreferences = {enabled:true,sound:false,volume:50,playback:'full',respectReducedMotion:false};
export function parseStartupPreferences(value:unknown):StartupPreferences {
  const p=value&&typeof value==='object'?value as Partial<StartupPreferences>:{};
  const customVideo=parseStartupMedia(p.customVideo,'video'),homeScreenshot=parseStartupMedia(p.homeScreenshot,'image');
  return {enabled:typeof p.enabled==='boolean'?p.enabled:true,sound:typeof p.sound==='boolean'?p.sound:false,volume:typeof p.volume==='number'&&Number.isFinite(p.volume)?Math.max(0,Math.min(100,p.volume)):50,playback:p.playback==='ready'?'ready':'full',respectReducedMotion:p.respectReducedMotion===true,...(customVideo?{customVideo}:{}),...(homeScreenshot?{homeScreenshot}:{})};
}
export function startupReducedMotion(preferences:StartupPreferences,systemReduced:boolean,preview=false){return preferences.respectReducedMotion&&systemReduced&&!preview;}
export function readStartupPreferences():StartupPreferences {
  try{return parseStartupPreferences(JSON.parse(localStorage.getItem(STARTUP_KEY)??'null'));}catch{return {...DEFAULT_STARTUP};}
}
export function saveStartupPreferences(value:StartupPreferences){
  const next=parseStartupPreferences(value);
  localStorage.setItem(STARTUP_KEY,JSON.stringify(next));
  window.dispatchEvent(new Event(STARTUP_CHANGED));
  return next;
}
export function startupAction({ready,skipped,failed,enabled,playback,time,duration}:{ready:boolean;skipped:boolean;failed:boolean;enabled:boolean;playback:StartupPreferences['playback'];time:number;duration?:number}):'wait'|'play'|'finish' {
  const timing=startupTiming(duration);
  if(!ready)return skipped||failed||!enabled||time>=timing.hold?'wait':'play';
  return skipped||failed||!enabled||playback==='ready'||time>=timing.finish?'finish':'play';
}
/** A stored scene can reveal the wallpaper before the app exists; a live reveal has to wait for it. */
export function startupCanPress({rested,sceneReady,appReady}:{rested:boolean;sceneReady:boolean;appReady:boolean}){return rested&&(sceneReady||appReady);}
/** Each launch opens with the sidebar folded; the saved width stays and a hidden sidebar stays hidden. */
export function foldedSidebarLayout(saved:string|null){
  let layout:Record<string,unknown>={};
  try{const parsed=JSON.parse(saved??'null');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))layout=parsed;}catch{}
  return JSON.stringify({...layout,mode:layout.mode==='hidden'?'hidden':'icons'});
}
export function startupTheme(choice:string|null|undefined,systemDark:boolean):'light'|'dark'{return choice==='light'||choice==='dark'?choice:systemDark?'dark':'light';}

/** What the boot script shows behind the pixels, generated from the home wallpaper by startup-scene.tsx. */
export interface StartupScene {
  key:string;
  /** A frame of a still wallpaper in the startup media library. A moving wallpaper has none and is shown live. */
  file?:string;
  /** Built-in rooms are bundled images, one for each part of the day. */
  rooms?:Partial<Record<RoutinePeriod,string>>;
  plain?:boolean;
  dim:number;
  blur:number;
  fit:'cover'|'contain';
}
export const STARTUP_SCENE_KEY='hivelab.startup-scene';
export type StartupSceneSource='frame'|'live'|'rooms'|'plain';
export function startupScenePlan(p:Pick<BackgroundPreferences,'mode'|'media'>):{key:string;source:StartupSceneSource}{
  const media=p.mode==='media'?p.media:undefined;
  // A still frame of something that moves would come to life with a jump, so the window looks at the real thing.
  if(media)return {key:'media:'+media.file,source:media.kind==='image'&&!/\.gif$/i.test(media.file)?'frame':'live'};
  return p.mode==='plain'?{key:'plain',source:'plain'}:{key:'rooms',source:'rooms'};
}
export function parseStartupScene(value:unknown):StartupScene|undefined {
  if(!value||typeof value!=='object')return;
  const s=value as Partial<StartupScene>;if(typeof s.key!=='string'||!s.key)return;
  const number=(v:unknown,min:number,max:number,fallback:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
  const rooms=s.rooms&&typeof s.rooms==='object'?Object.fromEntries(Object.entries(s.rooms).filter(([,url])=>typeof url==='string'&&url.length<2048)):undefined;
  return {key:s.key,...(typeof s.file==='string'&&/^[a-f0-9-]{36}\.(webp|jpg)$/i.test(s.file)?{file:s.file}:{}),...(rooms?{rooms}:{}),...(s.plain===true?{plain:true}:{}),dim:number(s.dim,0,.95,.26),blur:number(s.blur,0,20,0),fit:s.fit==='contain'?'contain':'cover'};
}
export function readStartupScene(){try{return parseStartupScene(JSON.parse(localStorage.getItem(STARTUP_SCENE_KEY)??'null'));}catch{return undefined;}}
export function saveStartupScene(scene:StartupScene|undefined){
  try{if(scene)localStorage.setItem(STARTUP_SCENE_KEY,JSON.stringify(scene));else localStorage.removeItem(STARTUP_SCENE_KEY);}catch{}
}
/** The picture to show now, or nothing when the reveal must use the live wallpaper. */
export function startupSceneImage(scene:StartupScene|undefined,period:RoutinePeriod){
  if(!scene)return;
  return scene.file?startupMediaUrl({file:scene.file,name:''}):scene.rooms?.[period];
}
export interface StartupController {ready():void;fail():void;preview():void;beforeEntrance?():Promise<void>;}
declare global {interface Window {hivelabStartup?:StartupController;}}

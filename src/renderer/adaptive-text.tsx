import {useLayoutEffect} from 'react';
import {CONTRAST_INKS,advanceTextTone,preferredTone,sampleContrast,TEXT_SAMPLE_INTERVAL_MS,type StableTextTone,type ContrastRect,type ContrastTone,type ContrastEvidence} from '../shared/text-contrast';
import {useAppearancePreferences} from './appearance-preferences';
import {useMediaPreference} from './media-preferences';
import {collectTextGroups,textGroupCacheKey,textGroupLooseKey,type TextGroup} from './adaptive-text-groups';
import {emptyTextToneCache,parseTextToneCache,updateTextToneCache,type TextToneCache} from '../shared/adaptive-text-cache';
import './adaptive-text.css';

const TONE_TURN_MS=420,TONE_ANIMATION='adaptive-tone';
/** The folded sidebar shows no text, so its glass is read directly. Text that unfolds starts from this tone. */
const SIDEBAR_RAIL='sidebar-rail',SIDEBAR_KINDS=['brand','tabs','people','navigation','projects','footer','files','sidebar-label'];
/** Registered in adaptive-text.css, so they interpolate; everything else is derived from them on the group. */
const TONE_VALUES:Record<ContrastTone,Record<string,string>>={
 dark:{'--adaptive-tone-ink':CONTRAST_INKS.dark,'--adaptive-tone-accent':'#713500','--adaptive-halo-near':'rgb(255 255 255 / .8)','--adaptive-halo-far':'rgb(255 255 255 / .45)'},
 light:{'--adaptive-tone-ink':CONTRAST_INKS.light,'--adaptive-tone-accent':'#ffe6b0','--adaptive-halo-near':'rgb(0 0 0 / .85)','--adaptive-halo-far':'rgb(0 0 0 / .5)'}
};
const PROPS=['color',...Object.keys(TONE_VALUES.dark),'--adaptive-ink','--adaptive-halo','--adaptive-accent','--ink','--ink-2','--ink-3','--m-ink','--chat-input-ink','--chat-reply-ink','--chat-mine-ink'];
// Global page/theme/background palettes; independent of temporary DOM nodes.
let pagePalettes:TextToneCache=emptyTextToneCache(),loading:Promise<void>|undefined,syncActivePalette:(()=>void)|undefined;
export function warmAdaptiveTextCache(){return loading??=window.hivelab.invoke('appearance.textCache.read').then(value=>{pagePalettes=parseTextToneCache(value);}).catch(error=>{console.warn('文字配色缓存读取失败',error);});}
/** Restore the destination palette during the React commit, before painting. */
export function useAdaptiveTextPage(page:string,theme?:string,accentColor?:string){
 useLayoutEffect(()=>{const root=document.documentElement;root.dataset.appearancePage=page;if(accentColor)root.style.setProperty('--workspace-control-accent',accentColor);else root.style.removeProperty('--workspace-control-accent');syncActivePalette?.();return()=>{if(root.dataset.appearancePage===page){delete root.dataset.appearancePage;root.style.removeProperty('--workspace-control-accent');}};},[page,theme,accentColor]);
}
function rememberColors(context:string,tones:Record<string,ContrastTone>){
 const old=pagePalettes.contexts[context]?.tones;
 if(old&&Object.keys(tones).every(key=>old[key]===tones[key]))return;
 const merged=Object.fromEntries([...Object.entries(old??{}).filter(([key])=>!(key in tones)),...Object.entries(tones)]);
 pagePalettes=updateTextToneCache(pagePalettes,context,merged);
 void window.hivelab.invoke('appearance.textCache.write',{context,tones:pagePalettes.contexts[context].tones}).catch(error=>{console.warn('文字配色缓存保存失败',error);});
}
type GroupState=StableTextTone&{key:string;loose:string;sampled:boolean;restored:boolean};
type Painted={tone:ContrastTone;kind:string;original:Map<string,[string,string]>};
function currentTone(node:HTMLElement):ContrastTone{
 const color=getComputedStyle(node).color,numbers=color.match(/[\d.]+/g)?.map(Number);
 if(numbers?.length&&numbers.length>=3){const scale=color.startsWith('color(srgb')?1:255;return (.2126*numbers[0]+.7152*numbers[1]+.0722*numbers[2])/scale>.5?'light':'dark';}
 return document.documentElement.dataset.theme==='light'?'dark':'light';
}
const rect=(r:DOMRect,pad=0):ContrastRect=>({x:r.x-pad,y:r.y-pad,width:r.width+2*pad,height:r.height+2*pad});
const overlaps=(a:ContrastRect,b:ContrastRect)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
function sampleArea(node:HTMLElement,bounds:DOMRect,overlays:HTMLElement[],solid=false,code=false):{area:ContrastRect;masks:ContrastRect[]}{
 const masks:ContrastRect[]=[],textAreas:DOMRect[]=[];
 for(const overlay of overlays)if(!overlay.contains(node)&&overlay!==node){const r=overlay.getBoundingClientRect();if(overlaps(bounds,r))masks.push(rect(r));}
 if(code&&node.matches('.syntax-line-numbers,textarea'))return {area:{x:bounds.left+3,y:bounds.top+3,width:Math.max(6,Math.min(12,parseFloat(getComputedStyle(node).paddingLeft)-4)),height:Math.max(0,bounds.height-6)},masks};
 for(const child of node.querySelectorAll('svg,img,canvas,video,textarea,input,.md-code,.syntax-code,.room-meta em,.button.primary,.room-send')){const r=child.getBoundingClientRect();if(r.width&&r.height)masks.push(rect(r,2));}
 const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text:Node|null,count=0;
 while(!solid&&(text=walker.nextNode())&&count++<240&&masks.length<100){
  if(!text.textContent?.trim()||text.parentElement?.closest('svg,option,textarea,.md-code,.syntax-code'))continue;
  const range=document.createRange();range.selectNodeContents(text);for(const r of range.getClientRects())if(r.width&&r.height&&overlaps(bounds,r)){masks.push(rect(r,1.5));textAreas.push(r);}
 }
 // A text-only span has no internal padding. The narrow surrounding strip is
 // on the same surface and still supplies evidence after masking its glyphs.
 let area=rect(bounds,solid?0:node.matches('button,summary,select,input')?2:bounds.height<28?6:0);
 // Flex labels often occupy the entire row. Sampling their empty right-hand
 // space would choose a colour for wallpaper far away from the actual glyphs.
 if(textAreas.length&&node.matches('.room-meta,.room-title,.room-topic-bar,.roster-text,.sidebar-section-label,.sidebar-settings,.room-entry,.home-action,.preview-panel-header,.standee-home-header>div,.home-toolbar-greeting')){
  const x=Math.max(bounds.left-6,Math.min(...textAreas.map(r=>r.left))-12),y=Math.max(bounds.top-6,Math.min(...textAreas.map(r=>r.top))-8),right=Math.min(bounds.right+6,Math.max(...textAreas.map(r=>r.right))+12),bottom=Math.min(bounds.bottom+6,Math.max(...textAreas.map(r=>r.bottom))+8);area={x,y,width:right-x,height:bottom-y};
 }
 return {area,masks:masks.slice(0,128)};
}
function groupEvidence(group:TextGroup,pixels:Uint8ClampedArray,width:number,height:number,overlays:HTMLElement[]):ContrastEvidence|null{
 const samples=group.probes.map(node=>{const area=sampleArea(node,node.getBoundingClientRect(),overlays,group.kind==='solid',group.kind==='code');return sampleContrast(pixels,width,height,{width:innerWidth,height:innerHeight},area.area,area.masks);}).filter((e):e is ContrastEvidence=>!!e);
 if(!samples.length)return null;
 const quartile=(key:'dark'|'light')=>samples.map(e=>e[key]).sort((a,b)=>a-b)[Math.floor((samples.length-1)*.25)];
 return {dark:quartile('dark'),light:quartile('light'),count:samples.reduce((sum,e)=>sum+e.count,0)};
}
/** Identity/configuration changes are distinct from frames of a playing video. */
function darkTheme(){const theme=document.documentElement.dataset.theme;return theme==='dark'||theme!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches;}
function startupCoveringPage(){const overlay=document.getElementById('hivelab-startup'),root=document.getElementById('root');return !!overlay&&!overlay.hidden||!!root?.classList.contains('startup-stage')||!!root?.classList.contains('startup-entering');}
const startupEntering=()=>!!document.getElementById('root')?.classList.contains('startup-entering');
const pageTurning=()=>document.documentElement.dataset.sidebarMoving!==undefined||document.documentElement.dataset.panelMoving!==undefined||[...document.querySelectorAll<HTMLElement>('.sidebar-page,.page-turn-ghost,.home-background')].some(page=>page.getAnimations().length>0);
/** Surfaces still transparent while the wallpaper stands alone, which will sit behind the text. */
const ARRIVING_SURFACES='.app-shell>.sidebar,.workspace-toolbar-glass,.workspace-header-surface,.home-action,.standee-name,.cast-auto';
function layoutContext(){return JSON.stringify([innerWidth,innerHeight,...[...document.querySelectorAll<HTMLElement>('.app-shell,.file-preview-workspace')].map(node=>[node.className,node.style.getPropertyValue('--sidebar-width'),node.style.getPropertyValue('--file-preview-width')])]);}
/** The wallpapers the page is turning to. During a turn the leaving layer is still on screen; counting it would make
 * a passing context whose (wrong) palette is applied first and then corrected when the turn lands. */
function wallpaperIdentities(){const all=[...document.querySelectorAll<HTMLElement>('.home-background')],targets=all.filter(node=>node.dataset.wallpaperTarget!==undefined);return (targets.length?targets:all).map(node=>node.dataset.contrastBackground);}
function backgroundContext(material:unknown){
 const page=document.querySelector<HTMLElement>('.page-background'),shell=document.querySelector<HTMLElement>('.app-shell'),workspace=document.querySelector<HTMLElement>('.file-preview-workspace');
 const values=(node:HTMLElement|null,names:string[])=>names.map(name=>node?.style.getPropertyValue(name)??'');
 return JSON.stringify({page:document.documentElement.dataset.appearancePage??page?.dataset.backgroundPage??'home',theme:darkTheme()?'dark':'light',glass:document.documentElement.dataset.liquidGlass,material,menu:document.documentElement.style.getPropertyValue('--glass-menu-opacity'),wallpapers:wallpaperIdentities(),sidebar:values(shell,['--sidebar-opacity']),workspace:values(workspace,['--workspace-header-opacity','--workspace-preview-opacity','--workspace-terminal-opacity']),chat:values(page,['--chat-input-opacity','--chat-reply-opacity','--chat-mine-opacity','--chat-input-color','--chat-reply-color','--chat-mine-color'])});
}
/** Contexts that differ only in opacity or material settings show the same wallpaper under the same theme:
 * their colours are the closest available guess for a context seen for the first time. */
function contextFamily(key:string){try{const value=JSON.parse(key);return JSON.stringify([value.page,value.theme,value.glass,value.wallpapers]);}catch{return key;}}
/** First colour for a group before any sample: this context's own record, then the same page elsewhere. */
function rememberedTone(context:string,key:string,loose:string):{tone:ContrastTone;exact:boolean}|undefined{
 const own=pagePalettes.contexts[context]?.tones;
 if(own?.[key])return {tone:own[key],exact:true};
 if(own?.[loose])return {tone:own[loose],exact:false};
 const family=contextFamily(context),relatives=Object.entries(pagePalettes.contexts).filter(([name])=>name!==context&&contextFamily(name)===family).sort((a,b)=>b[1].updatedAt-a[1].updatedAt);
 for(const [,entry] of relatives){const tone=entry.tones[key]??entry.tones[loose];if(tone)return {tone,exact:false};}
}
export function AdaptiveTextAppearance(){
 const {adaptiveText,adaptiveTextDwellSeconds,adaptiveTextHoldSeconds,glass}=useAppearancePreferences(),systemDark=useMediaPreference('(prefers-color-scheme: dark)');
 const reducedTransparency=useMediaPreference('(prefers-reduced-transparency: reduce)'),moreContrast=useMediaPreference('(prefers-contrast: more)');
 useLayoutEffect(()=>{
  if(!adaptiveText||reducedTransparency||moreContrast)return;
  const timing={dwellMs:adaptiveTextDwellSeconds*1000,holdMs:adaptiveTextHoldSeconds*1000};
  document.documentElement.dataset.adaptiveText='true';
  const states=new Map<HTMLElement,GroupState>(),painted=new Map<HTMLElement,Painted>(),canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)return()=>{delete document.documentElement.dataset.adaptiveText;};
  let stopped=false,timer=0,busy=false,dirty=true,urgent=true,last=-TEXT_SAMPLE_INTERVAL_MS,version=0,contextKey=backgroundContext(glass),layoutKey=layoutContext(),retries=0;
  function release(node:HTMLElement,state:Painted){for(const [name,[value,priority]] of state.original)if(value)node.style.setProperty(name,value,priority);else node.style.removeProperty(name);delete node.dataset.adaptiveRegion;delete node.dataset.adaptiveGroup;delete node.dataset.adaptiveTone;}
  function toneColours(node:HTMLElement){const style=getComputedStyle(node);return Object.fromEntries(Object.keys(TONE_VALUES.dark).map(name=>[name,style.getPropertyValue(name)]));}
  const movingWallpaper=()=>!!document.querySelector('.home-background video:not([data-paused]),.home-background iframe');
  /** The last captured frame, for estimating a new group's colour before its own sample. Only valid in the context it was taken in. */
  let lastFrame:{image:HTMLImageElement;context:string}|undefined;
  /** What the group will sit on: the last frame behind it, with the tinted surfaces between it and the wallpaper laid over. */
  function estimateTone(group:TextGroup):ContrastTone|undefined{
   if(!lastFrame||lastFrame.context!==contextKey||movingWallpaper())return;
   const bounds=group.anchor.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
   try{
    const scale=lastFrame.image.naturalWidth/innerWidth,x=Math.max(0,Math.floor(bounds.x*scale)),y=Math.max(0,Math.floor(bounds.y*scale));
    const width=Math.min(lastFrame.image.naturalWidth-x,Math.ceil(bounds.width*scale)),height=Math.min(lastFrame.image.naturalHeight-y,Math.ceil(bounds.height*scale));if(width<2||height<2)return;
    const surface=document.createElement('canvas');surface.width=width;surface.height=height;const draw=surface.getContext('2d',{willReadFrequently:true});if(!draw)return;
    draw.drawImage(lastFrame.image,x,y,width,height,0,0,width,height);
    const layers:string[]=[];for(let node:HTMLElement|null=group.anchor;node&&node!==document.body;node=node.parentElement){const fill=getComputedStyle(node).backgroundColor;if(fill&&!/rgba\(0, 0, 0, 0\)|transparent/.test(fill))layers.unshift(fill);}
    for(const fill of layers){draw.fillStyle=fill;draw.fillRect(0,0,width,height);}
    const pixels=draw.getImageData(0,0,width,height).data,evidence=sampleContrast(pixels,width,height,{width:width/scale,height:height/scale},{x:0,y:0,width:width/scale,height:height/scale});
    return evidence?preferredTone(evidence):undefined;
   }catch{return;}
  }
  /** A group inside an already coloured surface starts in that surface's tone. */
  const inheritedTone=(node:HTMLElement)=>node.parentElement?.closest<HTMLElement>('[data-adaptive-tone]')?.dataset.adaptiveTone as ContrastTone|undefined;
  /** Groups repainted for a new page, with the colours they showed; only the old look is released, not its colour. */
  const handedOver=new Map<HTMLElement,{tone:ContrastTone;colours:Record<string,string>}>();
  function paint(node:HTMLElement,kind:string,tone:ContrastTone){
   let state=painted.get(node);if(state?.tone===tone&&state.kind===kind)return;
   // A group already on screen changes colour gradually, from wherever it is now.
   const held=handedOver.get(node),from=held?.tone===tone?undefined:held?.colours??(state&&state.tone!==tone?toneColours(node):undefined);
   if(!state){state={tone,kind,original:new Map(PROPS.map(name=>[name,[node.style.getPropertyValue(name),node.style.getPropertyPriority(name)]]))};painted.set(node,state);}
   node.getAnimations().find(animation=>animation.id===TONE_ANIMATION)?.cancel();
   for(const [name,value] of Object.entries(TONE_VALUES[tone]))node.style.setProperty(name,value);
   // Sidebar text that is about to unfold is still invisible, so it simply starts in its colour.
   if(from&&document.documentElement.dataset.motion!=='off'&&!(document.documentElement.dataset.sidebarMoving!==undefined&&node.closest('.sidebar')))node.animate([from,TONE_VALUES[tone]],{id:TONE_ANIMATION,duration:TONE_TURN_MS,easing:'ease'});
   state.tone=tone;state.kind=kind;node.dataset.adaptiveRegion='';node.dataset.adaptiveGroup=kind;node.dataset.adaptiveTone=tone;
   node.style.setProperty('--adaptive-ink','var(--adaptive-tone-ink)');node.style.setProperty('--adaptive-accent','var(--adaptive-tone-accent)');
   node.style.setProperty('--adaptive-halo','0 1px 2px var(--adaptive-halo-near),0 0 4px var(--adaptive-halo-far)');
   for(const name of ['--ink','--ink-2','--ink-3','--chat-input-ink','--chat-reply-ink','--chat-mine-ink'])node.style.setProperty(name,'var(--adaptive-ink)');
   node.style.setProperty('--m-ink','color-mix(in srgb,var(--m,var(--adaptive-ink)) 10%,var(--adaptive-ink))');node.style.setProperty('color','var(--adaptive-ink)');
  }
  function queue(fast=false){
   dirty=true;urgent=urgent||fast;if(fast&&timer){clearTimeout(timer);timer=0;}
   if(!timer&&!busy&&!stopped&&!document.hidden&&!startupCoveringPage())timer=window.setTimeout(()=>void sample(),urgent?100:Math.max(100,TEXT_SAMPLE_INTERVAL_MS-(performance.now()-last)));
  }
  function prepareGroups(){
   const groups=collectTextGroups(),activeRoots=new Set(groups.flatMap(g=>g.roots)),activeGroups=new Set(groups.map(g=>g.anchor));
   for(const [node,state] of painted)if(!activeRoots.has(node)){release(node,state);painted.delete(node);}
   for(const node of states.keys())if(!activeGroups.has(node))states.delete(node);
   const cached=pagePalettes.contexts[contextKey]?.tones,now=performance.now();
   paintGroups(groups,cached,now);
   return groups;
  }
  let sidebarPending=false,panelPending=false,panelPainted:HTMLElement|undefined;
  function paintGroups(groups:TextGroup[],cached:Record<string,ContrastTone>|undefined,now:number){
   for(const group of groups){
    const key=textGroupCacheKey(group);let state=states.get(group.anchor);
    if(!state||state.key!==key){
     const loose=textGroupLooseKey(group),remembered=rememberedTone(contextKey,key,loose),rail=SIDEBAR_KINDS.includes(group.kind)?cached?.[SIDEBAR_RAIL]:undefined;
     // Without a record, read what is behind the group in the last frame, then follow the surface it sits on.
     const tone=remembered?.tone??rail??(group.kind==='solid'?currentTone(group.roots[0]):estimateTone(group)??inheritedTone(group.anchor)??(darkTheme()?'light':'dark'));
     const exact=!!remembered?.exact;
     state={key,loose,tone,changedAt:exact?now:now-timing.holdMs,sampled:exact,restored:exact};states.set(group.anchor,state);
    }
    for(const root of group.roots)paint(root,group.kind,state.tone);
   }
  }
  /** Settles the final colours while the wallpaper stands alone, so the interface arrives wearing them.
   * A palette learned on an earlier launch is already painted. Otherwise this is an estimate from the wallpaper
   * and the surfaces' tints; once the interface is in place a real sample confirms it, under the usual dwell and hold. */
  async function prepareEntrance(){
   const pending=prepareGroups().filter(group=>!states.get(group.anchor)?.restored);
   if(!pending.length||stopped)return;
   const read=()=>window.hivelab.invoke<{dataUrl:string}|null>('appearance.contrastFrame');
   let frame=await read();
   if(!frame?.dataUrl){await new Promise(resolve=>setTimeout(resolve,650));frame=await read();}
   if(!frame?.dataUrl||stopped)return;
   const image=new Image();image.src=frame.dataUrl;await image.decode();if(stopped)return;
   canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;context!.drawImage(image,0,0);
   const scale=canvas.width/innerWidth;
   for(const surface of document.querySelectorAll<HTMLElement>(ARRIVING_SURFACES)){
    const r=surface.getBoundingClientRect();if(!r.width||!r.height)continue;
    context!.fillStyle=getComputedStyle(surface).backgroundColor;context!.fillRect(r.x*scale,r.y*scale,r.width*scale,r.height*scale);
   }
   const pixels=context!.getImageData(0,0,canvas.width,canvas.height).data;
   for(const group of pending){
    const state=states.get(group.anchor);if(!state||!group.anchor.isConnected)continue;
    const evidence=groupEvidence(group,pixels,canvas.width,canvas.height,[]);if(!evidence)continue;
    state.tone=preferredTone(evidence,state.tone);state.sampled=true;state.changedAt=performance.now();
    for(const root of group.roots)paint(root,group.kind,state.tone);
   }
  }
  const wallpaperLoading=()=>[...document.querySelectorAll<HTMLImageElement|HTMLVideoElement|HTMLIFrameElement>('.home-background img,.home-background video,.home-background iframe')].some(node=>node instanceof HTMLImageElement?!node.complete:node instanceof HTMLVideoElement?node.readyState<2:node.dataset.wallpaperState!=='ready');
  function invalidate(force=false){
   version++;retries=0;states.clear();for(const [node,state] of painted){handedOver.set(node,{tone:state.tone,colours:toneColours(node)});release(node,state);}painted.clear();const groups=prepareGroups();handedOver.clear();
   if(force)for(const state of states.values()){state.restored=false;state.sampled=false;}
   if(force||groups.some(group=>!states.get(group.anchor)?.restored)||movingWallpaper())queue(true);
   else{clearTimeout(timer);timer=0;dirty=false;urgent=false;}
  }
  async function sample(){
   timer=0;if(stopped||document.hidden||busy||startupCoveringPage()||wallpaperLoading()||pageTurning())return;
   const dynamic=movingWallpaper(),reuseHomePalette=!dynamic&&JSON.parse(contextKey).page==='home';
   const groups=prepareGroups().filter(group=>!reuseHomePalette||!states.get(group.anchor)?.restored);
   const rail=document.querySelector<HTMLElement>('.app-shell.sidebar-icons>.sidebar'),readRail=!!rail&&!pagePalettes.contexts[contextKey]?.tones[SIDEBAR_RAIL];
   if(!groups.length&&!readRail)return;
   busy=true;dirty=false;urgent=false;last=performance.now();const ticket=version;
   try{
    const frame=await window.hivelab.invoke<{dataUrl:string}|null>('appearance.contrastFrame');if(stopped||document.hidden||startupCoveringPage())return;
    // capturePage is rate-limited in main. Retry a fast navigation refresh
    // instead of losing the only request on an otherwise static wallpaper.
    if(!frame?.dataUrl){if(retries++<3){urgent=true;dirty=true;timer=window.setTimeout(()=>void sample(),650);}return;}retries=0;
    const image=new Image();image.src=frame.dataUrl;await image.decode();if(stopped||document.hidden||startupCoveringPage())return;
    if(ticket!==version){queue(true);return;}
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;context!.drawImage(image,0,0);const pixels=context!.getImageData(0,0,canvas.width,canvas.height).data;
    lastFrame={image,context:contextKey};
    const overlays=[...document.querySelectorAll<HTMLElement>('.room-top,.room-composer,.modal-overlay,.context-menu')].filter(n=>n.getClientRects().length);
    const learned:Record<string,ContrastTone>={};
    if(readRail&&rail){const r=rail.getBoundingClientRect(),evidence=sampleContrast(pixels,canvas.width,canvas.height,{width:innerWidth,height:innerHeight},{x:r.x,y:r.y,width:r.width,height:r.height});if(evidence)learned[SIDEBAR_RAIL]=preferredTone(evidence);}
    for(const group of groups){
     if(!group.anchor.isConnected)continue;
     const evidence=groupEvidence(group,pixels,canvas.width,canvas.height,overlays);if(!evidence)continue;
     const state=states.get(group.anchor);if(!state||state.key!==textGroupCacheKey(group))continue;
     // Start with the theme's ink and immediately repair an unreadable surface.
     // Ordinary moving wallpaper still respects the user's dwell and hold times.
     if(!state.sampled){state.tone=preferredTone(evidence,state.tone);state.sampled=true;state.changedAt=performance.now();}else advanceTextTone(evidence,state,performance.now(),timing);
     for(const root of group.roots)paint(root,group.kind,state.tone);if(state.candidate)dirty=true;
     learned[state.key]=state.tone;learned[state.loose]=state.tone;
     state.restored=true;
    }
    if(Object.keys(learned).length)rememberColors(contextKey,learned);
   }catch{/* Existing colours remain usable if the compositor is unavailable. */}
   finally{busy=false;if(!stopped&&(dirty||movingWallpaper()))queue();}
  }
  const changes=new MutationObserver(records=>{
   // Colours are final before the entrance; nothing is judged while the interface moves.
   if(startupEntering())return;
   // Gathering every text group lays the whole page out, which would hold up a panel's first frame. The panel itself
   // gets its colours now, and the rest of the page waits until it has landed.
   if(document.documentElement.dataset.sidebarMoving!==undefined){
    if(!sidebarPending){const sidebar=document.querySelector<HTMLElement>('.sidebar');if(sidebar)paintGroups(collectTextGroups(sidebar),pagePalettes.contexts[contextKey]?.tones,performance.now());}
    sidebarPending=true;return;
   }
   if(document.documentElement.dataset.panelMoving!==undefined){
    panelPending=true;
    const panel=document.querySelector<HTMLElement>('[data-drawer-moving]');
    if(panel&&panel!==panelPainted){panelPainted=panel;paintGroups(collectTextGroups(panel),pagePalettes.contexts[contextKey]?.tones,performance.now());}
    return;
   }
   const key=backgroundContext(glass);if(key!==contextKey){contextKey=key;invalidate();return;}
   const layout=layoutContext();if(layout!==layoutKey){layoutKey=layout;invalidate(true);return;}
   if(records.some(record=>record.type==='childList'&&[...record.addedNodes,...record.removedNodes].some(node=>!(node instanceof SVGElement))||record.attributeName==='class'||record.attributeName==='hidden')){const groups=prepareGroups();if(groups.some(group=>!states.get(group.anchor)?.restored)||movingWallpaper())queue();}
  });changes.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','style','data-theme','data-liquid-glass','data-background-page','data-contrast-background','data-wallpaper-target','data-appearance-page']});
  const visibility=()=>{if(document.hidden){clearTimeout(timer);timer=0;}else queue();};
  const synchronize=()=>{if(startupEntering())return;const key=backgroundContext(glass);if(key!==contextKey){contextKey=key;invalidate();}else prepareGroups();};syncActivePalette=synchronize;
  const refresh=()=>{if(startupEntering())return;const key=backgroundContext(glass);if(key!==contextKey){contextKey=key;invalidate();}else queue();},mediaReady=(event:Event)=>{if(event.target instanceof Element&&event.target.closest('#hivelab-startup'))return;refresh();};
  const landed=()=>{
   panelPainted=undefined;
   if(sidebarPending){sidebarPending=false;layoutKey=layoutContext();const key=backgroundContext(glass);if(key!==contextKey){contextKey=key;invalidate();return;}prepareGroups();for(const state of states.values()){state.restored=false;state.sampled=false;}queue(true);return;}
   if(panelPending){panelPending=false;const key=backgroundContext(glass);if(key!==contextKey){contextKey=key;invalidate();return;}const layout=layoutContext();if(layout!==layoutKey){layoutKey=layout;invalidate(true);return;}}
   refresh();
  };
  const pageTurned=(event:Event)=>{if(event.target instanceof Element&&event.target.matches('.sidebar-page'))refresh();};
  const wallpaperReady=(event:MessageEvent)=>{if(event.data?.type==='hivelab-wallpaper'&&event.data.state==='ready'&&[...document.querySelectorAll<HTMLIFrameElement>('.home-background iframe')].some(frame=>frame.contentWindow===event.source))refresh();};
  document.addEventListener('scroll',refresh,true);document.addEventListener('transitionend',pageTurned);window.addEventListener('hivelab:page-turned',landed);document.addEventListener('visibilitychange',visibility);document.addEventListener('load',mediaReady,true);document.addEventListener('loadeddata',mediaReady,true);window.addEventListener('message',wallpaperReady);window.addEventListener('resize',refresh);window.addEventListener('focus',refresh);invalidate();
  const startup=window.hivelabStartup;if(startup)startup.beforeEntrance=prepareEntrance;
  return()=>{stopped=true;if(startup?.beforeEntrance===prepareEntrance)delete startup.beforeEntrance;if(syncActivePalette===synchronize)syncActivePalette=undefined;clearTimeout(timer);changes.disconnect();document.removeEventListener('scroll',refresh,true);document.removeEventListener('transitionend',pageTurned);window.removeEventListener('hivelab:page-turned',landed);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('load',mediaReady,true);document.removeEventListener('loadeddata',mediaReady,true);window.removeEventListener('message',wallpaperReady);window.removeEventListener('resize',refresh);window.removeEventListener('focus',refresh);for(const [node,state] of painted)release(node,state);delete document.documentElement.dataset.adaptiveText;};
 },[adaptiveText,adaptiveTextDwellSeconds,adaptiveTextHoldSeconds,glass,systemDark,reducedTransparency,moreContrast]);
 return null;
}

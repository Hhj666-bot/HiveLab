import {t as tr} from './i18n';
import {foldedSidebarLayout,readStartupPreferences,readStartupScene,STARTUP_ART_LIMIT_MS,STARTUP_CHANGED,STARTUP_COLOURS_LIMIT_MS,STARTUP_ENTRANCE,STARTUP_ENTRANCE_MS,entranceOffset,STARTUP_QUIET_MS,STARTUP_REST_LIMIT_MS,STARTUP_REST_MS,STARTUP_STAGE_MS,startupAction,startupCanPress,startupMediaUrl,startupReducedMotion,startupSceneImage,startupTheme,startupTiming} from '../shared/startup-animation';
import {routinePeriod} from '../shared/life';
import {MOTION_PREFERENCE_KEY,motionLevel,parseMotionPreference,REDUCED_MOTION_QUERY} from '../shared/motion';
import {createLogoCanvas,logoSize,PRESS_HOLD_MS,PRESS_MS,TUNNEL_MS,worldScale,type LogoCanvas} from './startup-logo';
import {createGlTunnel,type GlTunnel} from './startup-tunnel-gl';

// This small, separate bundle runs before React and its appearance cache load.
// Writing here means the sidebar never paints expanded first; expanding it lasts until the next launch.
try{localStorage.setItem('hivelab.sidebar.layout',foldedSidebarLayout(localStorage.getItem('hivelab.sidebar.layout')??localStorage.getItem('hivelab.sidebar.chat')??localStorage.getItem('hivelab.sidebar.home')));}catch{}
// CSS needs the motion level before the first frame; React takes over once it mounts.
let motionChoice:string|null=null;try{motionChoice=localStorage.getItem(MOTION_PREFERENCE_KEY);}catch{}
document.documentElement.dataset.motion=motionLevel(parseMotionPreference(motionChoice),matchMedia(REDUCED_MOTION_QUERY).matches);
const overlay=document.getElementById('hivelab-startup');
if(overlay){
  const video=overlay.querySelector('video')!,status=overlay.querySelector<HTMLElement>('[data-startup-status]')!,skip=overlay.querySelector<HTMLButtonElement>('[data-startup-skip]')!,sound=overlay.querySelector<HTMLButtonElement>('[data-startup-sound]')!,reload=overlay.querySelector<HTMLButtonElement>('[data-startup-reload]')!,root=document.getElementById('root')!;
  const canvas=overlay.querySelector<HTMLCanvasElement>('.startup-logo')!,glCanvas=overlay.querySelector<HTMLCanvasElement>('.startup-tunnel')!,scene=overlay.querySelector<HTMLElement>('.startup-scene')!,sceneImage=scene.querySelector('img')!;
  let preferences=readStartupPreferences(),ready=false,skipped=false,failed=false,preview=false,active=true,closing=false,frame=0,timeout:ReturnType<typeof setTimeout>,previousFocus:HTMLElement|null=null;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const handoff=document.createElement('img');handoff.className='startup-handoff-frame';handoff.alt='';handoff.setAttribute('aria-hidden','true');overlay.append(handoff);
  let screenshotReady=false,custom=false,mediaTicket=0,logo:LogoCanvas|undefined,tunnel:GlTunnel|undefined,sceneReady=false,rest=0,press=0,travel:number|undefined,opened=false,holding=0,quiet=0,last=0,appSince=0,leaving=0;
  const reduceMotion=()=>startupReducedMotion(preferences,reduced.matches,preview);
  const timing=()=>startupTiming(video.duration);
  const footer=overlay.querySelector<HTMLElement>('.startup-footer')!;
  function fitVideo(){
    const t=timing();
    video.style.transform='none';
    const ending=(preview||ready)&&video.currentTime>=t.fillStart&&!skipped&&!failed;
    overlay!.classList.toggle('startup-cinematic-end',ending);footer.inert=ending;
  }
  const systemDark=matchMedia('(prefers-color-scheme: dark)');
  function theme(){let choice:string|null=document.documentElement.dataset.theme??null;if(!choice)try{choice=localStorage.getItem('hivelab.theme');}catch{}return startupTheme(choice,systemDark.matches);}
  function playVideo(){
    const source=video.src;
    void video.play().catch(error=>{if(source===video.src&&active&&!closing&&!skipped&&error?.name!=='AbortError')fallBack();});
  }
  function applyMotion(){overlay!.dataset.reducedMotion=String(reduceMotion());}
  function applySound(){video.muted=!preferences.sound;video.volume=preferences.volume/100;sound.textContent=video.muted?tr("开启声音"):tr("静音");sound.setAttribute('aria-pressed',String(!video.muted));}
  function showLoading(message=tr("正在准备工作室…")){overlay!.dataset.mode='loading';overlay!.classList.remove('startup-revealing');video.pause();status.textContent=message;}
  /** The wallpaper must be painted before the window opens onto it. */
  function wallpaperSettled(){
    return [...root.querySelectorAll<HTMLImageElement|HTMLVideoElement|HTMLIFrameElement>('.home-background img,.home-background video,.home-background iframe')].every(node=>node instanceof HTMLImageElement?node.complete:node instanceof HTMLVideoElement?node.readyState>=2||!!node.error:node.dataset.wallpaperState==='ready');
  }
  function appReady(now:number){
    if(!preview&&!ready){appSince=0;return false;}
    if(preview||wallpaperSettled())return true;
    if(!appSince)appSince=now;
    return now-appSince>3000;
  }
  function loadScene(ticket:number){
    const saved=readStartupScene(),url=startupSceneImage(saved,routinePeriod(new Date().getHours()));
    sceneReady=false;scene.hidden=true;sceneImage.removeAttribute('src');
    if(!saved||!url&&!saved.plain)return;
    scene.style.setProperty('--startup-dim',String(saved.dim));scene.style.setProperty('--startup-blur',saved.blur+'px');scene.style.setProperty('--startup-fit',saved.fit);
    if(!url){sceneReady=true;return;}
    sceneImage.src=url;void sceneImage.decode().then(()=>{if(ticket===mediaTicket)sceneReady=true;}).catch(()=>{});
  }
  /** Rendering the first snapshot stalls this thread; the press waits it out, within limits, so the opening starts smoothly. */
  function settled(raw:number){
    quiet=raw<40?quiet+raw:0;
    return rest>=STARTUP_REST_MS&&((preview||ready)&&quiet>=STARTUP_QUIET_MS||rest>=STARTUP_REST_LIMIT_MS);
  }
  /** The world beyond the window starts far away; a scene frame and the live wallpaper move the same way. */
  function setWorld(scale:number|undefined){
    const value=scale===undefined?'':String(scale);
    scene.style.scale=value;
    for(const node of root.querySelectorAll<HTMLElement>('.home-background'))node.style.scale=value;
  }
  function openTunnel(){
    logo!.draw(1,undefined);
    tunnel=createGlTunnel(glCanvas,()=>logo!.layers(),overlay!.dataset.theme as 'light'|'dark',()=>logoSize(glCanvas.clientWidth,glCanvas.clientHeight,Math.min(2,window.devicePixelRatio||1)))??undefined;
    overlay!.dataset.renderer=tunnel?'webgl':'canvas';
    setWorld(worldScale(0));
    if(tunnel){tunnel.draw(0);logo!.clear();}
  }
  function dropCanvases(){try{logo?.clear();tunnel?.dispose();}catch{}logo=undefined;tunnel=undefined;}
  function drawOpening(dt:number,raw:number){
    if(!logo)return false;
    const now=performance.now();
    if(travel===undefined&&!press){
      rest+=dt;
      if(startupCanPress({rested:settled(raw),sceneReady,appReady:appReady(now)})){press=dt/PRESS_MS;scene.hidden=!sceneReady;}
      else if(rest>1500&&overlay!.dataset.waiting!=='true')overlay!.dataset.waiting='true';
    }else if(travel===undefined){
      press+=dt/PRESS_MS;
      if(press>=1+PRESS_HOLD_MS/PRESS_MS){travel=0;openTunnel();overlay!.classList.add('startup-revealing');delete overlay!.dataset.waiting;}
    }else if(!opened)travel+=dt;
    if(opened){holding+=dt;if(holding>1500)overlay!.dataset.waiting='true';return true;}
    opened=tunnel?tunnel.draw(travel!):logo.draw(Math.min(1,press*press*(3-2*Math.min(1,press))),travel);
    if(travel!==undefined)setWorld(worldScale(travel/TUNNEL_MS));
    return opened;
  }
  /** Everything of the interface waits outside the page until the wallpaper has stood alone. */
  function stage(on:boolean){root.classList.toggle('startup-stage',on);document.body.classList.toggle('startup-previewing',on&&preview);}
  /** Driven frame by frame like the tunnel: on a normal launch a CSS transition here was not shown on screen
   * until it had nearly finished. A slow frame also resumes where it stopped, so nothing can jump ahead. */
  function enter(){
    if(reduceMotion()){stage(false);return;}
    root.classList.add('startup-entering');stage(false);
    let elapsed=0,previous=0,finished=false;
    const finish=()=>{
      if(finished)return;finished=true;clearTimeout(leaving);
      for(const part of STARTUP_ENTRANCE)root.style.removeProperty(part.name);
      root.classList.remove('startup-entering');
    };
    const step=(now:number)=>{
      if(finished)return;
      elapsed+=previous?Math.min(48,now-previous):0;previous=now;
      for(const part of STARTUP_ENTRANCE)root.style.setProperty(part.name,entranceOffset(elapsed,part.delay,part.duration).toFixed(4));
      if(elapsed>=STARTUP_ENTRANCE_MS)finish();else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // Frames stop in a hidden window; the interface must still end up in place.
    leaving=window.setTimeout(finish,STARTUP_ENTRANCE_MS*3);
  }
  /** Large images left to decode on the way in show as gaps, so every image is ready before anything moves. */
  async function settleImages(){
    const deadline=performance.now()+STARTUP_ART_LIMIT_MS;
    while(root.querySelector('[data-art-pending]')&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,40));
    await Promise.allSettled([...root.querySelectorAll<HTMLImageElement>('img')].map(image=>image.decode()));
  }
  function close(){
    setWorld(undefined);overlay!.hidden=true;overlay!.classList.remove('startup-leaving','startup-revealing');delete overlay!.dataset.waiting;scene.hidden=true;dropCanvases();root.inert=false;active=false;closing=false;
    const ticket=mediaTicket,settled=()=>{preview=false;previousFocus?.focus();};
    if(failed||reduceMotion()||!root.classList.contains('startup-stage')){stage(false);settled();return;}
    // The wallpaper is alone from here, which is when its colours can be read for the interface about to arrive.
    const colours=Promise.race([(async()=>{await window.hivelabStartup?.beforeEntrance?.();})().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,STARTUP_COLOURS_LIMIT_MS))]);
    const held=new Promise(resolve=>{leaving=window.setTimeout(resolve,STARTUP_STAGE_MS);});
    const images=Promise.race([settleImages(),new Promise(resolve=>setTimeout(resolve,STARTUP_ART_LIMIT_MS+400))]);
    void Promise.all([colours,images,held]).finally(()=>{if(ticket!==mediaTicket)return;enter();settled();});
  }
  function dismiss(){
    if(!active||closing)return;
    closing=true;clearTimeout(timeout);cancelAnimationFrame(frame);video.pause();
    const matching=custom&&screenshotReady&&!skipped&&!failed&&!reduceMotion();
    if(failed||matching)stage(false);
    if(opened&&!sceneReady){close();return;}
    const finish=()=>{overlay!.classList.add('startup-leaving');setTimeout(close,reduceMotion()?0:opened?260:700);};
    if(matching){overlay!.classList.add('startup-matching-home');setTimeout(finish,650);}else finish();
  }
  function tick(now:number){
    if(!active||closing)return;
    // Frames stop while the window is hidden; the animation resumes where it was instead of jumping ahead.
    const raw=last?now-last:16,dt=Math.min(48,raw);last=now;
    if(failed){dismiss();return;}
    if(overlay!.dataset.mode==='tunnel'){
      if(drawOpening(dt,raw)&&appReady(performance.now())){dismiss();return;}
    }else if(overlay!.dataset.mode==='video'){
      fitVideo();
      const action=startupAction({ready:preview||ready,skipped,failed,enabled:preview||preferences.enabled,playback:preview?'full':preferences.playback,time:video.currentTime,duration:video.duration});
      if(action==='finish'){dismiss();return;}
      if(action==='wait'){video.pause();if(video.currentTime>timing().hold+.04)video.currentTime=timing().hold;status.textContent=tr("正在加载工作室，准备好后继续…");}
      else if(video.paused&&!failed&&!skipped)playVideo();
    }else if((preview||ready)&&appReady(performance.now())){dismiss();return;}
    frame=requestAnimationFrame(tick);
  }
  function startOpening(){
    overlay!.dataset.mode='tunnel';overlay!.dataset.source='builtin';custom=false;video.pause();video.removeAttribute('src');video.removeAttribute('poster');video.style.transform='';video.load();
    loadScene(mediaTicket);logo=createLogoCanvas(canvas,overlay!.dataset.theme as 'light'|'dark');logo.draw(0,undefined);
  }
  function startFilm(){
    overlay!.dataset.mode='video';
    video.removeAttribute('poster');
    video.src=startupMediaUrl(preferences.customVideo!);video.currentTime=0;
    fitVideo();playVideo();
  }
  /** An unplayable upload falls back to the tunnel. */
  function fallBack(){
    if(!preferences.enabled&&!preview){showLoading();return;}
    startOpening();
  }
  function begin(isPreview=false){
    clearTimeout(timeout);clearTimeout(leaving);cancelAnimationFrame(frame);previousFocus=isPreview?document.activeElement as HTMLElement:null;
    preferences=readStartupPreferences();preview=isPreview;skipped=false;failed=false;active=true;closing=false;custom=Boolean(preferences.customVideo);rest=0;press=0;travel=undefined;opened=false;holding=0;quiet=0;last=0;appSince=0;
    const ticket=++mediaTicket;screenshotReady=false;handoff.removeAttribute('src');
    if(custom&&preferences.homeScreenshot){handoff.src=startupMediaUrl(preferences.homeScreenshot);void handoff.decode().then(()=>{if(ticket===mediaTicket)screenshotReady=true;}).catch(()=>{});}
    overlay!.dataset.source=custom?'custom':'builtin';overlay!.dataset.theme=theme();delete overlay!.dataset.waiting;
    root.classList.remove('startup-entering');stage(!reduceMotion());
    overlay!.hidden=false;overlay!.classList.remove('startup-leaving','startup-matching-home','startup-revealing','startup-cinematic-end');footer.inert=false;root.inert=true;reload.hidden=true;skip.disabled=false;
    status.textContent=tr("正在准备工作室…");skip.textContent=isPreview?tr("结束预览 · Esc"):tr("跳过动画 · Esc");applyMotion();applySound();
    if((isPreview||preferences.enabled)&&!reduceMotion()){
      if(custom)startFilm();
      else startOpening();
    }else{skipped=true;showLoading();video.pause();video.removeAttribute('src');video.load();}
    timeout=setTimeout(()=>{if(active&&!closing){skipped=true;showLoading(tr("加载时间较长，可以重新加载窗口。"));reload.hidden=false;}},60_000);
    frame=requestAnimationFrame(tick);
  }
  function skipAnimation(){
    if(!active||closing||opened&&sceneReady&&!preview&&!ready)return;skipped=true;
    if(appReady(performance.now()))dismiss();
    else{overlay!.classList.remove('startup-revealing');dropCanvases();scene.hidden=true;showLoading(tr("正在加载工作室，准备好后自动进入…"));skip.disabled=true;skip.textContent=tr("正在加载…");}
  }
  video.addEventListener('error',()=>{if(!active||closing||!video.getAttribute('src'))return;fallBack();});
  video.addEventListener('ended',()=>{if(preview||ready)dismiss();else{video.pause();status.textContent=tr("正在加载工作室，准备好后自动进入…");}});
  video.addEventListener('loadedmetadata',()=>{fitVideo();if(custom&&Number.isFinite(video.duration)){clearTimeout(timeout);timeout=setTimeout(()=>{if(active&&!closing){skipped=true;showLoading(tr("加载时间较长，可以重新加载窗口。"));reload.hidden=false;}},Math.max(60000,(video.duration+30)*1000));}});
  new ResizeObserver(()=>{if(overlay!.dataset.mode==='video')fitVideo();if(logo&&active&&!closing){logo.resize();if(tunnel){logo.draw(1,undefined);tunnel.resize();logo.clear();}else logo.draw(Math.min(1,press),travel);}}).observe(overlay);
  skip.addEventListener('click',skipAnimation);
  sound.addEventListener('click',()=>{preferences={...preferences,sound:video.muted};applySound();});
  reload.addEventListener('click',()=>location.reload());
  window.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if(active){event.preventDefault();event.stopImmediatePropagation();skipAnimation();}
  },true);
  window.addEventListener(STARTUP_CHANGED,()=>{preferences=readStartupPreferences();applyMotion();applySound();});
  reduced.addEventListener('change',()=>{applyMotion();if(active&&reduceMotion()){skipped=true;dropCanvases();showLoading();}});
  window.hivelabStartup={ready(){ready=true;},fail(){ready=true;failed=true;},preview(){if(!active){begin(true);skip.focus();}}};
  begin();
}

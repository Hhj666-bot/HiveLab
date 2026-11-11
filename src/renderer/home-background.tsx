import {afterPageReady} from './app/page-readiness';
import {t} from './i18n';
import {useContext,useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type CSSProperties,type ReactNode} from 'react';
import {flushSync} from 'react-dom';
import {EASING,FADE_MS,pageStep,TURN_MS,WALLPAPER_TURN} from './app/page-turn';
import {useMotionLevel} from './motion/use-motion-level';
import {WorkspaceToolbar} from './workspace-toolbar';
import type {Notify} from './ui';
import {Image,ImagePlus,Film,FolderOpen,Pause,Play,RotateCcw} from 'lucide-react';
import {DEFAULT_BACKGROUND,defaultBackground,normalizeBackground,type BackgroundPreferences,type BackgroundMedia} from '../shared/background';
import {Modal} from './modals';
import {useExtensionFeature} from './extensions';
import {routinePeriod} from '../shared/life';
import {ChatAppearanceButton,useChatAppearance} from './chat-appearance';
import {chatColorMode} from '../shared/chat-appearance';
import {requestAppearance,useAppearancePreferences} from './appearance-preferences';
import morning from './assets/rooms/morning.webp';
import afternoon from './assets/rooms/afternoon.webp';
import evening from './assets/rooms/evening.webp';
import night from './assets/rooms/night.webp';

type PageState={preferences:BackgroundPreferences;busy:boolean;error:string;loaded:boolean;fetched?:boolean;ticket:number};
const pages=new Map<string,PageState>();
const OPACITY_KEYS=['headerTransparency','previewTransparency','terminalTransparency','welcomeCardTransparency'] as const;
type OpacityKey=typeof OPACITY_KEYS[number];
const OPACITY_DEFAULT=DEFAULT_BACKGROUND as Record<OpacityKey,number>;
const OPACITY_ALL_KEY='hivelab.background.apply-all.';
function readOpacityFlags(){const out={headerTransparency:true,previewTransparency:true,terminalTransparency:true,welcomeCardTransparency:true} as Record<OpacityKey,boolean>;try{for(const key of OPACITY_KEYS)out[key]=localStorage.getItem(OPACITY_ALL_KEY+key)!=='0';}catch{}return out;}
function state(page:string){let value=pages.get(page);if(!value){value={preferences:defaultBackground(page),busy:false,error:'',loaded:false,ticket:0};pages.set(page,value);}return value;}
const listeners=new Set<()=>void>(),emit=()=>listeners.forEach(listener=>listener());
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
async function load(page:string){
  const old=state(page);if(old.loaded)return;pages.set(page,{...old,loaded:true});
  try{const result=await window.hivelab.invoke('background.get',{page});if(state(page).ticket===old.ticket)pages.set(page,{...state(page),preferences:normalizeBackground(result),error:'',fetched:true});}
  catch(error){if(state(page).ticket===old.ticket)pages.set(page,{...state(page),error:String((error as Error).message),loaded:false,fetched:true});}emit();
}
async function change(page:string,method:string,params?:Partial<BackgroundPreferences>){
  const old=state(page),id=old.ticket+1;
  pages.set(page,{...old,ticket:id,preferences:method==='background.save'?normalizeBackground({...old.preferences,...params}):old.preferences,busy:true,error:''});emit();
  try{const result=await window.hivelab.invoke(method,{...params,page});if(id===state(page).ticket)pages.set(page,{...state(page),preferences:result?normalizeBackground(result):old.preferences,busy:false,error:''});}
  catch(error){
    // Read back the committed state: another slider change may have succeeded in the meantime.
    let preferences=old.preferences;try{preferences=normalizeBackground(await window.hivelab.invoke('background.get',{page}));}catch{}
    if(id===state(page).ticket)pages.set(page,{...state(page),preferences,busy:false,error:String((error as Error).message)});
  }
  finally{emit();}
}
/** Match the saved home palette to its real background before React's first paint. */
export function warmHomeBackground(){return load('home');}
const warmed=new Map<string,HTMLImageElement>();
/** A page's picture turns in together with the page only if it is already at hand on the first visit. */
export async function warmPageBackground(page:string){
  await load(page);const p=state(page).preferences;
  const previous=warmed.get(page),url=p.mode==='media'&&p.media?.kind==='image'?backgroundUrl(p.media.file):undefined;
  warmed.delete(page);
  if(previous&&previous.src!==url)previous.removeAttribute('src');
  if(!url)return;
  if(previous?.src===url){warmed.set(page,previous);return;}
  const image=document.createElement('img');image.src=url;warmed.set(page,image);void image.decode().catch(()=>{});
}
export function useHomeBackground(page='home'){
  const current=useSyncExternalStore(subscribe,()=>state(page));useEffect(()=>{void load(page);},[page]);
  return {...current,save:(patch:Partial<BackgroundPreferences>)=>change(page,'background.save',patch),importFile:()=>change(page,'background.import'),importWallpaper:()=>change(page,'background.wallpaper')};
}
export const backgroundUrl=(file:string)=>`hivelab-background://local/${encodeURIComponent(file)}`;
const ROOMS={morning,afternoon,evening,night};
function WallpaperFrame({media,paused,fit,respectReducedMotion,onError,onReady}:{media:BackgroundMedia;paused:boolean;fit:'cover'|'contain';respectReducedMotion:boolean;onError:()=>void;onReady:()=>void}){
  const frame=useRef<HTMLIFrameElement>(null),[ready,setReady]=useState(false);
  const sync=()=>frame.current?.contentWindow?.postMessage({type:'hivelab-wallpaper-control',id:media.file,paused,fit,respectReducedMotion},'*');
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{if(event.source!==frame.current?.contentWindow||event.data?.type!=='hivelab-wallpaper'||event.data.id!==media.file)return;if(event.data.state==='error')onError();else if(event.data.state==='ready'){setReady(true);sync();onReady();}};
    window.addEventListener('message',receive);sync();return()=>window.removeEventListener('message',receive);
  },[media.file,paused,fit,respectReducedMotion,onError]);
  return <iframe ref={frame} title={t("动态壁纸")} sandbox="allow-scripts" allow="autoplay" tabIndex={-1} data-wallpaper-state={ready?'ready':'loading'} src={`hivelab-wallpaper://player/index.html?source=${encodeURIComponent(media.file)}`} onLoad={sync}/>;
}
/** How long a new picture may keep the old one waiting before it turns in regardless. */
const ARRIVAL_PATIENCE=1500;
type WallpaperLayerState={id:number;look:string;preferences:BackgroundPreferences;slot:number;ready:boolean;kept?:boolean};
const wallpaperLook=(p:BackgroundPreferences)=>JSON.stringify([p.mode,p.media?.file]);
/** A moving wallpaper takes a while to start again, so the last one left behind waits, paused and out of sight. */
const lively=(p:BackgroundPreferences)=>p.mode==='media'&&['scene','web','video'].includes(p.media?.kind??'');
/** The bottom layer of the window. SidebarLayout mounts the only one; see docs/ui-layers.md.
 *  A page with another picture lies on the same strip as the page and turns in with it once it can be shown.
 *  Turning back returns to the picture that is still there. */
export function HomeBackground({preferences,settled=true,direction=1,onError}:{preferences:BackgroundPreferences;settled?:boolean;direction?:number;onError?:Notify}){
  const motion=useMotionLevel(),look=wallpaperLook(preferences);
  const [layers,setLayers]=useState<WallpaperLayerState[]>([{id:0,look,preferences,slot:0,ready:true}]),[targetId,setTargetId]=useState(0);
  const nodes=useRef(new Map<number,HTMLElement>()),running=useRef<Animation[]>([]);
  const target=layers.find(layer=>layer.id===targetId)??layers.at(-1)!;
  // Until a page's own preferences are read, the defaults say nothing about its picture.
  if(settled&&target.look!==look){
    const id=Math.max(...layers.map(layer=>layer.id))+1,back=motion==='full'?layers.find(layer=>!layer.kept&&layer.look===look&&layer.slot===target.slot+direction):undefined,kept=layers.find(layer=>layer.kept&&layer.look===look);
    if(motion==='off')setLayers([kept?{...kept,kept:false,slot:0}:{id,look,preferences,slot:0,ready:true}]);
    // The one left waiting is already running, so it turns in at once.
    else if(kept)setLayers(layers.map(layer=>layer===kept?{...layer,kept:false,slot:target.slot+direction}:layer));
    else if(!back)setLayers([...layers,{id,look,preferences,slot:target.slot+direction,ready:false}]);
    setTargetId(kept?.id??back?.id??id);
  }
  useLayoutEffect(()=>{
    if(!target.ready||layers.length<2)return;
    return afterPageReady(()=>{
    // The others leave the screen before the turn lets go of them: a layer kept for later may lie above the new one.
    const settle=()=>{
      flushSync(()=>setLayers(current=>{const keep=current.filter(layer=>layer.id!==target.id&&lively(layer.preferences)&&layer.ready).at(-1);return current.flatMap<WallpaperLayerState>(layer=>layer.id===target.id?[{...layer,slot:0,kept:false}]:layer===keep?[{...layer,kept:true}]:[]);}));
      for(const animation of running.current)animation.cancel();running.current=[];
      window.dispatchEvent(new Event('hivelab:page-turned'));
    };
    const shown=layers.filter(layer=>layer.ready&&!layer.kept);
    if(document.hidden){settle();window.dispatchEvent(new Event(WALLPAPER_TURN));return;}
    const node=nodes.current.get(target.id)!;
    if(motion!=='full'){node.animate([{opacity:0},{opacity:1}],{duration:FADE_MS,easing:'ease',fill:'both'}).onfinish=settle;window.dispatchEvent(new Event(WALLPAPER_TURN));return;}
    const step=pageStep(),probe=shown.find(layer=>nodes.current.get(layer.id)?.getAnimations().length);
    const from=probe?probe.slot*step-new DOMMatrixReadOnly(getComputedStyle(nodes.current.get(probe.id)!).transform).m42:0,to=target.slot*step;
    for(const animation of running.current)animation.cancel();
    running.current=shown.map(layer=>nodes.current.get(layer.id)!.animate([{transform:`translateY(${layer.slot*step-from}px)`},{transform:`translateY(${layer.slot*step-to}px)`}],{duration:TURN_MS,easing:EASING,fill:'both'}));
    running.current[shown.indexOf(target)].onfinish=settle;
    window.dispatchEvent(new Event(WALLPAPER_TURN));
    });
  },[target.id,target.ready]);
  return <>{layers.map(layer=><WallpaperLayer key={layer.id} preferences={layer===target&&target.look===look?preferences:layer.preferences} target={layer===target} waiting={!layer.ready} kept={!!layer.kept} onError={onError} onReady={()=>setLayers(current=>current.map(item=>item.id===layer.id?{...item,ready:true}:item))} register={node=>{if(node)nodes.current.set(layer.id,node);else nodes.current.delete(layer.id);}}/>)}</>;
}
function WallpaperLayer({preferences:p,target,waiting,kept,onReady,register,onError}:{preferences:BackgroundPreferences;target:boolean;waiting:boolean;kept:boolean;onReady:()=>void;register:(node:HTMLDivElement|null)=>void;onError?:Notify}){
  const motion=useMotionLevel(),stillMotion=p.respectReducedMotion!==false&&motion!=='full';
  const paused=p.paused||stillMotion||kept;
  const enabled=useExtensionFeature('backgrounds');
  const [period,setPeriod]=useState(()=>routinePeriod(new Date().getHours())),[visible,setVisible]=useState(!document.hidden),[error,setError]=useState(false);
  const video=useRef<HTMLVideoElement>(null),media=p.mode==='media'?p.media:undefined;
  const picture=useRef<HTMLImageElement>(null);
  const reported=useRef(false);
  useLayoutEffect(()=>{if(waiting&&picture.current?.complete)onReady();},[waiting]);
  useEffect(()=>{if(!waiting)return;if(p.mode==='plain')onReady();const timer=setTimeout(onReady,ARRIVAL_PATIENCE);return()=>clearTimeout(timer);},[waiting]);
  useEffect(()=>{const timer=setInterval(()=>setPeriod(routinePeriod(new Date().getHours())),60000),sync=()=>setVisible(!document.hidden);document.addEventListener('visibilitychange',sync);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',sync);};},[]);
  useEffect(()=>{setError(false);},[media?.file,p.mode]);
  useEffect(()=>{if(!error){reported.current=false;return;}if(enabled&&target&&!kept&&!reported.current&&onError){reported.current=true;onError(t("背景无法播放，已显示工作室。可在背景设置中重新导入壁纸。"),true);}},[error,enabled,target,kept,onError]);
  useEffect(()=>{const node=video.current;if(!node)return;if(paused||!visible)node.pause();else void node.play().catch(()=>setError(true));},[paused,visible,media?.file]);
  const style={'--home-dim':p.dim,'--home-blur':`${p.blur}px`,'--home-fit':p.fit} as CSSProperties;
  if(!enabled)return null;
  return <div className={kept?'wallpaper-kept':'home-background'} aria-hidden="true" ref={register} data-arriving={waiting?'':undefined} data-wallpaper-target={target?'':undefined} data-contrast-background={JSON.stringify([p.mode,p.media?.file,p.dim,p.blur,p.fit,p.mode==='studio'?period:undefined])} style={style}>
    {media&&!error?(['scene','web'].includes(media.kind)?<WallpaperFrame key={media.file} media={media} paused={paused||!visible} fit={p.fit} respectReducedMotion={stillMotion} onError={()=>setError(true)} onReady={onReady}/>:media.kind==='video'?<video key={media.file} ref={video} data-paused={paused||!visible?'':undefined} src={backgroundUrl(media.file)} muted loop playsInline preload="metadata" onLoadedData={onReady} onError={()=>setError(true)}/>:<img ref={picture} src={backgroundUrl(media.file)} alt="" onLoad={onReady} onError={()=>setError(true)}/>):p.mode!=='plain'&&<img ref={picture} src={ROOMS[period]} alt="" onLoad={onReady}/>}<div className="home-background-shade"/>
  </div>;
}
export function WorkspaceBackground({page,title,children}:{page:string;title:string;children:ReactNode}){
  const toolbar=useContext(WorkspaceToolbar);
  const enabled=useExtensionFeature('backgrounds');
  const appearance=useChatAppearance(page);
  const bg=useHomeBackground(page),[open,setOpen]=useState(false);
  useEffect(()=>setOpen(false),[page]);
  return <section className="page-background" data-background-page={page} style={{...appearance.style,'--welcome-card-opacity':(100-(bg.preferences.welcomeCardTransparency??OPACITY_DEFAULT.welcomeCardTransparency))+'%'} as CSSProperties} data-chat-reply-custom={chatColorMode(appearance.preferences.reply)!=='theme'} data-chat-input-custom={chatColorMode(appearance.preferences.input)!=='theme'} data-chat-reply-member={appearance.preferences.reply.color==='member'} data-chat-mine-member={appearance.preferences.mine.color==='member'} data-chat-input-member={appearance.preferences.input.color==='member'}>
    {!toolbar&&<div className="page-background-toolbar"><ChatAppearanceButton appearance={appearance}/>{enabled&&page!=='home'&&<button className="button quiet small" type="button" onClick={()=>setOpen(true)} aria-label={t("设置本页背景")}><Image size={14}/>{page==='home'?t("背景"):t("聊天背景")}</button>}</div>}
    <div className="page-background-content">{children}</div>
    {open&&<Modal title={page==='home'?t("首页背景"):t("{0} · 背景", title)} subtitle={t("只修改当前页面，其他页面的背景保持各自设置。")} onClose={()=>setOpen(false)} className="home-background-modal"><div className="modal-body"><BackgroundSettings page={page} onAppearance={()=>{setOpen(false);requestAppearance();}}/></div></Modal>}
  </section>;
}
export function BackgroundSettings({page='home',onAppearance,pageIds}:{page?:string;onAppearance?:()=>void;pageIds?:string[]}){return useExtensionFeature('backgrounds')?<EnabledBackgroundSettings page={page} onAppearance={onAppearance} pageIds={pageIds}/>:<p className="settings-description">{t("页面背景插件已停用；原有背景设置保留。")}</p>;}
function OpacityField({label,aria,value,onValue,applied,disabled,hint,onApplied,canApply=true}:{label:string;aria:string;value:number;onValue:(value:number)=>void;applied:boolean;disabled?:boolean;hint?:string;onApplied?:(on:boolean)=>void;canApply?:boolean}){
  return <div className="background-opacity-field">
    <label className="field">{label} · {value}%<input aria-label={aria} type="range" min="0" max="100" value={value} onChange={event=>onValue(Number(event.target.value))}/></label>
    {canApply?<label className="apply-all-check" title={hint}><input type="checkbox" aria-label={t("{0}应用到全体会话", aria)} checked={applied} disabled={disabled} onChange={event=>onApplied?.(event.target.checked)}/>{t("应用到全体会话")}</label>:null}
  </div>;
}
function EnabledBackgroundSettings({page='home',onAppearance,pageIds}:{page?:string;onAppearance?:()=>void;pageIds?:string[]}){
  const bg=useHomeBackground(page),p=bg.preferences;
  const reducedMotion=useMotionLevel()!=='full';
  const layout=useAppearancePreferences(),sidebarTransparency=layout.transparency??p.sidebarTransparency??0;
  const [allSlots,setAllSlots]=useState<Record<OpacityKey,boolean>>(readOpacityFlags);
  const [syncNote,setSyncNote]=useState('');
  async function syncPatch(patch:Partial<BackgroundPreferences>){
    const ids=(pageIds??[]).filter(id=>id!==page);if(!ids.length)return;
    let failed=0;for(const id of ids){await change(id,'background.save',patch);if(state(id).error)failed++;}
    setSyncNote(failed?t("有 {0} 个界面未能同步，请稍后再试。", failed):t("已同步 {0} 个界面。", ids.length+1));
  }
  const syncTimers=useRef<Partial<Record<OpacityKey,number>>>({});
  const saveOpacity=(key:OpacityKey,value:number)=>{void bg.save({[key]:value} as Partial<BackgroundPreferences>);if(!allSlots[key])return;window.clearTimeout(syncTimers.current[key]);syncTimers.current[key]=window.setTimeout(()=>{delete syncTimers.current[key];void syncPatch({[key]:value} as Partial<BackgroundPreferences>);},300);};
  const toggleOpacityAll=(key:OpacityKey,on:boolean)=>{setAllSlots(prev=>({...prev,[key]:on}));try{localStorage.setItem(OPACITY_ALL_KEY+key,on?'1':'0');}catch{}setSyncNote('');if(on)void syncPatch({[key]:p[key]??OPACITY_DEFAULT[key]} as Partial<BackgroundPreferences>);};
  return <section className="background-settings" aria-label={t("本页背景设置")} data-background-page={page}>
    {syncNote?<p className="settings-description" role="status">{syncNote}</p>:null}
    <div className="background-controls background-toolbar-controls">
      <OpacityField label={t("顶部栏透明度")} aria={t("顶部任务栏透明度")} value={p.headerTransparency??OPACITY_DEFAULT.headerTransparency} onValue={value=>saveOpacity('headerTransparency',value)} applied={allSlots.headerTransparency} onApplied={on=>toggleOpacityAll('headerTransparency',on)} canApply={!!pageIds?.length} hint={t("勾选后此值同步到全部界面")}/>
      <OpacityField label={t("左侧栏透明度")} aria={t("左侧栏透明度")} value={sidebarTransparency} onValue={value=>layout.setTransparency(value)} applied disabled hint={t("左侧栏透明度本来就全部界面共用")}/>
    </div>
    <div className="background-controls background-toolbar-controls">
      <OpacityField label={t("文件预览与浏览器透明度")} aria={t("文件预览与浏览器透明度")} value={p.previewTransparency??OPACITY_DEFAULT.previewTransparency} onValue={value=>saveOpacity('previewTransparency',value)} applied={allSlots.previewTransparency} onApplied={on=>toggleOpacityAll('previewTransparency',on)} canApply={!!pageIds?.length} hint={t("勾选后此值同步到全部界面")}/>
      <OpacityField label={t("终端透明度")} aria={t("终端透明度")} value={p.terminalTransparency??OPACITY_DEFAULT.terminalTransparency} onValue={value=>saveOpacity('terminalTransparency',value)} applied={allSlots.terminalTransparency} onApplied={on=>toggleOpacityAll('terminalTransparency',on)} canApply={!!pageIds?.length} hint={t("勾选后此值同步到全部界面")}/>
    </div>
    <div className="background-controls background-toolbar-controls">
      <OpacityField label={t("欢迎卡片透明度")} aria={t("欢迎卡片透明度")} value={p.welcomeCardTransparency??OPACITY_DEFAULT.welcomeCardTransparency} onValue={value=>saveOpacity('welcomeCardTransparency',value)} applied={allSlots.welcomeCardTransparency} onApplied={on=>toggleOpacityAll('welcomeCardTransparency',on)} canApply={!!pageIds?.length} hint={t("控制尚无消息时的聊天欢迎卡片")}/>
    </div>
    {onAppearance&&<label className="toggle-row background-glass-toggle"><span><strong>{t("液态玻璃")}</strong><small>{t("为预览、终端、侧栏和设置窗口启用玻璃折射与背景模糊，所有页面共用。")}</small></span><input type="checkbox" aria-label={t("液态玻璃")} checked={layout.liquidGlass} onChange={event=>layout.setLiquidGlass(event.target.checked)}/></label>}
    <p className="settings-description">{t("顶部栏、文件预览、终端和欢迎卡片按页面保存，左侧栏透明度为全部页面共用；勾选「应用到全体会话」后该项会在所有界面统一，之后继续调整也会一起同步。只调整底色，文字和按钮保持清晰。")}</p>
    {onAppearance&&<button type="button" className="button quiet small" onClick={onAppearance}>{t("全部外观设置")}</button>}
    <div className="background-actions"><button type="button" className="button secondary" disabled={bg.busy} onClick={()=>void bg.importFile()}><ImagePlus size={15}/>{t("选择图片 / 视频")}</button><button type="button" className="button secondary" disabled={bg.busy} onClick={()=>void bg.importWallpaper()}><FolderOpen size={15}/>{t("从 Wallpaper Engine 导入")}</button></div>
    <p className="settings-description">{t("在 Wallpaper Engine 中右键壁纸 → 在资源管理器中打开，选择 project.json。支持图片、视频、场景与网页壁纸；请保留同目录的资源文件。场景与网页在屋内直接渲染，部分特效可能不兼容。")}</p>
    <div className="field">{t("显示模式")}<select aria-label={t("本页背景模式")} value={p.mode} onChange={event=>void bg.save({mode:event.target.value as BackgroundPreferences['mode']})}><option value="studio">{t("随时间变化的工作室")}</option><option value="plain">{t("纯色")}</option>{p.media&&<option value="media">{t("自选背景 · {0}", p.media.name)}</option>}</select></div>
    {p.media&&<p className="background-file">{p.media.kind==='video'?<Film size={14}/>:<ImagePlus size={14}/>}<span>{p.media.name}</span><small>{p.media.source==='wallpaper-engine'?'Wallpaper Engine':t("本地文件")}</small></p>}
    <div className="background-controls"><label className="field">{t("遮罩强度 · {0}%", Math.round(p.dim*100))}<input aria-label={t("背景遮罩强度")} type="range" min="0" max="95" value={Math.round(p.dim*100)} onChange={event=>void bg.save({dim:Number(event.target.value)/100})}/></label><label className="field">{t("模糊 · {0}px", p.blur)}<input aria-label={t("背景模糊")} type="range" min="0" max="20" value={p.blur} onChange={event=>void bg.save({blur:Number(event.target.value)})}/></label><label className="field">{t("画面适配")}<select aria-label={t("背景画面适配")} value={p.fit} onChange={event=>void bg.save({fit:event.target.value as 'cover'|'contain'})}><option value="cover">{t("铺满")}</option><option value="contain">{t("完整显示")}</option></select></label></div>
    {p.mode==='media'&&p.media&&p.media.kind!=='image'&&<button type="button" className="button secondary" onClick={()=>void bg.save({paused:!p.paused})}>{p.paused?<Play size={14}/>:<Pause size={14}/>} {p.media.kind==='video'?(p.paused?t("继续视频"):t("暂停视频")):(p.paused?t("继续动态背景"):t("暂停动态背景"))}</button>}
    {p.mode==='media'&&p.media&&p.media.kind!=='image'&&<label className="toggle-row"><span><strong>{t("跟随系统减少动态效果")}</strong><small>{reducedMotion&&p.respectReducedMotion!==false?t("当前动效不是完整档；场景使用静态预览。"):t("关闭后可照常播放本页动态背景，仍可手动暂停。")}</small></span><input aria-label={t("跟随系统减少动态效果")} type="checkbox" checked={p.respectReducedMotion!==false} onChange={event=>void bg.save({respectReducedMotion:event.target.checked})}/></label>}
    {page==='home'&&<label className="toggle-row"><span><strong>{t("淡化立绘的浅色底")}</strong><small>{t("只在首页显示时处理与边缘相连的浅色区域，保留原图。透明 PNG 的效果最好。")}</small></span><input aria-label={t("淡化立绘浅色底")} type="checkbox" checked={p.matte} onChange={event=>void bg.save({matte:event.target.checked})}/></label>}
    <p className="settings-description">{t("仅对当前页面生效，重启后保留在这台电脑。动态背景静音播放，离开页面或隐藏窗口时暂停。图片不超过 32 MB，视频不超过 512 MB，场景与网页项目不超过 1 GB。导入会保存本地副本，原壁纸不变。")}</p>
    {bg.error&&<p role="alert" className="task-meta bad">{bg.error}</p>}
    <button type="button" className="button quiet small" onClick={()=>void bg.save(defaultBackground(page))}><RotateCcw size={13}/>{t("恢复本页默认")}</button>
  </section>;
}

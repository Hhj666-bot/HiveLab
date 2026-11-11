import {t} from './i18n';
import {useSyncExternalStore} from 'react';
import {TEXT_TONE_DWELL_MS,TEXT_TONE_HOLD_MS} from '../shared/text-contrast';
import {parseLiquidGlassSettings,type LiquidGlassSettings} from '../shared/liquid-glass';
import {accentColor,DEFAULT_ACCENT,type AccentMode} from '../shared/theme-accent';
import {MOTION_PREFERENCE_KEY,parseMotionPreference,type MotionPreference} from '../shared/motion';
export type SidebarPreference={mode:'expanded'|'icons'|'hidden';width:number};
type Preferences={accentMode:AccentMode;accentColor:string;sidebar:SidebarPreference;transparency?:number;density:number;liquidGlass:boolean;menuTransparency:number;glass:LiquidGlassSettings;adaptiveText:boolean;adaptiveTextDwellSeconds:number;adaptiveTextHoldSeconds:number;motion:MotionPreference;error:string};
const GLASS_KEY='hivelab.appearance.liquid-glass.settings';
const MENU_KEY='hivelab.appearance.menu-transparency';
export const DEFAULT_CAST_DENSITY=.75;
const menuPercent=(value:number)=>Number.isFinite(value)?Math.max(0,Math.min(100,value)):26;
function glassSettings(){try{return parseLiquidGlassSettings(JSON.parse(localStorage.getItem(GLASS_KEY)??'null'));}catch{return parseLiquidGlassSettings(null);}}
const seconds=(value:number)=>Number.isFinite(value)?Math.max(0,Math.min(3600,value)):0;
function timing(key:string,fallback:number){try{const value=localStorage.getItem('hivelab.appearance.adaptive-text.'+key);return value!==null&&Number.isFinite(Number(value))?seconds(Number(value)):fallback;}catch{return fallback;}}
const initialSidebar=():SidebarPreference=>({mode:'expanded',width:268});
function sidebar():SidebarPreference{try{const stored=localStorage.getItem('hivelab.sidebar.layout'),p=JSON.parse(stored??localStorage.getItem('hivelab.sidebar.chat')??localStorage.getItem('hivelab.sidebar.home')??'null'),next:SidebarPreference={mode:['expanded','icons','hidden'].includes(p?.mode)?p.mode:'expanded',width:Number.isFinite(p?.width)?Math.max(220,Math.min(420,p.width)):268};localStorage.setItem('hivelab.sidebar.layout',JSON.stringify(next));localStorage.removeItem('hivelab.sidebar.home');localStorage.removeItem('hivelab.sidebar.chat');return next;}catch{return initialSidebar();}}
let current:Preferences|undefined;
function state():Preferences{if(!current){let accentMode:AccentMode='contextual',chosenAccent:string=DEFAULT_ACCENT,transparency:number|undefined,density=DEFAULT_CAST_DENSITY,liquidGlass=true,menuTransparency=26,adaptiveText=true,motion:MotionPreference='system';try{motion=parseMotionPreference(localStorage.getItem(MOTION_PREFERENCE_KEY));accentMode=localStorage.getItem('hivelab.appearance.accent-mode')==='global'?'global':'contextual';chosenAccent=accentColor(localStorage.getItem('hivelab.appearance.accent-color'));liquidGlass=localStorage.getItem('hivelab.appearance.liquid-glass')!=='false';const menu=localStorage.getItem(MENU_KEY);if(menu!==null)menuTransparency=menuPercent(Number(menu));adaptiveText=localStorage.getItem('hivelab.appearance.adaptive-text')!=='false';const value=localStorage.getItem('hivelab.sidebar.transparency');if(value!==null&&Number.isFinite(Number(value)))transparency=Math.max(0,Math.min(100,Number(value)));const n=Number(localStorage.getItem('hivelab.cast.density')??DEFAULT_CAST_DENSITY);if(Number.isFinite(n))density=Math.max(.75,Math.min(1.25,n));}catch{}current={accentMode,accentColor:chosenAccent,sidebar:sidebar(),transparency,density,liquidGlass,menuTransparency,glass:glassSettings(),adaptiveText,adaptiveTextDwellSeconds:timing('dwell-seconds',TEXT_TONE_DWELL_MS/1000),adaptiveTextHoldSeconds:timing('hold-seconds',TEXT_TONE_HOLD_MS/1000),motion,error:''};}return current;}
const listeners=new Set<()=>void>(),subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function save(next:Preferences){current={...next,error:''};try{localStorage.setItem('hivelab.appearance.accent-mode',next.accentMode);localStorage.setItem('hivelab.appearance.accent-color',next.accentColor);localStorage.setItem('hivelab.sidebar.layout',JSON.stringify(next.sidebar));if(next.transparency!==undefined)localStorage.setItem('hivelab.sidebar.transparency',String(next.transparency));localStorage.setItem('hivelab.cast.density',String(next.density));localStorage.setItem('hivelab.appearance.liquid-glass',String(next.liquidGlass));localStorage.setItem(MENU_KEY,String(next.menuTransparency));localStorage.setItem(GLASS_KEY,JSON.stringify(next.glass));localStorage.setItem('hivelab.appearance.adaptive-text',String(next.adaptiveText));localStorage.setItem('hivelab.appearance.adaptive-text.dwell-seconds',String(next.adaptiveTextDwellSeconds));localStorage.setItem('hivelab.appearance.adaptive-text.hold-seconds',String(next.adaptiveTextHoldSeconds));localStorage.setItem(MOTION_PREFERENCE_KEY,next.motion);}catch{current={...next,error:t("当前外观已生效，但本机偏好未能保存。")};}listeners.forEach(listener=>listener());}
const setAccent=(patch:Partial<Pick<Preferences,'accentMode'|'accentColor'>>)=>save({...state(),...patch,...(patch.accentColor?{accentColor:accentColor(patch.accentColor)}:{})});
const setSidebar=(patch:Partial<SidebarPreference>)=>{const old=state(),p={...old.sidebar,...patch};p.width=Math.max(220,Math.min(420,p.width));save({...old,sidebar:p});};
const setTransparency=(value:number)=>save({...state(),transparency:Math.max(0,Math.min(100,value))});
const adoptLegacyTransparency=(value:number)=>{const old=state();if(old.transparency===undefined&&Number.isFinite(value)&&value>0)save({...old,transparency:Math.max(0,Math.min(100,value))});};
const setDensity=(value:number)=>save({...state(),density:Math.max(.75,Math.min(1.25,value))});
const setLiquidGlass=(value:boolean)=>save({...state(),liquidGlass:value});
const setMenuTransparency=(value:number)=>save({...state(),menuTransparency:menuPercent(value)});
const setGlass=(patch:Partial<LiquidGlassSettings>)=>save({...state(),glass:parseLiquidGlassSettings({...state().glass,...patch})});
const resetGlass=()=>save({...state(),glass:parseLiquidGlassSettings(null)});
const setAdaptiveText=(value:boolean)=>save({...state(),adaptiveText:value});
const setMotion=(value:MotionPreference)=>save({...state(),motion:value});
const setAdaptiveTextTiming=(patch:Partial<Pick<Preferences,'adaptiveTextDwellSeconds'|'adaptiveTextHoldSeconds'>>)=>{const next={...state(),...patch};save({...next,adaptiveTextDwellSeconds:seconds(next.adaptiveTextDwellSeconds),adaptiveTextHoldSeconds:seconds(next.adaptiveTextHoldSeconds)});};
export function useAppearancePreferences(){return {...useSyncExternalStore(subscribe,state),setAccent,setSidebar,setTransparency,setDensity,setLiquidGlass,setMenuTransparency,setGlass,resetGlass,setAdaptiveText,setAdaptiveTextTiming,setMotion,adoptLegacyTransparency};}
export const requestAppearance=()=>window.dispatchEvent(new Event('hivelab:open-appearance'));

/** Subscribe only to the preference a component uses; sidebar changes must not redraw chat history. */
export function useAppearancePreference<K extends keyof Preferences>(key:K):Preferences[K]{return useSyncExternalStore(subscribe,()=>state()[key]);}

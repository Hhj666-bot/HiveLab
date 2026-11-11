import {t} from './i18n';
export type BackgroundMedia={file:string;name:string;kind:'image'|'video'|'scene'|'web';source:'local'|'wallpaper-engine'};
export type BackgroundPreferences={mode:'studio'|'media'|'plain';media?:BackgroundMedia;dim:number;blur:number;fit:'cover'|'contain';paused:boolean;respectReducedMotion?:boolean;matte:boolean;sidebarTransparency?:number;headerTransparency?:number;previewTransparency?:number;terminalTransparency?:number;welcomeCardTransparency?:number};
export const DEFAULT_BACKGROUND:BackgroundPreferences={mode:'studio',dim:0.26,blur:0,fit:'cover',paused:false,respectReducedMotion:true,matte:true,sidebarTransparency:95,headerTransparency:95,previewTransparency:40,terminalTransparency:39,welcomeCardTransparency:40};
export function defaultBackground(page:string):BackgroundPreferences{return {...DEFAULT_BACKGROUND,mode:page==='home'?'studio':'plain'};}
/** Stable entity ids keep settings independent of navigation, renames and roster order. */
export function backgroundPage(view:string,projectId='',memberId=''){
  if(view==='desk')return `desk:${memberId}`;
  if(view==='reports'&&projectId)return `report:${projectId}:${memberId}`;
  if(view==='project'&&projectId)return `project:${projectId}`;
  return view==='room'?'lounge':view==='roundtable'?'roundtable':'home';
}
/** Where a page sits in the sidebar's reading order, so turning follows the direction of the eye. */
export function pageRank(page:string,roster:string[],projects:string[]){
  const [kind,first]=page.split(':');
  if(kind==='home')return 0;
  if(kind==='desk')return 1000+roster.indexOf(first);
  if(kind==='project'||kind==='report')return 2000+projects.indexOf(first)*10+(kind==='report'?1:0);
  return kind==='lounge'?3000:3001;
}
export const BACKGROUND_IMAGE_EXTENSIONS=['png','jpg','jpeg','webp','gif'];
export const BACKGROUND_VIDEO_EXTENSIONS=['mp4','webm','mov','m4v'];
export function backgroundKind(file:string):'image'|'video'|undefined{
  const ext=file.split('.').at(-1)?.toLowerCase()??'';
  return BACKGROUND_IMAGE_EXTENSIONS.includes(ext)?'image':BACKGROUND_VIDEO_EXTENSIONS.includes(ext)?'video':undefined;
}
export function normalizeBackground(value:unknown):BackgroundPreferences{
  const source=value&&typeof value==='object'?value as Record<string,any>:{};
  const clamp=(v:unknown,min:number,max:number,fallback:number)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(min,v)):fallback;
  const m=source.media,kind=m&&typeof m.file==='string'?(/^[a-f0-9-]{36}\.wallpaper$/i.test(m.file)&&['scene','web'].includes(m.kind)?m.kind as 'scene'|'web':backgroundKind(m.file)):undefined;
  const media=m&&kind&&/^[a-f0-9-]{36}\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|wallpaper)$/i.test(m.file)&&m.kind===kind?{file:m.file,name:String(m.name??t("自选背景")).slice(0,180),kind,source:m.source==='wallpaper-engine'?'wallpaper-engine' as const:'local' as const}:undefined;
  return {mode:source.mode==='plain'?'plain':source.mode==='media'&&media?'media':'studio',...(media?{media}:{}),dim:clamp(source.dim,0,0.95,DEFAULT_BACKGROUND.dim),blur:clamp(source.blur,0,20,0),fit:source.fit==='contain'?'contain':'cover',paused:source.paused===true,respectReducedMotion:source.respectReducedMotion!==false,matte:source.matte!==false,sidebarTransparency:clamp(source.sidebarTransparency,0,100,DEFAULT_BACKGROUND.sidebarTransparency!),headerTransparency:clamp(source.headerTransparency,0,100,DEFAULT_BACKGROUND.headerTransparency!),previewTransparency:clamp(source.previewTransparency,0,100,DEFAULT_BACKGROUND.previewTransparency!),terminalTransparency:clamp(source.terminalTransparency,0,100,DEFAULT_BACKGROUND.terminalTransparency!),welcomeCardTransparency:clamp(source.welcomeCardTransparency,0,100,DEFAULT_BACKGROUND.welcomeCardTransparency!)};
}

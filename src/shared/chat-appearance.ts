import {chatColorPreset} from './appearance-colors';

export const CHAT_SURFACES=['reply','mine','input'] as const;
export type ChatSurfaceSlot=typeof CHAT_SURFACES[number];
export type ChatSurface={color:string;transparency:number};
export type ChatAppearance=Record<ChatSurfaceSlot,ChatSurface>;
export type ChatAppearanceData={defaults:ChatAppearance;pages:Record<string,Partial<ChatAppearance>>};
export const defaultChatAppearance=():ChatAppearance=>({reply:{color:'member',transparency:70},mine:{color:'',transparency:70},input:{color:'',transparency:70}});
export const chatColorMode=(value:ChatSurface)=>value.color==='member'?'member':chatColorPreset(value.color)?'preset':/^#[0-9a-f]{6}$/i.test(value.color)?'custom':'theme';
export function chatColorInk(color:string){const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.179?'#171717':'#fafafa';}
const surface=(value:any,slot:ChatSurfaceSlot):ChatSurface=>({color:value?.color==='member'||value?.color==='theme'||typeof value?.color==='string'&&(chatColorPreset(value.color)||/^#[0-9a-f]{6}$/i.test(value.color))?value.color:defaultChatAppearance()[slot].color,transparency:typeof value?.transparency==='number'&&Number.isFinite(value.transparency)?Math.max(0,Math.min(100,value.transparency)):defaultChatAppearance()[slot].transparency});
export function parseChatAppearance(value:any):ChatAppearanceData{
 const defaults=defaultChatAppearance(),pages:ChatAppearanceData['pages']={};
 for(const slot of CHAT_SURFACES)if(value?.[slot])defaults[slot]=surface(value[slot],slot);
 if(value?.pages&&typeof value.pages==='object')for(const [page,entry] of Object.entries(value.pages).slice(0,5000)){
  if(!page||page.length>512||['__proto__','constructor','prototype'].includes(page)||!entry||typeof entry!=='object')continue;
  const overrides:Partial<ChatAppearance>={};for(const slot of CHAT_SURFACES)if(Object.hasOwn(entry,slot))overrides[slot]=surface((entry as any)[slot],slot);
  if(Object.keys(overrides).length)pages[page]=overrides;
 }
 return {defaults,pages};
}
export function chatAppearanceFor(data:ChatAppearanceData,page?:string):ChatAppearance{return {...data.defaults,...(page?data.pages[page]:{})};}
function clearSlot(pages:ChatAppearanceData['pages'],slot:ChatSurfaceSlot){
 return Object.fromEntries(Object.entries(pages).flatMap(([page,values])=>{const next={...values};delete next[slot];return Object.keys(next).length?[[page,next]]:[];}));
}
export function updateChatSurface(data:ChatAppearanceData,page:string|undefined,slot:ChatSurfaceSlot,patch:Partial<ChatSurface>):ChatAppearanceData{
 const next=surface({...chatAppearanceFor(data,page)[slot],...patch},slot);
 if(page&&data.pages[page]?.[slot])return {...data,pages:{...data.pages,[page]:{...data.pages[page],[slot]:next}}};
 return {defaults:{...data.defaults,[slot]:next},pages:clearSlot(data.pages,slot)};
}
export function setChatApplyAll(data:ChatAppearanceData,page:string,slot:ChatSurfaceSlot,all:boolean):ChatAppearanceData{
 const value={...chatAppearanceFor(data,page)[slot]};
 return all?{defaults:{...data.defaults,[slot]:value},pages:clearSlot(data.pages,slot)}:{...data,pages:{...data.pages,[page]:{...data.pages[page],[slot]:value}}};
}

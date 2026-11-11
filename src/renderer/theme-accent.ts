import {useLayoutEffect} from 'react';
import {resolveAccent} from '../shared/theme-accent';
import {chatColorInk} from '../shared/chat-appearance';
import {useAppearancePreference} from './appearance-preferences';
export function useThemeAccent(memberColor?:string){
 const accentMode=useAppearancePreference('accentMode'),accentColor=useAppearancePreference('accentColor'),color=resolveAccent(accentMode,accentColor,memberColor);
 useLayoutEffect(()=>{
  const values={'--brand-primary':color,'--brand-primary-hover':`color-mix(in srgb,${color} 90%,#000)`,'--brand-primary-pressed':`color-mix(in srgb,${color} 78%,#000)`,'--brand-primary-ink':chatColorInk(color),'--focus':`light-dark(color-mix(in srgb,${color} 65%,#172128),${color})`};
  const root=document.documentElement;for(const [name,value] of Object.entries(values))root.style.setProperty(name,value);
  return()=>{for(const name of Object.keys(values))root.style.removeProperty(name);};
 },[color]);
 return color;
}

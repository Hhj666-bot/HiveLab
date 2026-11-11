import {useSyncExternalStore} from 'react';

const queries=new Map<string,MediaQueryList>();
const subscribeTheme=(listener:()=>void)=>{const observer=new MutationObserver(listener);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();};
/** Colour inputs show the same variant as theme-aware CSS surfaces. */
export function useDarkAppearance(){
 const theme=useSyncExternalStore(subscribeTheme,()=>document.documentElement.dataset.theme??'system');
 const system=useMediaPreference('(prefers-color-scheme: dark)');
 return theme==='dark'||theme==='system'&&system;
}
/** Live OS preferences; changing a setting updates mounted surfaces as well. */
export function useMediaPreference(query:string){
  let media=queries.get(query);if(!media){media=window.matchMedia(query);queries.set(query,media);}
  return useSyncExternalStore(listener=>{media.addEventListener('change',listener);return()=>media.removeEventListener('change',listener);},()=>media.matches);
}

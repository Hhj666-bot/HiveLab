import {useLayoutEffect,useRef,type RefObject} from 'react';
import {useAppearancePreference} from './appearance-preferences';

// Page-turn transforms are visual only. Insets must use the resting layout,
// otherwise an incoming page temporarily reserves an entire screen above its messages.
function layoutTop(node:HTMLElement){
 let top=0;
 for(let at:HTMLElement|null=node;at;){const parent=at.offsetParent as HTMLElement|null;top+=at.offsetTop+(parent?.clientTop??0);at=parent;}
 return top;
}

/** Keep one full-height log underneath the floating glass header and composer.
 * Insets reserve readable space for the first/last message, not separate rows. */
export function useFloatingChatLayout(log:RefObject<HTMLDivElement|null>,pinned:RefObject<boolean>){
 const liquidGlass=useAppearancePreference('liquidGlass'),ref=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
  const room=ref.current;if(!liquidGlass||!room)return;
  const workspace=room.closest('.file-preview-workspace'),observed=new Set<Element>();let frame=0;
  const resize=new ResizeObserver(schedule);
  function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
  function measure(){
   frame=0;
   const header=room!.querySelector<HTMLElement>(':scope>.room-top'),composer=room!.querySelector<HTMLElement>(':scope>.room-composer'),toolbar=workspace?.querySelector<HTMLElement>(':scope>.preview-workspace-bar');
   const next=new Set<Element>([room!,...([header,composer,toolbar].filter(Boolean) as Element[])]);
   for(const node of observed)if(!next.has(node)){resize.unobserve(node);observed.delete(node);}
   for(const node of next)if(!observed.has(node)){resize.observe(node);observed.add(node);}
   const offset=toolbar?.getClientRects().length?Math.max(0,Math.ceil(layoutTop(toolbar)+toolbar.offsetHeight-layoutTop(room!))):0;
   const values={'--glass-top-offset':offset,'--glass-header-space':offset+(header?.offsetHeight??0),'--glass-composer-space':composer?.offsetHeight??0};
   let changed=false;
   for(const [name,value] of Object.entries(values))if(room!.style.getPropertyValue(name)!==value+'px'){room!.style.setProperty(name,value+'px');changed=true;}
   // Resizing an attachment tray or collapsing the header must keep the latest
   // message above the input when the user was already following new messages.
   if(changed&&pinned.current&&log.current)log.current.scrollTop=log.current.scrollHeight;
  }
  const changes=new MutationObserver(schedule);changes.observe(workspace??room,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});
  measure();
  return()=>{cancelAnimationFrame(frame);changes.disconnect();resize.disconnect();for(const name of ['--glass-top-offset','--glass-header-space','--glass-composer-space'])room.style.removeProperty(name);if(pinned.current&&log.current)log.current.scrollTop=log.current.scrollHeight;};
 },[liquidGlass]);
 return {ref,enabled:liquidGlass};
}

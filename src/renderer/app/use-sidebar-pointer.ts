import {useEffect,useLayoutEffect,useRef,type RefObject} from 'react';
import {calmedSpring,LIQUID_GLASS_PHYSICS as P} from '../../shared/liquid-glass';
import {useMotionLevel} from '../motion/use-motion-level';
import {advance,MAX_FRAME,STEP,type Edge,type Spring} from './use-tab-bubble';

/** A row is one target, whichever of its parts the pointer is over. */
const ROWS='.brand,.roster-with-desk,.project-tree-row,.explorer-root',CONTROLS='button,[role=button],summary';
const APART='[role=menu],[role=dialog],.context-menu,.modal,.rename-input';
/** These already carry a bubble of their own. */
const CHOSEN='.roster-with-desk.selected,.project-tree-row.selected,.room-entry.selected,[aria-pressed=true]';
const SCROLLERS='.sidebar-section-scroll,.explorer-tree,.sidebar-file-pane';
/** The longest the bubble may draw out, in lengths of what it left or reached. */
const STRETCH=2.2,SETTLED=.2,FIRST_FRAME=1/60,FADE_MS=160;
const SIDES=['left','right','top','bottom'] as const;
type Side=typeof SIDES[number];type Box=Record<Side,number>;

/** Where a control stands in the sidebar, cut to the list it scrolls in. */
function boxOf(node:HTMLElement,side:HTMLElement):Box{
 const r=node.getBoundingClientRect(),own=side.getBoundingClientRect(),area=node.closest(SCROLLERS)?.getBoundingClientRect(),x=own.left+side.clientLeft,y=own.top+side.clientTop;
 return {left:Math.max(r.left,area?.left??r.left)-x,right:Math.min(r.right,area?.right??r.right)-x,top:Math.max(r.top,area?.top??r.top)-y,bottom:Math.min(r.bottom,area?.bottom??r.bottom)-y};
}
/** Past the stretch limit the trailing edge is drawn along behind the leading one. */
function drawn(near:number,far:number,rest:number,forward:boolean){
 const limit=rest*STRETCH;if(far-near<=limit)return [near,far];
 return forward?[far-limit,far]:[near,near+limit];
}

/** One bubble serves every control in the sidebar. It rests on what the pointer last touched, so it holds across the
 *  gaps, and is drawn to the next control leading edge first, like something viscous. `chosen` names what is chosen
 *  now: the bubble lets go of a control that has just gained a bubble of its own. */
export function useSidebarPointer(side:RefObject<HTMLElement|null>,chosen:string){
 const bubble=useRef<HTMLDivElement>(null),aim=useRef<HTMLElement>(undefined),motion=useMotionLevel(),go=useRef<(follow?:boolean)=>void>(()=>{});
 useLayoutEffect(()=>{
  const aside=side.current,node=bubble.current;if(!aside||!node)return;
  let at:Record<Side,Edge>|undefined,goal:Box,rest={x:0,y:0},frame=0,last=0;const springs={} as Record<Side,Spring>;
  const paint=()=>{
   if(!at)return;
   const [left,right]=drawn(at.left.x,at.right.x,rest.x,goal.left>at.left.x),[top,bottom]=drawn(at.top.x,at.bottom.x,rest.y,goal.top>at.top.x);
   const thin=Math.max(.94,1-P.bubble.thin*Math.max(0,(bottom-top)/rest.y-1));
   node.style.width=`${right-left}px`;node.style.height=`${bottom-top}px`;node.style.transform=`translate(${left}px,${top}px) scaleX(${thin})`;
  };
  const stop=()=>{cancelAnimationFrame(frame);frame=0;last=0;};
  const tick=(now:number)=>{
   if(!at)return;
   let left=last?Math.min(MAX_FRAME,(now-last)/1000):FIRST_FRAME;last=now;
   for(;left>0;left-=STEP)for(const name of SIDES)advance(at[name],goal[name],springs[name],Math.min(STEP,left));
   if(SIDES.every(name=>Math.abs(at![name].x-goal[name])<SETTLED&&Math.abs(at![name].v)<SETTLED*10)){for(const name of SIDES)at[name]={x:goal[name],v:0};stop();paint();return;}
   paint();frame=requestAnimationFrame(tick);
  };
  go.current=(follow=false)=>{
   const row=aim.current,shown=!!row?.isConnected&&!row.matches(CHOSEN);
   node.dataset.shown=String(shown);
   if(!shown){stop();at=undefined;return;}
   const id=row!.dataset.rosterId;node.className='sidebar-pointer'+(id?` member-${id}`:'');
   const from=at;goal=boxOf(row!,aside);
   if(!from||follow||motion!=='full'||document.hidden){
    // Without movement the old place still lets go by a fade, not a jump.
    if(from&&!follow&&motion==='reduced'&&!document.hidden){const leaving=node.cloneNode() as HTMLElement;node.after(leaving);leaving.animate([{opacity:1},{opacity:0}],{duration:FADE_MS,easing:'ease'}).onfinish=()=>leaving.remove();node.animate([{opacity:0},{opacity:1}],{duration:FADE_MS,easing:'ease'});}
    stop();at=Object.fromEntries(SIDES.map(name=>[name,{x:goal[name],v:0}])) as Record<Side,Edge>;rest={x:goal.right-goal.left,y:goal.bottom-goal.top};paint();return;
   }
   rest={x:Math.max(goal.right-goal.left,from.right.x-from.left.x),y:Math.max(goal.bottom-goal.top,from.bottom.x-from.top.x)};
   const distance=Math.max(...SIDES.map(name=>Math.abs(goal[name]-from[name].x)));
   const lead=calmedSpring(P.hover.lead,distance),trail=calmedSpring(P.hover.trail,distance);
   for(const [near,far] of [['left','right'],['top','bottom']] as const){const forward=goal[near]>from[near].x||goal[far]>from[far].x;springs[near]=forward?trail:lead;springs[far]=forward?lead:trail;}
   if(!frame)frame=requestAnimationFrame(tick);
  };
  const over=(event:PointerEvent)=>{
   if(event.pointerType!=='mouse')return;
   const spot=event.target as HTMLElement,row=spot.closest<HTMLElement>(ROWS)??spot.closest<HTMLElement>(CONTROLS);
   if(!row||!aside.contains(row)||row===aim.current||row.matches(':disabled')||spot.closest(APART))return;
   aim.current=row;go.current();
  };
  const leave=()=>{aim.current=undefined;go.current();};
  const follow=()=>go.current(true);
  const slid=(event:TransitionEvent)=>{if(event.propertyName==='transform'&&(event.target as HTMLElement).contains(aim.current??null))follow();};
  const watch=new ResizeObserver(follow);watch.observe(aside);
  aside.addEventListener('pointerover',over);aside.addEventListener('pointerleave',leave);aside.addEventListener('transitionend',slid);aside.addEventListener('scroll',follow,true);
  return ()=>{stop();watch.disconnect();aside.removeEventListener('pointerover',over);aside.removeEventListener('pointerleave',leave);aside.removeEventListener('transitionend',slid);aside.removeEventListener('scroll',follow,true);};
 },[side,motion]);
 useLayoutEffect(()=>go.current(),[chosen]);
 // Folding moves every control; the bubble stays out of it and is back on its control when the sidebar lands.
 useEffect(()=>{const landed=()=>go.current(true);window.addEventListener('hivelab:page-turned',landed);return()=>window.removeEventListener('hivelab:page-turned',landed);},[]);
 return bubble;
}

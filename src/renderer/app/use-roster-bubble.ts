import {useEffect,useLayoutEffect,useRef,type RefObject} from 'react';
import {calmedSpring,LIQUID_GLASS_PHYSICS as P} from '../../shared/liquid-glass';
import {useMotionLevel} from '../motion/use-motion-level';
import {advance,STEP,type Edge,type Spring} from './use-tab-bubble';

/** The longest the bubble may draw out, in row heights. */
const STRETCH=2.2,SETTLED=.2,FRAME=1/60,LONGEST=180;
type Point={top:Edge;bottom:Edge};

/** The shape at two edges. Past the stretch limit the trailing edge is drawn along behind the leading one. */
function shape(top:number,bottom:number,rest:number,down:boolean){
 const limit=rest*STRETCH;if(bottom-top>limit){if(down)top=bottom-limit;else bottom=top+limit;}
 const stretch=(bottom-top)/rest,thin=Math.max(.94,Math.min(1.02,1-P.bubble.thin*(stretch-1)));
 return `translateY(${top}px) scale(${thin},${stretch})`;
}
/** The whole trip, worked out in advance. Opening a page keeps the main thread busy just as the
 *  bubble flies, so the compositor plays it instead of the bubble waiting for free frames. */
function flight(from:Point,goal:{top:number;bottom:number},lead:Spring,trail:Spring,down:boolean){
 const top={...from.top},bottom={...from.bottom},points:Point[]=[];
 for(let frame=0;frame<LONGEST;frame++){
  for(let left=FRAME;left>0;left-=STEP){const dt=Math.min(STEP,left);advance(top,goal.top,down?trail:lead,dt);advance(bottom,goal.bottom,down?lead:trail,dt);}
  points.push({top:{...top},bottom:{...bottom}});
  if(Math.abs(top.x-goal.top)<SETTLED&&Math.abs(bottom.x-goal.bottom)<SETTLED&&Math.abs(top.v)<SETTLED*10&&Math.abs(bottom.v)<SETTLED*10)break;
 }
 return points;
}

/** Moves the bubble behind the chosen row: the open desk's, the open project's or the open room's, each row named
 *  by `attribute`. Rows stay where they are, so any jump along the list takes the same time and a far one passes the
 *  rows between quickly. A new choice takes over mid-flight. */
export function useRosterBubble(selected:string|undefined,order:string,container:RefObject<HTMLElement|null>,attribute='data-roster-id'){
 const bubble=useRef<HTMLDivElement>(null),at=useRef<Point>({top:{x:0,v:0},bottom:{x:0,v:0}}),placed=useRef(false),move=useRef<(snap?:boolean)=>void>(()=>{});
 const trip=useRef<{points:Point[];start:number;animation:Animation;goal:{top:number;bottom:number}}>(undefined);
 const coloured=useRef(selected);if(selected)coloured.current=selected;
 const motion=useMotionLevel();
 useLayoutEffect(()=>{
  move.current=(snap=false)=>{
   const node=bubble.current,list=container.current;if(!node||!list)return;
   const row=selected?list.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(selected)}"]`):null;
   // Resize/landing notifications can repeat while the same flight is in progress.
   // Its stretched intermediate height is not a layout resize: keep flying to the same row.
   if(!snap&&row&&trip.current&&trip.current.goal.top===row.offsetTop&&trip.current.goal.bottom===row.offsetTop+row.offsetHeight)return;
   if(trip.current){const {points,start,animation}=trip.current;at.current=points[Math.min(points.length-1,Math.floor((performance.now()-start)/(FRAME*1000)))];animation.cancel();trip.current=undefined;}
   node.dataset.shown=String(!!row);
   if(!row){placed.current=false;return;}
   const goal={top:row.offsetTop,bottom:row.offsetTop+row.offsetHeight},rest=row.offsetHeight,from=at.current;
   const moved=from.top.x!==goal.top||from.bottom.x!==goal.bottom,down=goal.top>from.top.x,refitted=Math.abs(from.bottom.x-from.top.x-rest)>.5;
   at.current={top:{x:goal.top,v:0},bottom:{x:goal.bottom,v:0}};
   node.style.height=`${rest}px`;node.style.transform=shape(goal.top,goal.bottom,rest,true);
   if(snap||!placed.current||motion!=='full'||document.hidden){
    // Without movement the old place still lets go by a fade, not a jump.
    if(!snap&&placed.current&&moved&&motion==='reduced'&&!document.hidden){const leaving=node.cloneNode() as HTMLElement;leaving.style.transform=shape(from.top.x,from.bottom.x,rest,true);node.after(leaving);leaving.animate([{opacity:1},{opacity:0}],{duration:160,easing:'ease'}).onfinish=()=>leaving.remove();node.animate([{opacity:0},{opacity:1}],{duration:160,easing:'ease'});}
    placed.current=true;return;
   }
   if(!moved||refitted)return;
   const distance=Math.abs(goal.top-from.top.x),points=flight(from,goal,calmedSpring(P.bubble.lead,distance),calmedSpring(P.bubble.trail,distance),down);
   const animation=node.animate(points.map(point=>({transform:shape(point.top.x,point.bottom.x,rest,down)})),{duration:points.length*FRAME*1000,easing:'linear'});
   trip.current={points,start:performance.now(),animation,goal};animation.onfinish=()=>{trip.current=undefined;};
  };
  move.current();
 },[selected,order,motion,container,attribute]);
 // Rows change size when the sidebar folds; the bubble follows them there, in the commit that lands it.
 useEffect(()=>{const list=container.current;if(!list)return;const follow=()=>move.current(document.documentElement.dataset.sidebarMoving!==undefined),prepare=()=>move.current(true),watch=new ResizeObserver(follow);watch.observe(list);window.addEventListener('hivelab:page-turned',follow);window.addEventListener('hivelab:sidebar-will-move',prepare);return()=>{watch.disconnect();window.removeEventListener('hivelab:page-turned',follow);window.removeEventListener('hivelab:sidebar-will-move',prepare);};},[container]);
 return {bubble,member:coloured.current};
}

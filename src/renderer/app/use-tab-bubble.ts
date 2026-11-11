import {useLayoutEffect,useRef} from 'react';
import {LIQUID_GLASS_PHYSICS as P} from '../../shared/liquid-glass';
import {useMotionLevel} from '../motion/use-motion-level';

type Tab='work'|'files';
export type Edge={x:number;v:number};
export type Spring={response:number;dampingFraction:number};
/** The chosen side covers 3/4 of the track; edges are fractions of its width. */
const SPAN=.75,REST:Record<Tab,{left:number;right:number}>={work:{left:0,right:SPAN},files:{left:1-SPAN,right:1}};
const SETTLED=.0005;
export const STEP=1/240,MAX_FRAME=1/30;

/** Semi-implicit Euler, with stiffness and damping derived from response and dampingFraction. */
export function advance(edge:Edge,target:number,{response,dampingFraction}:Spring,dt:number){
 const w=2*Math.PI/response;
 edge.v+=(w*w*(target-edge.x)-2*dampingFraction*w*edge.v)*dt;edge.x+=edge.v*dt;
}
/** The track walls stop a bubble softly instead of letting it leave. */
function contain(edge:Edge){if(edge.x<0||edge.x>1){edge.x=Math.max(0,Math.min(1,edge.x));edge.v*=-P.bubble.wallBounce;}}
function paint(node:HTMLElement,left:number,right:number){
 const stretch=(right-left)/SPAN,offset=((left+right)/2-SPAN/2)/SPAN*100,thin=Math.max(.8,Math.min(1.06,1-P.bubble.thin*(stretch-1)));
 node.style.transform=`translateX(${offset}%) scale(${stretch},${thin})`;
}

/** Moves the sidebar page bubble. Its leading edge springs ahead of the trailing one, so it stretches,
 *  thins and settles like a bubble in water. A new choice takes over from the current shape and speed. */
export function useTabBubble(tab:Tab){
 const bubble=useRef<HTMLDivElement>(null),left=useRef<Edge>({x:REST[tab].left,v:0}),right=useRef<Edge>({x:REST[tab].right,v:0}),frame=useRef(0);
 const motion=useMotionLevel();
 useLayoutEffect(()=>{
  const node=bubble.current;if(!node)return;
  const target=REST[tab],lead=P.bubble.lead,trail=P.bubble.trail,forward=tab==='files';
  const place=()=>{left.current={x:target.left,v:0};right.current={x:target.right,v:0};paint(node,target.left,target.right);};
  cancelAnimationFrame(frame.current);frame.current=0;
  if(motion!=='full'||document.hidden){
   const moved=left.current.x!==target.left;place();
   // Without movement the choice still arrives by a fade, not a jump.
   if(moved&&motion==='reduced'&&!document.hidden)node.animate([{opacity:0},{opacity:1}],{duration:160,easing:'ease-out'});
   return;
  }
  if(left.current.x===target.left&&right.current.x===target.right&&!left.current.v&&!right.current.v){paint(node,target.left,target.right);return;}
  let last=performance.now();
  const tick=(now:number)=>{
   let rest=Math.min(MAX_FRAME,(now-last)/1000);last=now;
   for(;rest>0;rest-=STEP){const dt=Math.min(STEP,rest);advance(left.current,target.left,forward?trail:lead,dt);advance(right.current,target.right,forward?lead:trail,dt);contain(left.current);contain(right.current);}
   const moving=[[left.current,target.left],[right.current,target.right]].some(([edge,goal])=>Math.abs((edge as Edge).x-(goal as number))>SETTLED||Math.abs((edge as Edge).v)>SETTLED*10);
   if(!moving){frame.current=0;place();return;}
   paint(node,left.current.x,right.current.x);frame.current=requestAnimationFrame(tick);
  };
  frame.current=requestAnimationFrame(tick);
  return()=>{cancelAnimationFrame(frame.current);frame.current=0;};
 },[tab,motion]);
 return bubble;
}

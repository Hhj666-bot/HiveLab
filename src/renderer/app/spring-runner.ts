import {advance,MAX_FRAME,STEP,type Edge,type Spring} from './use-tab-bubble';

const SETTLED_PIXELS=.5,FIRST_FRAME=1/60,SOFT_START=.07;

/** Runs a spring from where it stands to its goal, repainting every frame. A spring pulls hardest at once, which
 *  reads as a jump, so the goal eases away from the start; a new goal keeps the position and speed. Time starts
 *  with the first frame, so laying out the page first does not spend the opening. It rests within half a pixel of
 *  `distance`, the trip's length on screen, so the final layout has nothing left to correct. Returns a cancel. */
export function runSpring(edge:{current:Edge},goal:number,spring:Spring,distance:number,paint:()=>void,done:()=>void){
 let frame=0,last=0,elapsed=0;const from=edge.current.x;
 const tick=(now:number)=>{
  let left=last?Math.min(MAX_FRAME,(now-last)/1000):FIRST_FRAME;last=now;
  for(;left>0;left-=STEP){const dt=Math.min(STEP,left),t=Math.min(1,(elapsed+=dt)/SOFT_START);advance(edge.current,from+(goal-from)*t*t*(3-2*t),spring,dt);}
  // The last frame is painted exactly at the goal and shown before handing over: handing over from half a pixel
  // short shows as a one-pixel step.
  if(Math.abs(edge.current.x-goal)*distance<SETTLED_PIXELS&&Math.abs(edge.current.v)*distance<SETTLED_PIXELS*10){edge.current={x:goal,v:0};paint();frame=requestAnimationFrame(()=>{frame=0;done();});return;}
  paint();frame=requestAnimationFrame(tick);
 };
 frame=requestAnimationFrame(tick);
 return ()=>cancelAnimationFrame(frame);
}

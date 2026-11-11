import {LIQUID_GLASS_OPTICS,LIQUID_GLASS_PHYSICS as P,type LiquidGlassSettings} from '../shared/liquid-glass';

/** Delegated button feedback: keep native clicks, focus, text selection and drag handling. */
export function installGlassInteractions(settings:()=>LiquidGlassSettings,setStrength:(node:HTMLElement,strength:number)=>void){
 type Press={node:HTMLElement;pointer:number;x:number;y:number;transform:string;origin:string;base:string;dx:number;dy:number;tx:number;ty:number};
 let press:Press|undefined,paintFrame=0,springFrame=0,lastPointer:{x:number;y:number}|undefined;
 function restore(p:Press){p.node.style.transform=p.transform;p.node.style.transformOrigin=p.origin;p.node.removeAttribute('data-liquid-pressed');}
 let rebounding:Press|undefined;
 function cancelSpring(){if(springFrame)cancelAnimationFrame(springFrame);springFrame=0;if(rebounding)restore(rebounding);rebounding=undefined;}
 function paint(){
  paintFrame=0;const p=press,point=lastPointer;if(!p||!point)return;
  if(!p.node.isConnected){end();return;}
  const gain=settings().motion/100,dx=point.x-p.x,dy=point.y-p.y,distance=Math.hypot(dx,dy),ux=distance?dx/distance:0,uy=distance?dy/distance:0,k=Math.min(P.press.stretchMax,distance/P.press.distance);
  p.dx=(P.press.scaleX*(1+k)-1)*gain;p.dy=(P.press.scaleY*(1+k*P.press.yRatio)-1)*gain;p.tx=ux*k*P.press.translate*gain;p.ty=uy*k*P.press.translate*gain;
  if(gain){p.node.style.transformOrigin=`${50-ux*P.press.originShift}% ${50-uy*P.press.originShift}%`;p.node.style.transform=`translate(${p.tx}px,${p.ty}px) scale(${1+p.dx},${1+p.dy}) ${p.base}`;}
 }
 function down(e:PointerEvent){
  if(e.button!==0||!(e.target instanceof Element))return;
  const button=e.target.closest<HTMLButtonElement>('button:not(:disabled)');if(!button||button.closest('[inert]'))return;
  // A card's main button moves the whole card; its side actions still press alone.
  const node=button.matches('.action-card-main')&&button.closest<HTMLElement>('.action-card')||button;
  // Dense task panels use their hover/focus and status feedback without
  // also springing the control and lighting up the surrounding workspace.
  if(node.closest('.settings-modal,.topic-panel,.topic-dialog'))return;
  if(press)end();cancelSpring();
  const computed=getComputedStyle(node).transform;
  press={node,pointer:e.pointerId,x:e.clientX,y:e.clientY,transform:node.style.transform,origin:node.style.transformOrigin,base:computed==='none'?'':computed,dx:0,dy:0,tx:0,ty:0};lastPointer={x:e.clientX,y:e.clientY};
  node.dataset.liquidPressed='';setStrength(node,LIQUID_GLASS_OPTICS.pressThickness);paint();
 }
 function move(e:PointerEvent){if(press?.pointer!==e.pointerId)return;lastPointer={x:e.clientX,y:e.clientY};if(!paintFrame)paintFrame=requestAnimationFrame(paint);}
 function end(){
  const p=press;if(!p)return;press=undefined;lastPointer=undefined;if(paintFrame)cancelAnimationFrame(paintFrame);paintFrame=0;
  setStrength(p.node,1);p.node.removeAttribute('data-liquid-pressed');
  if(!settings().motion||!p.node.isConnected){restore(p);return;}
  const start=performance.now();rebounding=p;
  function spring(now:number){
   const t=Math.min(1,(now-start)/P.spring.duration),decay=Math.exp(-P.spring.damping*t)*Math.cos(P.spring.frequency*t)*P.spring.releaseGain;
   if(t<1&&p!.node.isConnected&&settings().motion){p!.node.style.transform=`translate(${p!.tx*decay}px,${p!.ty*decay}px) scale(${1+p!.dx*decay},${1+p!.dy*decay}) ${p!.base}`;springFrame=requestAnimationFrame(spring);}
   else{restore(p!);springFrame=0;rebounding=undefined;}
  }
  springFrame=requestAnimationFrame(spring);
 }
 const up=(e:PointerEvent)=>{if(press?.pointer===e.pointerId)end();};
 document.addEventListener('pointerdown',down);document.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);window.addEventListener('blur',end);
 return()=>{if(press){setStrength(press.node,1);restore(press);press=undefined;}if(paintFrame)cancelAnimationFrame(paintFrame);cancelSpring();document.removeEventListener('pointerdown',down);document.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('blur',end);};
}

import {useLayoutEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import './topic-focus.css';

/** Lightly dim the surrounding workspace without intercepting reading/scrolling. */
export function TopicFocusShade({panel}:{panel:HTMLElement|null}){
 const [path,setPath]=useState('');
 useLayoutEffect(()=>{
  if(!panel){setPath('');return;}
  let frame=0,stopped=false;
  const animations=panel.getAnimations().filter(animation=>animation.playState==='running');
  let animating=animations.length>0;
  function schedule(){if(!stopped&&!frame)frame=requestAnimationFrame(measure);}
  function measure(){
   frame=0;if(stopped)return;
   const box=panel!.getBoundingClientRect();
   if(!box.width||!box.height){setPath('');return;}
   const {left:x,top:y,right,bottom}=box,r=Math.min(parseFloat(getComputedStyle(panel!).borderTopLeftRadius)||0,box.width/2,box.height/2);
   // An even-odd cutout leaves the panel itself at its original brightness.
   setPath(`M0 0H${innerWidth}V${innerHeight}H0Z M${x+r} ${y}H${right-r}A${r} ${r} 0 0 1 ${right} ${y+r}V${bottom-r}A${r} ${r} 0 0 1 ${right-r} ${bottom}H${x+r}A${r} ${r} 0 0 1 ${x} ${bottom-r}V${y+r}A${r} ${r} 0 0 1 ${x+r} ${y}Z`);
   if(animating)schedule();
  }
  const resize=new ResizeObserver(schedule);resize.observe(panel);
  if(panel.parentElement)resize.observe(panel.parentElement);
  window.addEventListener('resize',schedule);
  if(animating)void Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{animating=false;schedule();});
  measure();
  return()=>{stopped=true;cancelAnimationFrame(frame);resize.disconnect();window.removeEventListener('resize',schedule);};
 },[panel]);
 return path?createPortal(<svg className="topic-focus-shade" aria-hidden="true" focusable="false"><path d={path} fillRule="evenodd"/></svg>,document.body):null;
}

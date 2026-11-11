import {restFarMessages} from '../motion/rest-far-messages';
import {useLayoutEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {LIQUID_GLASS_PHYSICS as P} from '../../shared/liquid-glass';
import {useMotionLevel} from '../motion/use-motion-level';
import {castEnds,paintCast} from '../sidebar-spring';
import {runSpring} from './spring-runner';
import type {Edge} from './use-tab-bubble';

const shaped=(workspace:HTMLElement)=>[...workspace.querySelectorAll<HTMLElement>('.page-turn-live :is(.room-message-content,.room-composer>.composer)')];
const unshape=(node:HTMLElement)=>{for(const name of ['width','max-width','flex','margin-inline'])node.style.removeProperty(name);};
type Placed={panel:HTMLElement;workspace:HTMLElement;travel:number;room:number;contentWidth?:number;rested:HTMLElement[];shapes:{node:HTMLElement;wide:number;narrow:number}[]};

/** Springs a panel in from the right or bottom. Conversations reflow in the space left each frame,
 *  keeping their glass geometry and project columns in step. Other pages retain their whole-page slide.
 *  Returns whether the panel stays mounted, including while it leaves. */
export function useDrawer(shown:boolean,axis:'x'|'y',find:()=>{panel:HTMLElement|null;workspace:HTMLElement|null}){
 const motion=useMotionLevel(),[moving,setMoving]=useState(false),[seen,setSeen]=useState(shown),open=useRef<Edge>({x:shown?1:0,v:0}),ends=useRef<ReturnType<typeof castEnds>>(null),placed=useRef<Placed|null>(null),latest=useRef(find);latest.current=find;
 if(seen!==shown){setSeen(shown);if(motion!=='off'&&!document.hidden)setMoving(true);else open.current={x:shown?1:0,v:0};}
 useLayoutEffect(()=>{
  const {panel,workspace}=latest.current();
  if(!moving||!panel||!workspace)return;
  const root=document.documentElement,goal=shown?1:0,page=workspace.querySelector<HTMLElement>('.page-turn'),side=workspace.querySelector<HTMLElement>('.preview-conversation'),body=workspace.querySelector<HTMLElement>('.preview-workspace-body');
  if(panel.dataset.drawerMoving===undefined){
   // Float an opening panel before anything reads the layout, or the page is laid out narrow only to go back.
   if(shown)panel.dataset.drawerMoving='';
   const style=getComputedStyle(panel),travel=axis==='x'?panel.offsetWidth+parseFloat(style.marginLeft)+parseFloat(style.marginRight):panel.offsetHeight+parseFloat(style.marginTop)+parseFloat(style.marginBottom);
   const reflow=!!side?.querySelector('.project-room,.room'),rested=axis==='x'?restFarMessages(workspace):[],nodes=axis==='x'&&!reflow?shaped(workspace):[];
   // With the far messages resting the page lays out cheaply, so both shapes are simply measured.
   delete panel.dataset.drawerMoving;const narrow=nodes.map(node=>node.offsetWidth),beside=side?.clientWidth??0;
   panel.dataset.drawerMoving='';root.dataset.panelMoving='';
   // The page gives up what the layout takes, which is more than the panel: there is a gap beside it.
   placed.current={panel,workspace,travel,contentWidth:axis==='x'&&reflow?side?.clientWidth:undefined,room:axis==='x'&&side?side.clientWidth-beside:travel,rested,shapes:nodes.map((node,index)=>({node,wide:node.offsetWidth,narrow:narrow[index]}))};
   if(axis==='x')ends.current=castEnds(workspace,placed.current.room,goal);
   if(axis==='y'&&body){body.style.height=`${body.offsetHeight}px`;body.dataset.fullHeight=String(body.offsetHeight);body.style.flex='none';}
  }
  const {travel,room,shapes,contentWidth}=placed.current!,full=Number(body?.dataset.fullHeight??0);
  const paint=()=>{
   const x=open.current.x,hidden=Math.max(0,1-x);
   panel.style.translate=axis==='x'?`${hidden*travel}px 0`:`0 ${hidden*travel}px`;
   if(axis==='x'){
    // Reflow text pages; standee pages keep their cheaper whole-page movement.
    if(contentWidth!==undefined&&side){side.style.flex='none';side.style.width=`${Math.max(0,contentWidth-room*x)}px`;}
    else{if(side)side.style.translate=`${-room*x}px 0`;if(page)page.style.translate=`${room*x/2}px 0`;}
    for(const {node,wide,narrow} of shapes)Object.assign(node.style,{width:`${wide+(narrow-wide)*x}px`,maxWidth:'none',flex:'none',marginInline:'auto'});
    paintCast(ends.current,x);
   }else if(body)body.style.height=`${full-travel*x}px`;
   window.dispatchEvent(new Event('hivelab:panel-frame'));
  };
  paint();
  return runSpring(open,goal,motion==='full'?P.sidebar:P.sidebarReduced,Math.max(travel,room),paint,()=>flushSync(()=>setMoving(false)));
 },[moving,shown,motion,axis]);
 // Lands in the same commit as the final layout, so no frame shows the two disagreeing.
 useLayoutEffect(()=>{
  const landed=placed.current;if(moving||!landed)return;
  const {panel,workspace,rested,shapes}=landed,page=workspace.querySelector<HTMLElement>('.page-turn'),side=workspace.querySelector<HTMLElement>('.preview-conversation'),body=workspace.querySelector<HTMLElement>('.preview-workspace-body');
  placed.current=null;ends.current=null;delete panel.dataset.drawerMoving;panel.style.removeProperty('translate');page?.style.removeProperty('translate');side?.style.removeProperty('translate');
  if(landed.contentWidth!==undefined){side?.style.removeProperty('width');side?.style.removeProperty('flex');}
  if(body){body.style.removeProperty('height');body.style.removeProperty('flex');delete body.dataset.fullHeight;}
  for(const {node} of shapes)unshape(node);
  for(const row of rested){delete row.dataset.motionResting;row.style.removeProperty('height');row.style.removeProperty('content-visibility');}
  if(!document.querySelector('[data-drawer-moving]'))delete document.documentElement.dataset.panelMoving;
  window.dispatchEvent(new Event('hivelab:page-turned'));
 },[moving]);
 return shown||moving;
}

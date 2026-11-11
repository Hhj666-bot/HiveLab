import {restFarMessages} from './motion/rest-far-messages';
import {useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {flushSync} from 'react-dom';
import {castLayout,castMiddle} from '../shared/cast-layout';
import {LIQUID_GLASS_PHYSICS as P} from '../shared/liquid-glass';
import type {SidebarPreference} from './appearance-preferences';
import {runSpring} from './app/spring-runner';
import type {Edge} from './app/use-tab-bubble';
import {useMotionLevel} from './motion/use-motion-level';

/** The folded column, the sidebar's left margin, and what its border and padding take from its content. */
const FOLDED=84,MARGIN=8,CHROME=42;
const ICONS='svg,img,.avatar,.status-dot';
type Mode=SidebarPreference['mode'];
/** The conversation's column and composer, measured in the layout the trip runs on (folded, wide) and in the expanded one. */
type Shape={node:HTMLElement;wide:number;narrow:number;wideCenter:number;narrowCenter:number};
const SHAPED='.page-turn-live :is(.room-message-content,.room-composer>.composer)';
const unshape=(node:HTMLElement)=>{for(const name of ['width','max-width','flex','margin-inline','translate'])node.style.removeProperty(name);};
/** Both resting shapes of the chat, folded and expanded, read with the far messages resting so each layout is cheap.
 *  The trip's own layout is not a resting one (the message list's scrollbar gutter differs), so it is not measured.
 *  Everything is read before anything is written. */
function measureShapes(app:HTMLElement):Shape[]{
 const root=document.documentElement,nodes=[...app.querySelectorAll<HTMLElement>(SHAPED)];if(!nodes.length)return [];
 const box=(node:HTMLElement)=>{const r=node.getBoundingClientRect();return {width:r.width,center:r.left+r.width/2};};
 delete root.dataset.sidebarMoving;
 app.classList.replace('sidebar-expanded','sidebar-icons');const wide=nodes.map(box);
 app.classList.replace('sidebar-icons','sidebar-expanded');const narrow=nodes.map(box);
 root.dataset.sidebarMoving='';
 return nodes.map((node,index)=>({node,wide:wide[index].width,narrow:narrow[index].width,wideCenter:wide[index].center,narrowCenter:narrow[index].center}));
}

/** The standees are not laid out on the way either. Knowing where each width puts them, every figure walks to its
 *  place and grows or shrinks evenly, so none is ever squeezed out of shape. StandeeHome lets go of them in the
 *  commit that takes the real size. */
export function castEnds(app:HTMLElement,travel:number,goal:number){
 const cast=app.querySelector<HTMLElement>('.standee-cast');if(!cast)return null;
 const figures=[...cast.children] as HTMLElement[],count=Math.max(1,figures.length),density=Number(cast.dataset.density),width=cast.clientWidth;
 const wide={layout:castLayout(width,cast.clientHeight,count,density),width},narrow={layout:castLayout(width-travel,cast.clientHeight,count,density),width:width-travel};
 // The cast is laid out for the end the spring leaves from.
 const [from,to]=goal?[wide,narrow]:[narrow,wide],grow=to.layout.height/from.layout.height;
 for(const node of figures)node.style.transformOrigin='50% 100%';
 return {goal,grow,figures:figures.map((node,index)=>({node,shift:castMiddle(to.layout,to.width,count,index)-castMiddle(from.layout,from.width,count,index)}))};
}
export function paintCast(stage:ReturnType<typeof castEnds>,x:number){
 if(!stage)return;const along=stage.goal?x:1-x;
 for(const {node,shift} of stage.figures){node.style.translate=`${shift*along}px 0`;node.style.scale=String(1+(stage.grow-1)*along);}
}
/** Everything in the expanded sidebar starts from where the folded one shows it: icons travel from
 *  their folded place, what folding hides fades, and the two bubbles grow from their folded shape. */
function prepare(app:HTMLElement,side:HTMLElement){
 // The page tabs' icons ride in their track, which travels as a whole.
 const root=document.documentElement,icons=[...side.querySelectorAll<HTMLElement>(ICONS)].filter(node=>!node.parentElement?.closest(ICONS)&&!node.closest('.sidebar-workspace-tabs,.project-add'));
 const shapes=[...side.querySelectorAll<HTMLElement>('.sidebar-workspace-tabs,.roster-bubble,.project-add')],open=new Map([...icons,...shapes].map(node=>[node,node.getBoundingClientRect()]));
 const projects=side.querySelector<HTMLElement>('.sidebar-project-section'),openHeight=projects?.getBoundingClientRect().height??0;
 delete root.dataset.sidebarMoving;app.classList.replace('sidebar-expanded','sidebar-icons');
 const folded=new Map([...icons,...shapes].map(node=>[node,node.getClientRects().length?node.getBoundingClientRect():undefined]));
 const foldedHeight=projects?.getBoundingClientRect().height??0;
 const fading=[...side.querySelectorAll<HTMLElement>('*')].filter(node=>!node.getClientRects().length&&node.parentElement?.getClientRects().length);
 app.classList.replace('sidebar-icons','sidebar-expanded');root.dataset.sidebarMoving='';
 for(const node of fading)node.dataset.sidebarFade='';
 // Folded, the projects take less height and the roster shows more people, so the space changes hands gradually.
 projects?.style.setProperty('--fold-height',`${foldedHeight}px`);projects?.style.setProperty('--open-height',`${openHeight}px`);
 for(const node of icons){
  const from=folded.get(node),to=open.get(node)!;if(!from)continue;
  node.dataset.sidebarIcon='';node.style.setProperty('--fold-x',`${from.x+from.width/2-to.x-to.width/2}px`);node.style.setProperty('--fold-y',node.closest('.sidebar-project-section')?'0px':`${from.y+from.height/2-to.y-to.height/2}px`);node.style.setProperty('--fold-scale',String(to.width?from.width/to.width:1));
 }
 for(const node of shapes){
  const from=folded.get(node);if(!from)continue;
  node.style.setProperty('--fold-left',`${from.x-open.get(node)!.x}px`);node.style.setProperty('--fold-width',`${from.width}px`);if(node.matches('.project-add'))node.style.setProperty('--open-width',`${open.get(node)!.width}px`);
 }
}
function release(app:HTMLElement,side:HTMLElement){
 for(const node of side.querySelectorAll<HTMLElement>('[data-sidebar-fade]'))delete node.dataset.sidebarFade;
 for(const node of side.querySelectorAll<HTMLElement>('[data-sidebar-icon]')){delete node.dataset.sidebarIcon;for(const name of ['--fold-x','--fold-y','--fold-scale'])node.style.removeProperty(name);}
 for(const node of side.querySelectorAll<HTMLElement>('.sidebar-workspace-tabs,.roster-bubble,.project-add'))for(const name of ['--fold-left','--fold-width','--open-width'])node.style.removeProperty(name);
 for(const name of ['--fold-height','--open-height'])side.querySelector<HTMLElement>('.sidebar-project-section')?.style.removeProperty(name);
 for(const name of ['width','--sidebar-open','--sidebar-text','--sidebar-content','--sidebar-squash'])side.style.removeProperty(name);
 for(const node of app.querySelectorAll<HTMLElement>('.sidebar-edge-controls,.page-turn,.preview-workspace-leading-tools,.workspace,.file-preview-workspace')){node.style.removeProperty('left');node.style.removeProperty('translate');}
 app.style.removeProperty('grid-template-columns');
 delete document.documentElement.dataset.sidebarMoving;
 window.dispatchEvent(new Event('hivelab:page-turned'));
}

/** Springs the sidebar between folded and expanded. Text pages reflow with its column;
 *  other pages move as a whole while their standees follow the space left. Returns the mode to show. */
export function useSidebarSpring(mode:Mode,width:number,shell:RefObject<HTMLDivElement|null>):Mode{
 const motion=useMotionLevel(),[moving,setMoving]=useState(false),[seen,setSeen]=useState(mode),open=useRef<Edge>({x:mode==='expanded'?1:0,v:0}),ends=useRef<ReturnType<typeof castEnds>>(null),rested=useRef<HTMLElement[]>([]),shapes=useRef<Shape[]>([]);
 if(seen!==mode){setSeen(mode);if(motion!=='off'&&seen!=='hidden'&&mode!=='hidden'&&!document.hidden)setMoving(true);else open.current={x:mode==='expanded'?1:0,v:0};}
 useLayoutEffect(()=>{
  const app=shell.current,side=app?.querySelector<HTMLElement>('.sidebar');if(!moving||!app||!side)return;
  const root=document.documentElement,goal=mode==='expanded'?1:0,full=Math.min(width,innerWidth*.45)+24,travel=full-FOLDED,spring=motion==='full'?P.sidebar:P.sidebarReduced;
  const edge=app.querySelector<HTMLElement>('.sidebar-edge-controls'),page=app.querySelector<HTMLElement>('.page-turn'),leading=app.querySelector<HTMLElement>('.preview-workspace-leading-tools'),main=app.querySelector<HTMLElement>('.workspace'),inner=app.querySelector<HTMLElement>('.file-preview-workspace');
  const reflow=!!app.querySelector('.project-room,.room');
  const paint=()=>{
   const x=open.current.x,column=FOLDED+travel*x,shift=travel*x;
   // The bubbles flatten a little at speed and swell a little past the goal, then round out.
   const past=(x-goal)*(goal?1:-1),squash=motion==='full'?Math.max(-.1,Math.min(.07,Math.max(0,past)*1.4-Math.abs(open.current.v)*.02)):0;
   side.style.setProperty('--sidebar-squash',String(squash));
   side.style.width=`${column-MARGIN}px`;side.style.setProperty('--sidebar-open',String(x));side.style.setProperty('--sidebar-text',String(Math.max(0,Math.min(1,(x-.25)/.55))));
   if(edge)edge.style.left=`${column-14}px`;
   // Centred content follows the middle of the space that is left, and leading content its edge.
   if(reflow)app.style.gridTemplateColumns=`${column}px minmax(0,1fr)`;
   else{if(page)page.style.translate=`${shift/2}px 0`;if(leading)leading.style.translate=`${shift}px 0`;
   // The main area's edge meets the sidebar and cuts off what no longer fits, so the sidebar's glass only ever
   // has the wallpaper behind it, as it will at rest. The content inside moves back and stays where it was.
   if(main)main.style.translate=`${shift}px 0`;if(inner)inner.style.translate=`${-shift}px 0`;}
   // The chat takes its new width as it goes instead of switching at one end: its column and composer narrow (or widen)
   // with the spring and arrive exactly where the final layout puts them. Only the visible messages re-wrap each frame.
   for(const item of shapes.current)Object.assign(item.node.style,{width:`${item.wide+(item.narrow-item.wide)*x}px`,maxWidth:'none',flex:'none',marginInline:'auto',translate:`${(item.narrowCenter-item.wideCenter)*x-shift/2}px 0`});
   paintCast(ends.current,x);
  };
  if(root.dataset.sidebarMoving===undefined){window.dispatchEvent(new Event('hivelab:sidebar-will-move'));if(goal)root.dataset.sidebarMoving='';rested.current=restFarMessages(app);root.dataset.sidebarMoving='';shapes.current=reflow?[]:measureShapes(app);side.style.setProperty('--sidebar-content',`${full-MARGIN-CHROME}px`);prepare(app,side);ends.current=castEnds(app,travel,goal);}
  paint();
  return runSpring(open,goal,spring,travel,paint,()=>flushSync(()=>setMoving(false)));
 },[moving,mode,motion,width,shell]);
 // Lands in the same commit as the final layout, so no frame shows the two disagreeing.
 useLayoutEffect(()=>{const app=shell.current,side=app?.querySelector<HTMLElement>('.sidebar');if(!moving&&app&&side&&document.documentElement.dataset.sidebarMoving!==undefined){release(app,side);for(const item of shapes.current)unshape(item.node);shapes.current=[];for(const row of rested.current){delete row.dataset.motionResting;row.style.removeProperty('height');row.style.removeProperty('content-visibility');}rested.current=[];}},[moving,shell]);
 return moving?'expanded':mode;
}

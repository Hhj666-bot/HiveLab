import {afterPageReady} from './page-readiness';
import {Component,createRef,useRef,type ReactNode} from 'react';
import {useMotionLevel} from '../motion/use-motion-level';
import type {MotionLevel} from '../../shared/motion';
import './page-turn.css';

/** EASING is --ease-drawer; every sheet is animated from script so they all start on one frame. */
export const TURN_MS=420,FADE_MS=240,EASING='cubic-bezier(.32,.72,0,1)';
const GAP=32;
/** Sent as a wallpaper starts to turn in, so a page that waited for it turns on the same frame. */
export const WALLPAPER_TURN='hivelab:wallpaper-turn';
const LIVE='canvas,textarea,input,select,iframe,video',TOOLBAR=['.preview-workspace-leading-tools','.preview-workspace-controls'],PINNED='.room-composer';
let copies=0;

/** Which way the strip turns for this page: further down the sidebar turns forward. */
export function useTurnDirection(page:string,rank:number){
 const seen=useRef({page,rank,direction:1});
 if(seen.current.page!==page)seen.current={page,rank,direction:rank>=seen.current.rank?1:-1};
 return seen.current.direction;
}
/** One sheet of the strip. The wallpaper uses it too, so a page stays on its own picture while they turn. */
export const pageStep=()=>(document.querySelector('.page-turn')?.clientHeight??innerHeight)+GAP;

/** A copy keeps the glass of the page it shows; the original filters leave with the original surfaces. */
function keepGlass(copy:HTMLElement){
 const serial=++copies,filters=document.createElementNS('http://www.w3.org/2000/svg','svg');
 filters.classList.add('page-turn-filters');
 for(const node of copy.querySelectorAll<HTMLElement>('[data-liquid-surface]')){
  const id=/#([^"]+)/.exec(node.style.getPropertyValue('--liquid-refraction'))?.[1],filter=id&&document.getElementById(id);
  if(!filter)continue;
  const twin=filter.cloneNode(true) as SVGFilterElement;twin.id=`${id}-page-${serial}`;filters.append(twin);node.style.setProperty('--liquid-refraction',`url("#${twin.id}")`);
 }
 copy.append(filters);
}
/** Clone only visible history rows. Pruning after cloneNode(true) still copies every
 * code block, image and glass surface in the hidden history before throwing them away. */
export function cloneVisiblePage(source:HTMLElement){
 const content=source.querySelector<HTMLElement>('.room-message-content'),list=content?.parentElement;
 const path=new Set<Element>(),from:HTMLElement[]=[],to:HTMLElement[]=[];
 let start=0,end=Infinity,top=0,bottom=0;
 if(content&&list){
  const view=list.getBoundingClientRect(),box=content.getBoundingClientRect(),style=getComputedStyle(content),rows=[...content.children].map(row=>row.getBoundingClientRect());
  const shown=rows.flatMap((row,index)=>row.bottom>view.top&&row.top<view.bottom?[index]:[]);
  if(shown.length){
   start=shown[0];end=shown.at(-1)!;
   top=rows[start].top-box.top-parseFloat(style.paddingTop);bottom=box.bottom-rows[end].bottom-parseFloat(style.paddingBottom);
   for(let node:Element|null=content;node;node=node.parentElement){path.add(node);if(node===source)break;}
  }
 }
 function clone(node:HTMLElement):HTMLElement{
  const copy=node.cloneNode(!path.has(node)) as HTMLElement;
  if(node!==source){from.push(node);to.push(copy);}
  if(!path.has(node)){from.push(...node.querySelectorAll<HTMLElement>('*'));to.push(...copy.querySelectorAll<HTMLElement>('*'));return copy;}
  let index=0;
  for(const child of node.childNodes){
   if(!(child instanceof Element)){copy.append(child.cloneNode(true));continue;}
   const at=index++;if(node===content&&(at<start||at>end))continue;
   const twin=clone(child as HTMLElement);copy.append(twin);
   if(node===content){if(at===start)twin.style.marginTop=`${top}px`;if(at===end)twin.style.marginBottom=`${bottom}px`;}
  }
  return copy;
 }
 return {copy:clone(source),from,to};
}
/** A still copy of a page: it looks the same but runs nothing, and frames and videos would start over. */
function stillCopy(source:HTMLElement){
 const {copy,from,to}=cloneVisiblePage(source);
 const scrolled=from.flatMap((node,index)=>node.scrollTop||node.scrollLeft?[{node:to[index],top:node.scrollTop,left:node.scrollLeft}]:[]);
 from.forEach((node,index)=>{
  if(!node.matches(LIVE))return;
  const twin=to[index];
  if(node instanceof HTMLIFrameElement||node instanceof HTMLVideoElement)twin.remove();
  else if(node instanceof HTMLCanvasElement){const canvas=twin as HTMLCanvasElement;canvas.width=node.width;canvas.height=node.height;try{canvas.getContext('2d')?.drawImage(node,0,0);}catch{/* A canvas that cannot be read stays blank for this short moment. */}}
  else if(node instanceof HTMLSelectElement)(twin as HTMLSelectElement).value=node.value;
 });
 copy.removeAttribute('data-background-page');keepGlass(copy);
 return {copy,restoreScroll:()=>{for(const item of scrolled){item.node.scrollTop=item.top;item.node.scrollLeft=item.left;}}};
}
/** The same copy reduced to the part every chat page shares. */
function pinnedCopy(copy:HTMLElement){
 const part=copy.querySelector<HTMLElement>(PINNED),room=part?.parentElement;if(!part||!room)return;
 const others=[...room.children].filter(child=>child!==part);others.forEach(child=>child.remove());
 const still=copy.cloneNode(true) as HTMLElement;room.prepend(...others);
 return {part,still};
}
function ghostOf(page:HTMLElement,className:string){
 const ghost=document.createElement('div');ghost.className=className;ghost.inert=true;ghost.setAttribute('aria-hidden','true');ghost.append(page);return ghost;
}

/** The toolbar stays put while pages turn, so what it shows for the page fades across instead of sliding. */
function keepToolbar(from:HTMLElement|null){
 const workspace=from?.closest('.file-preview-workspace');
 return TOOLBAR.flatMap(selector=>{
  const part=workspace?.querySelector<HTMLElement>(selector),bar=part?.parentElement;if(!part||!bar||!part.getClientRects().length)return [];
  const rect=part.getBoundingClientRect(),base=bar.getBoundingClientRect(),copy=part.cloneNode(true) as HTMLElement;
  return [{part,bar,copy,box:{left:rect.left-base.left,top:rect.top-base.top,width:rect.width,height:rect.height}}];
 });
}
function crossToolbar(kept:ReturnType<typeof keepToolbar>){
 const options={duration:FADE_MS,easing:'ease'},fades:Animation[]=[];
 for(const {part,bar,copy,box} of kept){
  if(part.isConnected&&part.innerHTML===copy.innerHTML)continue;
  copy.inert=true;copy.setAttribute('aria-hidden','true');
  Object.assign(copy.style,{position:'absolute',margin:'0',pointerEvents:'none',left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
  bar.append(copy);const leaving=copy.animate([{opacity:1},{opacity:0}],options);leaving.onfinish=()=>copy.remove();
  fades.push(leaving,part.animate([{opacity:0},{opacity:1}],options));
 }
 return fades;
}

type Kept={ghost:HTMLElement;toolbar:ReturnType<typeof keepToolbar>;pin?:{part:HTMLElement;still:HTMLElement;rect:DOMRect}};
type Props={page:string;direction:number;motion:MotionLevel;backgroundReady?:boolean;children:ReactNode};
/** Turns the main page. Pages lie on one upright strip that moves with the roster bubble, and a new choice
 *  takes over from wherever the strip is. The old page is a still copy: only the new one stays alive.
 *  What both pages share stays where it is, and the rest passes behind it, so glass there shows the turn. */
class PageStrip extends Component<Props>{
 track=createRef<HTMLDivElement>();live=createRef<HTMLDivElement>();
 slot=0;travel=0;timer=0;running:Animation[]=[];moving:HTMLElement[]=[];waiting=()=>{};
 getSnapshotBeforeUpdate(previous:Props):Kept|null{
  const track=this.track.current,page=this.live.current?.firstElementChild as HTMLElement|null;
  if(previous.page===this.props.page||this.props.motion==='off'||document.hidden||!track||!page)return null;
  const sheet=this.moving.find(node=>node.isConnected);
  this.travel=this.slot*pageStep()-(sheet?new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42:0);
  const {copy,restoreScroll}=stillCopy(page),pinned=pinnedCopy(copy),rect=page.querySelector(PINNED)?.getBoundingClientRect();
  const ghost=ghostOf(copy,'page-turn-ghost');ghost.dataset.slot=String(this.slot);track.append(ghost);restoreScroll();
  return {ghost,toolbar:keepToolbar(track),pin:pinned&&rect&&{...pinned,rect}};
 }
 componentDidUpdate(_previous:Props,_state:unknown,kept:Kept|null){
  if(!kept)return;
  const fades=crossToolbar(kept.toolbar);
  // The turn is the page's entrance. A fade on top would also cut its glass off from what lies behind.
  for(const animation of this.live.current!.getAnimations({subtree:true}))if(animation instanceof CSSAnimation&&animation.effect?.getTiming().iterations!==Infinity)animation.finish();
  const sheets=this.sheets(kept);
  if(this.props.motion==='full')this.slide(this.props.direction,sheets,fades);else this.fade(kept.ghost,sheets,fades);
 }
 componentWillUnmount(){clearTimeout(this.timer);this.waiting();}
 /** The parts of the new page that turn: all of it, unless it holds the old page's shared part in the same spot. */
 sheets({pin}:Kept){
  const live=this.live.current!,track=this.track.current!,bar=live.querySelector<HTMLElement>(PINNED),room=bar?.parentElement,now=bar?.getBoundingClientRect();
  const same=!!pin&&!!now&&!!room&&Math.abs(room.offsetHeight-track.clientHeight)<2&&Math.abs(now.left-pin.rect.left)<2&&Math.abs(now.right-pin.rect.right)<2&&Math.abs(now.bottom-pin.rect.bottom)<2;
  if(!same)return [live];
  pin.part.style.visibility='hidden';
  const ghost=ghostOf(pin.still,'page-turn-ghost page-turn-pinned');track.append(ghost);
  ghost.animate([{opacity:1},{opacity:0}],{duration:FADE_MS,easing:'ease'}).onfinish=()=>ghost.remove();
  return [...room.children].filter(child=>child!==bar) as HTMLElement[];
 }
 slide(direction:number,sheets:HTMLElement[],fades:Animation[]){
  const track=this.track.current!,step=pageStep(),from=this.travel;this.slot+=direction;
  const to=this.slot*step,ghosts=[...track.querySelectorAll<HTMLElement>('.page-turn-ghost[data-slot]')];
  const move=(node:HTMLElement,slot:number)=>node.animate([{transform:`translateY(${slot*step-from}px)`},{transform:`translateY(${slot*step-to}px)`}],{duration:TURN_MS,easing:EASING,fill:'both'});
  for(const animation of this.running)animation.cancel();
  // Turning back: the page returns to the slot its copy kept for it.
  for(const ghost of ghosts)if(Number(ghost.dataset.slot)===this.slot)ghost.remove();
  this.running=[...ghosts.filter(ghost=>ghost.isConnected).map(ghost=>move(ghost,Number(ghost.dataset.slot))),...sheets.map(sheet=>move(sheet,this.slot))];
  this.moving=sheets;this.begin(TURN_MS,fades);
 }
 fade(ghost:HTMLElement,sheets:HTMLElement[],fades:Animation[]){
  const options={duration:FADE_MS,easing:'ease',fill:'both'} as const;
  this.running=[ghost.animate([{opacity:1},{opacity:0}],options),...sheets.map(sheet=>sheet.animate([{opacity:0},{opacity:1}],options))];
  this.begin(FADE_MS,fades);
 }
 /** A page whose wallpaper is still on its way holds at its first frame until the wallpaper turns, so the two
  *  arrive together and nothing of the new page shows over the old picture. */
 begin(duration:number,fades:Animation[]){
  clearTimeout(this.timer);
  this.waiting();
  const held=[...this.running,...fades];for(const animation of held)animation.pause();
  let ready=false,cancelReady=()=>{};
  const stop=()=>{cancelReady();window.removeEventListener(WALLPAPER_TURN,go);this.waiting=()=>{};};
  const go=()=>{if(!ready||document.querySelector('.home-background[data-arriving]'))return;stop();for(const animation of held)animation.play();this.settle(duration);};
  window.addEventListener(WALLPAPER_TURN,go);
  cancelReady=afterPageReady(()=>{ready=true;go();});
  this.waiting=()=>{stop();for(const animation of fades)animation.finish();};
 }
 settle(after:number){
  clearTimeout(this.timer);
  this.timer=window.setTimeout(()=>{
   const track=this.track.current;if(!track)return;
   if(this.running.some(animation=>animation.playState==='running')){this.settle(60);return;}
   for(const animation of this.running)animation.cancel();
   track.querySelectorAll('.page-turn-ghost').forEach(ghost=>ghost.remove());
   this.running=[];this.moving=[];this.slot=0;this.travel=0;
   window.dispatchEvent(new Event('hivelab:page-turned'));
  },after+40);
 }
 render(){return <div className="page-turn" ref={this.track} data-background-pending={this.props.backgroundReady===false?'':undefined}><div className="page-turn-live" ref={this.live}>{this.props.children}</div></div>;}
}
export function PageTurn(props:Omit<Props,'motion'>){return <PageStrip {...props} motion={useMotionLevel()}/>;}

import {useEffect,useRef,useState,type PointerEvent,type RefObject} from 'react';
import {insertMember,type InsertionTarget} from '../shared/arrange';

export function useInsertionArrange(ids:string[],ready:boolean,axis:'x'|'y',container:RefObject<HTMLElement|null>,save:(ids:string[])=>Promise<unknown>){
 const [preview,setPreview]=useState<string[]>(),[moving,setMoving]=useState(''),[offset,setOffset]=useState(0),[target,setTarget]=useState<InsertionTarget>(),[saving,setSaving]=useState(false);
 const press=useRef<{id:string;start:number;x:number;y:number;pointer:number;owner:HTMLElement;armed:boolean;target?:InsertionTarget}>(undefined);
 const timer=useRef<number>(undefined),frame=useRef(0),suppressed=useRef(false);
 const order=ids.join('\0');
 useEffect(()=>{if(preview&&(preview.length!==ids.length||preview.some(id=>!ids.includes(id))||preview.every((id,i)=>ids[i]===id)))setPreview(undefined);},[order,preview]);
 function cancel(){
  clearTimeout(timer.current);cancelAnimationFrame(frame.current);frame.current=0;
  const p=press.current;press.current=undefined;setMoving('');setOffset(0);setTarget(undefined);
  if(p?.owner.hasPointerCapture(p.pointer))p.owner.releasePointerCapture(p.pointer);
  if(p?.armed)setTimeout(()=>{suppressed.current=false;},0);
 }
 useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};window.addEventListener('blur',cancel);window.addEventListener('keydown',escape);return()=>{window.removeEventListener('blur',cancel);window.removeEventListener('keydown',escape);clearTimeout(timer.current);cancelAnimationFrame(frame.current);const p=press.current;press.current=undefined;if(p?.owner.hasPointerCapture(p.pointer))p.owner.releasePointerCapture(p.pointer);};},[]);
 function aim(){
  const p=press.current,list=container.current;if(!p||!list)return;
  const scroll=axis==='y'?list.closest<HTMLElement>('.sidebar-section-scroll')!:list,bounds=scroll.getBoundingClientRect(),point=axis==='x'?p.x:p.y;
  let next:InsertionTarget|undefined;
  if(p.x>=bounds.left-12&&p.x<=bounds.right+12&&p.y>=bounds.top&&p.y<=bounds.bottom&&Math.abs(point-p.start)>=12){
   let distance=Infinity;
   for(const item of list.querySelectorAll<HTMLElement>('[data-arrange-id]')){
    if(item.dataset.arrangeId===p.id)continue;
    const r=item.getBoundingClientRect(),mid=axis==='x'?r.left+r.width/2:r.top+r.height/2,d=Math.abs(point-mid);
    if(d<distance){distance=d;next={id:item.dataset.arrangeId!,edge:point<mid?'before':'after'};}
   }
  }
  if(p.target?.id!==next?.id||p.target?.edge!==next?.edge){p.target=next;setTarget(next);}
 }
 function scrollEdges(){
  const p=press.current,list=container.current;if(!p?.armed||!list)return;
  const scroll=axis==='y'?list.closest<HTMLElement>('.sidebar-section-scroll')!:list,r=scroll.getBoundingClientRect(),point=axis==='x'?p.x:p.y,start=axis==='x'?r.left:r.top,end=axis==='x'?r.right:r.bottom;
  const delta=point<start+28?-10:point>end-28?10:0;
  if(delta){if(axis==='x')scroll.scrollLeft+=delta;else scroll.scrollTop+=delta;aim();}
  frame.current=requestAnimationFrame(scrollEdges);
 }
 function down(event:PointerEvent,id:string){
  if(event.button!==0||!event.isPrimary||!ready||saving)return;
  const owner=(event.target as HTMLElement).closest<HTMLElement>('.roster-row,.standee-chat');if(!owner)return;
  cancel();suppressed.current=false;owner.setPointerCapture(event.pointerId);
  press.current={id,start:axis==='x'?event.clientX:event.clientY,x:event.clientX,y:event.clientY,pointer:event.pointerId,owner,armed:false};
  timer.current=window.setTimeout(()=>{const p=press.current;if(!p)return;p.armed=true;suppressed.current=true;setMoving(id);frame.current=requestAnimationFrame(scrollEdges);},200);
 }
 function move(event:PointerEvent){
  const p=press.current;if(!p||event.pointerId!==p.pointer)return;
  if(!p.armed){if(Math.hypot(event.clientX-p.x,event.clientY-p.y)>8)cancel();return;}
  event.preventDefault();p.x=event.clientX;p.y=event.clientY;setOffset((axis==='x'?p.x:p.y)-p.start);aim();
 }
 function up(event:PointerEvent){
  const p=press.current;if(!p||event.pointerId!==p.pointer)return;
  if(p.armed){p.x=event.clientX;p.y=event.clientY;aim();}
  const current=preview??ids,next=p.armed&&p.target?insertMember(current,p.id,p.target):current;cancel();
  if(next.every((id,i)=>id===current[i]))return;
  setPreview(next);setSaving(true);void save(next).catch(()=>setPreview(undefined)).finally(()=>setSaving(false));
 }
 return {ids:preview??ids,moving,offset,target,down,move,up,cancel,suppressClick:()=>suppressed.current};
}

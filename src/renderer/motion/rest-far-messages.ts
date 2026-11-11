const CHAT_MARGIN=500;
/** A long history takes longer to lay out than a frame, so messages far from view keep their height and sit out the
 *  trip. Only what can be seen follows the spring, and that is cheap enough to do on every frame. */
export function restFarMessages(workspace:HTMLElement){
 const content=workspace.querySelector<HTMLElement>('.page-turn-live .room-message-content'),list=content?.parentElement;if(!content||!list)return [];
 const view=list.getBoundingClientRect();
 // Every position is read before anything is written, or each message would lay the page out again.
 const far=([...content.children] as HTMLElement[]).flatMap(row=>{const box=row.getBoundingClientRect();return box.bottom>view.top-CHAT_MARGIN&&box.top<view.bottom+CHAT_MARGIN?[]:[{row,height:box.height}];});
 for(const {row,height} of far){row.dataset.motionResting='';row.style.height=`${height}px`;row.style.setProperty('content-visibility','hidden');}
 return far.map(item=>item.row);
}

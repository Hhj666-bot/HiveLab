/** First-visit reads must finish before either half of the page/wallpaper turn starts.
 * A failed or stalled read must not hold navigation indefinitely. */
export function afterPageReady(start:()=>void){
 let frame=0,stopped=false;
 const track=document.querySelector('.page-turn');
 const cleanup=()=>{stopped=true;cancelAnimationFrame(frame);clearTimeout(timer);observer.disconnect();};
 const finish=()=>{if(stopped)return;cleanup();start();};
 const check=()=>{frame=0;if(!track?.hasAttribute('data-background-pending')&&!track?.querySelector('.page-turn-live [data-page-loading]'))finish();};
 const schedule=()=>{if(!frame&&!stopped)frame=requestAnimationFrame(check);};
 const observer=new MutationObserver(schedule),timer=window.setTimeout(finish,1500);
 if(track)observer.observe(track,{childList:true,subtree:true,attributes:true,attributeFilter:['data-page-loading','data-background-pending']});
 schedule();return cleanup;
}

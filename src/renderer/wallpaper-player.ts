import {mount,httpSource,type SceneInstance} from 'webwallgl';

const id=new URLSearchParams(location.search).get('source')??'';
let scene:SceneInstance|undefined,paused=false,respectReducedMotion=true,played=false,disposed=false,showPreview=false,fit:'cover'|'contain'='cover';
let preview:HTMLImageElement|undefined,previewTask:Promise<HTMLImageElement|undefined>|undefined;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const send=(state:string,message?:string)=>parent.postMessage({type:'hivelab-wallpaper',id,state,...(message?{message:message.slice(0,400)}:{})},'*');
function staticPreview(){
  return previewTask??=(async()=>{
    try{
      const base=`hivelab-wallpaper://${id}/`,project=await fetch(base+'project.json').then(r=>r.json());
      if(typeof project.preview!=='string')return;
      const url=new URL(project.preview,base);if(url.protocol!=='hivelab-wallpaper:'||url.hostname!==id||!/\.(png|jpe?g|webp|gif)$/i.test(url.pathname))return;
      const image=new Image();image.crossOrigin='anonymous';image.src=url.href;await image.decode();
      // Workshop previews may be animated GIFs. Draw once so reduced motion
      // displays the artwork instead of freezing a scene's black introduction.
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      canvas.getContext('2d')!.drawImage(image,0,0);
      const poster=new Image();poster.src=canvas.toDataURL('image/png');poster.dataset.wallpaperPoster='';poster.alt='';
      poster.style.cssText='position:fixed;inset:0;width:100%;height:100%;background:#000;pointer-events:none';
      await poster.decode();if(disposed)return;preview=poster;document.body.append(poster);return poster;
    }catch{return;}
  })();
}
function sync(){
  const reduced=respectReducedMotion&&reducedMotion.matches,stopped=paused||document.hidden||reduced;
  if(scene){scene.setFit(fit);if(stopped)scene.pause();else{played=true;scene.resume();}}
  showPreview=reduced||paused&&!played;
  const update=(poster:HTMLImageElement|undefined)=>{if(poster){poster.hidden=!showPreview;poster.style.objectFit=fit;}};
  if(showPreview)void staticPreview().then(update);else update(preview);
}
reducedMotion.addEventListener('change',sync);
window.addEventListener('message',event=>{
  if(event.source!==parent||event.data?.type!=='hivelab-wallpaper-control'||event.data.id!==id)return;
  paused=event.data.paused===true;respectReducedMotion=event.data.respectReducedMotion!==false;fit=event.data.fit==='contain'?'contain':'cover';sync();
});
document.addEventListener('visibilitychange',sync);
window.addEventListener('pagehide',()=>{disposed=true;scene?.destroy({releasePkgCache:true});scene=undefined;});
try{
  // Chromium denies persistent CacheStorage in an opaque frame. The renderer already
  // supports an in-memory cache when the API is absent; keep the frame's isolation.
  try{void globalThis.caches;}catch{Object.defineProperty(globalThis,'caches',{value:undefined,configurable:true});}
  scene=await mount(document.getElementById('wallpaper')!,{source:httpSource(`hivelab-wallpaper://${id}`),fit,volume:0,fps:30,renderDpr:1,autoplay:true,audio:null,media:null,bake:false,onDiagnostic:(message,level)=>console[level==='error'?'error':level==='warn'?'warn':'debug']('Wallpaper renderer:',message),onError:error=>send('error',error.message)});
  sync();send('ready');
}catch(error){send('error',error instanceof Error?error.message:String(error));}

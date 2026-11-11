import {LIQUID_GLASS_OPTICS as OPTICS} from '../shared/liquid-glass';

const smoothStep=(a:number,b:number,t:number)=>{t=Math.max(0,Math.min(1,(t-a)/(b-a)));return t*t*(3-2*t);};
/** How far a surface's lens reaches. A longer surface keeps this lens's rim and stays flat between, so what lies
 *  under it shows exactly where it is and only the edge bends. */
const lensReach=(size:number)=>Math.min(size,OPTICS.lensSpan);
export const lensSpan=(width:number,height:number)=>Math.max(lensReach(width),lensReach(height));
const inLens=(at:number,size:number)=>{const c=(at-.5)*size;return Math.sign(c)*Math.max(0,Math.abs(c)-(size-lensReach(size))/2)/lensReach(size);};
/** Inset SDF fragment from xiaofangstudio/liquid-glass-web / Shu Ding (MIT).
 * Displacements stay in CSS pixels when the cached texture is downsampled. */
export function buildRefractionMap(width:number,height:number,edge=1,strength=1,maxPixels=768){
 const factor=Math.min(OPTICS.mapDPI,maxPixels/Math.max(width,height)),w=Math.max(1,Math.round(width*factor)),h=Math.max(1,Math.round(height*factor));
 const displacement=new Uint8ClampedArray(w*h*4),raw=new Float32Array(w*h*2);let maximum=0;
 // The flat middle repeats the same coordinates. Compute each axis once and reuse
 // identical middle rows/columns instead of evaluating the lens for every pixel.
 const reachX=lensReach(width),reachY=lensReach(height),xs=Array.from({length:w},(_,x)=>inLens(x/w,width));
 const qxs=xs.map(ix=>Math.abs(ix)-OPTICS.sdfWidth+OPTICS.radius);
 let middleRow=-1;
 for(let y=0;y<h;y++){
  const iy=inLens(y/h,height),qy=Math.abs(iy)-OPTICS.sdfHeight+OPTICS.radius;
  if(iy===0&&middleRow>=0){raw.copyWithin(y*w*2,middleRow*w*2,(middleRow+1)*w*2);continue;}
  let middleColumn=-1;
  for(let x=0;x<w;x++){
   const ix=xs[x],i=(y*w+x)*2;
   if(ix===0&&middleColumn>=0){raw[i]=raw[middleColumn];raw[i+1]=raw[middleColumn+1];continue;}
   const qx=qxs[x],distance=Math.min(Math.max(qx,qy),0)+Math.hypot(Math.max(qx,0),Math.max(qy,0))-OPTICS.radius;
   const amount=smoothStep(OPTICS.falloff,0,distance-OPTICS.threshold/edge/strength),s=smoothStep(0,1,amount),dx=ix*(s-1)*reachX,dy=iy*(s-1)*reachY;
   raw[i]=dx;raw[i+1]=dy;maximum=Math.max(maximum,Math.abs(dx),Math.abs(dy));
   if(ix===0)middleColumn=i;
  }
  if(iy===0)middleRow=y;
 }
 maximum=Math.max(.001,maximum*OPTICS.normalization);
 for(let i=0,j=0;i<displacement.length;i+=4,j+=2){displacement[i]=(raw[j]/maximum+.5)*255;displacement[i+1]=(raw[j+1]/maximum+.5)*255;displacement[i+3]=255;}
 return {width:w,height:h,scale:maximum,displacement};
}
type Maps={displacement:string;scale:number};
const cache=new Map<string,Maps>();
export function refractionMaps(width:number,height:number,edge=1,strength=1):Maps{
 width=Math.max(4,Math.round(width/4)*4);height=Math.max(4,Math.round(height/4)*4);
 const key=[width,height,edge,strength].join(':'),cached=cache.get(key);if(cached){cache.delete(key);cache.set(key,cached);return cached;}
 const data=buildRefractionMap(width,height,edge,strength),canvas=document.createElement('canvas');canvas.width=data.width;canvas.height=data.height;
 const context=canvas.getContext('2d')!;
 context.putImageData(new ImageData(data.displacement,data.width,data.height),0,0);const result={displacement:canvas.toDataURL(),scale:data.scale};
 // Release the native backing store now; only the encoded texture is cached.
 canvas.width=canvas.height=0;
 cache.set(key,result);if(cache.size>160)cache.delete(cache.keys().next().value!);return result;
}
// A small, current-size lens for animation frames, including uncached heights.
// Keep it separate from resting textures so a long animation cannot evict them.
const movingCache=new Map<string,Maps>();
export function movingRefractionMaps(width:number,height:number,edge=1,strength=1):Maps{
 width=Math.max(4,Math.round(width/4)*4);height=Math.max(4,Math.round(height/4)*4);
 const key=[width,height,edge,strength].join(':'),cached=movingCache.get(key);if(cached)return cached;
 const data=buildRefractionMap(width,height,edge,strength,192),canvas=document.createElement('canvas');canvas.width=data.width;canvas.height=data.height;
 canvas.getContext('2d')!.putImageData(new ImageData(data.displacement,data.width,data.height),0,0);
 const result={displacement:canvas.toDataURL(),scale:data.scale};canvas.width=canvas.height=0;
 movingCache.set(key,result);if(movingCache.size>64)movingCache.delete(movingCache.keys().next().value!);return result;
}

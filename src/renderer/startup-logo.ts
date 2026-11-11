/** Canvas drawing for the startup logo: a switch on a plain plane. Pressing it opens the tunnel in
 * startup-tunnel-gl.ts; the simpler tunnel here takes over when WebGL is unavailable.
 * Whatever the opening shows is a hole in the canvas, so it is the stored wallpaper scene or the live wallpaper. */
export const PRESS_MS=210,PRESS_HOLD_MS=240,TUNNEL_MS=3000;
const clamp=(t:number)=>Math.max(0,Math.min(1,t));
const ease=(t:number)=>t*t*(3-2*t);
export function logoSize(width:number,height:number,ratio=1){return Math.round(Math.max(72,Math.min(108,Math.min(width,height)*.115))*ratio);}
/** Half the window's size at `t` (0 to 1): it starts barely moving and comes to rest as it reaches the screen's edge. */
export function tunnelHalf(plate:number,full:number,t:number){return plate+(full-plate)*ease(clamp(t))**2;}
/** The wallpaper starts far away and arrives just before the window has fully opened, so its edge never shows. */
export function worldScale(t:number){return .72+.28*ease(clamp(t/.92));}
export function tunnelRadius(halfX:number,halfY:number,t:number){return Math.min(halfX,halfY)*.47*(1-ease(clamp(t)));}

export interface LogoCanvas {
 resize():void;
 /** Draws the logo at `press`, or the opening once `elapsed` is set; true when the opening is complete. */
 draw(press:number,elapsed:number|undefined):boolean;
 clear():void;
 /** The pressed logo as two separate pictures, so the tunnel can open the button and send the mark away. */
 layers():{plate:HTMLCanvasElement;glyph:HTMLCanvasElement};
}
const palette={
 light:{base:'#ffffff',line:'rgb(23 76 66 / 34%)',dent:'rgb(23 76 66 / 52%)',bowl:'rgb(23 76 66 / 9%)',lip:'rgb(255 255 255 / 100%)',glyph:'#174c42'},
 dark:{base:'#000000',line:'rgb(255 255 255 / 34%)',dent:'rgb(0 0 0 / 96%)',bowl:'rgb(255 255 255 / 7%)',lip:'rgb(255 255 255 / 30%)',glyph:'#f6f4ec'},
};
const GLYPH='M128 136C128 114 146 96 168 96C190 96 208 114 208 136V376C208 398 190 416 168 416C146 416 128 398 128 376Z M232 222C251 198 278 184 308 184C365 184 400 227 400 288V376C400 398 382 416 360 416C338 416 320 398 320 376V288C320 270 311 260 296 260C273 260 252 277 232 300Z';

/** A logo drawn on the plane itself: at rest only a fine line separates it; pressed, the same shape dents inward. */
function drawLogo(context:CanvasRenderingContext2D,colors:typeof palette.light,cx:number,cy:number,size:number,press:number,parts:{plate?:boolean;glyph?:boolean}={plate:true,glyph:true}){
 const radius=size*.235,x=cx-size/2,y=cy-size/2,line=Math.max(1,size/130);
 const plate=(inset=0)=>{context.beginPath();context.roundRect(x+inset,y+inset,size-inset*2,size-inset*2,Math.max(0,radius-inset));};
 context.save();
 if(parts.plate&&press>0){
  context.save();plate();context.clip();
  const bowl=context.createLinearGradient(0,y,0,y+size);bowl.addColorStop(0,colors.bowl);bowl.addColorStop(.62,'rgb(0 0 0 / 0%)');
  context.globalAlpha=press;context.fillStyle=bowl;context.fillRect(x,y,size,size);
  // The inner shadow falls from the upper rim, the way a dent in a lit surface does.
  context.shadowColor=colors.dent;context.shadowBlur=size*.11*press;context.shadowOffsetY=size*.05*press;
  context.beginPath();context.rect(x-size,y-size,size*3,size*3);context.roundRect(x,y,size,size,radius);context.fillStyle='#000';context.fill('evenodd');
  context.restore();
  // Light catches only the lower lip of the dent.
  context.save();plate();context.clip();context.globalAlpha=press;context.lineWidth=line*2.6;context.strokeStyle=colors.lip;
  context.beginPath();context.roundRect(x,y+line*1.4,size,size,radius);context.stroke();context.restore();
 }
 if(parts.plate){plate(line/2);context.lineWidth=line;context.strokeStyle=colors.line;context.stroke();}
 if(parts.glyph){
  const sink=1-.035*press;
  context.translate(cx,cy+size*.012*press);context.scale(size/512*sink,size/512*sink);context.translate(-256,-256);
  context.fillStyle=colors.glyph;context.fill(new Path2D(GLYPH));
 }
 context.restore();
}

export function createLogoCanvas(canvas:HTMLCanvasElement,theme:'light'|'dark'):LogoCanvas{
 const context=canvas.getContext('2d',{alpha:true})!,colors=palette[theme];
 let width=0,height=0,size=0;
 function resize(){
  const ratio=Math.min(2,window.devicePixelRatio||1);width=Math.max(1,Math.round(canvas.clientWidth*ratio));height=Math.max(1,Math.round(canvas.clientHeight*ratio));
  canvas.width=width;canvas.height=height;size=logoSize(canvas.clientWidth,canvas.clientHeight,ratio);
 }
 function draw(press:number,elapsed:number|undefined){
  context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,width,height);
  context.fillStyle=colors.base;context.fillRect(0,0,width,height);
  if(elapsed===undefined){drawLogo(context,colors,width/2,height/2,size,press);return false;}
  const t=clamp(elapsed/TUNNEL_MS),halfX=tunnelHalf(size/2,width*.55,t),halfY=tunnelHalf(size/2,height*.55,t),radius=tunnelRadius(halfX,halfY,t);
  context.globalCompositeOperation='destination-out';context.fillStyle='#000';
  context.beginPath();context.roundRect(width/2-halfX,height/2-halfY,halfX*2,halfY*2,radius);context.fill();context.globalCompositeOperation='source-over';
  context.strokeStyle=colors.line;context.lineWidth=Math.max(1,size/130);
  for(const reach of [1.24,1.54,1.9]){context.globalAlpha=(1-t)*(2.2-reach);context.beginPath();context.roundRect(width/2-halfX*reach,height/2-halfY*reach,halfX*2*reach,halfY*2*reach,radius*reach);context.stroke();}
  context.globalAlpha=1;
  return t>=1;
 }
 resize();
 function picture(parts:{plate?:boolean;glyph?:boolean}){
  const layer=document.createElement('canvas');layer.width=width;layer.height=height;
  const paint=layer.getContext('2d')!;
  if(parts.plate){paint.fillStyle=colors.base;paint.fillRect(0,0,width,height);}
  drawLogo(paint,colors,width/2,height/2,size,1,parts);
  return layer;
 }
 return {resize,draw,clear(){context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,width,height);},layers:()=>({plate:picture({plate:true}),glyph:picture({glyph:true})})};
}

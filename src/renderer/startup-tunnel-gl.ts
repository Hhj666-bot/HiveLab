/** The opening of 默认2: the pressed logo sinks away and its button becomes a window, which widens down a tunnel
 * of receding outlines. The window itself is transparent, so the world beyond it is the stored wallpaper scene
 * or the live wallpaper. Without WebGL, startup-logo.ts draws a plainer tunnel. */
import {TUNNEL_MS,tunnelHalf,tunnelRadius} from './startup-logo';

export interface GlTunnel {draw(elapsed:number):boolean;resize():void;dispose():void;}

const VERTEX='attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAGMENT=`precision highp float;
uniform vec2 uSize,uHalf;uniform float uRadius,uTime,uDark;uniform vec3 uBase,uLine;uniform sampler2D uPlate,uGlyph;
float box(vec2 p,vec2 h,float r){vec2 q=abs(p)-h+r;return length(max(q,vec2(0.)))+min(max(q.x,q.y),0.)-r;}
void main(){
 vec2 c=vec2(gl_FragCoord.x,uSize.y-gl_FragCoord.y)-uSize*.5;
 // Shadow and rim grow out of the pressed button instead of switching on with the first frame.
 float d=box(c,uHalf,uRadius),scale=min(uHalf.x,uHalf.y),arrive=smoothstep(0.,.12,uTime),depth=exp(-max(d,0.)/(scale*.5+36.))*arrive;
 // The wall falls into shadow towards the window, and lifts away at the end.
 vec3 wall=uDark>.5?uBase+vec3(.09*depth):uBase*(1.-.17*depth);
 // Echoes of the window's outline leave its edge and pass the viewer, which is what makes it a tunnel.
 for(int i=0;i<6;i++){
  float k=float(i)+fract(uTime*2.4),m=pow(1.46,k),width=.55+.2*k;
  float ring=1.-smoothstep(width,width+1.4,abs(box(c,uHalf*m,uRadius*m)));
  // Rings appear one after another from the window, not all at once.
  float reach=smoothstep(float(i)*.03,float(i)*.03+.12,uTime);
  wall=mix(wall,uLine,ring*reach*smoothstep(0.,.7,k)*(1.-smoothstep(2.6,5.6,k))*.55);
 }
 // The button's surface melts away first; the mark keeps sinking into the distance and goes last.
 float melt=smoothstep(0.,.1,uTime),sink=smoothstep(0.,.26,uTime),gone=smoothstep(.09,.25,uTime);
 vec3 plate=texture2D(uPlate,c/uSize+.5).rgb;
 float shadow=exp(min(d,0.)/(scale*.2+10.))*.5*(1.-smoothstep(.55,1.,uTime));
 vec4 under=vec4(plate*(1.-melt),1.-melt)+vec4(0.,0.,0.,shadow)*melt;
 vec4 mark=texture2D(uGlyph,c/(1.-.46*sink)/uSize+.5)*(1.-gone);
 vec4 inner=mark+under*(1.-mark.a);
 float rim=(1.-smoothstep(.4,2.2,abs(d)))*(1.-smoothstep(.8,1.,uTime))*.6*arrive;
 gl_FragColor=mix(mix(vec4(wall,1.),inner,1.-smoothstep(-1.,1.,d)),vec4(uLine,1.),rim);
}`;

/** `layers` gives the pressed logo as two pictures; null when WebGL or the shader is unavailable. */
export function createGlTunnel(canvas:HTMLCanvasElement,layers:()=>{plate:HTMLCanvasElement;glyph:HTMLCanvasElement},theme:'light'|'dark',plate:()=>number):GlTunnel|null{
 const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,powerPreference:'high-performance'});
 if(!gl)return null;
 const shader=(type:number,source:string)=>{const node=gl.createShader(type)!;gl.shaderSource(node,source);gl.compileShader(node);return gl.getShaderParameter(node,gl.COMPILE_STATUS)?node:null;};
 const vertex=shader(gl.VERTEX_SHADER,VERTEX),fragment=shader(gl.FRAGMENT_SHADER,FRAGMENT),program=gl.createProgram();
 if(!vertex||!fragment||!program)return null;
 gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))return null;
 gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const position=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
 const textures=[gl.createTexture(),gl.createTexture()];
 textures.forEach((texture,unit)=>{
  gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);
  for(const [name,value] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,name,value);
 });
 const uniform=(name:string)=>gl.getUniformLocation(program,name);
 gl.uniform1i(uniform('uPlate'),0);gl.uniform1i(uniform('uGlyph'),1);
 const time=uniform('uTime'),half=uniform('uHalf'),corner=uniform('uRadius'),dark=theme==='dark';
 gl.uniform1f(uniform('uDark'),dark?1:0);
 if(dark){gl.uniform3f(uniform('uBase'),0,0,0);gl.uniform3f(uniform('uLine'),.62,.64,.62);}else{gl.uniform3f(uniform('uBase'),1,1,1);gl.uniform3f(uniform('uLine'),.58,.67,.64);}
 let lost=false,width=1,height=1;const onLost=(event:Event)=>{event.preventDefault();lost=true;};canvas.addEventListener('webglcontextlost',onLost);
 function resize(){
  const ratio=Math.min(2,window.devicePixelRatio||1);width=Math.max(1,Math.round(canvas.clientWidth*ratio));height=Math.max(1,Math.round(canvas.clientHeight*ratio));
  canvas.width=width;canvas.height=height;gl!.viewport(0,0,width,height);gl!.uniform2f(uniform('uSize'),width,height);
  gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
  const {plate:surface,glyph}=layers();
  [surface,glyph].forEach((layer,unit)=>{gl!.activeTexture(gl!.TEXTURE0+unit);gl!.texImage2D(gl!.TEXTURE_2D,0,gl!.RGBA,gl!.RGBA,gl!.UNSIGNED_BYTE,layer);});
 }
 resize();
 return {
  resize,
  // A lost context ends the opening at once, leaving the wallpaper rather than a frozen frame.
  draw(elapsed){
   if(lost)return true;
   const t=Math.min(1,elapsed/TUNNEL_MS),halfX=tunnelHalf(plate()/2,width*.55,t),halfY=tunnelHalf(plate()/2,height*.55,t);
   gl.uniform1f(time,t);gl.uniform2f(half,halfX,halfY);gl.uniform1f(corner,tunnelRadius(halfX,halfY,t));gl.drawArrays(gl.TRIANGLES,0,3);
   return t>=1;
  },
  dispose(){canvas.removeEventListener('webglcontextlost',onLost);if(!lost){gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);textures.forEach(texture=>gl.deleteTexture(texture));gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);}},
 };
}

/** Display-only white matte. Connected border regions are removed; enclosed white clothes stay opaque. */
export function softenStandeeMatte(rgba:Uint8ClampedArray,width:number,height:number):void{
  if(rgba.length!==width*height*4||width<1||height<1)return;
  const visited=new Uint8Array(width*height),queue=new Int32Array(width*height);let start=0,end=0;
  const add=(pixel:number)=>{
    if(visited[pixel])return;visited[pixel]=1;const i=pixel*4,r=rgba[i],g=rgba[i+1],b=rgba[i+2];
    if(rgba[i+3]<8||Math.min(r,g,b)>=225&&Math.max(r,g,b)-Math.min(r,g,b)<26){queue[end++]=pixel;rgba[i+3]=0;}
  };
  for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}for(let y=0;y<height;y++){add(y*width);add(y*width+width-1);}
  while(start<end){const pixel=queue[start++],x=pixel%width,y=Math.floor(pixel/width);if(x)add(pixel-1);if(x+1<width)add(pixel+1);if(y)add(pixel-width);if(y+1<height)add(pixel+width);}
}

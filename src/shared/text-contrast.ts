export type ContrastTone='dark'|'light';
export type ContrastRect={x:number;y:number;width:number;height:number};
export type ContrastEvidence={dark:number;light:number;count:number};
export const CONTRAST_INKS={dark:'#101114',light:'#f8fafc'} as const;
const linear=Array.from({length:256},(_,n)=>{const s=n/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});
export function luminance(r:number,g:number,b:number){return .2126*linear[r]+.7152*linear[g]+.0722*linear[b];}
const darkL=luminance(16,17,20),lightL=luminance(248,250,252);
const ratio=(a:number,b:number)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
/** Sample the rendered surface between glyphs, not the foreground text itself.
 * A lower quartile protects mixed backgrounds better than one average pixel. */
export function sampleContrast(pixels:Uint8ClampedArray,width:number,height:number,viewport:{width:number;height:number},rect:ContrastRect,masks:ContrastRect[]=[]):ContrastEvidence|null{
 const left=Math.max(0,rect.x+3),top=Math.max(0,rect.y+3),right=Math.min(viewport.width,rect.x+rect.width-3),bottom=Math.min(viewport.height,rect.y+rect.height-3);
 if(right<=left||bottom<=top)return null;
 const scores:{dark:number[];light:number[]}={dark:[],light:[]};
 for(let row=0;row<12;row++)for(let col=0;col<16;col++){
  const x=left+(col+.5)*(right-left)/16,y=top+(row+.5)*(bottom-top)/12;
  if(masks.some(m=>x>=m.x&&x<=m.x+m.width&&y>=m.y&&y<=m.y+m.height))continue;
  const px=Math.max(0,Math.min(width-1,Math.floor(x/viewport.width*width))),py=Math.max(0,Math.min(height-1,Math.floor(y/viewport.height*height))),i=(py*width+px)*4;
  const l=luminance(pixels[i],pixels[i+1],pixels[i+2]);scores.dark.push(ratio(l,darkL));scores.light.push(ratio(l,lightL));
 }
 if(scores.dark.length<4)return null;
 const quartile=(values:number[])=>values.sort((a,b)=>a-b)[Math.floor((values.length-1)*.25)];
 return {dark:quartile(scores.dark),light:quartile(scores.light),count:scores.dark.length};
}
export function preferredTone(evidence:ContrastEvidence,current?:ContrastTone):ContrastTone{
 const best:ContrastTone=evidence.dark>evidence.light?'dark':'light';
 if(!current||current===best)return best;
 // Keep the theme's preferred ink while readable. A sustained shortfall can
 // switch to a clearly more legible alternative; close calls keep their tone.
 return evidence[current]<4.5&&evidence[best]>=4.5&&evidence[best]>evidence[current]*1.25?best:current;
}
export const TEXT_TONE_DWELL_MS=3500,TEXT_TONE_HOLD_MS=12000,TEXT_SAMPLE_INTERVAL_MS=1400;
export type TextToneTiming={dwellMs:number;holdMs:number};
export type StableTextTone={tone:ContrastTone;candidate?:ContrastTone;candidateSince?:number;changedAt:number};
export function advanceTextTone(evidence:ContrastEvidence,state:StableTextTone,now:number,timing:TextToneTiming={dwellMs:TEXT_TONE_DWELL_MS,holdMs:TEXT_TONE_HOLD_MS}):ContrastTone{
 const next=preferredTone(evidence,state.tone);
 if(next===state.tone){state.candidate=undefined;state.candidateSince=undefined;return state.tone;}
 if(state.candidate!==next){state.candidate=next;state.candidateSince=now;}
 if(now-(state.candidateSince??now)>=timing.dwellMs&&now-state.changedAt>=timing.holdMs){state.tone=next;state.changedAt=now;state.candidate=undefined;state.candidateSince=undefined;}
 return state.tone;
}

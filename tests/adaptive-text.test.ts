import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleContrast,preferredTone,advanceTextTone,type StableTextTone} from '../src/shared/text-contrast';
import {buildRefractionMap} from '../src/renderer/liquid-refraction';

const frame=(value:number)=>new Uint8ClampedArray(Array.from({length:40*40},()=>[value,value,value,255]).flat());
const viewport={width:40,height:40},area={x:0,y:0,width:40,height:40};
test('actual dark, light and middle-grey surfaces choose readable foregrounds',()=>{
 const dark=sampleContrast(frame(0),40,40,viewport,area)!,light=sampleContrast(frame(255),40,40,viewport,area)!,grey=sampleContrast(frame(128),40,40,viewport,area)!;
 assert.equal(preferredTone(dark),'light');assert.equal(preferredTone(light),'dark');assert.equal(preferredTone(grey),'dark');assert.ok(grey.dark>=4.5);
 assert.equal(preferredTone({dark:4.7,light:4.4,count:50},'light'),'light');
});
test('foreground and covering overlays are excluded from background evidence',()=>{
 const pixels=frame(255);for(let y=0;y<40;y++)for(let x=0;x<28;x++){const i=(y*40+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=0;}
 const evidence=sampleContrast(pixels,40,40,viewport,area,[{x:0,y:0,width:28,height:40}])!;
 assert.equal(preferredTone(evidence),'dark');assert.ok(evidence.dark>15);
 assert.equal(sampleContrast(pixels,40,40,viewport,area,[area]),null);
});
test('readable colours and short alternating wallpaper flashes never flip text',()=>{
 const state:StableTextTone={tone:'light',changedAt:0};
 for(let now=1400;now<30000;now+=1400){const evidence=now%2800?{dark:18,light:1.2,count:50}:{dark:1.1,light:19,count:50};assert.equal(advanceTextTone(evidence,state,now),'light');}
 assert.equal(preferredTone({dark:12,light:4.8,count:50},'light'),'light');
});

test('theme ink stays preferred when readable, but weak body-text contrast is repaired',()=>{
 assert.equal(preferredTone({dark:5.5,light:7,count:50},'dark'),'dark');
 assert.equal(preferredTone({dark:7,light:5.5,count:50},'light'),'light');
 assert.equal(preferredTone({dark:12,light:3,count:50},'light'),'dark');
 assert.equal(preferredTone({dark:3,light:12,count:50},'dark'),'light');
});
test('a sustained unreadable colour changes once, then respects a long hold',()=>{
 const state:StableTextTone={tone:'light',changedAt:-12000},bright={dark:18,light:1.1,count:50},dark={dark:1.1,light:18,count:50};
 assert.equal(advanceTextTone(bright,state,0),'light');assert.equal(advanceTextTone(bright,state,3499),'light');assert.equal(advanceTextTone(bright,state,3500),'dark');
 assert.equal(advanceTextTone(dark,state,3600),'dark');assert.equal(advanceTextTone(dark,state,10000),'dark');assert.equal(advanceTextTone(dark,state,15500),'light');
});
test('reference SDF refracts the edges around a neutral centre at bounded resolution',()=>{
 const map=buildRefractionMap(120,40),at=(x:number,y:number,c:number)=>map.displacement[(y*map.width+x)*4+c];
 assert.equal(at(60,20,0),128);assert.equal(at(60,20,1),128);
 assert.ok(at(0,20,0)>128);assert.ok(at(119,20,0)<128);
 assert.ok(at(60,0,1)>128);assert.ok(at(60,39,1)<128);
 assert.equal(Math.max(buildRefractionMap(6000,100).width,buildRefractionMap(100,6000).height),768);
 assert.equal(buildRefractionMap(240,80).scale,map.scale*2);
 assert.notDeepEqual(buildRefractionMap(120,40,2).displacement,map.displacement);
 assert.notDeepEqual(buildRefractionMap(120,40,1,1.3).displacement,map.displacement);
});
test('a large surface bends only at its rim, so what lies under the glass shows where it really is',()=>{
 const map=buildRefractionMap(760,760),at=(x:number,y:number,c:number)=>map.displacement[(y*map.width+x)*4+c];
 assert.equal(at(380,380,0),128);assert.equal(at(150,380,0),128);assert.equal(at(380,150,1),128);assert.equal(at(150,150,0),128);
 assert.ok(at(0,380,0)>128);assert.ok(at(759,380,0)<128);assert.ok(at(380,0,1)>128);assert.ok(at(380,759,1)<128);
 assert.equal(map.scale,buildRefractionMap(320,320).scale);
});
test('user-supplied dwell and hold times control each colour change, including zero-delay values',()=>{
 const state:StableTextTone={tone:'light',changedAt:0},bright={dark:18,light:1.1,count:50},dark={dark:1.1,light:18,count:50},timing={dwellMs:1000,holdMs:5000};
 assert.equal(advanceTextTone(bright,state,0,timing),'light');assert.equal(advanceTextTone(bright,state,1000,timing),'light');assert.equal(advanceTextTone(bright,state,5000,timing),'dark');
 assert.equal(advanceTextTone(dark,state,5500,timing),'dark');assert.equal(advanceTextTone(dark,state,9999,timing),'dark');assert.equal(advanceTextTone(dark,state,10000,timing),'light');
 assert.equal(advanceTextTone(bright,{tone:'light',changedAt:0},0,{dwellMs:0,holdMs:0}),'dark');
});

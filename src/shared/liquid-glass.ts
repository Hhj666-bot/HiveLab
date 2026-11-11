export const LIQUID_GLASS_CONTROLS=[
 ['blur','玻璃背景模糊',0,24,.25,'px'],
 ['refraction','玻璃折射强度',0,3,.05,'×'],
 ['edge','玻璃折射圈厚度',.25,3,.05,'×'],
 ['contrast','玻璃对比度',.5,2,.05,'×'],
 ['brightness','玻璃亮度',.5,1.8,.05,'×'],
 ['saturation','玻璃饱和度',0,2.5,.05,'×'],
 ['motion','玻璃按压动效',0,150,5,'%'],
] as const;
export type LiquidGlassSetting=typeof LIQUID_GLASS_CONTROLS[number][0];
export type LiquidGlassSettings=Record<LiquidGlassSetting,number>;
/** Values settled on in the daily app, adopted as defaults on 2026-11-03. */
export const DEFAULT_LIQUID_GLASS:Readonly<LiquidGlassSettings>={blur:1.25,refraction:.9,edge:1,contrast:1.2,brightness:.95,saturation:.95,motion:80};
export const LIQUID_GLASS_OPTICS={sdfWidth:.3,sdfHeight:.2,radius:.6,threshold:.15,falloff:.8,normalization:.5,mapDPI:1,pressThickness:1.3,lensSpan:320} as const;
export const LIQUID_GLASS_PHYSICS={
 press:{scaleX:1.05,scaleY:.93,originShift:30,stretchMax:.14,distance:900,translate:26,yRatio:.75},
 spring:{duration:500,damping:4,frequency:9,releaseGain:1.2},
 bubble:{lead:{response:.3,dampingFraction:.62},trail:{response:.46,dampingFraction:.7},wallBounce:.25,thin:.35},
 hover:{lead:{response:.36,dampingFraction:.82},trail:{response:.62,dampingFraction:.86}},
 // Panels carry text, and text must not overshoot and settle back: critically damped, so they ease in and stop.
 sidebar:{response:.27,dampingFraction:1},
 sidebarReduced:{response:.16,dampingFraction:1},
} as const;
export function parseLiquidGlassSettings(value:unknown):LiquidGlassSettings{
 const result={...DEFAULT_LIQUID_GLASS};
 if(value&&typeof value==='object')for(const [key,,min,max] of LIQUID_GLASS_CONTROLS){const n=(value as Record<string,unknown>)[key];if(typeof n==='number'&&Number.isFinite(n))result[key]=Math.max(min,Math.min(max,n));}
 return result;
}
/** A spring's overshoot grows with the distance, so a long trip needs more damping to pass its target by the same few pixels. */
export function calmedSpring<S extends {dampingFraction:number}>(spring:S,distance:number,overshoot=6):S{
 const ratio=-Math.log(Math.min(.9,overshoot/Math.max(distance,1)));
 return {...spring,dampingFraction:Math.max(spring.dampingFraction,ratio/Math.hypot(Math.PI,ratio))};
}

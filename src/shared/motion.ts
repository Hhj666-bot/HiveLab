export const MOTION_PREFERENCE_KEY='hivelab.appearance.motion';
export const REDUCED_MOTION_QUERY='(prefers-reduced-motion: reduce)';
export const MOTION_PREFERENCES=[
 ['system','跟随系统','系统关闭动画效果时简化，否则完整。'],
 ['full','完整','始终播放完整动效，动态壁纸也会恢复播放。'],
 ['reduced','简化','保留淡入淡出和颜色过渡，去掉位移和缩放。'],
 ['off','关闭','界面直接切换，不播放过渡。'],
] as const;
export type MotionPreference=typeof MOTION_PREFERENCES[number][0];
export type MotionLevel='full'|'reduced'|'off';
export const parseMotionPreference=(value:unknown):MotionPreference=>value==='full'||value==='reduced'||value==='off'?value:'system';
/** The one place that turns the saved choice and the system setting into a level. */
export function motionLevel(preference:MotionPreference,systemReduced:boolean):MotionLevel{
 if(preference!=='system')return preference;
 return systemReduced?'reduced':'full';
}

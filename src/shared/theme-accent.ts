import {t} from './i18n';
export type AccentMode='global'|'contextual';
export const THEME_COLOR_PRESETS=[
 {get name(){return t("雾蓝")},color:'#9bb9ce'},{get name(){return t("鼠尾草")},color:'#a8bfaf'},
 {get name(){return t("暖沙")},color:'#c9b79b'},{get name(){return t("灰紫")},color:'#b5a8c9'},
 {get name(){return t("藕粉")},color:'#cba9b3'},{get name(){return t("湖青")},color:'#9bbfbd'},
 {get name(){return t("岩灰")},color:'#b0b4bc'},
] as const;
export const DEFAULT_ACCENT=THEME_COLOR_PRESETS[0].color;
export function accentColor(value:unknown):string{return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value:DEFAULT_ACCENT;}
export function resolveAccent(mode:AccentMode,color:string,memberColor?:string){return mode==='contextual'&&memberColor?memberColor:color;}

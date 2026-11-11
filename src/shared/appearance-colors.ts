import {t} from './i18n';
/** Distinct identity hues, anchored by the reference's graphite and blue. */
export const MEMBER_COLOR_PRESETS=[
 {get name(){return t("石墨")},color:'#48484a'},
 {get name(){return t("海蓝")},color:'#0071e3'},
 {get name(){return t("松绿")},color:'#248a3d'},
 {get name(){return t("琥珀")},color:'#c48214'},
 {get name(){return t("紫罗兰")},color:'#8944ab'},
 {get name(){return t("橙色")},color:'#d95f21'},
 {get name(){return t("珊瑚")},color:'#d64763'},
 {get name(){return t("湖青")},color:'#008a91'},
] as const;

/** Named reading surfaces follow the theme without changing their saved selection. */
export const CHAT_COLOR_PRESETS=[
 {id:'palette:stone',get name(){return t("瓷白 / 石墨")},light:'#f5f5f7',dark:'#272729'},
 {id:'palette:sand',get name(){return t("琥珀")},light:'#f2d6a2',dark:'#63451e'},
 {id:'palette:sage',get name(){return t("松绿")},light:'#c2e2c4',dark:'#244f36'},
 {id:'palette:blue',get name(){return t("海蓝")},light:'#b7d8fa',dark:'#1c4470'},
 {id:'palette:violet',get name(){return t("紫罗兰")},light:'#dcc8f4',dark:'#51336e'},
 {id:'palette:rose',get name(){return t("珊瑚")},light:'#f5bfc9',dark:'#713b47'},
 {id:'palette:teal',get name(){return t("湖青")},light:'#ade0de',dark:'#1b5555'},
] as const;
export const chatColorPreset=(value:string)=>CHAT_COLOR_PRESETS.find(preset=>preset.id===value);

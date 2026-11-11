import {t} from './i18n';
import type {ContrastTone} from './text-contrast';

export type TextToneCache={version:3;contexts:Record<string,{updatedAt:number;tones:Record<string,ContrastTone>}>};
export const emptyTextToneCache=():TextToneCache=>({version:3,contexts:{}});
const contextLimit=64,groupLimit=320;
function tones(value:unknown):Record<string,ContrastTone>{
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 return Object.fromEntries(Object.entries(value).filter(([key,tone])=>key.length>0&&key.length<=512&&(tone==='dark'||tone==='light')).slice(-groupLimit)) as Record<string,ContrastTone>;
}
export function parseTextToneCache(value:unknown):TextToneCache{
 const source=value as Partial<TextToneCache>|null,result=emptyTextToneCache();
 if(source?.version!==3||!source.contexts||typeof source.contexts!=='object'||Array.isArray(source.contexts))return result;
 result.contexts=Object.fromEntries(Object.entries(source.contexts).filter(([key,entry])=>key.length>0&&key.length<=16384&&entry&&Number.isFinite(entry.updatedAt)).sort((a,b)=>a[1].updatedAt-b[1].updatedAt).slice(-contextLimit).map(([key,entry])=>[key,{updatedAt:entry.updatedAt,tones:tones(entry.tones)}]));
 return result;
}
export function updateTextToneCache(cache:TextToneCache,context:unknown,value:unknown,now=Date.now()):TextToneCache{
 if(typeof context!=='string'||!context.length||context.length>16384)throw Error(t("文字配色缓存标识无效。"));
 const next=tones(value);if(!Object.keys(next).length)return cache;
 return parseTextToneCache({version:3,contexts:{...cache.contexts,[context]:{updatedAt:now,tones:next}}});
}

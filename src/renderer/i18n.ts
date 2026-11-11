import {useSyncExternalStore} from 'react';
import {flushSync} from 'react-dom';
import {DEFAULT_LANGUAGE,LANGUAGE_STORAGE_KEY,getLanguage,parseLanguage,registerMessages,setLanguage,subscribeLanguage,type Language} from '../shared/i18n';
import {EN_MESSAGES} from './locales/en';

export {t,format,getLanguage,hasMessage,LANGUAGES,type Language} from '../shared/i18n';

registerMessages('en',EN_MESSAGES);
// The saved setting arrives with the first snapshot; this copy lets the boot screen and
// the first frame already speak the chosen language instead of flashing Chinese.
function storedLanguage():Language{try{return parseLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));}catch{return DEFAULT_LANGUAGE;}}
setLanguage(storedLanguage());
markDocument(getLanguage());

/** The page language, plus the few words index.html writes before any script runs. */
function markDocument(language:Language){
 if(typeof document==='undefined')return;
 document.documentElement.lang=language==='en'?'en':'zh-CN';
 const english=language==='en';
 document.title=english?'HiveLab · Our AI studio':'HiveLab 合屋 · 我们的 AI 工作室';
 const startup=document.getElementById('hivelab-startup');
 startup?.setAttribute('aria-label',english?'HiveLab startup animation':'HiveLab 启动动画');
 const subtitle=startup?.querySelector('.startup-brand span');if(subtitle)subtitle.textContent=english?'Our AI studio':'我们的 AI 工作室';
 const status=startup?.querySelector('[data-startup-status]');if(status&&status.textContent==='正在准备工作室…'&&english)status.textContent='Getting the studio ready…';
}

/** Components that cache text (memo, useMemo) read this so a switch re-renders them. */
export const useLanguage=()=>useSyncExternalStore(subscribeLanguage,getLanguage,getLanguage);

type ViewTransitionDocument=Document&{startViewTransition?:(update:()=>void)=>{finished:Promise<void>}};
/**
 * Switch the interface language. The words change inside a short cross-fade (§R8 of the
 * motion guide: 180ms, 120ms when reduced) so the page never jumps; only the "off" motion
 * level switches without one.
 */
// The language a running cross-fade is switching to. The words change one frame after the
// transition starts, so a second request in that gap (the saved setting arriving) must not
// start another transition, which would skip this one.
let turningTo:Language|undefined,turn=0;
export function applyLanguage(next:unknown,{animate=true}:{animate?:boolean}={}){
 const language=parseLanguage(next);
 try{localStorage.setItem(LANGUAGE_STORAGE_KEY,language);}catch{}
 if(language===(turningTo??getLanguage()))return;
 const update=()=>{setLanguage(language);markDocument(language);};
 const doc=typeof document==='undefined'?undefined:document as ViewTransitionDocument;
 const motion=doc?.documentElement.dataset.motion;
 if(!animate||!doc?.startViewTransition||motion==='off'||doc.visibilityState==='hidden'){turningTo=undefined;update();return;}
 const own=++turn,root=doc.documentElement,done=()=>{if(own!==turn)return;turningTo=undefined;delete root.dataset.languageTurn;};
 turningTo=language;root.dataset.languageTurn='';
 try{
  const transition=doc.startViewTransition(()=>flushSync(update));
  void transition.finished.catch(()=>{}).finally(done);
 }catch{done();update();}
}

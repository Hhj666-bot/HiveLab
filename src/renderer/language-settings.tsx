import {useState} from 'react';
import {Languages,LoaderCircle} from 'lucide-react';
import {LANGUAGES,parseLanguage,type Language} from '../shared/i18n';
import type {Snapshot} from '../shared/types';
import {applyLanguage,t,useLanguage} from './i18n';
import type {Invoke} from './ui';
import './language-settings.css';

/**
 * Settings → Language. Each choice is written in its own language so it can be found
 * from either side. The switch saves to the settings record at once (it never waits for
 * members to go idle) and the page changes language inside a short cross-fade.
 */
export function LanguageSettings({snapshot,invoke}:{snapshot:Snapshot;invoke:Invoke}){
 const current=useLanguage();
 const saved=parseLanguage(snapshot.settings.language);
 const [pending,setPending]=useState<Language|null>(null);
 const [error,setError]=useState('');
 async function choose(language:Language){
  if(pending||language===saved&&language===current)return;
  setPending(language);setError('');
  const previous=current;
  applyLanguage(language);
  try{await invoke('settings.language',{language},undefined,{background:true});}
  catch(reason){applyLanguage(previous);setError(t('语言未能保存：{0}',reason instanceof Error?reason.message:String(reason)));}
  finally{setPending(null);}
 }
 const chosen=pending??current;
 return <div className="language-settings">
  <div className="settings-section-heading"><h3>{t('语言')}</h3></div>
  <p className="settings-description">{t('选择界面使用的语言。切换后立即生效，保存在本机资料里，重启后保持不变。')}</p>
  <section className="settings-group" aria-label={t('界面语言')}>
   <h3><Languages size={16} aria-hidden="true"/>{t('界面语言')}</h3>
   <div className="segmented wide language-choice" role="radiogroup" aria-label={t('界面语言')}>
    {LANGUAGES.map(([id,name,detail])=><button type="button" role="radio" key={id} lang={id} aria-checked={chosen===id} className={chosen===id?'selected':''} disabled={Boolean(pending)} onClick={()=>void choose(id)}>
     {pending===id?<LoaderCircle size={13} className="spin" aria-hidden="true"/>:null}<span>{name}</span>{detail!==name&&<small>{detail}</small>}
    </button>)}
   </div>
   {error?<p className="language-settings-error" role="alert">{error}</p>:<p className="settings-description">{t('成员回复用什么语言不受这里影响，仍由人物设定和你的对话决定。')}</p>}
  </section>
 </div>;
}

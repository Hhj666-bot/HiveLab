import {t} from './i18n';
import {useRef,useState} from 'react';

const KEY='hivelab.brand.subtitle';
const DEFAULT_SUBTITLE='我们的 AI 工作室';
// An unchanged default is stored as written so it follows the interface language.
function readSubtitle(){try{return localStorage.getItem(KEY)?.trim()||DEFAULT_SUBTITLE;}catch{return DEFAULT_SUBTITLE;}}

export function Brand({onHome}:{onHome:()=>void}){
  const [subtitle,setSubtitle]=useState(readSubtitle),[draft,setDraft]=useState(subtitle),[editing,setEditing]=useState(false),[error,setError]=useState('');
  const cancelled=useRef(false);
  function edit(){cancelled.current=false;setDraft(t(subtitle));setError('');setEditing(true);}
  function save(){
    if(cancelled.current)return;
    const typed=draft.trim(),value=!typed||typed===t(DEFAULT_SUBTITLE)?DEFAULT_SUBTITLE:typed;
    try{localStorage.setItem(KEY,value);setSubtitle(value);setEditing(false);setError('');}
    catch{setError(t("副标题未能保存，请重试。"));}
  }
  return <div className="brand" role="group" aria-label={t("HiveLab 合屋")}>
    <button type="button" className="brand-logo glass-content-action" onClick={onHome} title={t("回到团队主页")} aria-label={t("回到团队主页")}><img className="brand-image" src="./brand/hivelab.svg" alt="" width="34" height="34"/></button>
    <div className="brand-text">
      <button type="button" className="brand-name glass-content-action" onClick={onHome} title={t("回到团队主页")}><strong>{t("HiveLab 合屋")}</strong></button>
      {editing?<input className="brand-subtitle-input" aria-label={t("工作室副标题")} autoFocus maxLength={60} value={draft} placeholder={t(DEFAULT_SUBTITLE)} onFocus={e=>e.currentTarget.select()} onChange={e=>setDraft(e.target.value)} onBlur={save} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();save();}else if(e.key==='Escape'){e.preventDefault();cancelled.current=true;setEditing(false);setError('');}}}/>:<button type="button" className="brand-subtitle glass-content-action" title={t("点击修改副标题；留空恢复默认")} aria-label={t("修改工作室副标题")} onClick={edit}>{t(subtitle)}</button>}
      {error&&<span className="brand-subtitle-error" role="alert">{error}</span>}
    </div>
  </div>;
}

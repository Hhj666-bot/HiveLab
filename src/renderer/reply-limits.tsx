import {t} from './i18n';
import {useState} from 'react';
import {ListOrdered} from 'lucide-react';
import {Modal} from './modals';
import {DEFAULT_REPLY_LIMITS,MAX_MEMBER_REPLIES,normalizeReplyLimits,type ReplyLimitSettings} from '../shared/reply-limits';
import './reply-limits.css';

function read(scope:string){try{return normalizeReplyLimits(JSON.parse(localStorage.getItem('hivelab.reply-limits.'+scope)??'null'));}catch{return DEFAULT_REPLY_LIMITS;}}
export function useReplyLimits(scope:string){
  const [entry,setEntry]=useState(()=>({scope,value:read(scope)}));
  const value=entry.scope===scope?entry.value:read(scope);
  return {value,set:(next:ReplyLimitSettings)=>{try{localStorage.setItem('hivelab.reply-limits.'+scope,JSON.stringify(next));}catch{}setEntry({scope,value:next});}};
}
type Draft={perMember:string;modes:Record<string,'inherit'|'custom'|'unlimited'>;counts:Record<string,string>};
export function ReplyLimitsButton({value,onChange,members,disabled}:{value:ReplyLimitSettings;onChange:(value:ReplyLimitSettings)=>void;members:{id:string;name:string}[];disabled:boolean}){
  const [draft,setDraft]=useState<Draft>(),[error,setError]=useState('');
  const individual=members.some(m=>Object.hasOwn(value.overrides,m.id));
  function open(){
    setError('');setDraft({perMember:value.perMember===null?'unlimited':String(value.perMember),modes:Object.fromEntries(members.map(m=>[m.id,!Object.hasOwn(value.overrides,m.id)?'inherit':value.overrides[m.id]===null?'unlimited':'custom'])),counts:Object.fromEntries(members.map(m=>[m.id,String(value.overrides[m.id]??value.perMember??1)]))});
  }
  function apply(){
    if(!draft)return;
    const number=(text:string)=>{if(!text.trim())throw Error(t("请填写次数，或选择不限"));return Number(text);};
    try{
      const overrides=Object.fromEntries(members.flatMap<[string,number|null]>(m=>draft.modes[m.id]==='custom'?[[m.id,number(draft.counts[m.id])]]:draft.modes[m.id]==='unlimited'?[[m.id,null]]:[]));
      onChange(normalizeReplyLimits({perMember:draft.perMember==='unlimited'?null:number(draft.perMember),overrides}));setDraft(undefined);
    }catch(e){setError((e as Error).message);}
  }
  return <>
    <button type="button" className="composer-tool reply-limits-button" aria-label={t("设置本次每人发言次数")} title={t("发送下一条消息时生效，每条新消息重新计数；可给各成员分别设置")} disabled={disabled} onClick={open}><ListOrdered size={16}/><span>{individual?t("分别设置次数"):value.perMember===null?t("发言不限"):t("每人 {0} 次", value.perMember)}</span></button>
    {draft&&<Modal title={t("本次每人发言次数")} subtitle={t("用于下一条发送的消息；每条新消息重新计数，闲聊和开会均适用。")} className="reply-limits-modal" onClose={()=>setDraft(undefined)}>
      <div className="modal-body">
      <div className="reply-limit-default"><label htmlFor="reply-default-count">{t("统一默认次数")}</label><input id="reply-default-count" aria-label={t("统一每人发言次数")} type="number" min="0" max={MAX_MEMBER_REPLIES} step="1" value={draft.perMember==='unlimited'?'':draft.perMember} disabled={draft.perMember==='unlimited'} onChange={e=>setDraft({...draft,perMember:e.target.value})}/><label className="reply-limit-unlimited"><input type="checkbox" checked={draft.perMember==='unlimited'} onChange={e=>setDraft({...draft,perMember:e.target.checked?'unlimited':'1'})}/>{t("不限")}</label></div>
      <div className="reply-limit-presets">{[1,2,3,5].map(n=><button type="button" key={n} className="button small secondary" onClick={()=>setDraft({...draft,perMember:String(n)})}>{t("每人 {0} 次", n)}</button>)}<button type="button" className="link-button" onClick={()=>setDraft({...draft,modes:Object.fromEntries(members.map(m=>[m.id,'inherit']))})}>{t("全部跟随统一")}</button></div>
      <div className="reply-limit-members">{members.map(m=><div className="reply-limit-member" key={m.id}>
        <span title={m.name}>{m.name}</span><select aria-label={t("{0} 次数设置", m.name)} value={draft.modes[m.id]??'inherit'} onChange={e=>setDraft({...draft,modes:{...draft.modes,[m.id]:e.target.value as Draft['modes'][string]}})}><option value="inherit">{t("跟随统一")}</option><option value="custom">{t("单独设置")}</option><option value="unlimited">{t("不限")}</option></select>
        {draft.modes[m.id]==='custom'?<input type="number" min="0" max={MAX_MEMBER_REPLIES} step="1" aria-label={t("{0} 本次发言次数", m.name)} value={draft.counts[m.id]??''} onChange={e=>setDraft({...draft,counts:{...draft.counts,[m.id]:e.target.value}})}/>:<small>{draft.modes[m.id]==='unlimited'||draft.perMember==='unlimited'?t("不限"):draft.perMember==='0'?t("不发言"):t("{0} 次", draft.perMember)}</small>}
      </div>)}</div>
      <p className="settings-description">{t("0 次表示本条消息不请这位成员发言。每次安排正式回复计一次机会，表情或选择不发言也占一次；举手、补正和纪要不额外占用正式回复次数。")}</p>
      <p className="settings-description">{t("达到上限后等待你发下一条消息；你也可以随时终止本轮。{0}", members.length===0?t("邀请成员后可分别设置。"):'')}</p>
      {error&&<p role="alert" className="reply-limit-error">{error}</p>}
      </div>
      <footer className="modal-footer"><button type="button" className="button secondary" onClick={()=>setDraft(undefined)}>{t("取消")}</button><button type="button" className="button primary" onClick={apply}>{t("应用到下一条消息")}</button></footer>
    </Modal>}
  </>;
}

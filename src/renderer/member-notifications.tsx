import {t} from './i18n';
import {useEffect,useState} from 'react';
import {Bell,CheckCircle2,AlertCircle,X} from 'lucide-react';
import {noticeMemberId,noticeIsFocused,type MemberNotice,type MemberNoticeFocus} from '../shared/member-notifications';
import type {Snapshot} from '../shared/types';
import {Avatar,useTeam} from './members';
import './member-notifications.css';

export interface ForegroundNotice {notice:MemberNotice;open:()=>void}
export function useFocusedMemberNotices(snapshot:Snapshot,items:ForegroundNotice[],focus:()=>MemberNoticeFocus|undefined,onRead:(ids:string[])=>void){
 useEffect(()=>{
  if(!items.length)return;let frame=0;
  const check=()=>{
   if(document.hidden||!document.hasFocus())return;const active=focus();if(!active||active.roomId&&!active.sessionId&&document.querySelector('.preview-is-maximized.preview-is-open'))return;
   const ids=items.filter(item=>noticeIsFocused(snapshot,item.notice,active)).map(item=>item.notice.id);if(ids.length)onRead(ids);
  };
  const interacted=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(check);};
  check();window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);document.addEventListener('focusin',interacted);document.addEventListener('pointerdown',interacted);
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);document.removeEventListener('focusin',interacted);document.removeEventListener('pointerdown',interacted);};
 },[items,focus,onRead,snapshot.sessions,snapshot.rooms,snapshot.attention]);
}

function Notice({item,onDismiss,snapshot,count,onNext}:{item:ForegroundNotice;onDismiss:(id:string)=>void;snapshot:Snapshot;count:number;onNext:()=>void}){
 const {notice}=item,team=useTeam(),member=team.get(noticeMemberId(snapshot,notice)??'');
 return <div className={'member-notice action-card kind-'+notice.kind+(member?' member-'+member.id:'')} role={notice.kind==='completed'?'status':'alert'} aria-label={notice.title}>
  <button type="button" className="member-notice-main action-card-main glass-content-action" aria-label={(notice.kind==='completed'?t("查看对话："):t("去处理："))+notice.title} onClick={()=>{item.open();onDismiss(notice.id);}}>
   <span className="member-notice-icon">{member?<Avatar member={member} size={30}/>:notice.kind==='completed'?<CheckCircle2 size={20}/>:notice.kind==='error'?<AlertCircle size={20}/>:<Bell size={20}/>}</span>
   <span className="member-notice-body"><strong>{notice.title}</strong><span title={notice.body}>{notice.body}</span></span>
  </button>
  {count>1&&<button type="button" className="member-notice-queue glass-content-action" aria-label={t("{0} 条提醒，查看下一条", count)} onClick={onNext}>{count}</button>}
  <button type="button" className="member-notice-dismiss glass-content-action" aria-label={t("删除提醒：{0}", notice.title)} title={t("删除这条提醒")} onClick={()=>onDismiss(notice.id)}><X size={14}/></button>
 </div>;
}
export function MemberNoticeStack({items,onDismiss,snapshot,toast,onDismissToast}:{items:ForegroundNotice[];onDismiss:(id:string)=>void;snapshot:Snapshot;toast?:{id:number;text:string;error?:boolean}|null;onDismissToast?:()=>void}){
 const [selected,setSelected]=useState(''),latest=items.at(-1)?.notice.id;
 useEffect(()=>{setSelected(latest??'');},[latest]);
 // 自动消失的 toast
 useEffect(()=>{
  if(!toast)return;
  const timer=setTimeout(()=>{onDismissToast?.();},toast.error?5000:3000); // 错误消息显示 5 秒，普通消息 3 秒
  return ()=>clearTimeout(timer);
 },[toast?.id]);
 if(toast)return <div className={'workspace-toast'+(toast.error?' error':'')} role={toast.error?'alert':'status'} key={toast.id}>
   {toast.error?<AlertCircle size={18}/>:<CheckCircle2 size={18}/>}<span>{toast.text}</span>
   {onDismissToast&&<button type="button" className="toast-dismiss icon-button glass-content-action" aria-label={t("关闭")} onClick={onDismissToast}><X size={14}/></button>}
 </div>;
 if(!items.length)return null;
 const index=items.findIndex(item=>item.notice.id===selected),item=items[index<0?items.length-1:index];
 return <section className="member-notice-stack" aria-label={t("消息提醒")}><Notice key={item.notice.id} item={item} onDismiss={onDismiss} snapshot={snapshot} count={items.length} onNext={()=>setSelected(items[((index<0?items.length-1:index)-1+items.length)%items.length].notice.id)}/></section>;
}

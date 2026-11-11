import {t} from './i18n';
import {useState} from 'react';
import {Eye,EyeOff,LoaderCircle,Trash2} from 'lucide-react';
import type {MemberProfile} from '../shared/types';
import {Modal} from './modals';
import type {Invoke} from './ui';

export function CardVisibilityButton({member,invoke,disabled,onChanged,iconOnly=false,className=''}:{member:MemberProfile;invoke:Invoke;disabled?:boolean;onChanged?:(hidden:boolean)=>void;iconOnly?:boolean;className?:string}){
  const [busy,setBusy]=useState(false),hidden=member.cardHidden===true;
  async function toggle(){if(busy)return;setBusy(true);try{await invoke('team.visibility',{id:member.id,hidden:!hidden},hidden?t("人物卡已显示。"):t("人物卡已隐藏，连接与对话继续保留。"));onChanged?.(!hidden);}catch{}finally{setBusy(false);}}
  const label=t("{0} {1} 的人物卡", hidden?t("显示"):t("隐藏"), member.name);
  const VisibilityIcon=(iconOnly?!hidden:hidden)?Eye:EyeOff;
  return <button type="button" className={`${iconOnly?'icon-button':'button small secondary'} ${className}`} aria-label={label} title={label} aria-pressed={iconOnly?!hidden:undefined} disabled={disabled||busy} onClick={()=>void toggle()}>{busy?<LoaderCircle size={14} className="spin"/>:<VisibilityIcon size={14}/>} {!iconOnly&&(hidden?t("显示人物卡"):t("隐藏人物卡"))}</button>;
}

export function DeleteMemberDialog({member,invoke,onClose,onDeleted}:{member:MemberProfile;invoke:Invoke;onClose:()=>void;onDeleted:()=>void}){
  const [busy,setBusy]=useState(false);
  async function remove(){if(busy)return;setBusy(true);try{await invoke('team.delete',{id:member.id},t("人物卡及其配置已删除，历史对话和成果已保留。"));onDeleted();}catch{}finally{setBusy(false);}}
  return <Modal title={t("删除人物卡「{0}」？", member.name)} onClose={()=>{if(!busy)onClose();}}><div className="modal-body"><p>{t("将删除这张人物卡及其配置。已有对话、汇报、成果和个人文件夹都会保留，历史中仍显示原来的名字与头像。")}</p><p>{t("保留的对话可继续查看和导出。需要继续聊天时，请添加新人物卡；程序连接会保留。")}</p></div><div className="modal-footer"><button type="button" className="button quiet" disabled={busy} onClick={onClose}>{t("取消")}</button><button type="button" className="button danger-solid" disabled={busy} onClick={()=>void remove()}>{busy?<LoaderCircle size={14} className="spin"/>:<Trash2 size={14}/>}{t("确认删除人物卡")}</button></div></Modal>;
}

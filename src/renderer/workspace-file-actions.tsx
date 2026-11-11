import {t} from './i18n';
import {useState} from 'react';
import {Files,FolderOpen,FolderInput} from 'lucide-react';
import type {Snapshot} from '../shared/types';
import type {Invoke} from './ui';
import {DeskFileManager,openDeskFileRoot} from './desk-file-manager';

export function WorkspaceFileActions({snapshot,invoke,memberId,rootId,onPick}:{snapshot:Snapshot;invoke:Invoke;memberId?:string;rootId:string;onPick:()=>void}){
 const [manager,setManager]=useState(false),[error,setError]=useState('');
 const member=snapshot.members.find(m=>m.id===memberId);
 return <>
  <button type="button" aria-label={t("查看当前会话文件")} onClick={()=>openDeskFileRoot(rootId||'desk:'+memberId)} disabled={!rootId&&!member}><Files size={14}/>{t("会话文件")}</button>
  <button type="button" aria-label={t("管理工位文件")} onClick={()=>setManager(true)} disabled={!member}><Files size={14}/>{t("文件管理")}</button>
  <button type="button" aria-label={t("个人文件夹")} title={member?t("{0} 的个人文件夹", member.name):t("请先添加成员")} disabled={!member} onClick={()=>void invoke('desk.folder',{memberId}).catch(e=>setError((e as Error).message))}><FolderOpen size={14}/>{t("个人文件夹")}{member&&<small>{member.name}</small>}</button>
  <button type="button" aria-label={t("切换工位文件夹")} onClick={onPick}><FolderInput size={14}/>{t("切换文件夹")}</button>
  {error&&<p className="preview-error" role="alert">{error}</p>}
  {manager&&memberId&&<DeskFileManager snapshot={snapshot} invoke={invoke} memberId={memberId} onClose={()=>setManager(false)}/>}
 </>;
}

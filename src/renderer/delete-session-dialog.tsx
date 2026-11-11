import {t} from './i18n';
import {useState} from 'react';
import {Trash2} from 'lucide-react';
import {Modal} from './modals';

export function DeleteSessionDialog({title,busy=false,onClose,onDelete}:{title:string;busy?:boolean;onClose:()=>void;onDelete:(deleteFiles:boolean)=>Promise<unknown>}){
 const [deleteFiles,setDeleteFiles]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState('');
 const locked=busy||working;
 async function remove(){setWorking(true);setError('');try{await onDelete(deleteFiles);onClose();}catch(cause){setError((cause as Error).message);}finally{setWorking(false);}}
 return <Modal title={t("删除会话")} subtitle={t("删除「{0}」？", title)} onClose={()=>{if(!locked)onClose();}}><div className="modal-body"><p>{t("聊天记录将永久删除。默认保留工作文件。")}</p><label className="toggle-row"><span><strong>{t("是否同步删除对话内文件")}</strong><small>{t("勾选后删除此会话专用目录中的文件；共享目录、外部项目及其他会话仍在使用的文件夹不会被删除。")}</small></span><input type="checkbox" checked={deleteFiles} disabled={locked} onChange={event=>setDeleteFiles(event.target.checked)}/></label>{error&&<p className="inline-notice error" role="alert">{error}</p>}</div><div className="modal-footer"><button type="button" className="button quiet" disabled={locked} onClick={onClose}>{t("取消")}</button><button type="button" className="button danger-solid" disabled={locked} onClick={()=>void remove()}><Trash2 size={14}/>{working?t("正在删除…"):t("确认删除")}</button></div></Modal>;
}

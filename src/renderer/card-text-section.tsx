import {t} from './i18n';
import {useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Modal} from './modals';
import './persona-editor.css';

/** The same compact preview/edit interaction used by 人物设定. */
export function CardTextSection({title,preview,meta,children}:{title:string;preview:string;meta?:string;children:ReactNode}){
 const [open,setOpen]=useState(false);
 return <><button type="button" className="persona-section" onClick={()=>setOpen(true)}><span className="persona-section-head"><strong>{title}</strong><small>{meta}</small></span><span className={'persona-section-preview'+(!preview?' empty':'')}>{preview||t("未填写，点击填写")}</span></button>
 {open&&createPortal(<Modal title={title} subtitle={t("完成编辑后，点击人物卡底部的“保存人物卡”生效。")} className="persona-section-dialog" onClose={()=>setOpen(false)}><div className="modal-body persona-section-body">{children}</div><div className="modal-footer"><button type="button" className="button primary" onClick={()=>setOpen(false)}>{t("完成编辑")}</button></div></Modal>,document.body)}</>;
}

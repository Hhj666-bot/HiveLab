import {t} from './i18n';
import {useCallback,useState,type MouseEvent} from 'react';
import {Copy,FolderOpen,Eye} from 'lucide-react';
import type {FileReference} from '../shared/file-preview';
import type {Invoke} from './ui';
import {ContextMenu,type MenuState} from './interactions';

/** Every file surface uses the same validated desktop location action. */
export function useFileActions(invoke:Invoke,onError:(message:string)=>void,onCopied?:(kind:string)=>void){
 const [menu,setMenu]=useState<MenuState>(null),close=useCallback(()=>setMenu(null),[]);
 function openAt(file:FileReference,x:number,y:number,preview?:()=>void){
  setMenu({x,y,items:[...(preview?[{label:t("预览文件"),icon:<Eye size={14}/>,onSelect:preview}]:[]),{label:t("复制"),icon:<Copy size={14}/>,onSelect:()=>{void invoke<{copied:string}>('file.copy',file,undefined,{background:true}).then(result=>onCopied?.(result.copied)).catch(e=>onError((e as Error).message));}},{label:t("在文件资源管理器中显示"),icon:<FolderOpen size={14}/>,onSelect:()=>{void invoke('file.reveal',file,undefined,{background:true}).catch(e=>onError((e as Error).message));}}]});
 }
 function context(event:MouseEvent,file:FileReference,preview?:()=>void){event.preventDefault();event.stopPropagation();openAt(file,event.clientX,event.clientY,preview);}
 return {context,openAt,menu:<ContextMenu menu={menu} onClose={close}/>};
}

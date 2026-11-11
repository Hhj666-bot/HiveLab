import {t} from './i18n';
import {useEffect,useRef,useState} from 'react';

export default function WordPreview({base64}:{base64:string}){
 const host=useRef<HTMLDivElement>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{
  const root=host.current!.shadowRoot??host.current!.attachShadow({mode:'open'});
  const container=document.createElement('div'),styles=document.createElement('div'),baseStyle=document.createElement('style');
  baseStyle.textContent=':host{display:block;min-width:0} .docx-wrapper{background:transparent!important;padding:16px 8px!important} .docx-wrapper>section.docx{margin:0 auto 20px!important;box-shadow:0 2px 15px #0002!important;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere} img{max-width:100%;height:auto} table{max-width:100%}';
  root.replaceChildren(baseStyle,styles,container);let current=true;setError('');setLoading(true);
  const onClick=(event:Event)=>{if((event.target as Element)?.closest?.('a'))event.preventDefault();};root.addEventListener('click',onClick);
  void import('docx-preview').then(async({renderAsync})=>{
   const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
   await renderAsync(bytes,container,styles,{inWrapper:true,ignoreWidth:true,ignoreHeight:true,ignoreFonts:true,useBase64URL:true,renderAltChunks:false,renderComments:false,breakPages:true});
   if(current)setLoading(false);
  }).catch(cause=>{if(current){setError(t("Word 预览失败：{0}", (cause as Error).message));setLoading(false);}});
  return()=>{current=false;root.removeEventListener('click',onClick);root.replaceChildren();};
 },[base64]);
 return <>{loading&&<p role="status">{t("正在排版 Word 文档…")}</p>}{error&&<p role="alert">{error}</p>}<div ref={host} className="word-layout-preview" aria-label={t("Word 版式预览")}/></>;
}

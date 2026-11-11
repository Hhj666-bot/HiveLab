import {t,useLanguage} from './i18n';
import {Children,isValidElement,useEffect,useMemo,useState,type ReactElement,type ReactNode} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import {SyntaxCode} from './syntax-code';
import {useOpenFilePreview} from './preview-context';
import type {FileReference,FilePreviewData} from '../shared/file-preview';
import type {Invoke} from './ui';

function resourcePath(file:FileReference,href:string){const base=(file.resource??'').replaceAll('\\','/');return base.slice(0,base.lastIndexOf('/')+1)+decodeURIComponent(href.split(/[?#]/)[0]);}
function MarkdownImage({src='',alt='',title,file,invoke}:{src?:string;alt?:string;title?:string;file:FileReference;invoke:Invoke}){
 const remote=/^https:\/\//i.test(src),[url,setUrl]=useState(remote?src:''),[failed,setFailed]=useState(false);
 useEffect(()=>{let current=true;setFailed(false);setUrl(remote?src:'');if(!src){setFailed(true);return;}if(!remote){if(/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)){setFailed(true);return;}void Promise.resolve().then(()=>invoke<FilePreviewData>('file.preview',{...file,resource:resourcePath(file,src)},undefined,{background:true})).then(data=>{if(current){if(data.kind==='image'&&data.dataUrl)setUrl(data.dataUrl);else setFailed(true);}}).catch(()=>{if(current)setFailed(true);});}return()=>{current=false;};},[src,remote,file.source,file.id,file.name,file.path,file.resource,invoke]);
 return failed?<span className="preview-missing-image" title={src}>{alt||t("图片不可用")}</span>:url?<img src={url} alt={alt} title={title} loading="lazy" crossOrigin={remote?'anonymous':undefined} referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<span className="preview-missing-image">{alt||t("正在读取图片…")}</span>;
}

export default function RichMarkdown({text,file,invoke}:{text:string;file:FileReference;invoke:Invoke}){
 const open=useOpenFilePreview();
 const language=useLanguage();const components=useMemo(()=>({
  img:({src,alt,title}:{src?:string;alt?:string;title?:string})=><MarkdownImage src={src} alt={alt} title={title} file={file} invoke={invoke}/>,
  pre:({children}:{children?:ReactNode})=>{const child=Children.toArray(children).find(isValidElement) as ReactElement<{children?:ReactNode;className?:string}>|undefined;if(!child)return <pre>{children}</pre>;const lang=/language-([^\s]+)/.exec(child.props.className??'')?.[1]??'';return <div className="md-code"><div className="md-code-bar"><span>{lang||t("代码")}</span></div><SyntaxCode text={String(child.props.children??'').replace(/\n$/,'')} language={lang}/></div>;},
  a:({href='',children,title}:{href?:string;children?:ReactNode;title?:string})=><a href={href} title={title??href} onClick={event=>{event.preventDefault();if(href.startsWith('#')){try{const target=event.currentTarget.closest('.preview-markdown')?.querySelector('#'+CSS.escape('preview-heading-'+decodeURIComponent(href.slice(1))));target?.scrollIntoView({block:'start'});}catch{}return;}if(open&&!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href))try{open({...file,resource:resourcePath(file,href)},invoke);}catch{}}}>{children}</a>,
 }),[file.source,file.id,file.name,file.path,file.resource,invoke,open,language]);
 return <div className="markdown preview-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw,rehypeSanitize,[rehypeSlug,{prefix:'preview-heading-'}]]} components={components}>{text}</ReactMarkdown></div>;
}

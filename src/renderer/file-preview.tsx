import {t} from './i18n';
import {lazy,Suspense,useContext,useEffect,useLayoutEffect,useRef,useState,type PointerEvent} from 'react';
import {Download,FolderOpen,ZoomIn,ZoomOut,RefreshCw,Copy,Check,Eye,CodeXml,FileText} from 'lucide-react';
import {Modal} from './modals';
import {createPortal} from 'react-dom';
import {PreviewDocumentToolbar} from './workspace-toolbar';
import type {Invoke} from './ui';
import type {FileReference,FilePreviewData} from '../shared/file-preview';
import './file-preview.css';
import {useExtensionFeature} from './extensions';
import {useFilePreview,useOpenFilePreview} from './preview-context';
import {SyntaxCode} from './syntax-code';
import {PreviewZoom} from './preview-zoom';
const PreviewMarkdown=lazy(()=>import('./rich-markdown'));
const WordPreview=lazy(()=>import('./docx-preview'));
const PdfPreview=lazy(()=>import('./pdf-preview'));
function useImagePan(viewport:()=>HTMLElement|null){
 const drag=useRef<{pointer:number;x:number;y:number;left:number;top:number;viewport:HTMLElement}|undefined>(undefined),[panning,setPanning]=useState(false);
 const finish=()=>{drag.current=undefined;setPanning(false);};
 return {
  'data-image-panning':panning||undefined,
  onPointerDown:(event:PointerEvent<HTMLDivElement>)=>{if(event.button!==0)return;const node=viewport();if(!node||node.scrollWidth<=node.clientWidth&&node.scrollHeight<=node.clientHeight)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={pointer:event.pointerId,x:event.clientX,y:event.clientY,left:node.scrollLeft,top:node.scrollTop,viewport:node};setPanning(true);},
  onPointerMove:(event:PointerEvent<HTMLDivElement>)=>{const start=drag.current;if(!start||start.pointer!==event.pointerId)return;event.preventDefault();start.viewport.scrollLeft=start.left+start.x-event.clientX;start.viewport.scrollTop=start.top+start.y-event.clientY;},
  onPointerUp:finish,onPointerCancel:finish,onLostPointerCapture:finish,
 };
}
function PreviewImage({src,name,scale,onToggle,onError}:{src?:string;name:string;scale:number;onToggle:()=>void;onError:()=>void}){
 const shell=useRef<HTMLDivElement>(null),[viewport,setViewport]=useState({width:0,height:0}),[natural,setNatural]=useState({width:0,height:0});
 const pan=useImagePan(()=>shell.current?.parentElement??null);
 useLayoutEffect(()=>{const parent=shell.current?.parentElement;if(!parent)return;const measure=()=>{const style=getComputedStyle(parent);setViewport({width:Math.max(0,parent.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)),height:Math.max(0,parent.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom))});};const observer=new ResizeObserver(measure);observer.observe(parent);measure();return()=>observer.disconnect();},[]);
 const fit=natural.width&&natural.height?Math.min(1,viewport.width/natural.width,viewport.height/natural.height):1,width=natural.width*fit*scale,height=natural.height*fit*scale;
 return <div className="panel-image-preview image-pan-surface" ref={shell} {...pan} data-image-pannable={width>viewport.width||height>viewport.height||undefined} onDoubleClick={onToggle} style={{minWidth:Math.max(viewport.width,width),minHeight:Math.max(viewport.height,height),justifyContent:width>viewport.width?'flex-start':'center',alignItems:height>viewport.height?'flex-start':'center'}}><img src={src} alt={name} draggable={false} style={natural.width?{width,height,maxWidth:'none',maxHeight:'none'}:undefined} onLoad={event=>setNatural({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={onError}/></div>;
}
function OpenInPanel({file,invoke,onClose}:{file:FileReference;invoke:Invoke;onClose:()=>void}){
 const open=useOpenFilePreview()!;
 useEffect(()=>{open(file,invoke);onClose();},[open,file.source,file.id,file.name,file.path,file.resource,invoke]);
 return null;
}
export function ImagePreview(props:{image:{id:string;name:string};invoke:Invoke;onClose:()=>void}){const enabled=useExtensionFeature('filePreview'),panel=useFilePreview();return enabled?(panel?<OpenInPanel file={{source:'attachment',id:props.image.id,name:props.image.name}} invoke={props.invoke} onClose={props.onClose}/>:<EnabledImagePreview {...props}/>):<Modal title={t("图片预览")} onClose={props.onClose}><p>{t("预览插件已停用，可在插件 中启用。")}</p></Modal>;}
function EnabledImagePreview({image,invoke,onClose}:{image:{id:string;name:string};invoke:Invoke;onClose:()=>void}){
 const [zoom,setZoom]=useState(1),[error,setError]=useState(''),viewport=useRef<HTMLDivElement>(null),pan=useImagePan(()=>viewport.current);const src=`hivelab-asset://local/attachments/${image.id}/${encodeURIComponent(image.name)}`;
 return <Modal title={t("图片预览")} subtitle={image.name} onClose={onClose} className="asset-preview-modal"><div className={`asset-image-preview image-pan-surface${zoom>1?' zoomed':''}`} ref={viewport} {...pan} data-image-pannable={zoom>1||undefined} onDoubleClick={()=>setZoom(v=>v===1?2:1)}><img src={src} alt={image.name} draggable={false} style={{width:zoom===1?'auto':`${zoom*100}%`,maxWidth:zoom===1?'100%':'none',maxHeight:zoom===1?'100%':'none'}} onError={()=>setError(t("图片未能读取，请关闭后重试。"))}/></div>{error&&<p role="alert">{error}</p>}<footer className="modal-footer"><button className="button secondary" aria-label={t("缩小图片")} onClick={()=>setZoom(v=>Math.max(1,v-.5))}><ZoomOut size={14}/></button><button className="button secondary" onClick={()=>setZoom(1)}>{t("适应窗口")}</button><button className="button secondary" aria-label={t("放大图片")} onClick={()=>setZoom(v=>Math.min(4,v+.5))}><ZoomIn size={14}/></button><button className="button secondary" onClick={()=>void invoke('attachment.reveal',image).catch(e=>setError((e as Error).message))}><FolderOpen size={14}/>{t("查看位置")}</button><button className="button primary" onClick={()=>void invoke('attachment.save',image).catch(e=>setError((e as Error).message))}><Download size={14}/>{t("保存图片")}</button></footer></Modal>;
}
export function FilePreview(props:{file:FileReference;invoke:Invoke;onClose:()=>void}){const enabled=useExtensionFeature('filePreview'),panel=useFilePreview();return enabled?(panel?<OpenInPanel {...props}/>:<Modal title={t("文件预览")} subtitle={props.file.name} onClose={props.onClose} className="asset-preview-modal"><FilePreviewBody file={props.file} invoke={props.invoke}/></Modal>):<Modal title={t("文件预览")} onClose={props.onClose}><p>{t("预览插件已停用，可在插件 中启用。")}</p></Modal>;}

export function FilePreviewBody({file,invoke}:{file:FileReference;invoke:Invoke}){
 const toolbarTarget=useContext(PreviewDocumentToolbar);
 const sharedZoom=useContext(PreviewZoom);
 const [data,setData]=useState<FilePreviewData>(),[error,setError]=useState(''),[source,setSource]=useState(false),[revision,setRevision]=useState(0),[localZoom,setLocalZoom]=useState(1),[copied,setCopied]=useState(false),[sheet,setSheet]=useState(0);
 const zoom=sharedZoom?.scale??localZoom,setZoom=sharedZoom?.setScale??setLocalZoom;
 useEffect(()=>{let current=true;setData(undefined);setError('');setSource(false);setLocalZoom(1);setCopied(false);setSheet(0);void invoke<FilePreviewData>('file.preview',file,undefined,{background:true}).then(value=>{if(current)setData(value);}).catch(e=>{if(current)setError((e as Error).message);});return()=>{current=false;};},[file.source,file.id,file.name,file.path,file.resource,invoke,revision]);
 const code=Boolean(data&&(data.kind==='text'||source)),toggleSource=data?.kind==='html'||data?.kind==='markdown'||data?.kind==='word'||((data?.kind==='spreadsheet'||data?.kind==='image')&&data.content!==undefined);
 const sourceLabel=source?t("排版预览"):data?.kind==='word'?t("查看纯文本"):t("查看源码");
 async function copy(){try{await navigator.clipboard.writeText(data?.content??'');setCopied(true);}catch(e){setError(t("复制失败：{0}", (e as Error).message));}}
 const action=(method:string,params:unknown)=>void invoke(method,params).catch(e=>setError((e as Error).message));
 const toolbar=<div className="file-preview-toolbar">
  {toggleSource&&<button type="button" className="button quiet small" aria-label={sourceLabel} title={sourceLabel} aria-pressed={source} onClick={()=>setSource(v=>!v)}>{source?<Eye size={14}/>:data?.kind==='word'?<FileText size={14}/>:<CodeXml size={14}/>}</button>}
  {data?.content!==undefined&&<button type="button" className="button quiet small" aria-label={t("复制文件内容")} title={t("复制文件内容")} onClick={()=>void copy()}>{copied?<Check size={14}/>:<Copy size={14}/>}</button>}
  {file.source!=='explorer'&&<button type="button" className="button quiet small" aria-label={t("刷新文件预览")} title={t("刷新文件预览")} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={14}/></button>}
  {file.source==='generated'&&<button type="button" className="button quiet small" aria-label={t("另存为")} title={t("另存为")} onClick={()=>action('file.download',{id:file.id})}><Download size={14}/></button>}
  {file.source!=='explorer'&&<button type="button" className="button quiet small" aria-label={t("在资源管理器中打开")} title={t("在资源管理器中打开")} onClick={()=>action('file.reveal',file)}><FolderOpen size={14}/></button>}
  {data?.kind==='image'&&!source&&<>
   {!sharedZoom&&<><button type="button" className="button quiet small" aria-label={t("缩小图片")} title={t("缩小图片")} disabled={zoom<=.5} onClick={()=>setZoom(v=>Math.max(.5,v-.25))}><ZoomOut size={14}/></button><button type="button" className="button quiet small" title={t("恢复适应窗口")} onClick={()=>setZoom(1)}>{Math.round(zoom*100)+'%'}</button><button type="button" className="button quiet small" aria-label={t("放大图片")} title={t("放大图片")} disabled={zoom>=4} onClick={()=>setZoom(v=>Math.min(4,v+.25))}><ZoomIn size={14}/></button></>}
   {file.source==='attachment'&&<button type="button" className="button quiet small" aria-label={t("另存为")} title={t("另存为")} onClick={()=>action('attachment.save',{id:file.id,name:file.name})}><Download size={14}/></button>}
  </>}
 </div>;
 return <div className="file-preview-document">{toolbarTarget?createPortal(toolbar,toolbarTarget):toolbar}{error&&<p className="preview-error" role="alert">{error}</p>}<div className={'asset-file-preview preview-content'+(code?' preview-content-code':data?.kind==='html'?' preview-content-page':'')} aria-label={t("文件正文")} style={{zoom:data?.kind==='pdf'||data?.kind==='image'&&!source?1:zoom}}>
  {!data?!error&&<p role="status">{t("正在读取文件…")}</p>:data.kind==='unsupported'?<p>{data.reason}</p>:data.kind==='html'&&!source?<iframe className="html-file-preview" title={t("HTML 预览：{0}", data.name)} src={data.previewUrl} sandbox="allow-scripts" referrerPolicy="no-referrer" onError={()=>setError(t("页面未能载入，可刷新重试或查看源码。"))}/>:data.kind==='audio'||data.kind==='video'?<div className="preview-media">{data.kind==='audio'?<audio aria-label={data.name} controls preload="metadata" src={data.previewUrl} onError={()=>setError(t("音频未能解码，请用默认应用打开。"))}/>:<video aria-label={data.name} controls playsInline preload="metadata" src={data.previewUrl} onError={()=>setError(t("视频未能解码，请用默认应用打开。"))}/>}</div>:data.kind==='pdf'?<Suspense fallback={<p role="status">{t("正在载入 PDF…")}</p>}><PdfPreview base64={data.base64!}/></Suspense>:data.kind==='spreadsheet'&&!source?<><p className="word-preview-note">{data.reason}</p><div className="office-sheet-tabs" role="tablist" aria-label={t("工作表")}>{data.sheets?.map((s,i)=><button type="button" className="button quiet small" role="tab" aria-selected={sheet===i} key={i} onClick={()=>setSheet(i)}>{s.name}</button>)}</div><table className="office-grid"><tbody>{data.sheets?.[Math.min(sheet,data.sheets.length-1)]?.rows.map((row,i)=><tr key={i}><th>{i+1}</th>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></>:data.kind==='slides'?<><p className="word-preview-note">{data.reason}</p>{data.slides?.map((slide,i)=><article className="office-slide" key={i}><small>{t("第 {0} 页", i+1)}</small>{slide.map((line,j)=>j===0?<h3 key={j}>{line}</h3>:<p key={j}>{line}</p>)}</article>)}</>:data.kind==='image'&&!source?<PreviewImage src={data.dataUrl} name={data.name} scale={zoom} onToggle={()=>setZoom(v=>v===1?2:1)} onError={()=>setError(t("图片未能解码，请确认文件内容有效。"))}/>:data.kind==='word'&&!source?<><p className="word-preview-note">{data.reason}</p>{data.base64?<Suspense fallback={<p role="status">{t("正在载入 Word 预览…")}</p>}><WordPreview base64={data.base64}/></Suspense>:<article className="word-document-preview">{data.blocks?.map((block,index)=>block.heading?<h2 key={index}>{block.text}</h2>:<p key={index}>{block.text||'\u00a0'}</p>)}</article>}</>:data.kind==='markdown'&&!source?<Suspense fallback={<p role="status">{t("正在排版…")}</p>}><PreviewMarkdown text={data.content??''} file={file} invoke={invoke}/></Suspense>:<SyntaxCode text={data.content??''} language={data.kind==='word'?'txt':data.language??(data.kind==='markdown'?'md':'txt')} lineNumbers/>}
 </div></div>;
}

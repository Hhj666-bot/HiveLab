import {t} from './i18n';
import {createContext,type Dispatch,type SetStateAction} from 'react';
import {ZoomIn,ZoomOut} from 'lucide-react';
export const PreviewZoom=createContext<{scale:number;setScale:Dispatch<SetStateAction<number>>}|null>(null);
export function PreviewZoomControls({scale,setScale}:{scale:number;setScale:Dispatch<SetStateAction<number>>}){
 return <div className="preview-zoom-controls" role="group" aria-label={t("文件预览缩放")}><button type="button" className="preview-icon-button" aria-label={t("缩小文件预览")} title={t("缩小预览")} disabled={scale<=.5} onClick={()=>setScale(value=>Math.max(.5,value-.25))}><ZoomOut size={14}/></button><button type="button" className="preview-zoom-reset" aria-label={t("恢复文件预览为100%")} title={t("恢复 100%")} onClick={()=>setScale(1)}>{Math.round(scale*100)}%</button><button type="button" className="preview-icon-button" aria-label={t("放大文件预览")} title={t("放大预览")} disabled={scale>=4} onClick={()=>setScale(value=>Math.min(4,value+.25))}><ZoomIn size={14}/></button></div>;
}

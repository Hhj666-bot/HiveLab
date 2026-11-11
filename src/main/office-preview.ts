import {readSlides,readWorkbook} from '../backend/office-read';
import type {FilePreviewData} from '../shared/file-preview';
export function officePreview(bytes:Buffer,extension:string,name:string):FilePreviewData{
 if(extension==='pptx')return {name,kind:'slides',reason:'幻灯片文字预览；完整排版可用默认应用打开。',slides:readSlides(bytes,100).map(slide=>slide.paragraphs)};
 const sheets=readWorkbook(bytes,{sheets:30,rows:500,columns:80}).map(sheet=>({name:sheet.name,rows:sheet.rows}));
 return {name,kind:'spreadsheet',sheets,reason:'显示各工作表前 500 行、80 列及已保存的单元格值；编辑与完整格式可用默认应用打开。'};
}

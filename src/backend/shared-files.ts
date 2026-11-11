import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {replaceWordText,wordBlocks} from './word-document';
import {columnName,readSlides,readWorkbook,type SheetData} from './office-read';
import {parsePages} from './page-range';
import {readPdf,PDF_RENDER_PAGES} from './pdf-read';

const MB=1024*1024;
/** What read_file hands back at most in one call; longer files are read in slices (pages / rows). */
export const READ_CHAR_LIMIT=120_000;
const SIZE_LIMIT={text:2*MB,word:20*MB,spreadsheet:20*MB,slides:20*MB,pdf:50*MB};
type Kind=keyof typeof SIZE_LIMIT;
export type ReadOptions={pages?:unknown;sheet?:unknown;rows?:unknown;render?:unknown};
export type SharedFile={name:string;kind:Kind;content:string;sha256:string;bytes:Buffer;encoding?:string;truncated?:boolean;next?:string;pageCount?:number;sheets?:{name:string;range:string;rows:number;columns:number}[];images?:{page:number;width:number;height:number;data:string}[]};

function kindOf(name:string):Kind{
 const extension=path.extname(name).slice(1).toLowerCase();
 if(extension==='docx')return 'word';
 if(['xlsx','xlsm'].includes(extension))return 'spreadsheet';
 if(extension==='pptx')return 'slides';
 if(extension==='pdf')return 'pdf';
 if(['doc','xls','ppt'].includes(extension))throw Error(`旧版 .${extension} 不能直接读取；请先另存为 .${extension}x`);
 return 'text';
}
const clean=(value:string)=>value.replace(/[\t\r\n]+/g,' ');

/** "5" / "10-50" / "100-" → inclusive 1-based row range; absent means from the first row. */
function rowRange(spec:unknown,fallback:number):[number,number]{
 if(spec===undefined||spec===null||spec==='')return [1,fallback];
 const text=String(spec).replace(/\s+/g,''),match=text.match(/^(\d+)(?:-(\d*))?$/);
 if(!match)throw Error('rows 格式应为 50、1-200 或 201-');
 const start=Number(match[1]),end=match[2]===undefined?start:match[2]===''?start+fallback-1:Number(match[2]);
 if(start<1||end<start)throw Error('rows 范围无效');return [start,Math.min(end,start+4999)];
}

function sheetText(sheet:SheetData,index:number,total:number,[from,to]:[number,number],budget:number){
 const range=sheet.columnCount?`A1:${columnName(sheet.columnCount-1)}${sheet.rowCount}`:'（空）';
 const lines=[`=== 工作表 ${index+1}/${total}「${sheet.name}」 范围 ${range}（${sheet.rowCount} 行 × ${sheet.columnCount} 列） ===`];
 const width=Math.min(sheet.columnCount,200);
 if(width)lines.push(['行',...Array.from({length:width},(_,i)=>columnName(i))].join('\t'));
 let used=lines.join('\n').length,last=from-1,cut:number|undefined;
 for(let number=from;number<=Math.min(to,sheet.rowCount);number++){
  const row=sheet.rows[number-1];if(!row?.some(Boolean)){last=number;continue;}
  const line=[String(number),...row.slice(0,width).map(clean)].join('\t').replace(/\t+$/,'');
  if(used+line.length>budget&&number>from){cut=number;break;}
  lines.push(line);used+=line.length+1;last=number;
 }
 const formulas=sheet.formulas.filter(f=>{const row=Number(f.ref.match(/\d+$/)?.[0]);return row>=from&&row<=last;});
 if(formulas.length)lines.push(`公式（${formulas.length} 个${formulas.length>100?'，列出前 100 个':''}）：`+formulas.slice(0,100).map(f=>`${f.ref} ${f.formula}`).join('；'));
 if(sheet.merged.length)lines.push(`合并单元格：${sheet.merged.slice(0,50).join('、')}${sheet.merged.length>50?` 等 ${sheet.merged.length} 处`:''}`);
 const more=cut??(last<sheet.rowCount?last+1:undefined);
 return {text:lines.join('\n'),used,next:more};
}

async function readSpreadsheet(bytes:Buffer,options:ReadOptions){
 const sheets=readWorkbook(bytes,{columns:200}),total=sheets.length;
 const summary=sheets.map(s=>({name:s.name,range:s.columnCount?`A1:${columnName(s.columnCount-1)}${s.rowCount}`:'',rows:s.rowCount,columns:s.columnCount}));
 let chosen=sheets.map((sheet,index)=>({sheet,index}));
 if(options.sheet!==undefined&&options.sheet!==null&&options.sheet!==''){
  const wanted=String(options.sheet).trim(),byIndex=/^\d+$/.test(wanted)?sheets[Number(wanted)-1]:undefined,byName=sheets.find(s=>s.name===wanted)??sheets.find(s=>s.name.toLowerCase()===wanted.toLowerCase());
  const found=byName??byIndex;if(!found)throw Error(`没有名为「${wanted}」的工作表；共有：${sheets.map(s=>s.name).join('、')}`);
  chosen=[{sheet:found,index:sheets.indexOf(found)}];
 }
 const rows=rowRange(options.rows,chosen.length>1?200:1000),parts:string[]=[],hints:string[]=[];let budget=READ_CHAR_LIMIT;
 for(const {sheet,index} of chosen){
  if(budget<2000){hints.push(`工作表「${sheet.name}」未显示，传 sheet 单独读取`);continue;}
  const part=sheetText(sheet,index,total,rows,budget);parts.push(part.text);budget-=part.used;
  if(part.next)hints.push(`「${sheet.name}」从第 ${part.next} 行继续：sheet="${sheet.name}", rows="${part.next}-"`);
 }
 const note='单元格为文件中保存的值（日期、百分比已按格式显示）；公式单独列出，公式未在 Excel 中计算过时显示为公式本身。';
 return {content:[note,...parts].join('\n\n'),sheets:summary,...(hints.length?{truncated:true,next:hints.join('；')}:{})};
}

function readPresentation(bytes:Buffer,options:ReadOptions){
 const slides=readSlides(bytes),wanted=new Set(parsePages(options.pages,slides.length));
 const parts:string[]=[];let used=0,next:number|undefined;
 for(const slide of slides){
  if(!wanted.has(slide.number))continue;
  const text=[`=== 第 ${slide.number} 张幻灯片 / 共 ${slides.length} 张 ===`,...slide.paragraphs,...(slide.notes.length?['备注：'+slide.notes.join(' / ')]:[])].join('\n');
  if(parts.length&&used+text.length>READ_CHAR_LIMIT){next=slide.number;break;}
  parts.push(text);used+=text.length;
 }
 return {content:parts.join('\n\n'),pageCount:slides.length,...(next?{truncated:true,next:`从第 ${next} 张继续：pages="${next}-"`}:{})};
}

async function readPdfFile(bytes:Buffer,options:ReadOptions){
 const render=options.render===true;
 const result=await readPdf(bytes,{pages:options.pages===undefined||options.pages===null||options.pages===''?(render?'1':undefined):String(options.pages),render,maxChars:READ_CHAR_LIMIT});
 const text=result.pages.map(p=>`=== 第 ${p.page} 页 / 共 ${result.pageCount} 页 ===\n${p.text||'（这一页没有可提取的文字）'}`).join('\n\n');
 const blank=result.pages.filter(p=>!p.text).map(p=>p.page),list=blank.slice(0,PDF_RENDER_PAGES).join(',');
 const hints=[...(result.nextPage?[`从第 ${result.nextPage} 页继续：pages="${result.nextPage}-"`]:[]),...(blank.length&&!render?[`第 ${blank.join('、')} 页没有文字层，可能是扫描件或图片：传 render=true, pages="${list}" 查看页面图片`]:[])];
 return {content:text,pageCount:result.pageCount,...(render?{images:result.images}:{}),...(hints.length?{truncated:!!result.nextPage,next:hints.join('；')}:{})};
}

function decodeText(bytes:Buffer){
 if(bytes[0]===0xff&&bytes[1]===0xfe)return {content:new TextDecoder('utf-16le').decode(bytes),encoding:'utf-16le'};
 if(bytes[0]===0xfe&&bytes[1]===0xff)return {content:new TextDecoder('utf-16be').decode(bytes),encoding:'utf-16be'};
 if(bytes.includes(0))throw Error('此二进制格式没有公共读取器；请使用相应原生工具');
 try{return {content:new TextDecoder('utf-8',{fatal:true}).decode(bytes),encoding:'utf-8'};}
 // Excel and older Windows tools save Chinese CSV/TXT as GBK.
 catch{try{return {content:new TextDecoder('gb18030',{fatal:true}).decode(bytes),encoding:'gb18030'};}catch{throw Error('无法识别文件编码（支持 UTF-8、UTF-16 和 GBK）');}}
}

export async function readSharedFile(target:string,options:ReadOptions={}):Promise<SharedFile>{
 const name=path.basename(target),kind=kindOf(name),limit=SIZE_LIMIT[kind],info=await stat(target);
 if(!info.isFile())throw Error('文件不存在');
 if(info.size>limit)throw Error(`文件超过读取上限（文本 2 MB，Word/Excel/PPT 20 MB，PDF 50 MB）`);
 const bytes=await readFile(target);if(bytes.length>limit)throw Error('文件超过读取上限');
 const sha256=createHash('sha256').update(bytes).digest('hex');
 if(options.render===true&&kind!=='pdf')throw Error('render 只用于 PDF 页面');
 if(kind==='word')return {name,kind,content:wordBlocks(bytes).map(block=>block.text).join('\n'),sha256,bytes};
 if(kind==='spreadsheet')return {name,kind,sha256,bytes,...await readSpreadsheet(bytes,options)};
 if(kind==='slides')return {name,kind,sha256,bytes,...readPresentation(bytes,options)};
 if(kind==='pdf')return {name,kind,sha256,bytes,...await readPdfFile(bytes,options)};
 const decoded=decodeText(bytes);
 return {name,kind,sha256,bytes,content:decoded.content.replace(/^﻿/,''),...(decoded.encoding==='utf-8'?{}:{encoding:decoded.encoding})};
}
export {PDF_RENDER_PAGES};

export async function editSharedFile(target:string,args:any){
 const kind=kindOf(path.basename(target));
 if(kind!=='text'&&kind!=='word')throw Error('edit_file 只能修改文本、代码和 Word；表格、幻灯片和 PDF 请用 create_file 生成新文件');
 const file=await readSharedFile(target);
 if(file.encoding)throw Error(`公共文本编辑目前只支持 UTF-8 文件（此文件是 ${file.encoding}）`);
 if(typeof args.expectedHash!=='string'||args.expectedHash!==file.sha256)throw Error('文件已变化或缺少版本校验；请先 read_file，再传入返回的 sha256 作为 expectedHash');
 if(typeof args.oldText!=='string'||!args.oldText||typeof args.newText!=='string'||Buffer.byteLength(args.newText)>2*1024*1024)throw Error('须提供非空 oldText 和文本 newText（不超过 2 MB）');
 if(file.kind==='word'){const changed=replaceWordText(file.bytes,args.oldText,args.newText,args.replaceAll===true);return {...changed,name:file.name,format:'docx' as const};}
 const count=file.content.split(args.oldText).length-1;if(!count)throw Error('未找到待替换文字');if(count>1&&args.replaceAll!==true)throw Error(`找到 ${count} 处匹配；请缩小文字范围或明确 replaceAll`);
 const content=file.content.split(args.oldText).join(args.newText);if(Buffer.byteLength(content)>2*1024*1024)throw Error('编辑结果超过 2 MB');
 const extension=path.extname(file.name).slice(1).toLowerCase();return {name:file.name,format:['md','txt'].includes(extension)?extension as 'md'|'txt':'code' as const,language:extension||'text',content,replacements:count};
}

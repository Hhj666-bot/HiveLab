import {wordParts} from './word-document';

/** XML text node → plain text. Character references only; no entities beyond the five XML ones. */
export const xmlText=(value:string)=>value.replace(/<[^>]*>/g,'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(all,key:string)=>{if(key[0]==='#'){const hex=key[1].toLowerCase()==='x',code=parseInt(key.slice(hex?2:1),hex?16:10);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'�';}return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[key.toLowerCase()]??all;});
const attr=(xml:string,key:string)=>xml.match(new RegExp('\\b'+key+'=["\']([^"\']*)["\']'))?.[1]??'';
const partText=(part:Buffer|undefined)=>part?.toString('utf8')??'';
const resolveTarget=(base:string,target:string)=>{if(target.startsWith('/'))return target.slice(1);const parts=base.split('/').slice(0,-1);for(const piece of target.split('/')){if(piece==='..')parts.pop();else if(piece&&piece!=='.')parts.push(piece);}return parts.join('/');};
function relationships(parts:Record<string,Buffer>,file:string){
 const slash=file.lastIndexOf('/'),rels=partText(parts[`${file.slice(0,slash)}/_rels/${file.slice(slash+1)}.rels`]),map=new Map<string,{target:string;type:string}>();
 for(const m of rels.matchAll(/<Relationship\b[^>]*\/?\s*>/g)){if(attr(m[0],'TargetMode')==='External')continue;map.set(attr(m[0],'Id'),{target:resolveTarget(file,attr(m[0],'Target')),type:attr(m[0],'Type')});}
 return map;
}

export const columnName=(index:number)=>{let name='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
const columnIndex=(letters:string)=>{let column=0;for(const letter of letters)column=column*26+letter.charCodeAt(0)-64;return column-1;};

export type SheetData={name:string;rows:string[][];formulas:{ref:string;formula:string}[];merged:string[];rowCount:number;columnCount:number;truncated:boolean};
const BUILTIN_DATE=new Set([14,15,16,17,22,27,28,29,30,31,34,35,36,50,51,52,53,54,57,58]),BUILTIN_TIME=new Set([18,19,20,21,32,33,45,46,47,55,56]),BUILTIN_PERCENT=new Set([9,10]);
type Style='date'|'time'|'datetime'|'percent'|undefined;
function styleKinds(stylesXml:string):Style[]{
 const custom=new Map<number,string>();for(const m of stylesXml.matchAll(/<numFmt\b[^>]*\/?\s*>/g))custom.set(Number(attr(m[0],'numFmtId')),xmlText(attr(m[0],'formatCode')));
 const xfs=stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1]??'';
 return [...xfs.matchAll(/<xf\b[^>]*\/?\s*>/g)].map(m=>{
  const id=Number(attr(m[0],'numFmtId'));if(BUILTIN_DATE.has(id))return id===22?'datetime':'date';if(BUILTIN_TIME.has(id))return 'time';if(BUILTIN_PERCENT.has(id))return 'percent';
  const code=custom.get(id);if(!code)return undefined;const plain=code.replace(/"[^"]*"|\[[^\]]*\]|\\./g,'');
  if(/%/.test(plain))return 'percent';const date=/[yd]/i.test(plain),time=/[hs]/i.test(plain);
  return date&&time?'datetime':date?'date':time?'time':undefined;
 });
}
const pad=(n:number)=>String(n).padStart(2,'0');
function excelDate(serial:number,kind:Exclude<Style,'percent'|undefined>,date1904:boolean){
 if(!Number.isFinite(serial))return String(serial);
 const ms=Math.round((serial+(date1904?1462:0))*86400000)+Date.UTC(1899,11,30),d=new Date(ms);
 const day=`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`,clock=`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${d.getUTCSeconds()?':'+pad(d.getUTCSeconds()):''}`;
 return kind==='time'?(serial>=1?`${day} ${clock}`:clock):kind==='datetime'||serial%1?`${day} ${clock}`:day;
}

/** Cell values as Excel shows them (saved values; dates and percentages formatted), plus formulas and merged ranges. */
export function readWorkbook(bytes:Buffer,limits:{sheets?:number;rows?:number;columns?:number}={}):SheetData[]{
 const parts=wordParts(bytes,'xl/workbook.xml'),workbook=partText(parts['xl/workbook.xml']),rels=relationships(parts,'xl/workbook.xml');
 const shared=[...partText(parts['xl/sharedStrings.xml']).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>[...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g,'').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t=>xmlText(t[1])).join(''));
 const styles=styleKinds(partText(parts['xl/styles.xml'])),date1904=/<workbookPr\b[^>]*\bdate1904=["'](1|true)["']/.test(workbook);
 const maxRows=limits.rows??Infinity,maxColumns=limits.columns??Infinity;
 return [...workbook.matchAll(/<sheet\b[^>]*\/?\s*>/g)].slice(0,limits.sheets??Infinity).map((sheet,index)=>{
  const file=rels.get(attr(sheet[0],'r:id'))?.target??'',xml=partText(parts[file]);
  const rows:string[][]=[],formulas:{ref:string;formula:string}[]=[];let rowCount=0,columnCount=0,truncated=false;
  for(const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)){
   const number=Number(attr(row[1],'r'))||rowCount+1;rowCount=Math.max(rowCount,number);
   if(number>maxRows){truncated=true;continue;}
   const cells:string[]=[];
   for(const cell of (row[2]??'').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const ref=attr(cell[1],'r'),letters=ref.match(/^[A-Z]+/)?.[0],column=letters?columnIndex(letters):cells.length;
    const body=cell[2]??'',type=attr(cell[1],'t'),raw=body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1],formula=body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
    let value=type==='s'?(shared[Number(raw)]??''):type==='inlineStr'?[...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>xmlText(m[1])).join(''):type==='b'?(raw==='1'?'TRUE':raw===undefined?'':'FALSE'):raw===undefined?'':xmlText(raw);
    if(!type||type==='n'){const kind=styles[Number(attr(cell[1],'s'))||0];if(raw!==undefined&&kind){const n=Number(raw);value=kind==='percent'?`${+(n*100).toFixed(6)}%`:excelDate(n,kind,date1904);}}
    if(formula!==undefined&&formula!==''){const text='='+xmlText(formula);formulas.push({ref:ref||columnName(column)+number,formula:text});if(value==='')value=text;}
    if(value==='')continue;
    columnCount=Math.max(columnCount,column+1);if(column>=maxColumns){truncated=true;continue;}
    cells[column]=value;
   }
   rows[number-1]=Array.from({length:cells.length},(_,i)=>cells[i]??'');
  }
  return {name:xmlText(attr(sheet[0],'name'))||'工作表 '+(index+1),rows:Array.from({length:Math.min(rows.length,maxRows)},(_,i)=>rows[i]??[]),formulas,merged:[...xml.matchAll(/<mergeCell\b[^>]*\bref=["']([^"']+)["']/g)].map(m=>m[1]),rowCount,columnCount,truncated};
 });
}

export type SlideData={number:number;paragraphs:string[];notes:string[]};
const paragraphs=(xml:string)=>[...xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)].map(m=>[...m[1].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>/g)].map(t=>t[1]===undefined?'\n':xmlText(t[1])).join('').trim()).filter(Boolean);
/** Slide text in presentation order, with speaker notes. */
export function readSlides(bytes:Buffer,limit=Infinity):SlideData[]{
 const parts=wordParts(bytes,'ppt/presentation.xml'),rels=relationships(parts,'ppt/presentation.xml');
 let files=[...partText(parts['ppt/presentation.xml']).matchAll(/<p:sldId\b[^>]*\/?\s*>/g)].map(m=>rels.get(attr(m[0],'r:id'))?.target).filter((file):file is string=>!!file&&!!parts[file]);
 if(!files.length)files=Object.keys(parts).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a,b)=>Number(a.match(/\d+/)?.[0])-Number(b.match(/\d+/)?.[0]));
 return files.slice(0,limit).map((file,index)=>{
  const notes=[...relationships(parts,file).values()].find(rel=>/notesSlide$/.test(rel.type))?.target;
  return {number:index+1,paragraphs:paragraphs(partText(parts[file])),notes:notes?paragraphs(partText(parts[notes])).filter(text=>!/^\d+$/.test(text)):[]};
 });
}

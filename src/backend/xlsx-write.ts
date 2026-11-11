import {escapeDocumentText as escape,zipParts} from './document-output';
import {columnName} from './office-read';

/**
 * Tables for create_file. Every cell arrives as text and is read the way Excel reads typing:
 * "=SUM(B2:B5)" is a formula, "1200" / "-3.5" a number, "12.5%" a percentage, "2026-11-09" (optionally with a time) a date,
 * and a leading apostrophe keeps the rest as plain text ("'00123", "'=not a formula").
 */
export type TableSheet={name?:string;rows:unknown[][];columns?:{width?:number;format?:string}[];header?:boolean;merge?:string[]};
const MAX_SHEETS=50,MAX_CELLS=1_000_000,MAX_COLUMNS=1000,MAX_ROWS=1_048_576,MAX_TEXT=32_767;
const NUMBER=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/,PERCENT=/^-?(?:0|[1-9]\d*)(?:\.\d+)?%$/,DATE=/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const invalidXml=/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

type Cell={kind:'text';text:string}|{kind:'number';value:number;format?:string}|{kind:'bool';value:boolean}|{kind:'formula';formula:string}|{kind:'empty'};
function cellOf(input:unknown):Cell{
 if(input===null||input===undefined||input==='')return {kind:'empty'};
 if(typeof input==='number')return Number.isFinite(input)?{kind:'number',value:input}:{kind:'text',text:String(input)};
 if(typeof input==='boolean')return {kind:'bool',value:input};
 const text=String(input).replace(invalidXml,'');
 if(text.startsWith("'"))return {kind:'text',text:text.slice(1)};
 if(text.startsWith('=')&&text.length>1)return {kind:'formula',formula:text.slice(1)};
 const trimmed=text.trim();
 // More than 15 significant digits would lose precision in Excel; such strings are IDs, kept as text.
 if(NUMBER.test(trimmed)&&trimmed.replace(/^-|\.|e.*$/gi,'').replace(/^0+/,'').length<=15)return {kind:'number',value:Number(trimmed)};
 if(PERCENT.test(trimmed)){const value=Number(trimmed.slice(0,-1))/100,decimals=trimmed.split('.')[1]?.replace('%','').length??0;return {kind:'number',value,format:decimals?'0.'+'0'.repeat(Math.min(decimals,6))+'%':'0%'};}
 const date=trimmed.match(DATE);
 if(date){
  const [,y,m,d,h,mi,s]=date.map(Number),ms=Date.UTC(y,m-1,d,h||0,mi||0,s||0),check=new Date(ms);
  if(check.getUTCFullYear()===y&&check.getUTCMonth()===m-1&&check.getUTCDate()===d&&(h||0)<24&&(mi||0)<60&&(s||0)<60&&y>=1900)
   return {kind:'number',value:(ms-Date.UTC(1899,11,30))/86_400_000,format:date[4]?(date[6]?'yyyy-mm-dd hh:mm:ss':'yyyy-mm-dd hh:mm'):'yyyy-mm-dd'};
 }
 return {kind:'text',text:text.slice(0,MAX_TEXT)};
}
const displayWidth=(text:string)=>{let width=0;for(const char of text)width+=/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(char)?2:1;return width;};

export function checkSheets(input:unknown):TableSheet[]{
 if(!Array.isArray(input)||!input.length)throw Error('sheets 须为非空数组：[{name, rows:[["表头",…],["值",…]]}]');
 if(input.length>MAX_SHEETS)throw Error(`最多 ${MAX_SHEETS} 张工作表`);
 const names=new Set<string>();let cells=0;
 return input.map((sheet:any,index)=>{
  if(!sheet||typeof sheet!=='object'||!Array.isArray(sheet.rows))throw Error(`第 ${index+1} 张工作表缺少 rows（二维数组）`);
  if(sheet.rows.length>MAX_ROWS)throw Error('行数超过 Excel 上限');
  for(const row of sheet.rows){if(!Array.isArray(row))throw Error(`工作表 ${index+1} 的每一行都须为数组`);if(row.length>MAX_COLUMNS)throw Error(`每行最多 ${MAX_COLUMNS} 列`);cells+=row.length;}
  if(cells>MAX_CELLS)throw Error(`单元格总数超过 ${MAX_CELLS}`);
  let name=String(sheet.name??'').replace(/[\[\]:*?/\\]/g,' ').replace(invalidXml,'').trim().replace(/^'+|'+$/g,'').slice(0,31)||`Sheet${index+1}`;
  const base=name;for(let n=2;names.has(name.toLowerCase());n++)name=`${base.slice(0,29-String(n).length)}(${n})`;
  names.add(name.toLowerCase());
  const merge=Array.isArray(sheet.merge)?sheet.merge.map(String):[];
  for(const range of merge)if(!/^[A-Z]{1,3}[1-9]\d*:[A-Z]{1,3}[1-9]\d*$/.test(range))throw Error(`合并范围无效：${range}（应为 A1:C1）`);
  const columns=Array.isArray(sheet.columns)?sheet.columns.slice(0,MAX_COLUMNS).map((c:any)=>({width:typeof c?.width==='number'&&c.width>0?Math.min(c.width,255):undefined,format:typeof c?.format==='string'&&c.format.length<=100?c.format:undefined})):undefined;
  return {name,rows:sheet.rows,columns,header:sheet.header!==false,merge};
 });
}

class Styles{
 private formats=new Map<string,number>();private xfs=new Map<string,number>([['0|0',0]]);
 index(format:string|undefined,bold:boolean){
  let id=0;if(format){id=this.formats.get(format)??164+this.formats.size;this.formats.set(format,id);}
  const key=`${id}|${bold?1:0}`;let xf=this.xfs.get(key);if(xf===undefined){xf=this.xfs.size;this.xfs.set(key,xf);}return xf;
 }
 xml(){
  const formats=[...this.formats].map(([code,id])=>`<numFmt numFmtId="${id}" formatCode="${escape(code)}"/>`).join('');
  const xfs=[...this.xfs.keys()].map(key=>{const [id,bold]=key.split('|').map(Number);return `<xf numFmtId="${id}" fontId="${bold}" fillId="${bold?2:0}" borderId="0" xfId="0"${id?' applyNumberFormat="1"':''}${bold?' applyFont="1" applyFill="1"':''}/>`;}).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${formats?`<numFmts count="${this.formats.size}">${formats}</numFmts>`:''}<fonts count="2"><font><sz val="11"/><name val="等线"/><family val="2"/><charset val="134"/></font><font><b/><sz val="11"/><name val="等线"/><family val="2"/><charset val="134"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F4F7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.size}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
 }
}

function sheetXml(sheet:TableSheet,styles:Styles){
 const header=sheet.header!==false&&sheet.rows.length>1,widths:number[]=[];let lastColumn=0;
 const rows=sheet.rows.map((row,r)=>{
  const cells=row.map((input,c)=>{
   const cell=cellOf(input),ref=columnName(c)+(r+1),bold=header&&r===0,columnFormat=bold?undefined:sheet.columns?.[c]?.format,format=cell.kind==='number'?columnFormat??cell.format:cell.kind==='formula'?columnFormat:undefined;
   if(cell.kind==='empty')return bold?`<c r="${ref}" s="${styles.index(undefined,true)}"/>`:'';
   lastColumn=Math.max(lastColumn,c+1);
   const shown=cell.kind==='text'?cell.text:cell.kind==='formula'?'0000000000':cell.kind==='bool'?'FALSE':cell.format?.includes('y')?(cell.format.includes('h')?'2026-01-01 00:00':'2026-01-01'):String(cell.value);
   widths[c]=Math.max(widths[c]??0,Math.max(...shown.split('\n').map(displayWidth)));
   const style=styles.index(format,bold),s=style?` s="${style}"`:'';
   if(cell.kind==='text')return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escape(cell.text)}</t></is></c>`;
   if(cell.kind==='bool')return `<c r="${ref}"${s} t="b"><v>${cell.value?1:0}</v></c>`;
   if(cell.kind==='formula')return `<c r="${ref}"${s}><f>${escape(cell.formula)}</f></c>`;
   return `<c r="${ref}"${s}><v>${cell.value}</v></c>`;
  }).join('');
  return cells?`<row r="${r+1}">${cells}</row>`:'';
 }).join('');
 const columnCount=Math.max(lastColumn,sheet.columns?.length??0);
 const cols=columnCount?`<cols>${Array.from({length:columnCount},(_,c)=>`<col min="${c+1}" max="${c+1}" width="${(sheet.columns?.[c]?.width??Math.min(60,Math.max(8,(widths[c]??0)+2))).toFixed(2)}" customWidth="1"/>`).join('')}</cols>`:'';
 const view=header?'<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>':'<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
 const filter=header&&lastColumn?`<autoFilter ref="A1:${columnName(lastColumn-1)}${sheet.rows.length}"/>`:'';
 const merge=sheet.merge?.length?`<mergeCells count="${sheet.merge.length}">${sheet.merge.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`:'';
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${filter}${merge}</worksheet>`;
}

export function xlsxContent(input:unknown){
 const sheets=checkSheets(input),styles=new Styles(),bodies=sheets.map(sheet=>sheetXml(sheet,styles));
 const parts:Record<string,string>={
  '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
  '_rels/.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet,i)=>`<sheet name="${escape(sheet.name!)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
  'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  'xl/styles.xml':styles.xml(),
 };
 bodies.forEach((body,i)=>{parts[`xl/worksheets/sheet${i+1}.xml`]=body;});
 return zipParts(parts);
}

/** CSV/TSV text, or a Markdown table, as rows. Quoted fields may hold commas, quotes and line breaks. */
export function tableRows(content:string):string[][]{
 const text=content.replace(/^﻿/,'').replace(/\r\n?/g,'\n').replace(/\n+$/,'');
 const lines=text.split('\n');
 if(lines.length&&lines.every(line=>!line.trim()||/^\s*\|.*\|\s*$/.test(line)))
  return lines.filter(line=>line.trim()&&!/^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line)).map(line=>line.trim().slice(1,-1).split(/(?<!\\)\|/).map(cell=>cell.trim().replace(/\\\|/g,'|')));
 const delimiter=(lines[0]?.split('\t').length??0)>(lines[0]?.split(',').length??0)?'\t':',';
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){if(char==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=char;}
  else if(char==='"'&&!cell)quoted=true;
  else if(char===delimiter){row.push(cell);cell='';}
  else if(char==='\n'){row.push(cell);rows.push(row);row=[];cell='';}
  else cell+=char;
 }
 if(cell||row.length||text){row.push(cell);rows.push(row);}
 return rows;
}

const csvField=(value:unknown)=>{const text=value===null||value===undefined?'':String(value);return /[",\r\n]/.test(text)||/^\s|\s$/.test(text)?`"${text.replace(/"/g,'""')}"`:text;};
/** UTF-8 with a byte-order mark, so Excel opens Chinese text correctly. */
export function csvContent(args:{content?:unknown;sheets?:unknown}){
 if(args.sheets!==undefined){
  const sheets=checkSheets(args.sheets);if(sheets.length>1)throw Error('CSV 只能有一张表；多张表请用 format=xlsx');
  return Buffer.from('﻿'+sheets[0].rows.map(row=>row.map(csvField).join(',')).join('\r\n')+'\r\n','utf8');
 }
 if(typeof args.content!=='string')throw Error('CSV 须提供 content（CSV 文本）或 sheets');
 return Buffer.from('﻿'+args.content.replace(/^﻿/,''),'utf8');
}

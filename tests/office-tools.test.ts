import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pdf,pptx} from './office-fixtures';
import {readSlides,readWorkbook} from '../src/backend/office-read';
import {csvContent,tableRows,xlsxContent} from '../src/backend/xlsx-write';
import {editSharedFile,readSharedFile} from '../src/backend/shared-files';
import {parsePages} from '../src/backend/page-range';
import {outputName} from '../src/shared/file-output';
import {officePreview} from '../src/main/office-preview';

const temp=()=>mkdtempSync(path.join(process.env.TEMP!,'office-tools-'));

test('an Excel file written from text cells reads back with numbers, dates, percentages, formulas and kept text',()=>{
 const bytes=xlsxContent([
  {name:'销售/汇总',rows:[['日期','产品','数量','单价','金额','占比','编号'],['2026-11-01','甲','3','12.5','=C2*D2','12.5%',"'00123"],['2026-11-02 14:30','乙','10','2','=C3*D3','0.5%','123456789012345678']],columns:[{},{},{},{format:'#,##0.00'}],merge:['A5:C5']},
  {name:'销售/汇总',rows:[['只有一行']],header:false},
 ]);
 const [first,second]=readWorkbook(bytes);
 assert.equal(first.name,'销售 汇总');assert.equal(second.name,'销售 汇总(2)');
 assert.deepEqual(first.rows[0],['日期','产品','数量','单价','金额','占比','编号']);
 assert.deepEqual(first.rows[1],['2026-11-01','甲','3','12.5','=C2*D2','12.5%','00123']);
 assert.equal(first.rows[2][0],'2026-11-02 14:30');assert.equal(first.rows[2][5],'0.5%');
 assert.equal(first.rows[2][6],'123456789012345678','more than 15 digits stays text');
 assert.deepEqual(first.formulas,[{ref:'E2',formula:'=C2*D2'},{ref:'E3',formula:'=C3*D3'}]);
 assert.deepEqual(first.merged,['A5:C5']);
 assert.equal(first.rowCount,3);assert.equal(first.columnCount,7);
 // The preview shown in the app reads the same file.
 const preview=officePreview(bytes,'xlsx','t.xlsx');assert.equal(preview.sheets?.[0].rows[1][0],'2026-11-01');
});

test('CSV and Markdown tables become rows; CSV output carries a BOM and quotes fields',()=>{
 assert.deepEqual(tableRows('a,b\n"x, y","say ""hi"""\n1,2\n'),[['a','b'],['x, y','say "hi"'],['1','2']]);
 assert.deepEqual(tableRows('| 名称 | 数量 |\n|---|---:|\n| 甲 | 3 |'),[['名称','数量'],['甲','3']]);
 assert.deepEqual(tableRows('a\tb\n1\t2'),[['a','b'],['1','2']]);
 const csv=csvContent({sheets:[{rows:[['名称','备注'],['甲','含,逗号']]}]});
 assert.equal(csv.subarray(0,3).toString('hex'),'efbbbf');assert.equal(csv.toString('utf8').slice(1),'名称,备注\r\n甲,"含,逗号"\r\n');
 assert.throws(()=>csvContent({sheets:[{rows:[['a']]},{rows:[['b']]}]}),/只能有一张表/);
 assert.deepEqual(outputName('报表.xlsx','xlsx'),{name:'报表.xlsx',format:'xlsx'});assert.equal(outputName('数据','csv').name,'数据.csv');
});

test('read_file reads a workbook in slices: one sheet, a row range, and a hint for the rest',async()=>{
 const root=temp();
 try{
  const rows=[['序号','名称'],...Array.from({length:1500},(_,i)=>[String(i+1),'项目'+(i+1)])];
  const file=path.join(root,'清单.xlsx');writeFileSync(file,xlsxContent([{name:'明细',rows},{name:'说明',rows:[['备注'],['=1+1']]}]));
  const all=await readSharedFile(file);
  assert.equal(all.kind,'spreadsheet');assert.deepEqual(all.sheets?.map(s=>[s.name,s.range]),[['明细','A1:B1501'],['说明','A1:A2']]);
  assert.match(all.content,/=== 工作表 1\/2「明细」 范围 A1:B1501（1501 行 × 2 列） ===\n行\tA\tB\n1\t序号\t名称\n2\t1\t项目1/);
  assert.match(all.content,/公式（1 个）：A2 =1\+1/);
  assert.equal(all.truncated,true);assert.match(all.next!,/「明细」从第 201 行继续：sheet="明细", rows="201-"/);
  const slice=await readSharedFile(file,{sheet:'明细',rows:'1490-'});
  assert.doesNotMatch(slice.content,/「说明」/);assert.match(slice.content,/\n1490\t1489\t项目1489/);assert.match(slice.content,/\n1501\t1500\t项目1500$/);assert.equal(slice.truncated,undefined);
  assert.match((await readSharedFile(file,{sheet:'2'})).content,/「说明」/);
  await assert.rejects(()=>readSharedFile(file,{sheet:'不存在'}),/共有：明细、说明/);
  await assert.rejects(()=>readSharedFile(file,{rows:'abc'}),/rows 格式/);
  await assert.rejects(()=>editSharedFile(file,{expectedHash:all.sha256,oldText:'a',newText:'b'}),/只能修改文本、代码和 Word/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('slides read in presentation order with speaker notes, and pages picks slides',async()=>{
 const bytes=pptx();
 assert.deepEqual(readSlides(bytes),[{number:1,paragraphs:['封面'],notes:['讲者备注']},{number:2,paragraphs:['第二页标题','A & B'],notes:[]}]);
 const root=temp();
 try{
  const file=path.join(root,'deck.pptx');writeFileSync(file,bytes);
  const read=await readSharedFile(file);assert.equal(read.pageCount,2);assert.match(read.content,/=== 第 1 张幻灯片 \/ 共 2 张 ===\n封面\n备注：讲者备注/);
  assert.doesNotMatch((await readSharedFile(file,{pages:'2'})).content,/封面/);
  await assert.rejects(()=>readSharedFile(file,{render:true}),/render 只用于 PDF/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('PDF pages read as text, render to PNG images, and a page without text suggests render',async()=>{
 const root=temp();
 try{
  const file=path.join(root,'report.pdf');writeFileSync(file,pdf(['Page one text','Page two text','','Page four text','Page five text']));
  const all=await readSharedFile(file);
  assert.equal(all.kind,'pdf');assert.equal(all.pageCount,5);
  assert.match(all.content,/=== 第 1 页 \/ 共 5 页 ===\nPage one text/);assert.match(all.content,/=== 第 3 页 \/ 共 5 页 ===\n（这一页没有可提取的文字）/);
  const some=await readSharedFile(file,{pages:'2,4-'});assert.deepEqual([...some.content.matchAll(/第 (\d) 页/g)].map(m=>m[1]),['2','4','5']);
  const blank=await readSharedFile(file,{pages:'3'});assert.match(blank.next!,/render=true/);
  const shot=await readSharedFile(file,{pages:'1-2',render:true});
  assert.equal(shot.images?.length,2);assert.equal(shot.images![0].page,1);
  assert.equal(Buffer.from(shot.images![0].data,'base64').subarray(1,4).toString(),'PNG');
  assert.equal(Math.max(shot.images![0].width,shot.images![0].height),1600);
  assert.equal((await readSharedFile(file,{render:true})).images?.length,1,'render without pages shows the first page');
  await assert.rejects(()=>readSharedFile(file,{pages:'1-5',render:true}),/一次最多 4 页/);
  await assert.rejects(()=>readSharedFile(file,{pages:'9'}),/第 9 页不存在，共 5 页/);
  writeFileSync(path.join(root,'bad.pdf'),'not a pdf');await assert.rejects(()=>readSharedFile(path.join(root,'bad.pdf')),/PDF/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('GBK text is read; editing keeps the UTF-8-only rule; old Office formats are named',async()=>{
 const root=temp();
 try{
  const file=path.join(root,'导出.csv');writeFileSync(file,Buffer.from('c3fbb3c62cbdf0b6ee0d0ab1cabcc7b1be2c3132300d0a','hex'));
  const read=await readSharedFile(file);assert.equal(read.encoding,'gb18030');assert.equal(read.content,'名称,金额\r\n笔记本,120\r\n');
  await assert.rejects(()=>editSharedFile(file,{expectedHash:read.sha256,oldText:'120',newText:'130'}),/只支持 UTF-8/);
  writeFileSync(path.join(root,'old.xls'),'x');await assert.rejects(()=>readSharedFile(path.join(root,'old.xls')),/旧版 \.xls/);
  assert.deepEqual(parsePages('1,3-4,9-',10),[1,3,4,9,10]);assert.throws(()=>parsePages('0',3),/范围无效/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

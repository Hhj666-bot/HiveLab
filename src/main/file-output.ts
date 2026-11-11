import {BrowserWindow,dialog} from 'electron';
import {mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {documentBlocks,docxContent} from '../backend/document-output';
import {escapeDocumentText as escape} from '../backend/document-output';
import {outputName,type GeneratedFile} from '../shared/file-output';
import {resolveSafePath} from '../backend/security';
import {wordParts} from '../backend/word-document';
import {csvContent,tableRows,xlsxContent} from '../backend/xlsx-write';
export class FileOutputs{
  private root:string;private dataDirectory:string;private queue=Promise.resolve();
  constructor(dataDirectory:string){this.dataDirectory=path.resolve(dataDirectory);this.root=path.join(dataDirectory,'generated-files');}
  /** 只允许读取数据目录（工作区/工位）内的文件，避免把任意系统文件搬进成果目录。 */
  private localPath(input:string){const target=path.isAbsolute(input)?path.resolve(input):resolveSafePath(this.dataDirectory,input);if(target!==this.dataDirectory&&!target.startsWith(this.dataDirectory+path.sep))throw Error('图片路径须位于 HiveLab 数据目录内');return target;}
  /** 供 hivelab-generated:// 协议直读文件字节，避免再走一次 base64。 */
  async read(id:unknown){const {file,target}=await this.resolve(id);return {file,bytes:await readFile(target)};}
  /** Internal host operation: only publishes a revised DOCX created by the bounded editor. */
  async importWord(args:any):Promise<GeneratedFile>{
    if(typeof args?.base64!=='string'||args.base64.length>28*1024*1024)throw Error('Word 副本过大');const bytes=Buffer.from(args.base64,'base64');wordParts(bytes);
    const {name,format}=outputName(args.name,'docx'),id=randomUUID(),folder=path.join(this.root,id);await mkdir(folder,{recursive:true});
    try{await writeFile(path.join(folder,name),bytes,{flag:'wx'});const file:GeneratedFile={id,name,format,bytes:bytes.length,createdAt:new Date().toISOString()};await writeFile(path.join(this.root,id+'.json'),JSON.stringify(file),{flag:'wx'});return file;}catch(error){await rm(folder,{recursive:true,force:true});throw error;}
  }
  async create(args:any):Promise<GeneratedFile>{let complete!:()=>void;const previous=this.queue;this.queue=new Promise<void>(resolve=>complete=resolve);await previous;try{return await this.write(args);}finally{complete();}}
  private async write(args:any){const asImage=String(args?.format??'').toLowerCase()==='png'||(!args?.format&&typeof args?.sourcePath==='string');if(asImage)return this.writeImage(args);if(['xlsx','csv'].includes(String(args?.format??'').toLowerCase()))return this.writeTable(args);if(typeof args?.content!=='string'||Buffer.byteLength(args.content)>2*1024*1024)throw Error('文件正文须为文本且不超过 2 MB');const {name,format}=outputName(args.name,args.format,args.language),id=randomUUID(),folder=path.join(this.root,id);await mkdir(folder,{recursive:true});const target=path.join(folder,name);
    try{let bytes:Buffer;if(format==='pdf'){const view=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});view.webContents.setWindowOpenHandler(()=>({action:'deny'}));try{const body=documentBlocks(args.content).map(line=>line.heading?`<h${line.heading}>${escape(line.text)}</h${line.heading}>`:`<div class="${line.code?'code':'line'}">${escape(line.text)||'&nbsp;'}</div>`).join('');await view.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{font:12px/1.7 "Segoe UI","Microsoft YaHei",sans-serif;color:#20242a}.line{white-space:pre-wrap;overflow-wrap:anywhere}.code{font:10px/1.6 Consolas,monospace;background:#f2f4f6;white-space:pre-wrap;overflow-wrap:anywhere}h1,h2,h3{break-after:avoid}</style>'+body));bytes=await view.webContents.printToPDF({printBackground:true,pageSize:'A4',margins:{top:.6,bottom:.6,left:.6,right:.6}});}finally{view.destroy();}}
    else bytes=format==='docx'?docxContent(args.content):Buffer.from(args.content,'utf8');await writeFile(target,bytes,{flag:'wx'});const file:GeneratedFile={id,name,format,bytes:bytes.length,createdAt:new Date().toISOString()};await writeFile(path.join(this.root,id+'.json'),JSON.stringify(file));return file;}catch(error){await rm(folder,{recursive:true,force:true});throw error;}
  }
  async resolve(id:unknown){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('文件标识无效');const folder=resolveSafePath(this.root,id),file=JSON.parse(await readFile(resolveSafePath(this.root,id+'.json'),'utf8')) as GeneratedFile;if(file.id!==id||path.basename(file.name)!==file.name)throw Error('文件记录无效');return {file,target:resolveSafePath(folder,file.name)};}
  async save(id:unknown,parent?:BrowserWindow){const {file,target:source}=await this.resolve(id),downloads=path.join(this.root,'下载');await mkdir(downloads,{recursive:true});const options={title:'另存为成果文件',defaultPath:path.join(downloads,file.name),properties:['showOverwriteConfirmation'] as Electron.SaveDialogOptions['properties']};const picked=parent?await dialog.showSaveDialog(parent,options):await dialog.showSaveDialog(options);if(picked.canceled||!picked.filePath)return {saved:false};await copyFile(source,picked.filePath);return {saved:true,path:picked.filePath};}
  /** Excel / CSV: from sheets (rows of cells) or from CSV / Markdown-table text in content. */
  private async writeTable(args:any):Promise<GeneratedFile>{
    const kind=String(args.format).toLowerCase();
    if(args.sheets!==undefined&&JSON.stringify(args.sheets).length>16*1024*1024)throw Error('表格数据超过 16 MB');
    if(args.content!==undefined&&(typeof args.content!=='string'||Buffer.byteLength(args.content)>8*1024*1024))throw Error('content 须为不超过 8 MB 的文本');
    let bytes:Buffer;
    if(kind==='xlsx'){
      const sheets=args.sheets??(typeof args.content==='string'?[{name:path.parse(String(args.name??'')).name,rows:tableRows(args.content)}]:undefined);
      if(!sheets)throw Error('Excel 须提供 sheets（工作表数组），或 content（CSV / Markdown 表格文本）');
      bytes=xlsxContent(sheets);
    }else bytes=csvContent(args);
    const {name,format}=outputName(args.name,kind),id=randomUUID(),folder=path.join(this.root,id);await mkdir(folder,{recursive:true});
    try{await writeFile(path.join(folder,name),bytes,{flag:'wx'});const file:GeneratedFile={id,name,format,bytes:bytes.length,createdAt:new Date().toISOString()};await writeFile(path.join(this.root,id+'.json'),JSON.stringify(file));return file;}
    catch(error){await rm(folder,{recursive:true,force:true});throw error;}
  }
  /** PNG 图片：优先 sourcePath（本地文件），否则 content 为裸 base64 或 data:image/png;base64,…；只接受真实 PNG 头。 */
  private async writeImage(args:any):Promise<GeneratedFile>{
    let bytes:Buffer;
    if(typeof args?.sourcePath==='string'&&args.sourcePath.trim()){
      bytes=await readFile(this.localPath(args.sourcePath.trim()));
    }else{
      if(typeof args?.content!=='string')throw Error('图片内容须为 sourcePath（本地文件路径）或 base64 字符串');
      const raw=args.content.replace(/^data:image\/png;base64,/i,'').replace(/\s+/g,'');
      if(!raw)throw Error('图片内容为空');
      bytes=Buffer.from(raw,'base64');
    }
    if(bytes.length<8||bytes[0]!==0x89||bytes[1]!==0x50||bytes[2]!==0x4e||bytes[3]!==0x47)throw Error('不是有效的 PNG 图片');
    if(bytes.length>16*1024*1024)throw Error('图片不超过 16 MB');
    const {name,format}=outputName(args.name,'png'),id=randomUUID(),folder=path.join(this.root,id);
    await mkdir(folder,{recursive:true});
    try{await writeFile(path.join(folder,name),bytes,{flag:'wx'});const file:GeneratedFile={id,name,format,bytes:bytes.length,createdAt:new Date().toISOString()};await writeFile(path.join(this.root,id+'.json'),JSON.stringify(file));return file;}
    catch(error){await rm(folder,{recursive:true,force:true});throw error;}
  }
}

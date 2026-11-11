import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {isAttachmentId,safeAttachmentName} from '../shared/attachments';
import {resolveSafePath} from '../backend/security';
import type {FileReference,FilePreviewData} from '../shared/file-preview';
import type {FileOutputs} from './file-output';
import {wordBlocks} from '../backend/word-document';
import {officePreview} from './office-preview';
import {delimitedRows} from './delimited-preview';
import {PREVIEW_MIME} from './file-preview-server';
const TEXT_EXTENSIONS=new Set('txt md markdown mdx js mjs cjs jsx ts tsx py pyw cs c cc cpp h hpp java kt kts go rs rb php swift r lua sh bash ps1 bat cmd json jsonl yaml yml toml ini conf cfg xml html htm css scss less sql tex csv tsv log dockerfile makefile gitignore env'.split(' '));
const IMAGE_MIME:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',ico:'image/x-icon',svg:'image/svg+xml'};
export async function resolveFileReference(dataDirectory:string,outputs:FileOutputs,reference:FileReference,workspace?:(reference:FileReference)=>Promise<string>):Promise<{target:string;name:string}>{
  let target:string,name:string;
  if(reference?.source==='generated'){const resolved=await outputs.resolve(reference.id);target=resolved.target;name=resolved.file.name;}
  else if(reference?.source==='attachment'){if(!isAttachmentId(reference.id)||typeof reference.name!=='string'||safeAttachmentName(reference.name)!==reference.name)throw Error('附件标识无效');name=reference.name;target=resolveSafePath(dataDirectory,path.join('attachments',reference.id,name));}
  else if(['workspace','explorer'].includes(reference?.source)&&workspace){target=await workspace(reference);name=path.basename(target);}
  else throw Error('预览来源无效');
  if(reference.resource!==undefined){
    const resource=reference.resource;
    if(typeof resource!=='string'||!resource||resource.length>4096||resource.includes('\0')||path.isAbsolute(resource)||/^[a-z][a-z0-9+.-]*:/i.test(resource))throw Error('预览资源路径无效');
    target=reference.source==='explorer'&&workspace?await workspace({...reference,resource:undefined,path:path.posix.join(path.posix.dirname((reference.path??'').replaceAll('\\','/')),resource.replaceAll('\\','/'))}):reference.source==='workspace'&&workspace?await workspace({...reference,resource:undefined,path:path.resolve(path.dirname(target),resource)}):resolveSafePath(path.dirname(target),resource);
    name=path.basename(target);
  }
  return {target,name};
}
export async function previewFile(dataDirectory:string,outputs:FileOutputs,reference:FileReference,workspace?:(reference:FileReference)=>Promise<string>):Promise<FilePreviewData>{
  const {target,name}=await resolveFileReference(dataDirectory,outputs,reference,workspace);
  const info=await stat(target);if(!info.isFile())throw Error('文件不存在');const extension=path.extname(name).slice(1).toLowerCase()||name.toLowerCase();
  const mime=PREVIEW_MIME[extension];if(mime&&/^(audio|video)\//.test(mime)){if(info.size>20*1024*1024)return {name,kind:'unsupported',reason:'音视频超过 20 MB，请用默认应用打开。'};return {name,kind:mime.startsWith('audio/')?'audio':'video'};}
  if(['pdf','xlsx','pptx'].includes(extension)){if(info.size>20*1024*1024)return {name,kind:'unsupported',reason:'文件超过 20 MB，请用默认应用打开。'};const bytes=await readFile(target);return extension==='pdf'?{name,kind:'pdf',base64:bytes.toString('base64')}:officePreview(bytes,extension,name);}
  if(extension==='docx'){
    if(info.size>20*1024*1024)return {name,kind:'unsupported',reason:'Word 文件超过 20 MB，可下载后查看。'};
    const bytes=await readFile(target),blocks=wordBlocks(bytes);return {name,kind:'word',blocks,base64:bytes.toString('base64'),content:blocks.map(b=>b.text).join('\n'),reason:'Word 版式预览；精确分页以 Word 中打开的结果为准。'};
  }
  if(['doc','xls','ppt'].includes(extension))return {name,kind:'unsupported',reason:`旧版 .${extension} 暂不能内置预览，请先转换为 .${extension}x，或用默认应用打开。`};
  if(['odt','ods','odp','rtf','pages','numbers','key','heic','heif','tif','tiff','psd','zip','rar','7z','gz','exe','dll','sqlite','db'].includes(extension))return {name,kind:'unsupported',reason:'此格式暂不支持内置预览，请用默认应用打开。'};
  if(IMAGE_MIME[extension]){if(info.size>20*1024*1024)return {name,kind:'unsupported',reason:'图片超过 20 MB，请在外部查看。'};const bytes=await readFile(target);return {name,kind:'image',dataUrl:`data:${IMAGE_MIME[extension]};base64,${bytes.toString('base64')}`,...(extension==='svg'?{content:bytes.toString('utf8'),language:'svg'}:{})};}
  if(!TEXT_EXTENSIONS.has(extension)&&reference.source!=='explorer')return {name,kind:'unsupported',reason:'此格式暂不支持正文预览，可下载后查看。'};
  if(info.size>2*1024*1024)return {name,kind:'unsupported',reason:'文件超过 2 MB，可下载后查看完整内容。'};
  const bytes=await readFile(target),utf16=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':undefined;if(!utf16&&bytes.includes(0))return {name,kind:'unsupported',reason:'文件包含二进制内容，可用默认应用查看。'};
  const content=new TextDecoder(utf16??'utf-8',{fatal:false}).decode(bytes);
  if(['csv','tsv'].includes(extension))return {name,kind:'spreadsheet',content,language:extension,sheets:[{name,rows:delimitedRows(content,extension==='csv'?',':'\t')}],reason:'显示前 500 行、80 列；可切换查看源码。'};
  return {name,kind:['html','htm'].includes(extension)?'html':['md','markdown','mdx'].includes(extension)?'markdown':'text',content,language:extension};
}

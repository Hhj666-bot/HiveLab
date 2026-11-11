import {inflateRawSync} from 'node:zlib';
import {escapeDocumentText,zipParts} from './document-output';

const MAX_ARCHIVE=20*1024*1024,MAX_PART=8*1024*1024,MAX_TOTAL=64*1024*1024;
/** Read bounded OOXML ZIP entries in memory. No extraction, external relationships or macros run. */
export function wordParts(bytes:Buffer,requiredPart='word/document.xml'):Record<string,Buffer>{
 if(bytes.length>MAX_ARCHIVE)throw Error('Word 文件超过 20 MB');
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50&&p+22+bytes.readUInt16LE(p+20)===bytes.length){end=p;break;}
 if(end<0)throw Error('Word 文件不是有效的 DOCX');
 const count=bytes.readUInt16LE(end+10),start=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12);
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||count!==bytes.readUInt16LE(end+8)||count>2000||start+size!==end)throw Error('不支持此 Word 压缩格式');
 const parts:Record<string,Buffer>=Object.create(null);let at=start,total=0;
 for(let i=0;i<count;i++){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)throw Error('Word 压缩目录损坏');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),packed=bytes.readUInt32LE(at+20),length=bytes.readUInt32LE(at+24),names=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42);
  if(at+46+names+extra+comment>end||flags&1||![0,8].includes(method)||length>MAX_PART||(total+=length)>MAX_TOTAL)throw Error('Word 文件加密、过大或压缩方式不支持');
  const name=bytes.subarray(at+46,at+46+names).toString('utf8');
  if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').includes('..')||Object.hasOwn(parts,name)||offset+30>start||bytes.readUInt32LE(offset)!==0x04034b50)throw Error('Word 文件目录无效');
  const localNames=bytes.readUInt16LE(offset+26),data=offset+30+localNames+bytes.readUInt16LE(offset+28);
  if(data+packed>start||bytes.subarray(offset+30,offset+30+localNames).toString('utf8')!==name)throw Error('Word 文件数据范围无效');
  const raw=method===8?inflateRawSync(bytes.subarray(data,data+packed),{maxOutputLength:MAX_PART}):Buffer.from(bytes.subarray(data,data+packed));
  if(raw.length!==length)throw Error('Word 文件长度校验失败');
  let crc=0xffffffff;for(const byte of raw){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}if(((crc^0xffffffff)>>>0)!==bytes.readUInt32LE(at+16))throw Error('Word 文件内容校验失败');
  parts[name]=raw;at+=46+names+extra+comment;
 }
 if(at!==end||!parts[requiredPart]||!parts['[Content_Types].xml'])throw Error('办公文件缺少正文');return parts;
}
const decode=(text:string)=>text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,key:string)=>{if(key[0]==='#'){const point=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return point>0&&point<=0x10ffff?String.fromCodePoint(point):'�';}return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[key]??_;});
function namespace(xml:string){if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Word 正文包含不支持的 XML 声明');const prefix=xml.match(/xmlns:([\w]+)=["']http:\/\/schemas.openxmlformats.org\/wordprocessingml\/2006\/main["']/)?.[1];if(!prefix)throw Error('不支持此 Word 正文命名空间');return prefix+':';}
export function wordBlocks(bytes:Buffer){const xml=wordParts(bytes)['word/document.xml'].toString('utf8'),prefix=namespace(xml),paragraph=new RegExp(`<${prefix}p(?:\\s[^>]*)?>[\\s\\S]*?<\\/${prefix}p>`,'g'),token=new RegExp(`<${prefix}t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${prefix}t>|<${prefix}(tab|br|cr)\\b[^>]*\\/>`,'g');
 const blocks=[...xml.matchAll(paragraph)].map(p=>({text:[...p[0].matchAll(token)].map(t=>t[1]!==undefined?decode(t[1]):t[2]==='tab'?'\t':'\n').join(''),heading:Number(p[0].match(new RegExp(`<${prefix}pStyle\\b[^>]*${prefix}val=["'](?:Heading|heading)([1-6])["']`))?.[1]??0)}));
 if(blocks.length>30000||blocks.reduce((n,b)=>n+b.text.length,0)>2*1024*1024)throw Error('Word 正文过大');return blocks;
}
/** Exact text replacements within a paragraph, including text split across formatting runs.
 * Retain every other package part and run property. New text uses the first matched run's style. */
export function replaceWordText(bytes:Buffer,oldText:string,newText:string,all=false){
 if(!oldText||/[\r\n\t]/.test(oldText)||/[\r\n\t]/.test(newText))throw Error('Word 精确编辑目前支持单段落内的文字；换段或改结构请生成新文档');
 const parts=wordParts(bytes),xml=parts['word/document.xml'].toString('utf8'),prefix=namespace(xml),paragraph=new RegExp(`<${prefix}p(?:\\s[^>]*)?>[\\s\\S]*?<\\/${prefix}p>`,'g');let count=0;
 const updated=xml.replace(paragraph,p=>{
  // Never match through a tab or line break: their visible text separates runs.
  const group=new RegExp(`(?:<${prefix}t(?:\\s[^>]*)?>[\\s\\S]*?<\\/${prefix}t>|<${prefix}(?:tab|br|cr)\\b[^>]*\\/>)`,'g');
  const nodes=[...p.matchAll(group)];let joined='';const ranges=nodes.map(node=>{const value=node[0].match(new RegExp(`^<${prefix}t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${prefix}t>$`));const text=value?decode(value[1]):'\n',start=joined.length;joined+=text;return {node,text,start,end:joined.length,editable:!!value};});
  const matches:number[]=[];for(let at=joined.indexOf(oldText);at>=0;at=joined.indexOf(oldText,at+oldText.length))matches.push(at);if(!matches.length)return p;count+=matches.length;
  for(const start of matches.reverse()){const end=start+oldText.length,first=ranges.findIndex(r=>r.editable&&r.end>start),last=ranges.findIndex(r=>r.editable&&r.end>=end);if(first<0||last<first)throw Error('Word 文字范围无效');for(let i=last;i>=first;i--){const r=ranges[i];r.text=(i===first?r.text.slice(0,start-r.start)+newText:'')+(i===last?r.text.slice(end-r.start):'');}}
  for(const r of ranges.reverse())if(r.editable){const node=r.node[0].replace(/^(<[^>]+)>/,(tag)=>tag.includes('xml:space=')?tag:tag.slice(0,-1)+' xml:space="preserve">').replace(new RegExp(`>([\\s\\S]*?)<\\/${prefix}t>$`),()=>`>${escapeDocumentText(r.text)}</${prefix}t>`);p=p.slice(0,r.node.index!)+node+p.slice(r.node.index!+r.node[0].length);}return p;
 });
 if(!count)throw Error('未找到待替换文字');if(count>1&&!all)throw Error(`找到 ${count} 处匹配；请缩小文字范围或明确 replaceAll`);parts['word/document.xml']=Buffer.from(updated);return {bytes:zipParts(parts),replacements:count};
}

import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import type {SkillProvenance} from '../shared/skill-provenance';

export const skillHash=(content:string)=>createHash('sha256').update(content).digest('hex');
interface SkillImport {source:string;packageHash:string;contentHash:string;summary:string;importedAt:string}
/** Separate from skill packages, so metadata never changes a package fingerprint. */
export class SkillImports {
  constructor(private file:string) {}
  private read():Record<string,SkillImport> {
    if(!existsSync(this.file))return {};
    const value=JSON.parse(readFileSync(this.file,'utf8'));
    if(value.schemaVersion!==1||!value.items||typeof value.items!=='object'||Array.isArray(value.items))throw Error('技能导入记录格式无效');
    return value.items;
  }
  get(id:string){return this.read()[id];}
  record(id:string,source:string,packageHash:string,content:string,summary:string){
    const items=this.read();items[id]={source,packageHash,contentHash:skillHash(content),summary,importedAt:new Date().toISOString()};
    mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify({schemaVersion:1,items},null,2));renameSync(temp,this.file);
  }
}
export function inspectSkill(file:string,source:string,home:string,manager:string,imported?:SkillImport):SkillProvenance {
  const inspectedAt=new Date().toISOString();
  let content:string|undefined;
  try{const info=lstatSync(file);if(info.isFile()&&!info.isSymbolicLink()&&info.size<=256*1024)content=readFileSync(file,'utf8');}catch{}
  const contentHash=content===undefined?undefined:skillHash(content);
  const front=content?.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  const version=front?.match(/^\s*version:\s*["']?([^\s"']+)/m)?.[1];
  return {source,home,manager,version,contentHash,inspectedAt,...(imported?{importedFrom:imported.source,importedAt:imported.importedAt,importSummary:imported.summary,locallyModified:contentHash!==imported.contentHash}:{})};
}

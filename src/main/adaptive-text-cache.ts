import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {emptyTextToneCache,parseTextToneCache,updateTextToneCache,type TextToneCache} from '../shared/adaptive-text-cache';

/** One disposable, profile-local record of colours learned from rendered surfaces. */
export class AdaptiveTextColorCache{
 private loaded:Promise<TextToneCache>|undefined;
 private tail:Promise<unknown>=Promise.resolve();
 readonly file:string;
 constructor(readonly directory:string){this.file=path.join(directory,'adaptive-text-colors.json');}
 read(){return this.loaded??=readFile(this.file,'utf8').then(raw=>{try{return parseTextToneCache(JSON.parse(raw));}catch{return emptyTextToneCache();}}).catch(error=>{if(error.code==='ENOENT')return emptyTextToneCache();this.loaded=undefined;throw error;});}
 write(context:unknown,tones:unknown){
  const task=this.tail.then(async()=>{
   const next=updateTextToneCache(await this.read(),context,tones);
   await mkdir(this.directory,{recursive:true});
   const temporary=this.file+'.tmp';await writeFile(temporary,JSON.stringify(next,null,2),'utf8');await rename(temporary,this.file);
   this.loaded=Promise.resolve(next);return {saved:true};
  });
  this.tail=task.catch(()=>{});return task;
 }
}

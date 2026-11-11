import {t} from './i18n';
export const CODE_EXTENSIONS:Record<string,string>={javascript:'js',typescript:'ts',python:'py',csharp:'cs','c#':'cs',cpp:'cpp','c++':'cpp',c:'c',java:'java',rust:'rs',go:'go',ruby:'rb',php:'php',shell:'sh',bash:'sh',powershell:'ps1',sql:'sql',html:'html',css:'css',json:'json',yaml:'yaml',yml:'yml',markdown:'md',latex:'tex',kotlin:'kt',swift:'swift',r:'r',lua:'lua',vue:'vue',jsx:'jsx',tsx:'tsx',text:'txt'};
export type GeneratedFile={id:string;name:string;format:string;bytes:number;createdAt:string};
export function outputName(name:unknown,format:unknown,language?:unknown){
  const f=String(format??'md').toLowerCase();if(!['pdf','docx','xlsx','csv','md','txt','code','png'].includes(f))throw Error(t("支持 PDF、Word、Excel、CSV、Markdown、文本、代码和 PNG 图片文件"));
  const lang=String(language??'text').toLowerCase(),ext=f==='code'?(CODE_EXTENSIONS[lang]??(/^[a-z0-9]{1,12}$/.test(lang)?lang:'txt')):f;
  let base=String(name??t("HiveLab 合屋 成果")).replace(/[\\/:*?"<>|\x00-\x1f]/g,' ').trim().replace(/[. ]+$/,'').slice(0,100)||t("HiveLab 合屋 成果");
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base))base=t("HiveLab 合屋 {0}", base);
  if(f!=='code'||!base.includes('.'))base=base.replace(/\.(pdf|docx|xlsx|csv|md|txt|png)$/i,'')+'.'+ext;
  return {name:base,format:f};
}

import {existsSync} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

export function browserExecutable(browser:'edge'|'chrome',env=process.env,platform=process.platform):string|undefined{
  const suffix=browser==='edge'?['Microsoft','Edge','Application','msedge.exe']:['Google','Chrome','Application','chrome.exe'];
  const candidates=platform==='darwin'
    ?[browser==='edge'?'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge':'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    :[env['ProgramFiles(x86)'],env.ProgramFiles,env.LOCALAPPDATA].filter((root):root is string=>!!root).map(root=>path.join(root,...suffix));
  return candidates.find(candidate=>existsSync(candidate));
}

export async function launchBrowser(executable:string,url:string,start:typeof spawn=spawn):Promise<void>{
  const child=start(executable,[url],{detached:true,stdio:'ignore',windowsHide:false});
  await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
}

import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {mkdir,writeFile,rename,rm,open} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fetch,ProxyAgent} from 'undici';
import {spawnCli,type CliCommand} from './adapters/common';
import {waitForNpmOutput,UnconfirmedNpmStop,type InstallProgress} from './member-versions';

export const ANTIGRAVITY_REGISTRY='https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json';
const ENTRY='agy_acp_server.exe',HELPER='localharness_external.exe',MARKER='.hivelab-install.json';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const PINNED={version:'1.4.5',hashes:{x64:'d24f4c73c9f96d4f44384e281c855a56c72d8eaa9c5b0fad7ccb1635c6b63f50',arm64:'ab0a9aac8349e08ef289be6d16da8f89e3abe60eba5158032ef78c4a1220261c'}};
export function antigravityRelease(version:string,metadata:any,arch='x64'){
 if(!/^\d+\.\d+\.\d+$/.test(version)||!['x64','arm64'].includes(arch))throw Error('Antigravity 版本或架构无效');
 const suffix=arch==='arm64'?'arm64':'x86_64',url=`https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-${version}-windows-${suffix}.zip`;
 const release=metadata?.distribution?.binary?.[arch==='arm64'?'windows-aarch64':'windows-x86_64'];
 const hash=version===PINNED.version?PINNED.hashes[arch as keyof typeof PINNED.hashes]:release?.sha256;
 if(version!==PINNED.version&&(metadata?.id!=='antigravity-acp'||metadata.version!==version||release?.archive!==url||release?.cmd!=='./'+ENTRY))throw Error('官方 ACP 分发清单与版本不匹配');
 if(!/^[a-f0-9]{64}$/.test(hash??''))throw Error('官方 ACP 分发清单缺少 SHA-256');
 return {url,sha256:hash as string};
}
export function completeAntigravityEntry(prefix:string,version?:string){
 try{const marker=JSON.parse(readFileSync(path.join(prefix,MARKER),'utf8'));if(marker.member!=='antigravity'||version&&marker.version!==version||lstatSync(prefix).isSymbolicLink())return;
  for(const name of [ENTRY,HELPER]){const file=path.join(prefix,name),info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||sha(readFileSync(file))!==marker.hashes?.[name])return;}
  return path.join(prefix,ENTRY);
 }catch{return;}
}
export async function latestAntigravityVersion(env:NodeJS.ProcessEnv){
 const proxy=env.HTTPS_PROXY?new ProxyAgent(env.HTTPS_PROXY):undefined;
 try{const response=await fetch(ANTIGRAVITY_REGISTRY,{dispatcher:proxy,signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('无法读取 Antigravity 官方 ACP 清单');const value:any=await response.json();antigravityRelease(value.version,value,process.arch);return value.version as string;}finally{await proxy?.close();}
}
export async function installAntigravity(root:string,version:string,env:NodeJS.ProcessEnv,progress?:(value:InstallProgress)=>void,publish:(source:string,target:string)=>Promise<void>=rename){
 if(process.platform!=='win32'||!['x64','arm64'].includes(process.arch))throw Error('Antigravity 自动安装支持 Windows x64 / ARM64');
 root=path.resolve(root);const target=path.join(root,version);if(!/^\d+\.\d+\.\d+$/.test(version)||path.dirname(target)!==root||lstatSync(root).isSymbolicLink())throw Error('安装目录无效');
 const installed=completeAntigravityEntry(target,version);if(installed)return {version,entry:installed};
 if(existsSync(target))throw Error('此版本目录已有不完整文件，请先在存储中删除该版本');
 const stage=path.join(root,'.install-'+version+'-'+randomUUID()),proxy=env.HTTPS_PROXY?new ProxyAgent(env.HTTPS_PROXY):undefined;await mkdir(stage);let preserve=false;
 const command=async(program:CliCommand,args:string[],environment=env)=>{try{return await waitForNpmOutput(spawnCli(program,args,{cwd:stage,env:environment}),120000);}catch(error){if(error instanceof UnconfirmedNpmStop)preserve=true;throw error;}};
 try{
  let metadata:any;
  if(version!==PINNED.version){const response=await fetch(ANTIGRAVITY_REGISTRY,{dispatcher:proxy,signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('无法读取官方 ACP 清单');metadata=await response.json();}
  const release=antigravityRelease(version,metadata,process.arch),response=await fetch(release.url,{dispatcher:proxy,redirect:'error',signal:AbortSignal.timeout(30*60_000)});
  if(!response.ok||!response.body)throw Error('Antigravity 官方程序下载失败');
  const archive=path.join(stage,'official.zip'),output=await open(archive,'wx'),hash=createHash('sha256');let bytes=0,last=0;
  try{for await(const chunk of response.body){const data=Buffer.from(chunk);bytes+=data.length;if(bytes>768*1024*1024)throw Error('下载包大小异常');await output.writeFile(data);hash.update(data);if(Date.now()-last>1000){progress?.({phase:'installing',writtenBytes:bytes,lastProgressAt:new Date().toISOString()});last=Date.now();}}}finally{await output.close();}
  if(hash.digest('hex')!==release.sha256)throw Error('Antigravity 官方下载包校验失败，未安装');
  progress?.({phase:'files',writtenBytes:bytes});
  const require=createRequire(import.meta.url),seven=path.join(path.dirname(require.resolve('7zip-bin/package.json')),'win/x64/7za.exe');
  if((await command({command:seven,path:seven,prefix:[]},['x',archive,'-o'+stage,'-y','-bso0','-bsp0'])).code!==0)throw Error('Antigravity 解压失败');
  const executable=path.join(stage,ENTRY),powershell=path.join(process.env.SystemRoot!,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const signature=await command({command:powershell,path:powershell,prefix:[]},['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); $signature = Get-AuthenticodeSignature -LiteralPath $env:HIVELAB_VERIFY_FILE; @{status=$signature.Status.ToString();signer=$signature.SignerCertificate.Subject;detail=$signature.StatusMessage} | ConvertTo-Json -Compress; if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Google LLC') { exit 1 }"],{...env,PSModulePath:path.join(path.dirname(powershell),'Modules'),HIVELAB_VERIFY_FILE:executable});
  if(signature.code!==0)throw Error('Google 官方程序签名校验失败：'+(signature.stdout||signature.stderr).trim().slice(0,900));
  const hashes=Object.fromEntries([ENTRY,HELPER].map(name=>[name,sha(readFileSync(path.join(stage,name)))]));
  await rm(archive);await writeFile(path.join(stage,MARKER),JSON.stringify({schema:1,member:'antigravity',version,entry:ENTRY,source:release.url,archiveSha256:release.sha256,hashes}));
  progress?.({phase:'launch'});await publish(stage,target);return {version,entry:path.join(target,ENTRY)};
 }finally{await proxy?.close();if(!preserve&&existsSync(stage)&&path.dirname(stage)===root&&!lstatSync(stage).isSymbolicLink())await rm(stage,{recursive:true,force:true});}
}

/** AgentNest receives only this projection; secrets stay inside the native HiveLab process. */
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {mkdir,writeFile,rename,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {readGlmBalance} from '../backend/adapters/glm-balance';
import {DEFAULT_SETTINGS} from '../shared/defaults';
import type {AccountBalance,AcpExecutor,Settings} from '../shared/types';
export async function exportGlmBalance(data:string,readSecrets:(id:string)=>Record<string,string>){
  let result:AccountBalance={status:'unavailable',kind:'glm-api',wallets:[],bonusWallets:[],checkedAt:new Date().toISOString(),reason:'GLM 普通 API 账户尚未配置。'},accountStamp='';
  const current=async()=>{const db=new DatabaseSync(path.join(data,'hivelab.sqlite'),{readOnly:true});try{const row=db.prepare("SELECT value FROM entities WHERE entity='executors' AND id='acp-catalogzcode'").get() as {value:string}|undefined;const config=db.prepare("SELECT value FROM entities WHERE entity='settings' AND id='main'").get() as {value:string}|undefined;const executor:AcpExecutor|undefined=row?JSON.parse(row.value):undefined;const meta=executor?await stat(path.join(data,'secrets',executor.id+'.secret')).catch(()=>undefined):undefined;return {executor,settings:config?{...DEFAULT_SETTINGS,...JSON.parse(config.value)} as Settings:DEFAULT_SETTINGS,stamp:createHash('sha256').update(JSON.stringify([executor?.authentication,executor?.env.GLM_BASE_URL,meta?.mtimeMs,meta?.size])).digest('hex')};}finally{db.close();}};
  try{const source=await current();accountStamp=source.stamp;if(source.executor?.catalogId==='zcode'){const secrets=readSecrets(source.executor.id);result=await readGlmBalance({...source.executor,env:{...source.executor.env,GLM_API_KEY:secrets.GLM_API_KEY}},source.settings);}if((await current()).stamp!==accountStamp){accountStamp='';result={status:'unavailable',kind:'glm-api',wallets:[],bonusWallets:[],checkedAt:new Date().toISOString(),reason:'GLM 账号已变化，请重新刷新余额。'};}}
  catch{result={status:'unavailable',kind:'glm-api',wallets:[],bonusWallets:[],checkedAt:new Date().toISOString(),reason:'GLM 余额读取失败，请检查 HiveLab 合屋 的连接与网络设置。'};}
  const folder=path.join(data,'account-balances');await mkdir(folder,{recursive:true,mode:0o700});const target=path.join(folder,'glm.json'),temporary=target+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify({...result,accountStamp}),{mode:0o600});await rename(temporary,target);return result;
}

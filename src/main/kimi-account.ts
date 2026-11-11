/** Native app account reader for AgentNest. SQLite is read-only; credentials never leave the app. */
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {mkdir,writeFile,rename,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {readKimiBalance} from '../backend/adapters/kimi-balance';
import {DEFAULT_SETTINGS} from '../shared/defaults';
import type {AccountBalance,AcpExecutor,Settings} from '../shared/types';
export async function exportKimiBalance(data:string,readSecrets:(id:string)=>Record<string,string>){
  let result:AccountBalance={status:'unavailable',kind:'kimi-api',wallets:[],bonusWallets:[],checkedAt:new Date().toISOString(),reason:'Kimi 账户尚未配置。'},accountStamp='';
  try{
    const db=new DatabaseSync(path.join(data,'hivelab.sqlite'),{readOnly:true});
    let executor:AcpExecutor|undefined,settings=DEFAULT_SETTINGS;
    try{
      const row=db.prepare("SELECT value FROM entities WHERE entity='executors' AND id='acp-catalogkimi'").get() as {value:string}|undefined;
      if(row)executor=JSON.parse(row.value);
      const config=db.prepare("SELECT value FROM entities WHERE entity='settings' AND id='main'").get() as {value:string}|undefined;
      if(config)settings={...DEFAULT_SETTINGS,...JSON.parse(config.value)} as Settings;
    }finally{db.close();}
    if(executor?.catalogId==='kimi'){
      const meta=await stat(path.join(data,'secrets',executor.id+'.secret')).catch(()=>undefined);
      accountStamp=createHash('sha256').update(JSON.stringify([executor.authentication,executor.env.KIMI_MODEL_BASE_URL,meta?.mtimeMs,meta?.size])).digest('hex');
      const ownSecrets=readSecrets(executor.id);
      result=await readKimiBalance({...executor,env:{...executor.env,KIMI_MODEL_API_KEY:ownSecrets.KIMI_MODEL_API_KEY}},settings);
    }
  }catch{result.reason='Kimi 余额读取失败，请检查 HiveLab 合屋 的连接与网络设置。';}
  const folder=path.join(data,'account-balances');await mkdir(folder,{recursive:true,mode:0o700});
  const target=path.join(folder,'kimi.json'),temporary=target+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify({...result,accountStamp}),{mode:0o600});await rename(temporary,target);
  return result;
}

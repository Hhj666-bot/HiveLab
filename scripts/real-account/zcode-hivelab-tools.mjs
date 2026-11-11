// Real-account check that a ZCode official-account member can use HiveLab's shared tools.
// Starts this checkout's desktop build on the given data directory, opens a new desk topic for the
// member in a throwaway folder, asks it to read an xlsx and a PDF with read_file and to produce an
// xlsx with create_file, then switches the desk folder back. Consumes model quota.
//
//   node scripts/build.mjs
//   node --import tsx scripts/real-account/zcode-hivelab-tools.mjs --profile=D:\HiveLab\local-data\data --member=m-glm-zipzippipe --use-real-account --app-closed
import {realAccountTestEnvironment} from './guard.mjs';
import path from 'node:path';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {_electron} from '@playwright/test';
import {xlsxContent} from '../../src/backend/xlsx-write.ts';
import {pdf} from '../../tests/office-fixtures.ts';

const env=realAccountTestEnvironment();delete env.ELECTRON_RUN_AS_NODE;
const option=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const profile=option('profile'),memberId=option('member');
if(!profile||!path.isAbsolute(profile)||!existsSync(path.join(profile,'hivelab.sqlite')))throw Error('Pass --profile=<absolute HiveLab data directory>.');
if(!memberId)throw Error('Pass --member=<member id of the ZCode member>.');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const folder=path.resolve(option('folder')??path.join('.test-cache','zcode-tools',stamp));mkdirSync(folder,{recursive:true});
writeFileSync(path.join(folder,'budget.xlsx'),xlsxContent([{name:'预算',rows:[['项目','金额'],['场地',1200],['餐饮',860],['交通',345]]}]));
writeFileSync(path.join(folder,'notice.pdf'),pdf(['ZCode PDF check: the code word is LANTERN-42.','Second page says ORBIT-7.']));
const prompt=`这是 HiveLab 工具接入测试，请严格只用 HiveLab 的 MCP 工具完成，不要写脚本、不要用 Bash：
1. 用 read_file 读取 budget.xlsx，告诉我“餐饮”的金额。
2. 用 read_file 读取 notice.pdf，告诉我第 1 页和第 2 页各自的代号。
3. 用 create_file 生成一个 xlsx 文件 summary.xlsx，一个工作表“汇总”，两列“项目、金额”，写入上面表格里的三行，再加一行“合计”。
最后用一句话列出你实际调用过的工具名。`;

const app=await _electron.launch({executablePath:env.HIVELAB_ELECTRON_EXE??path.resolve('node_modules/electron/dist/electron.exe'),args:[path.resolve('.')],env:{...env,HIVELAB_DATA_DIR:profile},timeout:60000});
const page=await app.firstWindow();
const rpc=(method,params)=>page.evaluate(({method,params})=>window.hivelab.invoke(method,params),{method,params});
const roomId=`desk:${memberId}`;
let restore;
try{
  await page.waitForFunction(()=>!!window.hivelab,undefined,{timeout:60000});
  for(const deadline=Date.now()+120_000;;){try{await rpc('snapshot');break;}catch(error){if(Date.now()>deadline||!/尚未就绪/.test(String(error.message)))throw error;await new Promise(resolve=>setTimeout(resolve,1000));}}
  const opened=await rpc('desk.open',{memberId});
  restore=opened.folder?.personal||!opened.directory?{personal:true}:{directory:opened.directory};
  await rpc('desk.switchFolder',{memberId,directory:folder});
  await rpc('desk.topic',{memberId,directory:folder});
  const started=Date.now();
  await rpc('room.send',{roomId,text:prompt});
  let view;
  for(;;){
    if(Date.now()-started>15*60_000)throw Error('ZCode did not finish within 15 minutes; no automatic retry.');
    await new Promise(resolve=>setTimeout(resolve,2000));
    view=await rpc('room.get',{roomId});
    if(!view.state?.active&&!view.state?.running&&(view.messages??[]).some(m=>m.author!=='user'))break;
  }
  const replies=(view.messages??[]).filter(m=>m.author!=='user');
  const summary={folder,seconds:Math.round((Date.now()-started)/1000),reply:replies.map(m=>m.text).join('\n---\n'),files:replies.flatMap(m=>m.files??m.attachments??[]),state:view.state};
  writeFileSync(path.join(folder,'result.json'),JSON.stringify({summary,view},null,2));
  console.log(JSON.stringify(summary,null,2));
}finally{
  if(restore)await rpc('desk.switchFolder',{memberId,...restore}).catch(error=>console.error('Restoring the desk folder failed:',error.message));
  await app.close();
}

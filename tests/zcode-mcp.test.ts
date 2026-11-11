import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {attachZcodeHivelab,clearStaleZcodeHivelab,withoutHivelabServer,zcodeHivelabServer,zcodeUserConfigPath} from '../src/backend/adapters/zcode-mcp';

const helper=path.resolve('scripts/hivelab-tools.mjs');
const runEnv=(token='test-only-capability')=>({HIVELAB_CONTROL_HELPER:helper,HIVELAB_CONTROL_NODE:process.execPath,HIVELAB_CONTROL_URL:'http://127.0.0.1:12345/tools',HIVELAB_CONTROL_TOKEN:token});
let homes=0;
const home=()=>{const dir=path.join(process.env.HIVELAB_DATA_DIR!,'zcode-mcp',String(++homes));mkdirSync(dir,{recursive:true});return dir;};
const read=(dir:string)=>JSON.parse(readFileSync(zcodeUserConfigPath(dir),'utf8'));

test('ZCode server entry carries no capability and needs every bridge variable',()=>{
  const server=zcodeHivelabServer(runEnv())!;
  assert.deepEqual(server,{type:'stdio',command:process.execPath,args:[helper,'--mcp'],env:{ELECTRON_RUN_AS_NODE:'1'},timeoutMs:86_400_000});
  assert.ok(!JSON.stringify(server).includes('test-only-capability'));
  for(const key of Object.keys(runEnv()))assert.equal(zcodeHivelabServer({...runEnv(),[key]:''}),undefined,key);
});

test('a run enables the bridge in the member home, keeps the user settings and removes only its own entry',async()=>{
  const dir=home(),file=zcodeUserConfigPath(dir);mkdirSync(path.dirname(file),{recursive:true});
  writeFileSync(file,JSON.stringify({ui:{locale:'zh-CN'},mcp:{servers:{other:{type:'stdio',command:'other'}}}}));
  const bridge=(await attachZcodeHivelab(dir,runEnv()))!;
  const during=read(dir);
  assert.equal(during.ui.locale,'zh-CN');assert.equal(during.mcp.servers.other.command,'other');
  assert.deepEqual(during.mcp.servers.hivelab.args,[helper,'--mcp']);
  assert.ok(!readFileSync(file,'utf8').includes('test-only-capability'),'the token is inherited, never written');
  await bridge.release();await bridge.release();
  assert.deepEqual(read(dir),{ui:{locale:'zh-CN'},mcp:{servers:{other:{type:'stdio',command:'other'}}}});
});

test('concurrent runs of one member share the entry until the last one finishes',async()=>{
  const dir=home();
  const [first,second]=await Promise.all([attachZcodeHivelab(dir,runEnv('a')),attachZcodeHivelab(dir,runEnv('b'))]);
  await first!.release();assert.ok(read(dir).mcp.servers.hivelab,'still held by the second run');
  await clearStaleZcodeHivelab(dir);assert.ok(read(dir).mcp?.servers.hivelab,'a live run is never treated as stale');
  await second!.release();assert.deepEqual(read(dir),{});
});

test('without bridge credentials nothing is written, and a crashed run is cleaned up',async()=>{
  const dir=home();
  assert.equal(await attachZcodeHivelab(dir,{}),undefined);assert.ok(!existsSync(zcodeUserConfigPath(dir)));
  const file=zcodeUserConfigPath(dir);mkdirSync(path.dirname(file),{recursive:true});
  writeFileSync(file,JSON.stringify({mcp:{servers:{hivelab:zcodeHivelabServer(runEnv())}}}));
  await clearStaleZcodeHivelab(dir);assert.deepEqual(read(dir),{});
});

test('a user-defined server with the same name is never overwritten or removed',async()=>{
  const dir=home(),file=zcodeUserConfigPath(dir);mkdirSync(path.dirname(file),{recursive:true});
  const config={mcp:{servers:{hivelab:{type:'stdio',command:'mine',args:['server.js']}}}};writeFileSync(file,JSON.stringify(config));
  await assert.rejects(attachZcodeHivelab(dir,runEnv()),/同名 MCP 服务器/);
  assert.equal(withoutHivelabServer(config),undefined);assert.deepEqual(read(dir),config);
});

// Uses the installed official program signed out: the turn fails at model selection, so no
// prompt reaches a model. A probe named like the helper records how ZCode launched it; the
// helper-to-HiveLab leg is covered by the ACP bridge tests. Set HIVELAB_ZCODE_CLI to
// resources/glm/zcode.cjs to run it.
test('real signed-out ZCode launches the bridge from the member home with the inherited capability',{skip:!process.env.HIVELAB_ZCODE_CLI&&'HIVELAB_ZCODE_CLI is not set'},async()=>{
  const dir=home(),probe=path.join(dir,'probe','hivelab-tools.mjs'),seen=path.join(dir,'probe','seen.json');mkdirSync(path.dirname(probe),{recursive:true});
  writeFileSync(probe,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(seen)},JSON.stringify({argv:process.argv.slice(2),url:process.env.HIVELAB_CONTROL_URL,token:process.env.HIVELAB_CONTROL_TOKEN,node:process.env.ELECTRON_RUN_AS_NODE}));process.stdin.resume();`);
  const env:NodeJS.ProcessEnv={...process.env,...runEnv('probe-capability'),HIVELAB_CONTROL_HELPER:probe,HOME:dir,USERPROFILE:dir,ZCODE_DATA_BASE_DIR:dir};delete env.ELECTRON_RUN_AS_NODE;
  const bridge=(await attachZcodeHivelab(dir,env))!;
  assert.ok(!readFileSync(bridge.file,'utf8').includes('probe-capability'));
  try{
    const child=spawn(process.execPath,[process.env.HIVELAB_ZCODE_CLI!,'-p','hello','--output-format','stream-json','--mode','plan'],{cwd:dir,env,stdio:'ignore',windowsHide:true});
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('ZCode did not exit'));},90_000);child.once('error',reject);child.once('close',()=>{clearTimeout(timer);resolve();});});
  }finally{await bridge.release();}
  assert.deepEqual(JSON.parse(readFileSync(seen,'utf8')),{argv:['--mcp'],url:'http://127.0.0.1:12345/tools',token:'probe-capability',node:'1'});
  assert.deepEqual(read(dir),{});
});

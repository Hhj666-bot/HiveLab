import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,stat,rm,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {desktopSearchPath,localNodeCandidates,localNpmCli,npmNodeShim} from '../src/backend/platform-runtime.ts';
import {controlToolsForPlatform} from '../src/backend/agent-control.ts';
import {runningVersion,acceptRunningVersion} from '../src/main/version.ts';
import {packageLayout,sevenZipBinary} from '../scripts/package-layout.mjs';
import {productionPackages,copyProductionDependencies,verifyRuntimeDependencies} from '../scripts/runtime-dependencies.mjs';
const require=createRequire(import.meta.url);

test('Apple Silicon packaging config uses locked v26 schema and distinct Mac bundle paths',async()=>{
 const parent=JSON.parse(await readFile('electron-builder.json','utf8')),mac=JSON.parse(await readFile('electron-builder.mac.json','utf8'));
 const {validateConfiguration}=require('app-builder-lib/out/util/config/config.js');await validateConfiguration({...parent,...mac,extends:undefined},undefined);
 assert.equal(mac.mac.identity,'-');assert.equal(mac.mac.notarize,false);assert.equal(mac.mac.hardenedRuntime,false);assert.equal(parent.publish,null);assert.ok(mac.mac.target.every(t=>t.arch.length===1&&t.arch[0]==='arm64'));assert.ok(mac.files.includes('!dist/windows-*'));
 const icon=await readFile(mac.mac.icon);assert.equal(icon.subarray(0,4).toString(),'icns');assert.equal(icon.readUInt32BE(4),icon.length);assert.equal(icon.subarray(8,12).toString(),'ic08');assert.deepEqual(icon.subarray(16),await readFile('build/hivelab.png'));
 assert.equal(packageLayout('/release/mac-arm64','darwin').appRoot,path.join('/release/mac-arm64','HiveLab 合屋.app','Contents','Resources','app'));assert.equal(packageLayout('/release/win-unpacked','win32').appRoot,path.join('/release/win-unpacked','resources','app'));assert.throws(()=>packageLayout('/tmp','linux'),/Unsupported/);
 assert.equal(sevenZipBinary('darwin','arm64'),'node_modules/7zip-bin/mac/arm64/7za');assert.throws(()=>sevenZipBinary('darwin','x64'),/Unsupported/);
 if(process.platform!=='darwin'){const child=spawnSync(process.execPath,['scripts/package-mac.mjs'],{encoding:'utf8'});assert.notEqual(child.status,0);assert.match(child.stderr,/Apple 芯片 Mac/);}
});

test('macOS GUI PATH, Unix npm layout and exact shell path quoting preserve Windows defaults',()=>{
 const result=desktopSearchPath('darwin',{PATH:'/usr/bin:/opt/homebrew/bin'},'/Users/老大');assert.ok(result.includes('/opt/homebrew/bin'));assert.equal(result.split(':').filter(p=>p==='/opt/homebrew/bin').length,1);assert.ok(result.startsWith('/Users/老大/.local/bin:'));
 assert.equal(desktopSearchPath('win32',{Path:'D:\\bin;C:\\Windows'},'D:/user'),'D:\\bin;C:\\Windows');assert.equal(localNodeCandidates('darwin',{})[0],'/opt/homebrew/bin/node');assert.match(localNodeCandidates('win32',{})[0],/nodejs\\node.exe$/);
 assert.equal(localNpmCli('/opt/homebrew/bin/node','darwin',file=>file==='/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js'),'/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js');
 const node="/Applications/HiveLab's $demo.app/Contents/MacOS/HiveLab",shim=npmNodeShim(node,'darwin');assert.equal(shim.name,'node');assert.equal(shim.mode,0o755);assert.ok(shim.content.includes("HiveLab'\"'\"'s $demo.app"));assert.ok(shim.content.endsWith(' "$@"\n'));assert.equal(npmNodeShim('D:/HiveLab/HiveLab.exe','win32').name,'node.cmd');
 for(const name of ['create_file','read_file','edit_file','ask_user'])assert.ok(controlToolsForPlatform('darwin').some(t=>t.name===name));assert.ok(!controlToolsForPlatform('darwin').some(t=>t.name==='computer'));assert.ok(controlToolsForPlatform('win32').some(t=>t.name==='computer'));
});

test('Mac receipts go to user data without changing signed application metadata',async()=>{
 const root=await mkdtemp(path.join(process.env.TEMP,'mac-receipt-')),resources=path.join(root,'Resources'),data=path.join(root,'data');await mkdir(resources);await mkdir(data);
 try{const manifest=JSON.stringify({sourceCommit:'source',builtAt:'2026-10-18',sourceDirty:false});await writeFile(path.join(resources,'build-manifest.json'),manifest);await writeFile(path.join(data,'deployment-receipt.json'),JSON.stringify({sourceCommit:'source',userSessionAcceptance:'pending'}));assert.equal(runningVersion(resources,true,data).acceptance,'pending');assert.equal(acceptRunningVersion(resources,true,new Date('2026-10-18T00:00:00Z'),data).acceptance,'accepted');assert.equal(await readFile(path.join(resources,'build-manifest.json'),'utf8'),manifest);await assert.rejects(access(path.join(resources,'deployment-receipt.json')));}
 finally{await rm(root,{recursive:true,force:true});}
});

test('real production dependency copy selects Mac arm64 archive binary, never Windows or x64',async()=>{
 assert.ok(process.env.HIVELAB_TEST_PROFILE);const root=await mkdtemp(path.join(process.env.TEMP,'mac-deps-'));await mkdir(path.join(root,'dist'));const before=productionPackages({packages:{'node_modules/mac':{os:['darwin'],cpu:['arm64']},'node_modules/win':{os:['win32']},'node_modules/dev':{dev:true}}},'darwin','arm64');assert.deepEqual(before.map(p=>p[0]),['node_modules/mac']);
 try{const result=await copyProductionDependencies(root,'darwin','arm64');assert.ok(result.packages>0);await verifyRuntimeDependencies(root);const file=path.join(root,sevenZipBinary('darwin','arm64')),bytes=await readFile(file);assert.equal(bytes.readUInt32LE(0),0xfeedfacf);assert.equal(bytes.readUInt32LE(4),0x0100000c);if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o111,0o111);await assert.rejects(access(path.join(root,'node_modules/7zip-bin/win')));await assert.rejects(access(path.join(root,'node_modules/7zip-bin/mac/x64')));const manifest=JSON.parse(await readFile(path.join(root,'dist/runtime-dependencies.json'),'utf8'));assert.equal(manifest.platform,'darwin');assert.equal(manifest.arch,'arm64');assert.deepEqual(manifest.codeSignedBinaries,['node_modules/7zip-bin/mac/arm64/7za']);}
 finally{await rm(root,{recursive:true,force:true});}
});

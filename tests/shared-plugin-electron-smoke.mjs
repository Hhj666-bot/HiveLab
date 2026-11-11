import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
if(!process.env.HIVELAB_TEST_PROFILE)throw Error('Requires isolated test bootstrap');
const root=path.join(process.env.HIVELAB_TEST_PROFILE,'shared-plugin-electron');await mkdir(root,{recursive:true});
await build({entryPoints:['src/backend/shared-plugin-bridge.ts'],outfile:path.join(root,'bridge.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
await writeFile(path.join(root,'check.mjs'),`
import assert from 'node:assert/strict';
import {SharedPluginBridge} from './bridge.mjs';
process.env.HIVELAB_JOB_HELPER=${JSON.stringify(path.resolve('scripts/windows-job.ps1'))};
process.env.HIVELAB_BUNDLED_NODE_EXE=process.execPath;
const bridge=new SharedPluginBridge(${JSON.stringify(path.join(root,'data'))},()=>({networkMode:'tun',nodeRuntime:'bundled'}),{},{});
try {const id=bridge.add('Electron stdio',{command:'node',args:[${JSON.stringify(path.resolve('tests/fixtures/shared-mcp-server.mjs'))}]},true);await bridge.probe(id);const result=await bridge.call(bridge.tools().find(t=>t.name.endsWith('__echo')).name,{value:'electron-native-node-mode'});assert.equal(JSON.parse(result.content[0].text).value,'electron-native-node-mode');console.log('PASS: MCP bridge under Electron Node mode, owned child process, handshake and tool call.');}finally{await bridge.close();}
`);
const executable=process.env.HIVELAB_TEST_ELECTRON??path.resolve('node_modules/electron/dist/electron.exe');
const result=spawnSync(executable,[path.join(root,'check.mjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:2*1024*1024});
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');if(result.status!==0)throw Error(result.error?.message??'Electron MCP smoke failed: '+result.status);

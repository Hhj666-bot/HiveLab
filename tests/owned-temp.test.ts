import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {spawnOwned,stopOwned,disposeOwned,getOwnership} from '../src/backend/process-supervisor';
import {countStaleOwnedTemp,createOwnedTemp,removeOwnedTemp,sweepOwnedTemp} from '../src/backend/owned-temp';

function root(name:string){const value=path.join(process.env.HIVELAB_TEST_PROFILE!,'managed-temp-'+name);mkdirSync(value,{recursive:true});return value;}
function ready(child:ReturnType<typeof spawnOwned>):Promise<string>{return new Promise((resolve,reject)=>{let text='';child.stdout!.on('data',chunk=>{text+=chunk;if(text.includes('\n'))resolve(text.split('\n')[0]);});child.once('error',reject);child.once('close',code=>{if(!text.includes('\n'))reject(Error('Child exited before ready: '+code));});});}
const code='const fs=require("node:fs"),path=require("node:path");fs.mkdirSync(path.join(process.env.TEMP,"_MEI-test"));fs.writeFileSync(path.join(process.env.TEMP,"_MEI-test","payload.bin"),"fixture");console.log(process.env.TEMP);';

test('owned temp survives for the active child and is removed after normal exit or forced cancellation',async()=>{
 for(const cancel of [false,true]){
  const directory=root(cancel?'cancel':'normal'),child=spawnOwned(process.execPath,['-e',code+(cancel?'setInterval(()=>{},1000);':'setTimeout(()=>process.exit(0),300);')],{cwd:process.cwd(),env:{...process.env,HIVELAB_PROCESS_TEMP_ROOT:directory}});
  try{const temp=await ready(child);assert.equal(path.dirname(temp),directory);assert.equal(getOwnership(child)?.tempDirectory,temp);assert.ok(existsSync(path.join(temp,'_MEI-test','payload.bin')));
   if(cancel)await stopOwned(child,1000);else{await once(child,'close');await disposeOwned();}
   assert.equal(existsSync(temp),false,'The PyInstaller payload must not remain after its process tree exits');
  }finally{await stopOwned(child,1000);}
 }
});

test('restart cleanup removes dead owners, preserves live owners and unrelated legacy files, and refuses out-of-root deletion',async()=>{
 const directory=root('restart'),live=createOwnedTemp(directory)!;writeFileSync(path.join(directory,'keep.txt'),'keep');mkdirSync(path.join(directory,'_MEI-legacy'));
 const exited=spawn(process.execPath,['-e',''],{windowsHide:true});await once(exited,'close');
 const orphan=createOwnedTemp(directory)!,record=JSON.parse(readFileSync(path.join(orphan.directory,'.hivelab-temp-owner.json'),'utf8'));writeFileSync(path.join(orphan.directory,'.hivelab-temp-owner.json'),JSON.stringify({...record,ownerPid:exited.pid}));
 assert.equal(await countStaleOwnedTemp(directory),1);assert.ok(existsSync(orphan.directory));
 const result=await sweepOwnedTemp(directory);assert.equal(result.removed,1);assert.equal(await countStaleOwnedTemp(directory),0);assert.ok(result.skipped>=1);assert.equal(existsSync(orphan.directory),false);assert.ok(existsSync(live.directory));assert.ok(existsSync(path.join(directory,'_MEI-legacy')));assert.ok(existsSync(path.join(directory,'keep.txt')));
 await assert.rejects(removeOwnedTemp({root:directory,directory:path.join(path.dirname(directory),'owned-outside')}),/非托管/);await removeOwnedTemp(live);
});

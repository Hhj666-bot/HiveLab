import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {ChildProcess,spawn} from 'node:child_process';
import {browserExecutable,launchBrowser} from '../src/main/external-browsers';

test('browser choices detect Edge and Chrome in machine and user install directories',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hivelab-browser-test-'));
  try{
    const machine=path.join(root,'machine'),user=path.join(root,'user'),edge=path.join(machine,'Microsoft/Edge/Application/msedge.exe'),chrome=path.join(user,'Google/Chrome/Application/chrome.exe');
    for(const file of [edge,chrome]){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'fixture');}
    const env={ProgramFiles:machine,LOCALAPPDATA:user};
    assert.equal(browserExecutable('edge',env,'win32'),edge);assert.equal(browserExecutable('chrome',env,'win32'),chrome);
    assert.equal(browserExecutable('edge',{},'win32'),undefined);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('selected browser receives the URL as one argument without a shell',async()=>{
  const calls:unknown[]=[];let released=false;
  const child=new EventEmitter() as ChildProcess;child.unref=()=>{released=true;};
  const start=((...args:unknown[])=>{calls.push(args);queueMicrotask(()=>child.emit('spawn'));return child;}) as typeof spawn;
  await launchBrowser('C:/Browser/chrome.exe','https://example.com/path?a=1&b=2',start);
  assert.deepEqual(calls,[['C:/Browser/chrome.exe',['https://example.com/path?a=1&b=2'],{detached:true,stdio:'ignore',windowsHide:false}]]);assert.equal(released,true);
});

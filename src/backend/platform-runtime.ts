import path from 'node:path';
import {existsSync} from 'node:fs';
/** GUI launches on macOS do not load the user's interactive shell configuration. */
export function desktopSearchPath(platform:NodeJS.Platform,env:NodeJS.ProcessEnv,home:string){
 if(platform!=='darwin')return Object.entries(env).find(([key])=>key.toLowerCase()==='path')?.[1]??'';
 return [...new Set([path.posix.join(home,'.local/bin'),'/opt/homebrew/bin','/usr/local/bin',...(env.PATH??'').split(':'),'/usr/bin','/bin','/usr/sbin','/sbin'].filter(Boolean))].join(':');
}
export function localNodeCandidates(platform:NodeJS.Platform,env:NodeJS.ProcessEnv){
 return [env.HIVELAB_NODE_EXE,...(platform==='win32'?[path.win32.join(env.ProgramFiles||'C:\\Program Files','nodejs','node.exe')]:['/opt/homebrew/bin/node','/usr/local/bin/node','/usr/bin/node'])].filter((value):value is string=>!!value);
}
export function localNpmCli(node:string,platform:NodeJS.Platform=process.platform,exists:(file:string)=>boolean=existsSync){
 const paths=platform==='win32'?path.win32:path.posix,base=paths.dirname(node);
 return [paths.join(base,'node_modules/npm/bin/npm-cli.js'),paths.join(base,'../lib/node_modules/npm/bin/npm-cli.js')].find(exists);
}
/** Quote a filesystem path as POSIX shell data, including spaces, apostrophes and dollar signs. */
export function npmNodeShim(node:string,platform:NodeJS.Platform=process.platform){
 if(platform==='win32')return {name:'node.cmd',content:`@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${node.replaceAll('%','%%')}" %*\r\n`,mode:0o600};
 return {name:'node',content:`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '${node.replaceAll("'","'\"'\"'")}' "$@"\n`,mode:0o755};
}

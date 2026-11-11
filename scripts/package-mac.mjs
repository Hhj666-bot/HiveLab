import {execFileSync} from 'node:child_process';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Mac 预览版须在 Apple 芯片 Mac 上构建；Windows 不会生成或假冒已验证的 DMG。');
if(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw Error('请先提交源码改动；不将未记录的文件打入 Mac 预览版。');
const run=(script,args=[])=>execFileSync(process.execPath,[script,...args],{cwd:root,stdio:'inherit',env:process.env});
run('node_modules/typescript/bin/tsc',['--noEmit']);run('scripts/build.mjs');
run('node_modules/electron-builder/cli.js',['--mac','--arm64','--config','electron-builder.mac.json','--publish','never']);
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',path.join(root,'release/mac-arm64/HiveLab 合屋.app')],{cwd:root,stdio:'inherit'});
const artifacts=[];for(const name of await readdir(path.join(root,'release')))if(/^HiveLab-.*-macOS-arm64\.(dmg|zip)$/.test(name)){const bytes=await readFile(path.join(root,'release',name));artifacts.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
if(artifacts.length!==2)throw Error('未完整生成 Apple 芯片 DMG 和 ZIP');
const manifest=JSON.parse(await readFile(path.join(root,'release/mac-arm64/HiveLab 合屋.app/Contents/Resources/build-manifest.json'),'utf8'));
await writeFile(path.join(root,'release/mac-arm64-receipt.json'),JSON.stringify({builtAt:new Date().toISOString(),sourceCommit:manifest.sourceCommit,sourceDirty:manifest.sourceDirty,artifacts,signing:'local ad-hoc',notarized:false,acceptance:'requires real Mac startup and agent checks',modelCalls:0},null,2));
console.log('Apple 芯片预览包已生成：本机临时签名，未公证；仍须实际启动和成员验证。');

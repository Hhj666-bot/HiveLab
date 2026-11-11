import {cp,mkdir,readFile,readdir,rm,writeFile,copyFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyProductionDependencies} from './runtime-dependencies.mjs';
import {writeBuildManifest} from './build-manifest.mjs';
import {replaceExecutableIcon} from './executable-icon.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// HIVELAB_RUNTIME_DIR overrides the sibling runtime directory.
const installed=path.resolve(process.env.HIVELAB_RUNTIME_DIR||path.join(root,'..','runtime')),output=path.join(root,'release','win-unpacked');
// A direct update reuses the verified shell already there; the first copy comes from an unpacked green package.
const receipt=JSON.parse(await readFile(path.join(installed,'build-manifest.json'),'utf8').catch(error=>{
  if(error.code==='ENOENT')throw new Error(`No HiveLab program found in ${installed}. Unpack the green package (or run npm run package:green and copy release\\win-unpacked) there first, then deploy again.`);
  throw error;
}));
const executable=path.join(installed,'HiveLab.exe');
const digest=createHash('sha256').update(await readFile(executable)).digest('hex');
if(digest!==receipt.hashes['HiveLab.exe'])throw new Error('Installed desktop executable differs from its verified manifest.');
const electronVersion=JSON.parse(await readFile(path.join(root,'node_modules/electron/package.json'),'utf8')).version;
if((await readFile(path.join(installed,'version'),'utf8')).trim()!==electronVersion)throw new Error('Electron version changed; this direct-update path requires an explicitly validated new desktop shell.');
await mkdir(output,{recursive:true});
// Fixed workspace output only; never delete an installed directory or profile.
if(output!==path.join(root,'release','win-unpacked')||(await lstat(output)).isSymbolicLink())throw new Error('Unsafe direct build output.');
await rm(output,{recursive:true,force:true,maxRetries:20,retryDelay:100});await mkdir(output,{recursive:true});
// Reuse the verified installed shell, then update its icon in the staged copy only.
for(const entry of await readdir(path.join(root,'node_modules/electron/dist'),{withFileTypes:true})){
  if(['resources','electron.exe'].includes(entry.name))continue;
  await cp(path.join(root,'node_modules/electron/dist',entry.name),path.join(output,entry.name),{recursive:true});
}
await copyFile(executable,path.join(output,'HiveLab.exe'));
await replaceExecutableIcon(path.join(output,'HiveLab.exe'),path.join(root,'build','hivelab.ico'));
const appRoot=path.join(output,'resources','app');await mkdir(appRoot,{recursive:true});
await cp(path.join(root,'dist'),path.join(appRoot,'dist'),{recursive:true,filter:file=>!file.endsWith('.map')});await copyFile(path.join(root,'package.json'),path.join(appRoot,'package.json'));
const dependencies=await copyProductionDependencies(appRoot);const manifest=await writeBuildManifest(output,dependencies);
console.log('Direct desktop update prepared:',manifest.sourceCommit,'No installer or user backup created.');

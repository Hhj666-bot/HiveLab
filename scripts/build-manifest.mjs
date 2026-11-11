import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRuntimeDependencies} from './runtime-dependencies.mjs';
import {executableSignature} from './windows-signature.mjs';

/** Written before installers are archived, so installed copies identify their actual source. */
export async function writeBuildManifest(directory,dependencies){
  const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const files=['HiveLab.exe','resources/app/package.json','resources/app/package-lock.json'];
  async function collect(relative){for(const entry of await readdir(path.join(directory,relative),{withFileTypes:true})){const file=relative+'/'+entry.name;if(entry.isDirectory())await collect(file);else files.push(file);}}
  await collect('resources/app/dist');const hashes={};
  for(const file of files)hashes[file]=createHash('sha256').update(await readFile(path.join(directory,file))).digest('hex');
  const head=spawnSync('git',['rev-parse','--verify','HEAD'],{cwd:workspace,encoding:'utf8',windowsHide:true});
  const source=head.status===0?{sourceCommit:head.stdout.trim(),sourceDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:workspace,encoding:'utf8',windowsHide:true}).trim()}:{sourceCommit:'local-'+createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),sourceDirty:true,sourceKind:'uncommitted-build',sourceDirectory:workspace};
  const receipt={builtAt:new Date().toISOString(),...source,deployment:'pending-installation',dependencies,hashes};
  receipt.windowsSignature=executableSignature(path.join(directory,'HiveLab.exe'));
  await writeFile(path.join(directory,'build-manifest.json'),JSON.stringify(receipt,null,2));return receipt;
}

/** Written before codesign. Only application payload hashes: signing changes the Mach-O binary.
 * Keep this metadata read-only after signing; DMG/ZIP digests are recorded separately. */
export async function writeMacSourceManifest(appRoot,dependencies){
  const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),files=['package.json','package-lock.json'];
  async function collect(relative){for(const entry of await readdir(path.join(appRoot,relative),{withFileTypes:true})){const file=relative+'/'+entry.name;if(entry.isDirectory())await collect(file);else files.push(file);}}
  await collect('dist');const hashes={};for(const file of files)hashes[file]=createHash('sha256').update(await readFile(path.join(appRoot,file))).digest('hex');
  const manifest={builtAt:new Date().toISOString(),platform:'darwin',arch:'arm64',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:workspace,encoding:'utf8',windowsHide:true}).trim(),sourceDirty:!!execFileSync('git',['status','--porcelain'],{cwd:workspace,encoding:'utf8',windowsHide:true}).trim(),dependencies,hashScope:'application payload before signing; executable and archive verification are separate',hashes};
  await writeFile(path.join(path.dirname(appRoot),'build-manifest.json'),JSON.stringify(manifest,null,2));return manifest;
}

// Electron Builder calls this after editing executable icons/metadata, before archiving either target.
export default async function afterSign(context){
  if(context.electronPlatformName==='darwin'){
    const {packageLayout}=await import('./package-layout.mjs');await verifyRuntimeDependencies(packageLayout(path.resolve(context.appOutDir),'darwin').appRoot);return;
  }
  const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.resolve(context.appOutDir);
  if(output!==path.join(workspace,'release','win-unpacked')||context.electronPlatformName!=='win32')throw new Error('Unexpected build manifest target');
  await writeBuildManifest(output,await verifyRuntimeDependencies(path.join(output,'resources/app')));
}

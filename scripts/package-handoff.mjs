import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { verifyRuntimeDependencies } from './runtime-dependencies.mjs';

const dependencies = await verifyRuntimeDependencies('release/win-unpacked/resources/app');
const receipt=JSON.parse(await readFile('release/win-unpacked/build-manifest.json','utf8'));
for(const [file,hash] of Object.entries(receipt.hashes))if(createHash('sha256').update(await readFile('release/win-unpacked/'+file)).digest('hex')!==hash)throw new Error('Packaged build changed after archiving: '+file);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const portable = `release/HiveLab-${version}-Windows.exe`;
const installer=`release/HiveLab-Setup-${version}.exe`;
const artifact=async file=>({path:file,bytes:(await stat(file)).size,sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
await writeFile('release/build-receipt.json', JSON.stringify({ ...receipt, version, scope: 'workspace-build-only', realUserAcceptance: 'pending-user-or-Claude', portable:await artifact(portable),installer:await artifact(installer) }, null, 2));
await writeFile('release/DEPLOYMENT-REQUIRED.txt', 'Packaging is complete. Deployment is NOT complete.\r\nQuit HiveLab 合屋 from its tray before updating the application.\r\nInstall HiveLab-Setup-'+version+'.exe, or run npm run deploy to update the existing local runtime.\r\nOpen the HiveLab 合屋 desktop shortcut to enter the program directly. No command window is needed.\r\nExisting user data remains in %USERPROFILE%\\.hivelab\\data. Preserve deployment-receipt.json as evidence.\r\n');
console.log('\n[HiveLab 合屋] Installer and portable build complete; deployment remains pending.\nQuit HiveLab 合屋 before updating, then open the HiveLab 合屋 desktop shortcut.\nSee release/DEPLOYMENT-REQUIRED.txt.');

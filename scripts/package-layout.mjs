import path from 'node:path';
/** Only targets implemented and tracked by this fork. Never reuse a Windows payload for macOS. */
export function packageLayout(output,platform){
 if(platform==='win32')return {outputName:'win-unpacked',resources:path.join(output,'resources'),appRoot:path.join(output,'resources','app')};
 if(platform==='darwin')return {outputName:'mac-arm64',resources:path.join(output,'HiveLab 合屋.app','Contents','Resources'),appRoot:path.join(output,'HiveLab 合屋.app','Contents','Resources','app')};
 throw Error('Unsupported package platform: '+platform);
}
export function sevenZipBinary(platform,arch){
 if(platform==='win32'&&arch==='x64')return 'node_modules/7zip-bin/win/x64/7za.exe';
 if(platform==='darwin'&&arch==='arm64')return 'node_modules/7zip-bin/mac/arm64/7za';
 throw Error(`Unsupported archive runtime: ${platform}/${arch}`);
}

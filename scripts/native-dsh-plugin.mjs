// Invoke the installed DSH CLI's own package manager with HiveLab 合屋's pinned pnpm.
import {pathToFileURL} from 'node:url';
const [entry,pnpm,node,profile,...args]=process.argv.slice(2);
if(!entry||!pnpm||!node||!profile)throw Error('Missing native DSH plugin launcher arguments');
const {runCli}=await import(pathToFileURL(entry).href);
process.argv=[process.execPath,entry,'plugin','--profile',profile,...args];
await runCli({packageManager:{command:node,args:[pnpm],env:process.env}});

import net from 'node:net';
import path from 'node:path';
import {createServer as createViteServer} from 'vite';
/** Chromium refuses these. Windows can hand out any port from 1024 up, so port 0 sometimes lands on one. */
const BLOCKED_PORTS=new Set([1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
async function browserSafePort(host){
  for(;;){
    const probe=net.createServer();
    await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,host,resolve);});
    const {port}=probe.address();await new Promise(resolve=>probe.close(resolve));
    if(!BLOCKED_PORTS.has(port))return port;
  }
}
/** Parallel UI tests must not rewrite another worktree's shared dependency cache. */
export async function createServer(options){
  if(!process.env.HIVELAB_TEST_PROFILE)throw new Error('UI tests require the isolated test bootstrap.');
  const watch=options.server?.watch??{},ignored=watch.ignored===undefined?[]:Array.isArray(watch.ignored)?watch.ignored:[watch.ignored];
  // Scan the app entry, not packaged runtimes, rollback copies and portable extraction caches.
  const port=options.server?.port===0?await browserSafePort(options.server.host):options.server?.port;
  return createViteServer({...options,optimizeDeps:{...options.optimizeDeps,entries:['index.html']},server:{...options.server,port,watch:{...watch,ignored:[...ignored,'**/.test-cache/**','**/release/**','**/.builder-cache/**']}},cacheDir:path.join(process.env.HIVELAB_TEST_PROFILE,'vite-cache')});
}

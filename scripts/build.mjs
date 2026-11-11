import { build } from 'esbuild';
import { build as buildVite } from 'vite';
import { mkdir, copyFile, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './build-job.mjs';
import './build-startup.mjs';
await mkdir('dist', { recursive: true });
for (const [entry, outfile, format] of [
  ['src/main/main.ts', 'dist/main.mjs', 'esm'],
  ['src/main/preload.ts', 'dist/preload.cjs', 'cjs'],
  ['src/main/computer-indicator-preload.ts', 'dist/computer-indicator-preload.cjs', 'cjs'],
  ['src/backend/worker.ts', 'dist/worker.mjs', 'esm'],
  ['src/backend/pdf-thread.ts', 'dist/pdf-thread.mjs', 'esm'],
  ['src/backend/adapters/claude-permission-mcp.ts', 'dist/claude-permission-mcp.cjs', 'cjs'],
]) await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format, target: 'node24', packages: 'external', sourcemap: true });
if(existsSync('src/backend/backup.ts'))await build({entryPoints:['src/backend/backup.ts'],outfile:'dist/backup.mjs',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',sourcemap:true});
else await Promise.all(['dist/backup.mjs','dist/backup.mjs.map'].map(file=>rm(file,{force:true})));
await copyFile('scripts/windows-job.ps1', 'dist/windows-job.ps1');
await copyFile('scripts/hivelab-tools.mjs', 'dist/hivelab-tools.mjs');
await copyFile('scripts/native-dsh-plugin.mjs','dist/native-dsh-plugin.mjs');
await copyFile('scripts/dsh-account-plugin.mjs', 'dist/dsh-account-plugin.mjs');
await copyFile('scripts/verify-runtime-dependencies.ps1', 'dist/verify-runtime-dependencies.ps1');
await copyFile('build/hivelab.ico', 'dist/hivelab.ico');
await copyFile('build/hivelab.png', 'dist/hivelab.png');
await cp('build/third-party','dist/third-party',{recursive:true});
await rm('dist/extensions',{recursive:true,force:true});
await cp('build/extensions','dist/extensions',{recursive:true});
await copyFile('docs/extensions.md','dist/extensions/README.md');
await copyFile('docs/native-plugins.md','dist/extensions/原生插件.md');
await copyFile('docs/skills.md','dist/extensions/按执行端管理Skills.md');
// The renderer's JSX runs through src/renderer/jsx (React's runtime plus the interface-language
// display pass); `hivelab-jsx` is only an alias for that folder.
await buildVite({ base: './', build: { outDir: 'dist/renderer', emptyOutDir: true }, oxc: { jsx: { runtime: 'automatic', importSource: 'hivelab-jsx' } }, resolve: { alias: { 'hivelab-jsx': fileURLToPath(new URL('../src/renderer/jsx', import.meta.url)) } } });

await build({entryPoints:['src/renderer/wallpaper-player.ts'],outfile:'dist/wallpaper/player.js',bundle:true,platform:'browser',format:'esm',target:'chrome140',minify:true});

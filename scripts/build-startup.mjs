import {build} from 'esbuild';
await build({entryPoints:['src/renderer/startup-boot.ts'],outfile:'public/startup/boot.js',bundle:true,platform:'browser',format:'iife',target:'chrome140',minify:true});

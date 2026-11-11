import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';

// The editable SVG is the canonical artwork; derive every platform icon from it.
const source=(await readFile(new URL('../public/brand/hivelab.svg',import.meta.url))).toString('base64');
const browser=await chromium.launch({channel:process.env.HIVELAB_BROWSER_CHANNEL||'msedge',headless:true});
try{
  const page=await browser.newPage();
  const frames=[];
  for(const size of [16,24,32,48,64,128,256]){
    const png=Buffer.from(await page.evaluate(async({source,size})=>{
      const image=new Image();image.src='data:image/svg+xml;base64,'+source;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
      const context=canvas.getContext('2d');context.drawImage(image,0,0,size,size);
      return Array.from(new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))).arrayBuffer()));
    },{source,size}));
    frames.push({size,png});
  }
  const header=Buffer.alloc(6+frames.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);
  let offset=header.length;
  frames.forEach(({size,png},i)=>{const p=6+i*16;header[p]=header[p+1]=size===256?0:size;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(png.length,p+8);header.writeUInt32LE(offset,p+12);offset+=png.length;});
  await mkdir(new URL('../build/',import.meta.url),{recursive:true});
  const png=frames.at(-1).png;
  await writeFile(new URL('../build/hivelab.ico',import.meta.url),Buffer.concat([header,...frames.map(frame=>frame.png)]));
  await writeFile(new URL('../build/hivelab.png',import.meta.url),png);
  const icns=Buffer.alloc(16);icns.write('icns',0);icns.writeUInt32BE(16+png.length,4);icns.write('ic08',8);icns.writeUInt32BE(8+png.length,12);
  await writeFile(new URL('../build/hivelab.icns',import.meta.url),Buffer.concat([icns,png]));
  console.log('HiveLab SVG rendered to PNG, Windows ICO (16–256px), and macOS ICNS.');
}finally{await browser.close();}

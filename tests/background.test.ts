import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,truncate} from 'node:fs/promises';
import path from 'node:path';
import {BackgroundLibrary,MEDIA_LIMITS} from '../src/main/background-library';
import {normalizeBackground,backgroundPage,pageRank} from '../src/shared/background';
import {softenStandeeMatte} from '../src/shared/standee-matte';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
test('pane transparency accepts old preferences and clamps invalid values',()=>{
  assert.equal(normalizeBackground({}).respectReducedMotion,true);assert.equal(normalizeBackground({respectReducedMotion:false}).respectReducedMotion,false);
  assert.equal(normalizeBackground({dim:0.94}).dim,0.94);assert.equal(normalizeBackground({dim:1}).dim,0.95);
  const old=normalizeBackground({mode:'studio',dim:0.5});assert.equal(old.previewTransparency,40);assert.equal(old.terminalTransparency,39);
  const bounded=normalizeBackground({previewTransparency:150,terminalTransparency:-20});assert.equal(bounded.previewTransparency,100);assert.equal(bounded.terminalTransparency,0);
  const invalid=normalizeBackground({previewTransparency:NaN,terminalTransparency:'50'});assert.equal(invalid.previewTransparency,40);assert.equal(invalid.terminalTransparency,39);
});
test('each page, desk, project and report persists independently across restart and migrates legacy home preferences',async()=>{
  const root=await mkdtemp(path.join(process.env.TEMP!,'background-pages-')),library=new BackgroundLibrary(root);
  try{
    await mkdir(library.folder);await writeFile(path.join(library.folder,'preferences.json'),JSON.stringify({mode:'studio',dim:0.5,blur:2}));
    assert.equal((await library.get('home')).dim,0.5);assert.equal((await library.get('desk:sol')).mode,'plain');
    const ids=['home','lounge','roundtable',backgroundPage('desk','','sol'),backgroundPage('desk','','astra'),backgroundPage('project','one'),backgroundPage('project','two'),backgroundPage('reports','one','sol'),backgroundPage('reports','one','astra')];
    const source=path.join(root,'art.png');await writeFile(source,png);
    await Promise.all(ids.map(async(id,i)=>{await library.import(source,'local',id,id);await library.save({dim:i/20,blur:i},id);}));
    const restarted=new BackgroundLibrary(root);for(const [i,id] of ids.entries()){const p=await restarted.get(id);assert.equal(p.dim,i/20);assert.equal(p.blur,i);assert.equal(p.media?.name,id);}
    await library.save({mode:'plain',dim:0,previewTransparency:72,terminalTransparency:48,respectReducedMotion:false},'desk:sol');assert.equal((await library.get('desk:astra')).dim,0.2);assert.equal((await library.get('home')).mode,'media');
    assert.equal((await new BackgroundLibrary(root).get('desk:sol')).respectReducedMotion,false);assert.equal((await library.get('desk:astra')).respectReducedMotion,true);
    const panes=await new BackgroundLibrary(root).get('desk:sol');assert.equal(panes.previewTransparency,72);assert.equal(panes.terminalTransparency,48);assert.equal((await library.get('desk:astra')).terminalTransparency,39);
    for(const invalid of ['__proto__','../home','desk:','reports','report:one'])await assert.rejects(library.save({dim:0},invalid),/页面标识/);
    await writeFile(path.join(library.folder,'preferences.json'),'{broken');await assert.rejects(library.save({dim:0.3},'home'));assert.equal(await readFile(path.join(library.folder,'preferences.json'),'utf8'),'{broken');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('background import persists isolated preferences, serial saves preserve fields, and originals stay intact',async()=>{
  const root=await mkdtemp(path.join(process.env.TEMP!,'background-')),library=new BackgroundLibrary(path.join(root,'data'));
  try{
    const file=path.join(root,'wallpaper.png');await writeFile(file,png);const p=await library.import(file);assert.equal(p.mode,'media');assert.equal(p.media?.kind,'image');assert.deepEqual(await readFile(file),png);
    await Promise.all([library.save({dim:0.4}),library.save({blur:9}),library.save({previewTransparency:81}),library.save({terminalTransparency:62}),library.save({fit:'contain',media:{file:'../../stolen.txt'}})]);
    const saved=await new BackgroundLibrary(path.join(root,'data')).get();assert.equal(saved.dim,0.4);assert.equal(saved.blur,9);assert.equal(saved.previewTransparency,81);assert.equal(saved.terminalTransparency,62);assert.equal(saved.fit,'contain');assert.equal(saved.media?.file,p.media?.file);
    await writeFile(path.join(root,'fake.png'),'<script>alert(1)</script>');await assert.rejects(library.import(path.join(root,'fake.png')),/格式不符/);assert.deepEqual(await library.get(),saved);
    const large=path.join(root,'large.png');await writeFile(large,png);await truncate(large,MEDIA_LIMITS.image+1);await assert.rejects(library.import(large),/32 MB/);
    assert.equal(normalizeBackground({mode:'media',media:{file:'../../a.mp4',kind:'video'},dim:999,blur:-9}).mode,'studio');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('Wallpaper Engine imports video, scene and web projects; invalid projects preserve current media',async()=>{
  const root=await mkdtemp(path.join(process.env.TEMP!,'wallpaper-project-')),library=new BackgroundLibrary(path.join(root,'data'));
  try{
    const project=path.join(root,'project');await mkdir(project);const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(32)]);await writeFile(path.join(project,'video.mp4'),mp4);
    const json=path.join(project,'project.json');await writeFile(json,JSON.stringify({type:'video',file:'video.mp4',title:'测试视频壁纸'}));const imported=await library.importWallpaper(json);assert.equal(imported.media?.source,'wallpaper-engine');assert.equal(imported.media?.name,'测试视频壁纸');
    await writeFile(path.join(project,'scene.pkg'),Buffer.from('local scene package'));
    await writeFile(json,'\uFEFF'+JSON.stringify({type:'Scene',file:'scene.json',title:'场景壁纸'}));
    const scene=await library.importWallpaper(json,'desk:sol');assert.equal(scene.media?.kind,'scene');assert.equal(scene.media?.source,'wallpaper-engine');
    await writeFile(path.join(project,'index.html'),'<html><body>local wallpaper</body></html>');
    await writeFile(json,JSON.stringify({type:'web',file:'index.html'}));const web=await library.importWallpaper(json,'lounge');assert.equal(web.media?.kind,'web');
    await writeFile(json,JSON.stringify({type:'application',file:'program.exe'}));await assert.rejects(library.importWallpaper(json),/应用程序壁纸/);
    await writeFile(path.join(root,'outside.mp4'),mp4);await writeFile(json,JSON.stringify({type:'video',file:'../outside.mp4'}));await assert.rejects(library.importWallpaper(json),/超出|内/);assert.deepEqual(await library.get(),imported);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('wallpaper project copies survive source changes, protocol contains paths and sandbox policy blocks workbench and network access',async()=>{
  const root=await mkdtemp(path.join(process.env.TEMP!,'wallpaper-assets-')),library=new BackgroundLibrary(path.join(root,'data'));
  try{
    const project=path.join(root,'project');await mkdir(path.join(project,'images'),{recursive:true});
    await writeFile(path.join(project,'project.json'),JSON.stringify({type:'web',file:'index.html'}));await writeFile(path.join(project,'index.html'),'<html>owned fixture</html>');await writeFile(path.join(project,'images','sample.png'),png);
    const saved=await library.importWallpaper(path.join(project,'project.json')),id=saved.media!.file;
    await rm(project,{recursive:true});const restarted=new BackgroundLibrary(path.join(root,'data'));assert.deepEqual((await restarted.get()).media,saved.media);
    const response=await restarted.wallpapers.serve(new Request(`hivelab-wallpaper://${id}/images/sample.png`));assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
    const range=await restarted.wallpapers.serve(new Request(`hivelab-wallpaper://${id}/images/sample.png`,{headers:{Range:'bytes=4-9'}}));assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),png.subarray(4,10));
    assert.equal((await restarted.wallpapers.serve(new Request(`hivelab-wallpaper://${id}/images/sample.png`,{method:'HEAD'}))).headers.get('content-length'),String(png.length));
    for(const suffix of ['/%2e%2e%5cpreferences.json','/preferences.json','/C%3A/secret.txt'])assert.equal((await restarted.wallpapers.serve(new Request(`hivelab-wallpaper://${id}${suffix}`))).status,404);
    assert.equal((await restarted.wallpapers.serve(new Request('hivelab-wallpaper://invalid/index.html'))).status,404);
    const player=await restarted.wallpapers.serve(new Request(`hivelab-wallpaper://player/index.html?source=${id}`)),html=await player.text();assert.equal(player.status,200);assert.match(html,/player.js/);
    const csp=player.headers.get('content-security-policy')!;assert.match(csp,/default-src 'none'/);assert.doesNotMatch(csp,/https?:|hivelab-background:|file:/);
    const normalized=normalizeBackground(saved);assert.equal(normalized.media?.kind,'web');assert.equal(normalizeBackground({mode:'media',media:{file:id,kind:'image'}}).media,undefined);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('local media protocol supports ranges/HEAD, bounds invalid requests and cannot read arbitrary files',async()=>{
  const root=await mkdtemp(path.join(process.env.TEMP!,'background-range-')),library=new BackgroundLibrary(root);
  try{
    const file=path.join(root,'test.png');await writeFile(file,png);const p=await library.import(file),url='hivelab-background://local/'+p.media!.file;
    const response=await library.serve(new Request(url,{headers:{Range:'bytes=4-9'}}));assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 4-9/${png.length}`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png.subarray(4,10));
    const tail=await library.serve(new Request(url,{headers:{Range:'bytes=-5'}}));assert.deepEqual(Buffer.from(await tail.arrayBuffer()),png.subarray(-5));
    const head=await library.serve(new Request(url,{method:'HEAD'}));assert.equal(head.headers.get('content-length'),String(png.length));assert.equal((await head.arrayBuffer()).byteLength,0);
    for(const range of ['bytes=9999-','bytes=9-4','bytes=0-1,4-5','bytes=-0'])assert.equal((await library.serve(new Request(url,{headers:{Range:range}}))).status,416);
    assert.equal((await library.serve(new Request('hivelab-background://local/preferences.json'))).status,404);
    assert.equal((await library.serve(new Request('hivelab-background://local/../../hivelab.sqlite'))).status,404);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('display matte preserves enclosed white clothing, colored edges and original transparent regions',()=>{
  const pixels=new Uint8ClampedArray(7*7*4).fill(255);for(let y=1;y<6;y++)for(let x=1;x<6;x++)if(x===1||x===5||y===1||y===5){const i=(y*7+x)*4;pixels[i]=20;pixels[i+1]=40;pixels[i+2]=80;}
  softenStandeeMatte(pixels,7,7);assert.equal(pixels[3],0);assert.equal(pixels[(3*7+3)*4+3],255);assert.equal(pixels[(1*7+1)*4+3],255);
});
test('pages rank in the sidebar reading order, so turning follows it',()=>{
  const rank=(page:string)=>pageRank(page,['a','b'],['p','q']);
  const order=['home','desk:a','desk:b','project:p','report:p:a','project:q','lounge','roundtable'].map(rank);
  assert.deepEqual(order,order.toSorted((x,y)=>x-y));assert.equal(new Set(order).size,order.length);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AdaptiveTextColorCache} from '../src/main/adaptive-text-cache';
import {emptyTextToneCache,parseTextToneCache,updateTextToneCache} from '../src/shared/adaptive-text-cache';

test('cached region colours stay separate for each wallpaper and material context',()=>{
 let cache=updateTextToneCache(emptyTextToneCache(),'desk:a/wallpaper-1',{people:'light',topic:'dark'},1);
 cache=updateTextToneCache(cache,'desk:a/wallpaper-2',{people:'dark',topic:'light'},2);
 assert.equal(cache.contexts['desk:a/wallpaper-1'].tones.people,'light');
 assert.equal(cache.contexts['desk:a/wallpaper-2'].tones.people,'dark');
 assert.deepEqual(parseTextToneCache(JSON.parse(JSON.stringify(cache))),cache);
 assert.deepEqual(parseTextToneCache({version:0,contexts:cache.contexts}),emptyTextToneCache());
 assert.deepEqual(parseTextToneCache({version:1,contexts:cache.contexts}),emptyTextToneCache(),'rebuild colours learned before the wallpaper rendering fix');
 assert.deepEqual(parseTextToneCache({version:2,contexts:cache.contexts}),emptyTextToneCache(),'replace position-dependent identities with page palettes');
 assert.throws(()=>updateTextToneCache(cache,'x'.repeat(16385),{people:'light'}));
});
test('the single cache file survives restart and serializes simultaneous page updates',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'hivelab-text-cache-'));
 t.after(async()=>{if(path.dirname(directory)!==path.resolve(tmpdir()))throw Error('Unexpected cache test directory');await rm(directory,{recursive:true,force:true});});
 const first=new AdaptiveTextColorCache(directory);assert.deepEqual(await first.read(),emptyTextToneCache());
 await Promise.all([first.write('desk:a',{people:'light'}),first.write('desk:b',{people:'dark'})]);
 const restarted=new AdaptiveTextColorCache(directory),saved=await restarted.read();
 assert.equal(saved.contexts['desk:a'].tones.people,'light');assert.equal(saved.contexts['desk:b'].tones.people,'dark');
 assert.deepEqual(JSON.parse(await readFile(first.file,'utf8')),saved);
 await writeFile(first.file,'interrupted old cache');assert.deepEqual(await new AdaptiveTextColorCache(directory).read(),emptyTextToneCache());
});

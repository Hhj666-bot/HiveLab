import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {NativePlugins} from '../src/backend/native-plugins';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';

test('a source preview waits for an already-running inventory read instead of failing or repeating the operation',async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'native-preview-race-')),source=path.join(root,'source');mkdirSync(source);writeFileSync(path.join(source,'SKILL.md'),'---\nname: race-check\ndescription: Source preview test\n---\nRead only.');
 const service=new NativePlugins(path.join(root,'data'),()=>({...DEFAULT_SETTINGS,paths:{codex:process.env.HIVELAB_TEST_NATIVE_CODEX??path.resolve('node_modules/@openai/codex/bin/codex.js')}}),()=>[],()=>{});
 try{const reading=service.inventory('codex');await new Promise<void>(resolve=>setImmediate(resolve));const job=service.start({provider:'codex',action:'inspect',sourceKind:'local',source});await reading;await service.settled;const done=service.history().find(j=>j.id===job.id)!;assert.equal(done.status,'done',done.error??'');assert.equal(done.preview?.sharing?.skills[0].id,'race-check');assert.equal(service.history().filter(j=>j.id===job.id).length,1);}finally{await service.close();}
});

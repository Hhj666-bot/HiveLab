import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {repairClaudeTranscript,withoutEmptyThinking} from '../src/backend/adapters/claude-transcript';

const assistant=(uuid:string,parentUuid:string|null,content:unknown[])=>JSON.stringify({parentUuid,type:'assistant',uuid,message:{id:'msg_1',role:'assistant',content}});
const blank={type:'thinking',thinking:'',signature:''};
// Shape recorded from a session that ran through a relay: thinking gets its own line, blank on both fields.
const transcript=[
 JSON.stringify({type:'queue-operation',operation:'enqueue'}),
 JSON.stringify({parentUuid:null,type:'user',uuid:'u1',message:{role:'user',content:'你好'}}),
 assistant('a1','u1',[blank]),
 assistant('a2','a1',[blank]),
 assistant('a3','a2',[{type:'text',text:'你好'}]),
 '',
].join('\n');
const records=(text:string)=>text.split('\n').filter(Boolean).map(line=>JSON.parse(line));

test('Blank unsigned thinking is dropped and the chain still reaches the same records',()=>{
 const {text,removed}=withoutEmptyThinking(transcript);
 assert.equal(removed,2);
 assert.deepEqual(records(text).map(record=>record.uuid),[undefined,'u1','a3']);
 assert.equal(records(text)[2].parentUuid,'u1');
 assert.ok(text.endsWith('\n'));
});

test('Only the blank block leaves a line that carries other content',()=>{
 const {text}=withoutEmptyThinking(assistant('a1','u1',[blank,{type:'text',text:'保留'}]));
 assert.deepEqual(records(text)[0].message.content,[{type:'text',text:'保留'}]);
});

test('Signed or written thinking and unreadable lines are left byte for byte',()=>{
 const kept=[
  assistant('a1','u1',[{type:'thinking',thinking:'',signature:'c2ln'}]),
  assistant('a2','a1',[{type:'thinking',thinking:'想法',signature:''}]),
  '{"parentUuid":"broken',
 ].join('\n');
 assert.deepEqual(withoutEmptyThinking(kept),{text:kept,removed:0});
});

test('A repair keeps the original beside the transcript, once, and leaves a clean session untouched',()=>{
 const home=mkdtempSync(join(tmpdir(),'hivelab-transcript-')),id='0a55e4da-a785-4de9-a9b1-563e5e22888c';
 try{
  const folder=join(home,'projects','desk');mkdirSync(folder,{recursive:true});
  const file=join(folder,`${id}.jsonl`),backup=`${file}.before-thinking-repair`;
  writeFileSync(file,transcript);
  assert.equal(repairClaudeTranscript(id,home),2);
  assert.equal(readFileSync(backup,'utf8'),transcript);
  const repaired=readFileSync(file,'utf8');
  assert.equal(repairClaudeTranscript(id,home),0);
  assert.equal(readFileSync(file,'utf8'),repaired);
  assert.equal(repairClaudeTranscript('not-a-session',home),0);
  assert.equal(existsSync(`${file}.repairing`),false);
 }finally{rmSync(home,{recursive:true,force:true});}
});

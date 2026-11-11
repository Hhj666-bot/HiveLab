import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {Engine} from '../src/backend/engine';
import {parsePersonaFile,renderPersonaFile} from '../src/shared/persona-file';
import {personaInstructions} from '../src/shared/defaults';
import type {MemberProfile} from '../src/shared/types';

const cards:MemberProfile[]=[
  {id:'a',code:'01',executor:'claude',name:'小雪',persona:'沉稳。\n# 不是标题\n简洁。',voice:'中文：轻声。\nEnglish: soft.',userTitle:'老师',talkativeness:'chatty',motto:'先想清楚',routine:{morning:'泡茶'},quirks:['转笔'],relations:[{memberId:'b',text:'老同事'}],createdAt:'2026-01-01T00:00:00.000Z'},
  {id:'b',code:'02',executor:'codex',name:'阿木',createdAt:'2026-01-02T00:00:00.000Z'},
];
function setup(){const root=mkdtempSync(path.join(process.env.TEMP!,'persona-file-'));return {root,engine:new Engine(root,()=>{},()=>{},undefined,{maintenanceOnly:true})};}

test('persona file round-trips every field and writes relations by code',()=>{
  const text=renderPersonaFile(cards);
  assert.match(text,/- 编号：01/);assert.match(text,/- 02（阿木）：老同事/);
  const [first,second]=parsePersonaFile(text);
  assert.equal(first.id,'01');assert.equal(first.fields.persona,'沉稳。\n# 不是标题\n简洁。');
  assert.equal(first.fields.talkativeness,'chatty');assert.equal(first.fields.userTitle,'老师');
  assert.deepEqual(first.fields.routine,{morning:'泡茶'});assert.deepEqual(first.fields.quirks,['转笔']);
  assert.deepEqual(first.fields.relations,[{ref:'02',name:'阿木',text:'老同事'}]);
  assert.equal(first.fields.voice,'中文：轻声。\nEnglish: soft.');assert.ok(text.indexOf('### 语气与小动作')>text.indexOf('### 人设与说话风格'));
  assert.equal(second.id,'02');assert.equal(second.fields.persona,'');assert.equal(second.fields.voice,'');assert.deepEqual(second.fields.quirks,[]);
});

test('member instructions carry the code, voice, habits and code-led relations',()=>{
  const text=personaInstructions(cards[0],{name:'你'} as any,cards);
  assert.match(text,/「小雪」（编号 01）/);assert.match(text,/语气、小动作与口癖（你自己可以微调）：\n中文：轻声。\nEnglish: soft\./);
  assert.match(text,/小习惯：转笔/);assert.match(text,/- 02（阿木）：老同事/);
  assert.doesNotMatch(personaInstructions(cards[1],{name:'你'} as any,cards),/语气、小动作|小习惯/);
});

test('outside edits reach the card, relations follow codes through a rename, older name-only files still read',async()=>{
  const {root,engine}=setup();
  try{
    for(const card of cards)engine.store.put('members',card.id,card);
    (engine as any).personaFile.export();
    const file=(await engine.invoke('persona.file.read',{}) as {path:string}).path;
    writeFileSync(file,readFileSync(file,'utf8').replace('沉稳。','热情。'),'utf8');
    assert.match((await engine.invoke('persona.file.read',{}) as {content:string}).content,/热情。/);
    assert.match(engine.store.get<MemberProfile>('members','a')!.persona!,/^热情。/);
    // The name in brackets is stale after a rename; the code still finds the member.
    writeFileSync(file,readFileSync(file,'utf8').replace('- 02（阿木）：老同事','- 02（旧名字）：新同事'),'utf8');
    await engine.invoke('persona.file.read',{});
    assert.deepEqual(engine.store.get<MemberProfile>('members','a')!.relations,[{memberId:'b',text:'新同事'}]);
    // A file written before codes: 编号 holds the internal id and relations use names.
    writeFileSync(file,readFileSync(file,'utf8').replace('- 编号：01','- 编号：a').replace('- 02（旧名字）：新同事','- 阿木：老朋友'),'utf8');
    await engine.invoke('persona.file.read',{});
    assert.deepEqual(engine.store.get<MemberProfile>('members','a')!.relations,[{memberId:'b',text:'老朋友'}]);
    await engine.invoke('persona.file.apply',{members:[{id:'b',motto:'收到',quirks:['喝茶'],relations:[{ref:'a',text:'前辈'}]}]});
    const b=engine.store.get<MemberProfile>('members','b')!;
    assert.equal(b.motto,'收到');assert.deepEqual(b.quirks,['喝茶']);assert.deepEqual(b.relations,[{memberId:'a',text:'前辈'}]);
    assert.match(readFileSync(file,'utf8'),/一句话介绍：收到/);
    await assert.rejects(()=>engine.invoke('catalog.uninstall',{id:'claude'}),/没有可卸载/);
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('codes are assigned in join order, never reused automatically, and edited together without duplicates',async()=>{
  const {root,engine}=setup();
  try{
    const add=async(name:string)=>engine.invoke('team.save',{member:{name,executor:'codex'}}) as Promise<MemberProfile>;
    const first=await add('甲'),second=await add('乙');
    assert.equal(first.code,'01');assert.equal(second.code,'02');
    await engine.invoke('team.delete',{id:second.id});
    assert.equal((await add('丙')).code,'03','a deleted member keeps its number');
    await assert.rejects(()=>engine.invoke('team.codes',{codes:{[first.id]:'03'}}),/编号都是「03」/);
    await assert.rejects(()=>engine.invoke('team.codes',{codes:{[first.id]:'0 1'}}),/无效/);
    await engine.invoke('team.codes',{codes:{[first.id]:'10'}});
    assert.equal(engine.store.get<MemberProfile>('members',first.id)!.code,'10');
    // A card save from the editor never changes the code.
    await engine.invoke('team.save',{member:{...engine.store.get<MemberProfile>('members',first.id),name:'甲改名',code:'99'}});
    assert.equal(engine.store.get<MemberProfile>('members',first.id)!.code,'10');
    assert.match(readFileSync(path.join(root,'人物设定.md'),'utf8'),/- 编号：10/);
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('swapping codes imports an outside edit first, so file sections never land on the member taking the old code',async()=>{
  const {root,engine}=setup();
  try{
    const add=async(name:string)=>engine.invoke('team.save',{member:{name,executor:'codex'}}) as Promise<MemberProfile>;
    const first=await add('甲'),second=await add('乙');
    const file=path.join(root,'人物设定.md');
    // Edited outside the app while the codes are still 01 and 02.
    writeFileSync(file,readFileSync(file,'utf8').replace(/(## 甲[\s\S]*?- 一句话介绍：)[^\n]*/,'$1甲的介绍'),'utf8');
    if(!/甲的介绍/.test(readFileSync(file,'utf8')))writeFileSync(file,readFileSync(file,'utf8').replace(/## 甲\n/,'## 甲\n\n- 一句话介绍：甲的介绍\n'),'utf8');
    await engine.invoke('team.codes',{codes:{[first.id]:'02',[second.id]:'01'}});
    assert.equal(engine.store.get<MemberProfile>('members',first.id)!.code,'02');
    assert.equal(engine.store.get<MemberProfile>('members',second.id)!.code,'01');
    assert.equal(engine.store.get<MemberProfile>('members',first.id)!.motto,'甲的介绍');
    assert.notEqual(engine.store.get<MemberProfile>('members',second.id)!.motto,'甲的介绍');
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('saving codes can carry the move into persona text, swapping numbers in one pass',async()=>{
  const {root,engine}=setup();
  try{
    const add=async(name:string,persona:string)=>engine.invoke('team.save',{member:{name,executor:'codex',persona}}) as Promise<MemberProfile>;
    const a=await add('甲','身份=01；妹妹是 02，搭档 03。早上 8:02 起床，2026-11-02 入职。');
    const b=await add('乙','身份=02；姐姐 01。02 与 03 是并列主力。');
    const c=await add('丙','身份=03；常找 02 帮忙。');
    await engine.invoke('team.save',{member:{...engine.store.get<MemberProfile>('members',c.id),quirks:['数到 03 就睡着'],routine:{morning:'和 02 对进度'}}});
    // Without the option only the codes move.
    let result:any=await engine.invoke('team.codes',{codes:{[b.id]:'03',[c.id]:'02'}});
    assert.equal(result.rewritten,0);assert.match(engine.store.get<MemberProfile>('members',b.id)!.persona!,/身份=02/);
    await engine.invoke('team.codes',{codes:{[b.id]:'02',[c.id]:'03'}});
    result=await engine.invoke('team.codes',{codes:{[b.id]:'03',[c.id]:'02'},rewriteText:true});
    const card=(id:string)=>engine.store.get<MemberProfile>('members',id)!;
    assert.equal(card(a.id).persona,'身份=01；妹妹是 03，搭档 02。早上 8:02 起床，2026-11-02 入职。');
    assert.equal(card(b.id).persona,'身份=03；姐姐 01。03 与 02 是并列主力。');
    assert.equal(card(c.id).persona,'身份=02；常找 03 帮忙。');
    assert.deepEqual(card(c.id).quirks,['数到 02 就睡着']);assert.equal(card(c.id).routine?.morning,'和 03 对进度');
    assert.equal(card(b.id).code,'03');assert.equal(card(c.id).code,'02');
    assert.equal(result.rewritten,9);
    assert.match(readFileSync(path.join(root,'人物设定.md'),'utf8'),/身份=03；姐姐 01。03 与 02 是并列主力。/);
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

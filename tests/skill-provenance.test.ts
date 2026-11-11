import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {Extensions} from '../src/backend/extensions';
import {MessageSkills} from '../src/backend/message-skills';
import {NativeSkills} from '../src/backend/native-skills';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';
import {runtimeDiagnostics} from '../src/backend/runtime-diagnostics';
import {skillHash,SkillImports} from '../src/backend/skill-provenance';
import {nativePackageFiles} from '../src/backend/native-plugins';
import type {Run} from '../src/shared/types';

const body=(text:string)=>`---\nname: source-test\ndescription: Provenance fixture.\nversion: 1.0\n---\n${text}`;
test('common skill provenance explains same-name copies, freezes body and protects local edits during update',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'skill-provenance-'));
 try{const data=path.join(root,'data'),source=path.join(root,'source');mkdirSync(source);writeFileSync(path.join(source,'SKILL.md'),body('original common'));
  const extensions=new Extensions(data),preview=extensions.preview('skill',source);extensions.install(preview.token);
  const installed=path.join(data,'extensions/skills/source-test'),nativeFile=path.join(root,'native.md');writeFileSync(nativeFile,body('different native'));
  const native={list:async()=>({items:[{id:'native',name:'source-test',enabled:true,path:path.join(source,'SKILL.md')}],warnings:[]})};
  const service=new MessageSkills(extensions,native as any),frozen=(await service.resolve([{source:'common',id:'source-test'}],['codex']))[0];
  assert.equal(frozen.contentHash,skillHash(body('original common')));assert.equal(frozen.provenance?.importedFrom,source);assert.equal(frozen.provenance?.version,'1.0');
  writeFileSync(path.join(source,'SKILL.md'),body('updated upstream'));
  const update=extensions.preview('skill',source);assert.equal(update.update?.locallyModified,false);extensions.install(update.token);
  assert.match(readFileSync(path.join(installed,'SKILL.md'),'utf8'),/updated upstream/);assert.match(frozen.content,/original common/);
  const archived=path.join(data,'extensions/skill-history');assert.ok(readdirSync(archived).some(id=>readFileSync(path.join(archived,id,'SKILL.md'),'utf8').includes('original common')));
  writeFileSync(path.join(installed,'SKILL.md'),body('my local edit'));const modified=extensions.preview('skill',source);assert.equal(modified.update?.locallyModified,true);assert.throws(()=>extensions.install(modified.token),/保留原副本/);assert.match(readFileSync(path.join(installed,'SKILL.md'),'utf8'),/my local edit/);
  const list=await service.list(['codex']);assert.equal(list.items.filter(s=>s.name==='source-test').length,2);assert.equal(list.items.find(s=>s.source==='common'&&s.id==='source-test')?.provenance?.locallyModified,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('native update preview detects supporting-file changes and refuses to overwrite the user copy',async()=>{
 const root=mkdtempSync(path.join(process.env.TEMP!,'native-skill-update-'));
 try{const skills=new NativeSkills(root,()=>DEFAULT_SETTINGS,{} as any),source=path.join(root,'source');mkdirSync(source);writeFileSync(path.join(source,'SKILL.md'),body('upstream'));
  const installed=path.join(skills.directory('codex'),'source-test');mkdirSync(installed,{recursive:true});writeFileSync(path.join(installed,'SKILL.md'),body('upstream'));
  new SkillImports(path.join(root,'native-skills/imports.json')).record('codex:source-test',source,nativePackageFiles(installed).hash,body('upstream'),'导入基线');
  assert.equal(skills.preview('codex',source).update?.locallyModified,false);
  writeFileSync(path.join(installed,'support.md'),'my local support-file edit');
  const p=skills.preview('codex',source);assert.equal(p.update?.locallyModified,true);await assert.rejects(skills.change('install',{token:p.token}),/保留原副本/);assert.equal(readFileSync(path.join(installed,'support.md'),'utf8'),'my local support-file edit');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('runtime evidence separates selected, attached, read and native loading from Hook state',()=>{
 const run:Run={id:'r',sessionId:'s',projectId:'p',provider:'codex',revision:1,status:'ended',delivery:'confirmed',input:'task',bootId:'test',createdAt:'2026-10-29T03:00:00Z',updatedAt:'2026-10-29T03:00:00Z',messageSkills:[{source:'common',id:'skill',name:'skill',path:'D:/skill/SKILL.md',content:'frozen',contentHash:skillHash('frozen')}],skillAttachments:[{source:'common',id:'skill',name:'skill',contentHash:skillHash('frozen'),attachedAt:'2026-10-29T03:00:00Z'}]};
 const report=runtimeDiagnostics({provider:'codex',run,settings:DEFAULT_SETTINGS,events:[]}),rows=report.sections.find(s=>s.id==='skill-evidence')!.items;
 assert.equal(rows.find(r=>r.id==='selected:common:skill')?.state,'observed');assert.equal(rows.find(r=>r.id==='attached')?.state,'observed');assert.equal(rows.find(r=>r.id==='native-skill-loading')?.state,'unknown');assert.equal(report.sections.find(s=>s.id==='hooks')!.items.some(i=>i.id==='contract'&&i.state==='unknown'),true);
});

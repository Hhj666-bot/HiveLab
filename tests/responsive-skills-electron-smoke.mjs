import assert from 'node:assert/strict';
import path from 'node:path';
import {_electron,expect} from '@playwright/test';
if(!process.env.HIVELAB_TEST_PROFILE)throw Error('Requires isolated profile');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const installed=process.env.HIVELAB_TEST_EXECUTABLE;
const app=await _electron.launch({executablePath:installed??path.resolve('node_modules/electron/dist/electron.exe'),args:installed?[]:[path.resolve('.')],env,timeout:30000});
try{
 const page=await app.firstWindow();await expect.poll(()=>page.evaluate(()=>window.hivelab.invoke('snapshot').then(s=>s.backendReady).catch(()=>false)),{timeout:25000}).toBe(true);
 const snapshot=await page.evaluate(()=>window.hivelab.invoke('snapshot'));assert.equal(snapshot.members.length,0);assert.ok(snapshot.dataDirectory.includes('.test-cache'));
 // Packaged dependencies intentionally omit the development-only Codex CLI.
 // Configure a test CLI explicitly in this signed-out profile, as daily profiles do.
 if(installed)await page.evaluate(async cli=>{const s=await window.hivelab.invoke('snapshot');await window.hivelab.invoke('settings.save',{settings:{...s.settings,paths:{...s.settings.paths,codex:cli}}});},path.resolve('node_modules/@openai/codex/bin/codex.js'));
 const common=await page.evaluate(()=>window.hivelab.invoke('messageSkills.list',{providers:[]}));assert.ok(common.items.some(s=>s.source==='common'&&s.id==='team-handoff'));
 await page.evaluate(()=>window.hivelab.invoke('messageSkills.note',{source:'common',id:'team-handoff',note:'我的交接工具'}));
 const annotated=await page.evaluate(()=>window.hivelab.invoke('messageSkills.list',{providers:[]}));assert.equal(annotated.items.find(s=>s.id==='team-handoff').note,'我的交接工具');
 const native=await page.evaluate(()=>window.hivelab.invoke('messageSkills.list',{providers:['codex']}));assert.ok(Array.isArray(native.items));assert.ok(native.items.some(s=>s.source==='codex'),'actual native Skills API, no model call: '+JSON.stringify(native.warnings));
 await page.getByRole('button',{name:'收起侧栏',exact:true}).click();await expect.poll(()=>page.locator('.sidebar').evaluate(n=>n.getBoundingClientRect().width)).toBe(68);await expect(page.getByRole('button',{name:'隐藏侧栏',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'展开侧栏',exact:true})).toBeVisible();await page.getByRole('button',{name:'展开侧栏',exact:true}).click();
 await page.getByRole('button',{name:'茶歇室',exact:true}).click();await page.getByRole('button',{name:'选择本次 Skills'}).click();await expect(page.getByRole('checkbox',{name:'使用技能 team-handoff'})).toBeVisible();await page.getByRole('checkbox',{name:'使用技能 team-handoff'}).check();await page.getByRole('button',{name:'完成选择'}).click();await expect(page.getByRole('button',{name:'选择本次 Skills'})).toContainText('1 项');
 console.log('PASS: '+(installed?'installed D-drive':'built-source')+' Electron startup; isolated data; actual main/worker messageSkills RPC, personal description persistence and native skill discovery; sidebar controls; composer manual skill selection; no model calls.');
}finally{await app.close();}

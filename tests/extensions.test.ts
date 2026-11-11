import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Extensions} from '../src/backend/extensions';
import {CONTROL_TOOLS,AgentControl} from '../src/backend/agent-control';
import {Engine} from '../src/backend/engine';
import type {Snapshot} from '../src/shared/types';
const temp=()=>mkdtempSync(path.join(process.env.TEMP!,'hivelab-extensions-'));
const bundled=path.resolve('build/extensions');
test('nine bundled plugins preserve tools; disabling removes discovery, persists and keeps data',()=>{
 const root=temp();try{const host=new Extensions(root,bundled);assert.equal(host.list().items.filter(i=>i.kind==='plugin').length,9);assert.equal(host.skillIndex()[0].id,'team-handoff');
 for(const tool of CONTROL_TOOLS)assert.ok(host.tools(CONTROL_TOOLS).some(t=>t.name===tool.name),tool.name);
 host.toggle('plugin','hivelab-computer',false);assert.ok(!host.tools(CONTROL_TOOLS).some(t=>t.name==='computer'));assert.equal(new Extensions(root,bundled).enabled('hivelab-computer'),false);assert.throws(()=>host.remove('plugin','hivelab-files'),/内置/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('skill installs a copy, loads supporting text, rejects traversal and remains removable',()=>{
 const root=temp(),source=path.join(root,'source');mkdirSync(path.join(source,'references'),{recursive:true});writeFileSync(path.join(source,'SKILL.md'),'---\nname: test-skill\ndescription: >\n  整理目标，\n  只在点名时使用。\n---\n正文');writeFileSync(path.join(source,'references','note.md'),'# 参考');
 try{const host=new Extensions(path.join(root,'data'),bundled),preview=host.preview('skill',source);host.install(preview.token);writeFileSync(path.join(source,'references','note.md'),'original changed');assert.equal((host.skillTool('read_skill_asset',{id:'test-skill',path:'references/note.md'}) as any).content,'# 参考');assert.match((host.skillTool('read_skill',{id:'test-skill'}) as any).content,/正文/);assert.throws(()=>host.skillTool('read_skill_asset',{id:'test-skill',path:'../../state.json'}),/越界/);host.toggle('skill','test-skill',false);assert.throws(()=>host.skillTool('read_skill',{id:'test-skill'}),/停用/);host.remove('skill','test-skill');assert.ok(!host.list().items.some(i=>i.id==='test-skill'));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('install preview binds package contents and rejects incompatible manifests',()=>{
 const root=temp(),source=path.join(root,'source');mkdirSync(source);writeFileSync(path.join(source,'SKILL.md'),'---\nname: test-skill\ndescription: test\n---\noriginal');try{const host=new Extensions(path.join(root,'data'),bundled),preview=host.preview('skill',source);writeFileSync(path.join(source,'SKILL.md'),'---\nname: test-skill\ndescription: test\n---\nchanged');assert.throws(()=>host.install(preview.token),/发生变化/);writeFileSync(path.join(source,'hivelab-plugin.json'),JSON.stringify({apiVersion:999}));assert.throws(()=>host.preview('plugin',source),/不兼容/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('external plugin executes through protected process with namespaced tools and no control credential env',async()=>{
 const root=temp(),source=path.join(root,'source');mkdirSync(source);writeFileSync(path.join(source,'hivelab-plugin.json'),JSON.stringify({apiVersion:1,id:'sample-tool',name:'示例',version:'1',description:'test',entry:'index.mjs',tools:[{name:'hello',description:'test'}]}));writeFileSync(path.join(source,'index.mjs'),"let input='';for await(const s of process.stdin)input+=s;const r=JSON.parse(input);console.log(JSON.stringify({result:{name:r.arguments.name,secret:process.env.HIVELAB_CONTROL_TOKEN??null}}));");
 try{const host=new Extensions(path.join(root,'data'),bundled),preview=host.preview('plugin',source);host.install(preview.token);const tool=host.list().items.find(i=>i.id==='sample-tool')!.tools![0];assert.ok(tool.startsWith('ext_')&&tool.length<=64);const result=await host.callExternal(tool,{name:'老大'},{sessionId:'s',runId:'r'});assert.deepEqual(result,{name:'老大',secret:null});host.toggle('plugin','sample-tool',false);await assert.rejects(host.callExternal(tool,{}, {sessionId:'s',runId:'r'}),/不可用/);host.close();
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('MCP bridge discovery and calls honor plugin disable instead of relying on UI alone',async()=>{
 const root=temp(),host=new Extensions(root,bundled),server=new AgentControl(()=>true,async()=>({ok:true}),()=>host.tools(CONTROL_TOOLS));
 try{const env=await server.credentials('s'),request=(name:string)=>fetch(env.HIVELAB_CONTROL_URL,{method:'POST',headers:{Authorization:'Bearer '+env.HIVELAB_CONTROL_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({name})});let result=await (await request('list')).json() as any;assert.ok(result.tools.some((t:any)=>t.name==='computer'));host.toggle('plugin','hivelab-computer',false);result=await(await request('list')).json();assert.ok(!result.tools.some((t:any)=>t.name==='computer'));assert.equal((await request('computer')).status,400);
 }finally{server.close();host.close();rmSync(root,{recursive:true,force:true});}
});
test('engine exposes extensions, gates disabled feature APIs and injects skill index into native task context',async()=>{
 const root=temp();let persona='',release:()=>void=()=>{};const held=new Promise<void>(resolve=>release=resolve);
 const engine=new Engine(root,()=>{},()=>{},id=>({async probe(){return {id,name:id,available:true,auth:'subscription',capabilities:{cancel:'native',streaming:true,write:true,history:true,images:true}} as any;},async start(ctx){persona=ctx.persona??'';await held;ctx.emit('message','测试完成',{source:'assistant'});return {summary:'测试完成'};},async stop(){release();}}),{maintenanceOnly:true});
 try{assert.equal((await engine.invoke('extensions.list') as any).apiVersion,1);await engine.invoke('extensions.toggle',{kind:'plugin',id:'hivelab-usage',enabled:false});await assert.rejects(engine.invoke('provider.tokenActivity'),/停用/);assert.equal((engine.snapshot() as Snapshot).extensionFeatures?.tokenActivity,false);
 engine.store.put('members','sol',{id:'sol',executor:'codex',name:'Sol',color:'#339966',motto:''});await engine.probe('codex');await engine.invoke('desk.open',{memberId:'sol'});await engine.invoke('desk.topic',{memberId:'sol'});await engine.invoke('room.send',{roomId:'desk:sol',text:'测试技能索引'});for(let i=0;i<250&&!persona;i++)await new Promise(r=>setTimeout(r,10));assert.match(persona,/team-handoff/);assert.match(persona,/read_skill_asset/);await assert.rejects(engine.invoke('extensions.toggle',{kind:'plugin',id:'hivelab-computer',enabled:false}),/成员正在工作/);release();
 }finally{release();await engine.close();rmSync(root,{recursive:true,force:true});}
});
test('agent compatibility is enforced in discovery, HTTP calls and direct execution',async()=>{
 const root=temp(),source=path.join(root,'source');mkdirSync(source);writeFileSync(path.join(source,'hivelab-plugin.json'),JSON.stringify({apiVersion:1,id:'codex-only',name:'Codex 专用工具桥',version:'1',description:'test',entry:'index.mjs',agents:['codex'],tools:[{name:'hello',description:'test'}]}));writeFileSync(path.join(source,'index.mjs'),"for await(const _ of process.stdin){};console.log(JSON.stringify({result:'ok'}));");
 const host=new Extensions(path.join(root,'data'),bundled),preview=host.preview('plugin',source);host.install(preview.token);const tool=host.list().items.find(i=>i.id==='codex-only')!.tools![0];
 const server=new AgentControl(()=>true,(id,name,args)=>host.callExternal(name,args,{sessionId:id,runId:'r',provider:id}),id=>host.tools(CONTROL_TOOLS,id));
 try{assert.ok(host.tools(CONTROL_TOOLS,'codex').some(t=>t.name===tool));assert.ok(!host.tools(CONTROL_TOOLS,'dsh').some(t=>t.name===tool));await assert.rejects(host.callExternal(tool,{}, {sessionId:'s',runId:'r',provider:'claude'}),/不兼容/);
 const env=await server.credentials('dsh'),response=await fetch(env.HIVELAB_CONTROL_URL,{method:'POST',headers:{Authorization:'Bearer '+env.HIVELAB_CONTROL_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({name:tool})});assert.equal(response.status,400);assert.equal((host.list().items.find(i=>i.id==='codex-only')!).agents?.[0],'codex');
 }finally{server.close();host.close();rmSync(root,{recursive:true,force:true});}
});
test('native plugin packages are recognized but never installed as HiveLab tools',()=>{
 const root=temp(),host=new Extensions(path.join(root,'data'),bundled);
 try{for(const [relative,label] of [['.codex-plugin/plugin.json','Codex'],['.claude-plugin/plugin.json','Claude Code']]){const source=path.join(root,label.replace(/ /g,'-'));mkdirSync(path.dirname(path.join(source,relative)),{recursive:true});writeFileSync(path.join(source,relative),'{}');assert.throws(()=>host.preview('plugin',source),new RegExp(label+' 原生插件包'));}
 const source=path.join(root,'dsh');mkdirSync(source);writeFileSync(path.join(source,'package.json'),JSON.stringify({name:'sample',dependencies:{'@deepseek-ai/cordis':'1'}}));assert.throws(()=>host.preview('plugin',source),/DSH \/ Cordis 原生插件包/);
 }finally{host.close();rmSync(root,{recursive:true,force:true});}
});

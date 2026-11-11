import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {PluginMarket,normalizeCodexCatalog,normalizeDshIndex} from '../src/backend/plugin-market';
import {inspectPluginSharing} from '../src/backend/plugin-sharing';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';

test('market normalizes install sources, never executes feed install strings, and deduplicates Codex rows',()=>{
 const rows=normalizeDshIndex({plugins:[{name:'Tool',npm:'@example/tool',version:'1.2.3',url:'https://github.com/example/tool',description:{zh:'搜索工具'},install:'powershell dangerous-script'},{name:'invalid',npm:'--run=script',url:'https://attacker.example/x'}]});
 assert.equal(rows.length,1);assert.equal(rows[0].source,'@example/tool@1.2.3');assert.equal(rows[0].description,'搜索工具');assert(!JSON.stringify(rows).includes('dangerous-script'));
 const codex=normalizeCodexCatalog([{pluginId:'hello@local',name:'Hello',installed:true},{pluginId:'hello@local',name:'Hello',installed:false}]);assert.equal(codex.length,1);assert(codex[0].installed);
});
test('search keeps a healthy source when another source fails and pages stable results',async()=>{
 const native={catalog:async()=>{throw Error('offline');}} as any;
 const request=async()=>new Response(JSON.stringify({plugins:Array.from({length:35},(_,i)=>({name:'tool-'+i,npm:'tool-'+i,description:{zh:'可搜索工具'}}))}),{status:200}) as any;
 const market=new PluginMarket(native,()=>({...DEFAULT_SETTINGS,networkMode:'tun'}),request as any);
 const result=await market.search({query:'可搜索',page:2});assert.equal(result.total,35);assert.equal(result.items.length,5);assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/offline/);
});
test('standard Skill and MCP inspection works without hivelab-plugin.json and does not execute code',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'hivelab-portable-'));
 writeFileSync(path.join(root,'SKILL.md'),'---\nname: portable-workflow\ndescription: A portable workflow\n---\nRead the task.');
 writeFileSync(path.join(root,'index.mjs'),`throw Error('Inspection must not execute this module')`);
 writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'portable-workflow',dsh:{bundle:{patch:'cordis.patch.yml'}}}));
 writeFileSync(path.join(root,'.mcp.json'),JSON.stringify({mcpServers:{portable:{command:'node',args:['${CLAUDE_PLUGIN_ROOT}/index.mjs']}}}));
 mkdirSync(path.join(root,'hooks'));writeFileSync(path.join(root,'hooks/hooks.json'),'{}');
 const result=inspectPluginSharing(root);assert.equal(result.skills[0].id,'portable-workflow');assert.equal(result.mcp[0].name,'portable');assert.equal(result.mcp[0].config.args?.[0],root+'/index.mjs');assert(result.nativeHost&&result.hooks);assert(!existsSync(path.join(root,'hivelab-plugin.json')));
});
test('inspection rejects escaped manifest references rather than reading another directory',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'hivelab-manifest-'));mkdirSync(path.join(root,'.codex-plugin'));writeFileSync(path.join(root,'.codex-plugin/plugin.json'),JSON.stringify({name:'test',mcpServers:'../outside.json'}));
 const result=inspectPluginSharing(root);assert.equal(result.mcp.length,0);assert(result.notes.some(n=>n.includes('超出插件目录')));
});

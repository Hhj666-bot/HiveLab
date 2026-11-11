import {existsSync,readFileSync,readdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import type {SharingReport,McpServerConfig} from '../shared/plugin-market';
import {readSkillManifest} from './extensions';

/** Inspect data files only. No plugin module, hook, package script or MCP server is executed. */
export function inspectPluginSharing(root:string):SharingReport{
 const result:SharingReport={root,skills:[],mcp:[],nativeHost:false,hooks:false,notes:[]};
 const manifests:any[]=[];
 const read=(relative:string)=>{const file=path.resolve(root,relative),rel=path.relative(root,file);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('清单路径超出插件目录');if(!existsSync(file))return undefined;if(lstatSync(file).isSymbolicLink()||lstatSync(file).size>1024*1024)throw Error('清单必须是 1 MB 内的真实文件');return JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));};
 for(const file of ['plugin.json','.codex-plugin/plugin.json','.claude-plugin/plugin.json','package.json'])try{const value=read(file);if(value)manifests.push(value);}catch(e){result.notes.push(file+'：'+(e as Error).message);}
 const folders=new Set<string>(['.','skills']);
 for(const manifest of manifests)for(const dir of typeof manifest.skills==='string'?[manifest.skills]:Array.isArray(manifest.skills)?manifest.skills:[])if(typeof dir==='string')folders.add(dir);
 const seenSkills=new Set<string>();
 const addSkill=(dir:string)=>{const resolved=path.resolve(root,dir),rel=path.relative(root,resolved);if(rel.startsWith('..')||path.isAbsolute(rel)||!existsSync(path.join(resolved,'SKILL.md')))return;try{const s=readSkillManifest(resolved);if(!seenSkills.has(s.id)){seenSkills.add(s.id);result.skills.push({...s,directory:resolved});}}catch(e){result.notes.push('Skill：'+(e as Error).message);}};
 for(const dir of folders){addSkill(dir);const full=path.resolve(root,dir),rel=path.relative(root,full);if(rel.startsWith('..')||path.isAbsolute(rel)||!existsSync(full)||!lstatSync(full).isDirectory())continue;if(dir==='.')continue;for(const entry of readdirSync(full,{withFileTypes:true}).slice(0,200))if(entry.isDirectory()&&!entry.name.startsWith('.'))addSkill(path.join(dir,entry.name));}
 const expand=(value:any):any=>typeof value==='string'?value.replace(/\$\{(?:CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|PLUGIN_ROOT)\}/g,root):Array.isArray(value)?value.map(expand):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,expand(v)])):value;
 const seenMcp=new Set<string>();
 const addServers=(value:any)=>{if(!value||typeof value!=='object'||Array.isArray(value))return;for(const [name,raw] of Object.entries(value)){if(seenMcp.has(name)||!raw||typeof raw!=='object')continue;const config=expand(raw) as McpServerConfig;if(typeof config.command!=='string'&&typeof config.url!=='string')continue;if(config.command?.startsWith('./'))config.command=path.resolve(root,config.command);config.cwd??=root;seenMcp.add(name);result.mcp.push({name,config});}};
 for(const file of ['.mcp.json','mcp.json'])try{const value=read(file);addServers(value?.mcpServers??value?.servers);}catch(e){result.notes.push(file+'：'+(e as Error).message);}
 for(const m of manifests){if(typeof m.mcpServers==='string')try{const value=read(m.mcpServers);addServers(value?.mcpServers??value);}catch(e){result.notes.push('MCP：'+(e as Error).message);}else addServers(m.mcpServers);if(m.hooks)result.hooks=true;if(m.dsh||m.cordis)result.nativeHost=true;}
 result.hooks ||= existsSync(path.join(root,'hooks','hooks.json'));
 if(result.skills.length)result.notes.push('Skill 可作为共享工作方法导入；命令、图片和文件能力仍取决于当前成员的工具与权限。');
 if(result.mcp.length)result.notes.push('发现标准 MCP 配置；须经信任确认并实际连接读取 tools/list 后才会作为共用工具启用。');
 if(result.nativeHost)result.notes.push('检测到 DSH / Cordis 宿主依赖；不能把其 JavaScript 模块直接当作独立共用工具执行。若插件另有 MCP 导出，可通过 MCP 接入。');
 if(result.hooks)result.notes.push('Hooks 保留在原生宿主，不会跨执行端自动执行。');
 if(!result.skills.length&&!result.mcp.length)result.notes.push('未发现标准 Skill 或 MCP 入口；保留原生安装能力，共用工具需要宿主接口适配。');
 return result;
}

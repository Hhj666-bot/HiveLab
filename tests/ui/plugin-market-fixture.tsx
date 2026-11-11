import React from 'react';
import {createRoot} from 'react-dom/client';
import {ExtensionSettings} from '../../src/renderer/extensions';
import '../../src/renderer/styles.css';
import '../../src/renderer/extensions.css';
const jobs:any[]=[],calls:any[]=[],connections:any[]=[];(window as any).marketCalls=calls;
const invoke:any=async(method:string,p:any={})=>{
 calls.push({method,params:p});
 if(method==='pluginMarket.search'){const items=[{id:'codex:formatter@fixture',ecosystem:'codex',name:'Formatter',description:'Format source files',sourceLabel:'Fixture Codex market',source:'formatter@fixture',sourceKind:'catalog',installed:false},{id:'dsh:memory-fixture',ecosystem:'dsh',name:'Memory fixture',description:'Memory tool',sourceLabel:'DSH 社区索引',source:'memory-fixture@1.0.0',sourceKind:'npm',installed:false}].filter(i=>(!p.ecosystem||p.ecosystem==='all'||i.ecosystem===p.ecosystem)&&i.name.toLowerCase().includes((p.query??'').toLowerCase()));return {items,total:items.length,warnings:[],sources:[{name:'Codex 原生市场',count:1},{name:'DSH 社区索引',count:1}]};}
 if(method==='nativePlugins.providers')return ['codex','dsh'].map(id=>({id,name:id==='codex'?'Codex':'DSH',ecosystem:id,available:true,home:'D:/fixture/'+id,detail:'Fixture'}));
 if(method==='nativePlugins.list')return {provider:p.provider,items:[]};
 if(method==='nativePlugins.jobs')return structuredClone(jobs);
 if(method==='nativePlugins.start'){const job={id:String(calls.length),provider:p.provider,action:p.action,status:'running',startedAt:'now',updatedAt:'now',log:''};jobs.push(job);setTimeout(()=>{Object.assign(job,{status:'done',preview:{token:'fixture-token',provider:p.provider,source:p.source,ecosystem:p.provider,files:2,bytes:100,choices:[{id:p.action==='inspect'?'source':'formatter@fixture',name:'Fixture source'}],note:'Fixture preview',...(p.action==='inspect'?{sharing:{skills:[{id:'portable',name:'portable',description:'A standard workflow',directory:'D:/fixture'}],mcp:[],nativeHost:false,hooks:false,notes:['标准 Skill 入口已识别。']}}:{})}});},40);return structuredClone(job);}
 if(method==='pluginBridge.importSkills')return {installed:['portable'],kept:[],errors:[]};
 if(method==='pluginBridge.list')return structuredClone(connections);
 if(method==='pluginBridge.add'){const id='mcp-fixture';connections.push({id,name:p.name,enabled:false,config:p.config,tools:[],envKeys:[],headerKeys:[]});return {id};}
 if(method==='pluginBridge.probe'){Object.assign(connections[0],{enabled:true,verifiedAt:'now',tools:[{name:'echo',description:'Echo value',inputSchema:{type:'object'}}]});return structuredClone(connections);}
 if(method==='extensions.list')return {items:[],directory:'D:/fixture',apiVersion:1};
 return {};
};
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:950,margin:'auto',padding:24}}><ExtensionSettings invoke={invoke}/></main>);

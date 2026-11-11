import React from 'react';
import {createRoot} from 'react-dom/client';
import {NativePluginSettings} from '../../src/renderer/native-plugins';
import type {NativeJob,NativePlugin} from '../../src/shared/native-plugins';
import '../../src/renderer/styles.css';
import '../../src/renderer/extensions.css';
const providers=['codex','claude','dsh'].map(id=>({id,name:{codex:'Codex',claude:'Claude Code',dsh:'DSH'}[id],ecosystem:id,available:true,home:'D:/isolated/'+id}));
const items:Record<string,NativePlugin[]>={codex:[],claude:[],dsh:[{id:'example-cordis',name:'example-cordis',enabled:null,kind:'dependency'}]},jobs:NativeJob[]=[],calls:any[]=[];(window as any).nativePluginCalls=calls;
const invoke:any=async(method:string,p:any={})=>{calls.push({method,params:p});
 if(method==='nativePlugins.providers')return providers;
 if(method==='nativePlugins.list')return {provider:p.provider,items:structuredClone(items[p.provider])};
 if(method==='nativePlugins.jobs')return structuredClone(jobs);
 if(method==='nativePlugins.pick')return 'D:/fixtures/native-example';
 if(method==='nativePlugins.start'){
  const now=new Date().toISOString(),job:NativeJob={id:String(calls.length),provider:p.provider,action:p.action,status:'running',startedAt:now,updatedAt:now,log:''};jobs.unshift(job);
  setTimeout(()=>{job.status='done';if(p.action==='prepare')job.preview={token:'test-preview',provider:p.provider,source:p.source,ecosystem:p.provider,files:2,bytes:500,choices:[{id:'example',name:'Example native plugin'}],note:'隔离界面测试'};
   else if(p.action==='install')items[p.provider].push({id:'example@local',name:'Example native plugin',enabled:true});
   else if(p.action==='uninstall')items[p.provider]=items[p.provider].filter(i=>i.id!==p.pluginId);
   else{const item=items[p.provider].find(i=>i.id===p.pluginId)!;item.enabled=p.action!=='disable';if(p.action==='configure')item.kind='plugin';}
  },80);return structuredClone(job);
 }
 if(method==='nativePlugins.cancel'){jobs.find(j=>j.id===p.id)!.status='cancelled';return {};}
 return {};
};
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:900,margin:'auto',padding:20}}><NativePluginSettings invoke={invoke}/></main>);

import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ModelPopover} from '../../src/renderer/interactions';
import {ApiModelPicker} from '../../src/renderer/api-model-picker';
import type {ModelOption,ProviderInfo,Session} from '../../src/shared/types';
import '../../src/renderer/styles.css';
const search=location.search;
const reported:ModelOption[]=[{id:'gpt-6.1-sol',label:'GPT-6.1 Sol',isDefault:true,efforts:['low','medium','high','xhigh','max'],defaultEffort:'medium',effortSource:'reported'},{id:'gpt-6.1-terra',label:'GPT-6.1 Terra',efforts:['low','medium','high'],defaultEffort:'medium',effortSource:'reported'}];
// Antigravity lists each model once per thinking level; GLM reports no levels at all.
const variants:ModelOption[]=[{id:'gemini-3.8-flash',label:'Gemini 3.8 Flash',isDefault:true,efforts:[]},...['High','Medium','Low'].map(level=>({id:'gemini-4-argon-'+level.toLowerCase(),label:`Gemini 4 Argon (${level})`,efforts:[]})),...['High','Low'].map(level=>({id:'gemini-3.8-flash-'+level.toLowerCase(),label:`Gemini 3.8 Flash (${level})`,efforts:[]}))];
const glm:ModelOption[]=[{id:'glm-5.3-flash',label:'GLM-5.3-Flash（视觉）',isDefault:true,efforts:['off','on'],defaultEffort:'on'},{id:'glm-5.3',label:'GLM-5.3（纯文本）',efforts:['off','on'],defaultEffort:'on'}];
const flat:ModelOption[]=[{id:'glm-5.3-flash',label:'GLM-5.3-Flash（视觉）',isDefault:true,efforts:[]},{id:'glm-5.3',label:'GLM-5.3（纯文本）',efforts:[]}];
const info={id:'codex',name:'Codex',available:true,auth:'subscription',runtimeReady:true,model:'gpt-6.1-sol',configuration:{model:!search.includes('fixed'),effort:'reported'},
 modelOptions:search.includes('glm')?glm:search.includes('variants')?variants:search.includes('flat')?flat:reported} as unknown as ProviderInfo;
const saves:any[]=[],opened:string[]=[],reads:string[]=[];(window as any).effortSaves=saves;(window as any).settingsOpened=opened;(window as any).listReads=reads;
// The service lists one model the program did not report.
const listModels=async()=>{reads.push('popover');return {models:['gpt-6.1-sol','gpt-6.1-luna']};};
const loadConnection=async()=>{reads.push('connection');await new Promise(resolve=>setTimeout(resolve,150));return {models:['qwen-max','qwen-plus','qwen3-coder-plus']};};
const session={id:'topic',provider:'codex',...(search.includes('variants')?{model:'gemini-4-argon-high'}:search.includes('flat')||search.includes('glm')?{}:{effort:'high'})} as Session;
function Fixture(){
 const [open,setOpen]=useState<DOMRect>(),[connectionModel,setConnectionModel]=useState('');
 (window as any).connectionModel=connectionModel;
 const invoke:any=async(method:string)=>{if(method==='provider.config')return info;throw Error('Unexpected request: '+method);};
 return <div style={{padding:40,paddingTop:420,display:'flex',gap:60,alignItems:'flex-start'}}>
  <div><button className="button secondary" onClick={event=>setOpen(event.currentTarget.getBoundingClientRect())}>打开模型选择</button>
   {open&&<ModelPopover invoke={invoke} listModels={search.includes('served')?listModels:search.includes('glm')?async()=>({models:['glm-5.3','glm-4.6']}):undefined} anchor={open} session={session} info={info} defaults={{}} onSettings={()=>{opened.push('connection');}} onClose={()=>setOpen(undefined)} onSave={change=>{saves.push(change);}}/>}</div>
  <section className="provider-settings" aria-label="连接设置" style={{width:360,marginTop:-380,marginLeft:260}}><ApiModelPicker label="模型" value={connectionModel} onChange={setConnectionModel} load={loadConnection} placeholder="选择模型（必填）"/></section>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

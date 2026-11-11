import type {MemberProfile} from '../../src/shared/types';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SettingsModal} from '../../src/renderer/settings';
import {TeamProvider,makeTeam} from '../../src/renderer/members';
import {DEFAULT_SETTINGS,DEFAULT_PROFILE} from '../../src/shared/defaults';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';
import '../../src/renderer/liquid-glass.css';
document.documentElement.dataset.liquidGlass='true';
const initial:MemberProfile[]=[{id:'astra',code:'01',name:'Astra',executor:'codex',color:'#579879',persona:'身份=01；妹妹是 02，搭档 03。'},{id:'sol',code:'02',name:'Sol',executor:'codex',color:'#7959a1',persona:'身份=02；姐姐 01。早上 8:02 起床。'},{id:'glm',code:'03',name:'GLM',executor:'codex',color:'#a15959'}];
const calls:any[]=[];(window as any).settingsCalls=calls;
let setMembers:(m:MemberProfile[])=>void=()=>{};let current=initial;
const content=()=>'# 人物设定\n'+current.map(m=>`## ${m.name}\n- 编号：${m.code}\n`).join('\n');
const invoke:any=async(method:string,params:any)=>{calls.push({method,params});
  if(method==='persona.file.read')return {path:'D:/data/人物设定.md',content:content(),members:current.map(({id,name})=>({id,name}))};
  if(method==='team.codes'){current=current.map(m=>({...m,code:params.codes[m.id]}));setMembers(current);return {members:current.map(({id,code})=>({id,code})),rewritten:params.rewriteText?3:0};}
  if(method==='backup.list')return [];return {};};
(window as any).hivelab={invoke,onEvent:()=>()=>{}};
function Fixture(){const [members,set]=useState(initial);setMembers=set;const snapshot:any={members,removedMembers:[],settings:DEFAULT_SETTINGS,profile:DEFAULT_PROFILE,providers:[],executors:[],sessions:[],projects:[],runs:[],events:[],approvals:[],backendReady:true};
  return <TeamProvider value={makeTeam(members,[])}><SettingsModal snapshot={snapshot} invoke={invoke} notify={()=>{}} onClose={()=>{}} installs={{}} onInstall={()=>{}} theme="dark" onTheme={()=>{}} initialTab="personas"/></TeamProvider>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);

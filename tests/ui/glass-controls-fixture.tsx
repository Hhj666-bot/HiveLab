import {useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SettingsModal} from '../../src/renderer/settings';
import {MemberDesk} from '../../src/renderer/member-desk';
import {WorkspaceBackground} from '../../src/renderer/home-background';
import {MemberNoticeStack} from '../../src/renderer/member-notifications';
import {LiquidGlassAppearance} from '../../src/renderer/liquid-glass';
import {TeamProvider,TeamColors,makeTeam} from '../../src/renderer/members';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import {defaultBackground} from '../../src/shared/background';
import type {ProviderId,Snapshot} from '../../src/shared/types';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';
import '../../src/renderer/standee-home.css';
import '../../src/renderer/project-workbench.css';
const members=[{id:'sol',name:'Sol',executor:'codex',color:'#579879'},{id:'claudia',name:'Claudia',executor:'claude',color:'#d7947c'}] as any;
const team=makeTeam(members),at='2026-10-29T00:00:00Z';
const room={roomId:'desk:sol',sessionId:'s',currentThreadId:'topic',threads:[{id:'topic',title:'玻璃控件回归',createdAt:at}],messages:[{id:'answer',author:'sol',status:'done',at,runId:'r',text:'已完成。\n\n```sql\nSELECT member, role\nFROM members\nWHERE online = 1;\n```\n\n'+('这是一段用于检查展开和收起按钮的说明。'.repeat(40)),generatedImages:[{id:'00000000-0000-4000-8000-000000000001',name:'result.png',kind:'image',mime:'image/png',size:100}]}],hasMore:false,state:{active:false,mode:'chat'}} as any;
const calls:any[]=[];(window as any).controlCalls=calls;
function Fixture(){
 const [settings,setSettings]=useState(false),[removed,setRemoved]=useState<ProviderId[]>([]),[notices,setNotices]=useState(true),[theme,setTheme]=useState<any>('dark');
 const snapshot={settings:{...DEFAULT_SETTINGS,claudeAuthMode:'api',paths:{codex:'fixture-codex',claude:'fixture-claude'}},profile:DEFAULT_PROFILE,members,providers:['codex','claude'].filter(id=>!removed.includes(id as ProviderId)).map(id=>({id,name:id,path:'fixture-'+id,available:true,auth:'api',runtimeReady:true,model:'test-model',capabilities:{images:true,imageGeneration:true,steer:true},detail:'隔离界面测试'})),removedProviders:removed,executors:[],projects:[],sessions:[{id:'s',memberId:'sol',provider:'codex',roomId:'desk:sol',writeMode:true,workspaceKind:'original',model:'test-model',effort:'high'}],runs:[{id:'r',sessionId:'s',provider:'codex',status:'ended',createdAt:at,completedAt:at}],events:[],approvals:[],rooms:[{roomId:'desk:sol',memberId:'sol',sessionId:'s',currentThreadId:'topic',revision:1,state:room.state}],room,dataDirectory:'isolated-controls',backendReady:true} as unknown as Snapshot;
 const invoke:any=useCallback(async(method:string,params:any={})=>{
  calls.push({method,params});
  if(method==='room.get')return room;
  if(method==='background.get')return defaultBackground(params.page);
  if(method==='composer.draft.get')return null;
  if(method==='messageSkills.list')return {items:[],warnings:[]};
  if(method==='file.outputs')return [];
  if(method==='run.activity')return {events:[],hasMore:false};
  if(method==='catalog.list')return {items:[],node:{source:'bundled',version:'test'}};
  if(method==='team.memory'||method==='memory.list')return [];
  if(method==='executor.delete'){if((window as any).fixtureDeleteError)throw Error('当前任务正在运行，请先等待任务结束。');setRemoved(old=>[...old,params.id]);return {deleted:true};}
  return {saved:true};
 },[]);
 (window as any).hivelab={invoke,onEvent:()=>()=>{}};
 return <TeamProvider value={team}><TeamColors team={team}/><LiquidGlassAppearance/>
  <div style={{height:'100vh',display:'flex',background:'linear-gradient(120deg,#42676f,#bca786 55%,#3f725d)'}}><WorkspaceBackground page="desk:sol" title="Sol 的工位">
   <div style={{position:'absolute',top:8,right:20,zIndex:20}}><button aria-label="设置测试" className="icon-button" onClick={()=>setSettings(true)}>⚙</button></div>
   <MemberDesk memberId="sol" snapshot={snapshot} invoke={invoke} onSettings={()=>setSettings(true)}/>
   <div className="workspace-notice-slot" style={{top:60,right:16}}><MemberNoticeStack snapshot={snapshot} items={notices?[{notice:{id:'notice',kind:'completed',title:'Sol 完成了',body:'test',target:{sessionId:'s'}},open:()=>{}}]:[]} onDismiss={()=>setNotices(false)}/></div>
  </WorkspaceBackground></div>
  {settings&&<SettingsModal snapshot={snapshot} invoke={invoke} notify={()=>{}} installs={{}} onInstall={()=>{}} onClose={()=>setSettings(false)} initialTab="connections" theme={theme} onTheme={setTheme}/>}</TeamProvider>;
}
document.documentElement.dataset.theme='dark';
createRoot(document.getElementById('root')!).render(<Fixture/>);

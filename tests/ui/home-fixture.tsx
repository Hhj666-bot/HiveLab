import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StandeeHome} from '../../src/renderer/standee-home';
import {makeTeam,TeamProvider} from '../../src/renderer/members';
import {FilePreviewWorkspace} from '../../src/renderer/file-preview-panel';
import {FilePreviewProvider} from '../../src/renderer/preview-context';
import {AdaptiveTextAppearance,warmAdaptiveTextCache} from '../../src/renderer/adaptive-text';
import {LiquidGlassAppearance} from '../../src/renderer/liquid-glass';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import {defaultBackground} from '../../src/shared/background';
import {HomeBackground,useHomeBackground,WorkspaceBackground} from '../../src/renderer/home-background';
import type {Snapshot,MemberProfile} from '../../src/shared/types';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';

let count=5,hidden=false,config=JSON.parse(localStorage.getItem('test-background')??'null')??{};
const calls:any[]=[];(window as any).testCalls=calls;
const first=['Astra','Sol','DS','deepsleep','Gemini'];
const cards=Array.from({length:16},(_,index)=>({id:'member-'+index,executor:'codex',templateId:['codex','codex','dsh','dsh','claude'][index%5],name:first[index]??'成员 '+(index+1),color:'#539879',motto:'只在悬停时显示的口号',cardHidden:false})) as MemberProfile[];
if(new URLSearchParams(location.search).has('custom'))try{const overrides=await fetch('/.test-cache/home-art/members.json').then(r=>r.json());for(let i=0;i<5;i++)cards[i]={...cards[i],portrait:undefined,templateId:undefined,...overrides[i]};}catch{}
(window as any).hivelab={onEvent:()=>()=>{},invoke:async(method:string,params?:any)=>{
  if(method==='appearance.textCache.read')return {version:1,contexts:{}};if(method==='appearance.textCache.write')return {saved:true};if(method==='appearance.contrastFrame')return (window as any).fixtureContrastFrame?.()??null;
  calls.push({method,params});const key=params?.page??'home';let value=config[key]??defaultBackground(key);if(method==='background.get')return value;
  if(method==='background.save')value={...value,...params};
  if(method==='background.import')value={...value,mode:'media',media:{file:'00000000-0000-0000-0000-000000000001.png',name:'测试图片',kind:'image',source:'local'}};
  if(method==='background.wallpaper')throw Error('不支持应用程序壁纸，请选择图片、视频、场景或网页项目。');
  config[key]=value;localStorage.setItem('test-background',JSON.stringify(config));return value;
}};
function FixtureWallpaper({page}:{page:string}){return <HomeBackground preferences={useHomeBackground(page).preferences}/>;}
function Fixture(){
  const [n,setN]=useState(count),[hide,setHide]=useState(hidden),[opened,setOpened]=useState(''),[page,setPage]=useState('home');(window as any).setPage=setPage;
  (window as any).setMembers=(value:number,hideFirst=false)=>{setN(value);setHide(hideFirst);};
  const members=cards.slice(0,n).map((m,i)=>({...m,cardHidden:hide&&i===0})),team=makeTeam(members);
  if(new URLSearchParams(location.search).has('custom'))for(let i=0;i<team.members.length;i++)team.members[i].art='/.test-cache/home-art/'+i+'.png';
  const snapshot={settings:DEFAULT_SETTINGS,projects:[],sessions:[],runs:[],events:[],approvals:[],collaborations:[],dataDirectory:'isolated',backendReady:true,members,profile:DEFAULT_PROFILE,room:{messages:[],threads:[],state:{active:false,mode:'chat'}},providers:[{id:'codex',available:true,capabilities:{}}]} as unknown as Snapshot;
  const content=<div style={{position:'relative',isolation:'isolate',display:'flex',flex:1,minWidth:0}}><FixtureWallpaper page={page}/><WorkspaceBackground page={page} title={page}>{page==='home'?<StandeeHome snapshot={snapshot} team={team} moods={Object.fromEntries(members.map(m=>[m.id,'resting']))} invoke={(window as any).hivelab.invoke} onSettingsTab={()=>setOpened('管理人物')} onProject={()=>{}} onCard={id=>setOpened('人物详情 '+id)} onDesk={id=>setOpened('工位 '+id)} onCollaboration={()=>{}}/>:<main className='room'><div className='room-empty'><h2>{page}</h2><p>当前页面内容</p></div></main>}</WorkspaceBackground></div>;
  return <TeamProvider value={team}><div style={{height:'100vh',display:'flex',width:'100%'}}>{new URLSearchParams(location.search).has('toolbar')?<FilePreviewProvider><LiquidGlassAppearance/><AdaptiveTextAppearance/><FilePreviewWorkspace tools={<button aria-label="测试终端">终端</button>}>{content}</FilePreviewWorkspace></FilePreviewProvider>:content}</div><output style={{position:'fixed',top:0,right:0}}>{opened}</output></TeamProvider>;

}
void warmAdaptiveTextCache().finally(()=>createRoot(document.getElementById('root')!).render(<Fixture/>));

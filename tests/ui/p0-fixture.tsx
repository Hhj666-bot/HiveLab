import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RoomView} from '../../src/renderer/room';
import {makeTeam,TeamProvider} from '../../src/renderer/members';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import {HomeBackground} from '../../src/renderer/home-background';
import {defaultBackground,type BackgroundPreferences} from '../../src/shared/background';
import {LiquidGlassAppearance} from '../../src/renderer/liquid-glass';
import {AdaptiveTextAppearance} from '../../src/renderer/adaptive-text';
import type {Snapshot,RoomMessage,TimelineEvent} from '../../src/shared/types';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';
import '../../src/renderer/standee-home.css';

const member={id:'codex',name:'测试成员',executor:'codex' as const,color:'#438868'},team=makeTeam([member]);
const at='2026-10-26T00:00:00.000Z';
const messages:RoomMessage[]=Array.from({length:200},(_,i)=>({id:'saved-'+i,author:'codex',authorName:'测试成员',at,status:'done',text:i===100?'# 很长的回复\n\n```ts\nconst hidden = true;\n```\n'+('正文内容。'.repeat(200)):'已完成的回复 '+i+' **正文**'}));
messages.push({id:'live',author:'codex',at,status:'speaking',runId:'live-run',text:''});
const initial={settings:DEFAULT_SETTINGS,projects:[],sessions:[],runs:[{id:'live-run',sessionId:'session',provider:'codex',status:'running',delivery:'confirmed',createdAt:at}],events:[],approvals:[],collaborations:[],dataDirectory:'p0-isolated',backendReady:true,members:[member],profile:DEFAULT_PROFILE,room:{state:{active:true,mode:'chat',speaking:'codex'},messages,threads:[{id:'room-main',title:'性能回归',createdAt:at}],currentThreadId:'room-main'},providers:[{id:'codex',available:true,auth:'subscription',capabilities:{},detail:'test'}]} as unknown as Snapshot;
const calls:{method:string;params?:unknown}[]=[];(window as any).testCalls=calls;
const invoke=async(method:string,params?:unknown):Promise<any>=>{calls.push({method,params});return method==='run.activity'?{events:[],hasMore:false}:method==='run.files'?[]:method==='appearance.contrastFrame'?{dataUrl:(window as any).contrastFrame}:method==='messageSkills.list'?{items:[],warnings:[]}:{};};
(window as any).hivelab={invoke,onEvent:()=>()=>{}};
function Fixture(){
  const [snapshot,setSnapshot]=useState(initial);
  (window as any).p0Delta=(n:number)=>setSnapshot(previous=>({...previous,events:[{id:'delta',runId:'live-run',kind:'delta',text:'流式文本 '+n,at} as TimelineEvent]}));
  const p:BackgroundPreferences=defaultBackground('home');
  const contrastMode=new URLSearchParams(location.search).has('contrast');
  return <TeamProvider value={team}><LiquidGlassAppearance/>{contrastMode&&<AdaptiveTextAppearance/>}<div className="app-shell" style={{height:'100vh',display:'flex'}}><aside className="sidebar" style={{width:180}}>侧栏文字</aside><section className="page-background" style={{flex:1,display:'flex',position:'relative','--chat-reply-opacity':'0%','--chat-mine-opacity':'0%'} as React.CSSProperties}><HomeBackground preferences={p}/><RoomView snapshot={snapshot} invoke={invoke}/></section></div></TeamProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

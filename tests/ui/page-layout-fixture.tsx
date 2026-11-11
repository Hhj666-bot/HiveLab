import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PageTurn} from '../../src/renderer/app/page-turn';
import {FilePreviewProvider} from '../../src/renderer/preview-context';
import {FilePreviewWorkspace} from '../../src/renderer/file-preview-panel';
import {WorkspaceBackground} from '../../src/renderer/home-background';
import {RoomView} from '../../src/renderer/room';
import {TeamProvider,TeamColors,makeTeam} from '../../src/renderer/members';
import {LiquidGlassAppearance} from '../../src/renderer/liquid-glass';
import {DEFAULT_SETTINGS,DEFAULT_PROFILE} from '../../src/shared/defaults';
import {defaultBackground} from '../../src/shared/background';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';
import '../../src/renderer/standee-home.css';
const members=[{id:'a',name:'甲',executor:'codex',color:'#6698ce'},{id:'b',name:'乙',executor:'codex',color:'#579879'}] as any,team=makeTeam(members);
const rooms=Object.fromEntries(members.map((m:any)=>['desk:'+m.id,{currentThreadId:'topic-'+m.id,threads:[{id:'topic-'+m.id,title:'长对话',createdAt:'2026-11-01T00:00:00Z'}],hasMore:false,state:{active:false,mode:'chat'},messages:Array.from({length:32},(_,i)=>({id:m.id+'-'+i,author:i%2?m.id:'user',at:new Date(Date.UTC(2026,10,1,0,i)).toISOString(),status:'done',text:i%2?('这是长文本渲染测试，检查切换时的布局、滚动和消息留白。'.repeat(150)):'请检查文档 '+i}))}])) as any;
const invoke:any=async(method:string,p:any)=>{if(method==='room.get')return {...rooms[p.roomId],roomId:p.roomId};if(method==='background.get')return defaultBackground(p.page);if(method==='appearance.textCache.read')return {version:3,contexts:{}};if(method==='composer.draft.get')return null;if(method==='file.outputs')return [];return {};};
(window as any).hivelab={invoke,onEvent:()=>()=>{}};
const snapshot={settings:DEFAULT_SETTINGS,profile:DEFAULT_PROFILE,members,projects:[],backendReady:true,providers:[],sessions:[],runs:[],events:[],approvals:[],room:rooms['desk:a'],rooms:[],dataDirectory:'isolated-page-layout'} as any;
function Fixture(){
 const [id,setId]=useState('home');(window as any).switchDesk=setId;
 return <TeamProvider value={team}><TeamColors team={team}/><LiquidGlassAppearance/><div className="app-shell sidebar-hidden" style={{gridTemplateColumns:"minmax(0,1fr)"}}><div className="workspace" style={{height:'100vh'}}><FilePreviewWorkspace><PageTurn page={id} direction={id==='a'?-1:1}><WorkspaceBackground key={id} page={'desk:'+id} title={id}>{id==='home'?<div style={{flex:1}}>工作室首页</div>:<RoomView key={id} snapshot={snapshot} invoke={invoke} roomId={`desk:${id}`} personal={{kind:'desk',memberId:id,title:id,hint:'布局测试'}}/>}</WorkspaceBackground></PageTurn></FilePreviewWorkspace></div></div></TeamProvider>;
}
createRoot(document.getElementById('root')!).render(<FilePreviewProvider><Fixture/></FilePreviewProvider>);

import {SharedWallpaper} from '../../src/renderer/wallpaper-context';
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RoomView} from '../../src/renderer/room';
import {FilePreviewWorkspace} from '../../src/renderer/file-preview-panel';
import {FilePreviewProvider} from '../../src/renderer/preview-context';
import {AppearanceSettings} from '../../src/renderer/appearance-settings';
import {Modal} from '../../src/renderer/modals';
import {ApprovalCard} from '../../src/renderer/panels';
import {AttentionBubble} from '../../src/renderer/attention';
import {makeTeam,TeamProvider,TeamColors} from '../../src/renderer/members';
import {HomeBackground,WorkspaceBackground} from '../../src/renderer/home-background';
import {defaultBackground} from '../../src/shared/background';
import {LiquidGlassAppearance} from '../../src/renderer/liquid-glass';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import type {Approval,Snapshot} from '../../src/shared/types';
import type {AttentionSummary} from '../../src/shared/attention';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';
import '../../src/renderer/standee-home.css';

const member={id:'claude',name:'Claude',executor:'claude' as const,templateId:'claude' as const,color:'#d9692f'},team=makeTeam([member]),at='2026-10-28T08:00:00Z';
const approval:Approval={id:'permission',runId:'run',sessionId:'session',provider:'claude',type:'approval',state:'pending',title:'Claude 请求使用 Bash',detail:'需要读取项目文件。\n'+JSON.stringify({command:'Get-ChildItem src/renderer',description:'查看界面文件'},null,2),category:'command',createdAt:at,options:[{id:'allow',label:'允许这次'},{id:'deny',label:'拒绝这次'}]};
const room={roomId:'desk:claude',sessionId:'session',currentThreadId:'topic',threads:[{id:'topic',roomId:'desk:claude',title:'样式回归',createdAt:at}],messages:[{id:'reply',author:'claude',authorName:'Claude',at,status:'done',text:'这是一条用于对齐审批卡片的回复。'.repeat(80)}],hasMore:false,state:{active:false,mode:'chat'}};
const calls:any[]=[];(window as any).testCalls=calls;
const invoke:any=async(method:string,params:any)=>{calls.push({method,params});if(method==='background.get')return defaultBackground(params.page);if(method==='room.get')return room;if(method==='messageSkills.list')return {items:[],warnings:[]};if(method==='composer.draft.get')return null;return {};};
(window as any).hivelab={invoke,onEvent:()=>()=>{}};
const attention={total:1,items:[{id:'permission-item',kind:'approval',title:approval.title,detail:'等你确认操作',at,sessionId:'session',memberId:'claude',action:{view:'session',label:'打开对话'}}],counts:{approval:1},generatedAt:at} as AttentionSummary;
const snapshot={settings:DEFAULT_SETTINGS,profile:DEFAULT_PROFILE,members:[member],projects:[],sessions:[{id:'session',provider:'claude',memberId:'claude',roomId:'desk:claude',roomThreadId:'topic',writeMode:true}],runs:[],events:[],approvals:[approval],collaborations:[],dataDirectory:'approval-glass-isolated',backendReady:true,room,rooms:[{roomId:'desk:claude',sessionId:'session',currentThreadId:'topic',revision:1,state:room.state}],providers:[],attention} as unknown as Snapshot;
function Fixture(){
 const [page,setPage]=useState('desk:claude'),[settings,setSettings]=useState(false);
 useEffect(()=>{const open=()=>setSettings(true);window.addEventListener('hivelab:open-appearance',open);return()=>window.removeEventListener('hivelab:open-appearance',open);},[]);
 (window as any).fixtureAppearancePage=setPage;
 return <><LiquidGlassAppearance/><div className="app-shell" style={{position:'relative',isolation:'isolate',display:'flex',height:'100vh'}}>{<HomeBackground preferences={defaultBackground('home')}/>}<div className="workspace" style={{flex:1}}><SharedWallpaper.Provider value={true}><FilePreviewWorkspace ><WorkspaceBackground page={page} title="Claude 的工位"><RoomView snapshot={snapshot} invoke={invoke} roomId="desk:claude" personal={{kind:'desk',memberId:'claude',title:'Claude 的工位',hint:'隔离样式测试',dock:<div className="personal-approvals" aria-label="当前话题审批"><ApprovalCard approval={approval} member={team.get('claude')} invoke={invoke}/></div>}}/></WorkspaceBackground></FilePreviewWorkspace></SharedWallpaper.Provider></div></div><AttentionBubble page={page} summary={attention} onOpen={item=>{(window as any).openedAttention=item.id;}}/>{settings&&<Modal title="共享外观设置" onClose={()=>setSettings(false)} className="settings-modal"><div className="modal-body"><AppearanceSettings snapshot={snapshot} page={page} title="当前页面" theme="dark" onTheme={()=>{}}/></div></Modal>}</>;
}
createRoot(document.getElementById('root')!).render(<FilePreviewProvider><TeamProvider value={team}><TeamColors team={team}/><Fixture/></TeamProvider></FilePreviewProvider>);

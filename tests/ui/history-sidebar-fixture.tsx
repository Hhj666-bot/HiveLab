import {RoomView} from '../../src/renderer/room';
import {PageTurn} from '../../src/renderer/app/page-turn';
import {FilePreviewProvider} from '../../src/renderer/preview-context';
import {FilePreviewWorkspace} from '../../src/renderer/file-preview-panel';
import {WorkspaceBackground} from '../../src/renderer/home-background';
import {AdaptiveTextAppearance} from '../../src/renderer/adaptive-text';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppSidebar} from '../../src/renderer/app/AppSidebar';
import {StandeeHome} from '../../src/renderer/standee-home';
import {makeTeam,TeamColors,TeamProvider} from '../../src/renderer/members';
import {SidebarLayout} from '../../src/renderer/sidebar-layout';
import {AppearanceSettings} from '../../src/renderer/appearance-settings';
import {LiquidGlassAppearance} from '../../src/renderer/liquid-glass';
import {useThemeAccent} from '../../src/renderer/theme-accent';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import {defaultBackground} from '../../src/shared/background';
import type {MemberProfile,Snapshot} from '../../src/shared/types';
import '../../src/renderer/styles.css';
import '../../src/renderer/adaptive-text.css';
import '../../src/renderer/team.css';
const seed=[{id:'sol',name:'Sol',executor:'codex',templateId:'codex',color:'#579879',standeeOrder:0},{id:'astra',name:'Astra',executor:'codex',templateId:'codex',color:'#856fbb',standeeOrder:1},{id:'ds',name:'DS',executor:'dsh',templateId:'dsh',color:'#6698ce',standeeOrder:2}] as MemberProfile[];
const calls:any[]=[];(window as any).rosterCalls=calls;let dispatcher:any;
const invoke:any=async(method:string,p:any={})=>{calls.push({method,params:p});if(method==='room.get')return (window as any).historyRoom;if(method==='appearance.textCache.read')return {version:1,contexts:{}};if(method==='appearance.contrastFrame')return null;if(method==='messageSkills.list')return {items:[],warnings:[]};if(method==='composer.draft.get')return null;if(method==='background.get')return defaultBackground(p.page);if(method==='team.arrange')return dispatcher(p);if(method==='explorer.roots')return {roots:[]};return {};};
(window as any).hivelab={invoke,onEvent:()=>()=>{}};
function Fixture(){
 const [working,setWorking]=useState(false);(window as any).fixtureWorking=setWorking;
 const [projects,setProjects]=useState([{id:'one',name:'项目一',directory:'D:/fixture/one',createdAt:'2026-10-29T00:00:00Z'},{id:'two',name:'项目二',directory:'D:/fixture/two',createdAt:'2026-10-29T00:01:00Z'}]);(window as any).fixtureProjects=setProjects;const run={id:'run',sessionId:'sol-session',status:'running',provider:'codex',createdAt:'2026-10-29T00:00:00Z'};
 const [members,setMembers]=useState<MemberProfile[]>(()=>JSON.parse(localStorage.getItem('fixture.members')??'null')??seed),[view,setView]=useState('desk'),[deskMemberId,setDeskMemberId]=useState('sol'),[theme,setTheme]=useState<'light'|'dark'|'system'>('dark'),[settings,setSettings]=useState(false),[sidebarTab,setSidebarTab]=useState('work');
 dispatcher=({ids,scope}:any)=>setMembers(old=>{const field=scope==='sidebar'?'sidebarOrder':'standeeOrder',next=old.map(m=>ids.includes(m.id)?{...m,[field]:ids.indexOf(m.id)}:m);localStorage.setItem('fixture.members',JSON.stringify(next));return next;});
 (window as any).fixtureRoster=(value:MemberProfile[])=>{setMembers(value);localStorage.setItem('fixture.members',JSON.stringify(value));};(window as any).fixtureMembers=members;
 const team=makeTeam(members),accent=useThemeAccent(view==='desk'?team.get(deskMemberId)?.color:undefined),snapshot={members,settings:DEFAULT_SETTINGS,profile:DEFAULT_PROFILE,projects,runs:working?[run]:[],sessions:[{id:'sol-session',memberId:'sol',provider:'codex'}],events:[],approvals:[],providers:[],dataDirectory:'isolated-theme',backendReady:true,room:{messages:[],state:{active:false,mode:'chat'}}} as unknown as Snapshot;
 const noop=()=>{},openDesk=(id:string)=>{setDeskMemberId(id);setView('desk');};
 const controller={snapshot,loaded:true,projectId:'one',sessionId:'',setSessionId:noop,sidebarTab,setSidebarTab,setModal:noop,collapsedProjects:new Set(),setCollapsedProjects:noop,setQuotaOpen:noop,setActivityOpen:noop,setAutomationOpen:noop,view,setView,deskMemberId,memberToasts:[],probing:false,renaming:null,setRenaming:noop,refresh:noop,invoke,inviteTimer:{current:undefined},openProject:()=>setView('project'),openSettings:()=>setSettings(true),team,workProjects:projects,openDesk,allRunning:working?[run]:[],memberOfSession:new Map([['sol-session','sol']]),probe:noop,commitRename:noop,projectMenuItems:()=>[],openMenu:noop,memberStatus:(id:string)=>({mood:working&&id==='sol'?'working':'resting',text:working&&id==='sol'?'正在工作':'空闲'}),prepareMemberStop:noop,memberCard:null,closeMemberCard:noop,openMemberCard:noop,workspaceRoots:{roots:[],rootId:'',setRootId:noop,refresh:noop},openTerminal:noop} as any;
 return <TeamProvider value={team}><TeamColors team={team}/><LiquidGlassAppearance/><AdaptiveTextAppearance/><SidebarLayout><AppSidebar controller={controller}/><div className="workspace"><div style={{padding:14}}><button aria-label="主题外观" onClick={()=>setSettings(!settings)}>主题外观</button><button aria-label="立绘页面" onClick={()=>setView('work')}>主页</button><button aria-label="公共项目" onClick={()=>setView('project')}>项目</button><output data-accent={accent}>{view==='desk'?deskMemberId:view}</output></div>{settings?<div style={{overflow:'auto',padding:20}}><AppearanceSettings snapshot={snapshot} theme={theme} onTheme={value=>{setTheme(value);document.documentElement.dataset.theme=value;}} page={view==='desk'?'desk:'+deskMemberId:'home'} title="主题测试"/></div>:view==='work'?<StandeeHome team={team} snapshot={snapshot} moods={{}} invoke={invoke} onDesk={openDesk} onCard={noop} onSettingsTab={noop} onProject={noop} onCollaboration={noop}/>:<FilePreviewWorkspace><PageTurn page="history" direction={1}><WorkspaceBackground page="desk:sol" title="历史测试"><RoomView snapshot={snapshot} invoke={invoke} roomId="desk:sol" personal={{kind:'desk',memberId:'sol',title:'历史测试',hint:'只读副本'}}/></WorkspaceBackground></PageTurn></FilePreviewWorkspace>}</div></SidebarLayout></TeamProvider>;
}
createRoot(document.getElementById('root')!).render(<FilePreviewProvider><Fixture/></FilePreviewProvider>);


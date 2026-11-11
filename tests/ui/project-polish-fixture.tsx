import {SharedWallpaper} from '../../src/renderer/wallpaper-context';
import React,{useLayoutEffect,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Terminal} from 'lucide-react';
import {FilePreviewProvider} from '../../src/renderer/preview-context';
import {FilePreviewWorkspace} from '../../src/renderer/file-preview-panel';
import {PageTurn} from '../../src/renderer/app/page-turn';
import {useAppearancePreferences} from '../../src/renderer/appearance-preferences';
import {WorkspaceBackground,HomeBackground,useHomeBackground} from '../../src/renderer/home-background';
import {ProjectRoom} from '../../src/renderer/project-room';
import {RoomView} from '../../src/renderer/room';
import {TeamProvider,TeamColors,makeTeam} from '../../src/renderer/members';
import {LiquidGlassAppearance} from '../../src/renderer/liquid-glass';
import {AdaptiveTextAppearance,warmAdaptiveTextCache,useAdaptiveTextPage} from '../../src/renderer/adaptive-text';
import {DEFAULT_SETTINGS,DEFAULT_PROFILE} from '../../src/shared/defaults';
import {defaultBackground} from '../../src/shared/background';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';
import '../../src/renderer/project-room.css';
import '../../src/renderer/project-workbench.css';
import '../../src/renderer/workspace-tools.css';
import '../../src/renderer/sidebar-layout.css';
import {useDrawer} from '../../src/renderer/app/use-drawer';
import {useSidebarSpring} from '../../src/renderer/sidebar-spring';
function MotionTerminal({shown}:{shown:boolean}){
 const ref=useRef<HTMLElement>(null),mounted=useDrawer(shown,'y',()=>({panel:ref.current,workspace:ref.current?.closest<HTMLElement>('.file-preview-workspace')??null}));
 return mounted?<section ref={ref} className="workspace-terminal" style={{height:260,flexShrink:0}}><header>终端动画检查</header></section>:null;
}

import '../../src/renderer/standee-home.css';
const at='2026-10-28T00:00:00Z',names=['Astra','Sol','DS','deepsleep','Gemini','Kimiiii','GLM','Claude','GLmmm'];
const members=names.map((name,i)=>({id:'m'+i,name,executor:'codex',color:i%2?'#579879':'#856fbb',motto:''})) as any,team=makeTeam(members);
const project={id:'p',name:'测试项目',directory:'D:/Work/test',memberIds:members.map((m:any)=>m.id),createdAt:at} as any;
const filename='Codex桌面连接与策略拦截诊断-文件名称很长时的布局检查.md';
const room={currentThreadId:'topic',threads:[{id:'topic',title:'界面布局检查',createdAt:at}],hasMore:false,state:{active:false,mode:'chat'},messages:[{id:'file-message',author:'user',at,text:'这是检查报告',attachments:[{id:'long-file',name:filename,kind:'text',mime:'text/markdown',size:3891}]}]};
const snapshot={settings:DEFAULT_SETTINGS,profile:DEFAULT_PROFILE,projects:[project],members,backendReady:true,providers:[{id:'codex',available:true,auth:'subscription',capabilities:{}}],sessions:[],runs:[],events:[],approvals:[],projectFlows:[],room,rooms:[{roomId:'project:p',revision:1,state:room.state}],dataDirectory:'isolated-project-polish'} as any;
const flow={projectId:'p',revision:0,flow:null,plan:null,plans:[],rounds:[],tasks:[],submissions:[],reviews:[],integrations:[],acceptances:[],decisions:[],jointReviews:[],blockedOperations:[],overview:{working:0,remaining:0,needsUser:0},allowedActions:[]};
const transitionFixture=new URLSearchParams(location.search).has('transition');
const acceptanceFixture=new URLSearchParams(location.search).has('acceptance');
if(acceptanceFixture){
 const actions=['projectFlow.round.accept','projectFlow.round.requestChanges','projectFlow.round.requestCheck'].map(name=>({name,enabled:true}));
 Object.assign(flow,{flow:{id:'f',projectId:'p',status:'active',revision:7,dispatchMode:'paused',leadMemberId:'m2',memberIds:['m2','m3'],reviewLevel:'low',blockedReasons:[]},
  overview:{working:0,remaining:0,needsUser:1,stage:{label:'待验收',leadMemberId:'m2'}},
  allowedActions:[{name:'projectFlow.resume',enabled:true}],
  rounds:[{id:'r1',projectId:'p',flowId:'f',index:0,title:'新建 hello.md',status:'awaiting_acceptance',revision:3,requiresUserAcceptance:true,integrationId:'i1',integrationFixCount:0,allowedActions:actions,
   report:{summary:Array.from({length:16},(_,i)=>`第 ${i+1} 项：已完成文件整理与检查，报告滚动时底部操作不遮挡正文。`).join('\n\n'),deliverables:['hello.md'],remainingIssues:[],validationSummary:'文件已检查。'}}],
  integrations:[{id:'i1',roundId:'r1',status:'ready',reviewLevel:'low',conflicts:[],findings:[]}],
  decisions:[{id:'d1',status:'answered',title:'本轮已汇总，选择复核或验收'}]});
 (room.messages as any)=[{id:'decision1',author:'m2',at,text:'【决策】本轮已汇总，选择复核或验收。',status:'completed',flowDecision:{decisionId:'d1',status:'open'}},{id:'decision2',author:'user',at,text:'【决策】现在查看成品。',flowDecision:{decisionId:'d1',status:'answered'}}];
}
const calls:any[]=[];(window as any).testCalls=calls;
const invoke:any=async(method:string,params:any)=>{calls.push({method,params});if(method==='appearance.textCache.read')return {version:3,contexts:{}};if(method==='appearance.contrastFrame')return (window as any).fixtureContrastFrame?.()??null;if(method==='background.get'){if(transitionFixture&&params.page==='project:p')await new Promise(resolve=>setTimeout(resolve,80));return {...defaultBackground(params.page),...(transitionFixture&&params.page==='project:p'?{mode:'studio'}:{})};}if(method==='projectFlow.get'){if(transitionFixture)await new Promise(resolve=>setTimeout(resolve,450));return flow;}if(method==='projectFlow.timeline')return {items:[],total:0,hasMore:false};if(method==='room.get')return {...room,roomId:params.roomId};if(method==='composer.draft.get')return null;if(method==='run.activity')return {events:[],hasMore:false};if(method==='file.outputs')return [];if(method==='file.preview')return {name:filename,kind:'markdown',content:'# 文件预览\n\n附件预览正常。'};return {saved:true};};
(window as any).hivelab={invoke,onEvent:()=>()=>{}};
const reports=Array.from({length:32},(_,i)=>({id:i<9?'m'+i:'past'+i,name:names[i%9]+(i<9?'':' 历史成员 '+i),count:i,historical:i>=9}));
function Fixture(){
 const shell=useRef<HTMLDivElement>(null),[sidebar,setSidebar]=useState<'hidden'|'icons'|'expanded'>(new URLSearchParams(location.search).has('motion')?'icons':'hidden'),sidebarMode=useSidebarSpring(sidebar,260,shell),[terminal,setTerminal]=useState(false);(window as any).fixtureSidebar=setSidebar;(window as any).fixtureTerminal=setTerminal;
 const [theme,setTheme]=useState('dark'),[desk,setDesk]=useState(transitionFixture);(window as any).fixtureTheme=setTheme;(window as any).fixtureDesk=setDesk;
 const pageId=desk?'desk:m1':'project:p',background=useHomeBackground(pageId),appearance=useAppearancePreferences();(window as any).fixtureMenuTransparency=appearance.setMenuTransparency;
 useLayoutEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);useAdaptiveTextPage(desk?'desk:m1':'project:p',theme,desk?'#579879':undefined);
 return <TeamProvider value={team}><TeamColors team={team}/><LiquidGlassAppearance/><AdaptiveTextAppearance/><div ref={shell} className={"app-shell sidebar-"+sidebarMode} style={{'--sidebar-width':'260px'} as React.CSSProperties}>{sidebar!=='hidden'&&<aside className="sidebar"><div className="brand">HiveLab</div><div className="sidebar-section-scroll">项目</div></aside>}{transitionFixture?<HomeBackground preferences={background.preferences} settled={!!background.fetched} direction={desk?-1:1}/>:<div className="home-background" data-contrast-background={'fixture:'+theme} style={{position:'absolute',inset:0,zIndex:-2,background:'linear-gradient(110deg,#102721 5%,#c6d2c9 70%,#f8fafc)'}}/>}<div className="workspace"><SharedWallpaper.Provider value={true}><FilePreviewWorkspace terminal={<MotionTerminal shown={terminal}/>} headerTransparency={60} tools={<button className="button quiet small" aria-label="终端"><Terminal size={15}/></button>}><PageTurn page={pageId} backgroundReady={!transitionFixture||!!background.fetched} direction={desk?-1:1}><WorkspaceBackground page={desk?'desk:m1':'project:p'} title={desk?'Sol 的工位':'测试项目'}>{desk?<RoomView snapshot={snapshot} invoke={invoke} roomId="desk:m1" personal={{kind:'desk',memberId:'m1',title:'Sol 工位',hint:'D:/Work'}}/>:<ProjectRoom project={project} snapshot={snapshot} invoke={invoke} reports={reports} onOpenReport={id=>(window as any).lastReport=id} onOpenSession={()=>{}}/>}</WorkspaceBackground></PageTurn></FilePreviewWorkspace></SharedWallpaper.Provider></div></div></TeamProvider>;
}
void warmAdaptiveTextCache().finally(()=>createRoot(document.getElementById('root')!).render(<FilePreviewProvider><Fixture/></FilePreviewProvider>));

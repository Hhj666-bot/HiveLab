import React from 'react';
import {createRoot} from 'react-dom/client';
import {StandeeHome} from '../../src/renderer/standee-home';
import {SidebarLayout} from '../../src/renderer/sidebar-layout';
import {FilePreviewWorkspace} from '../../src/renderer/file-preview-panel';
import {FilePreviewProvider} from '../../src/renderer/preview-context';
import {HomeBackground,useHomeBackground,WorkspaceBackground,warmHomeBackground} from '../../src/renderer/home-background';
import {TeamProvider,makeTeam} from '../../src/renderer/members';
import {AttentionBubble} from '../../src/renderer/attention';
import {LiquidGlassAppearance} from '../../src/renderer/liquid-glass';
import {AdaptiveTextAppearance,warmAdaptiveTextCache,useAdaptiveTextPage} from '../../src/renderer/adaptive-text';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import type {Snapshot} from '../../src/shared/types';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';

const members=[{id:'sol',name:'Sol',executor:'codex',color:'#579879'},{id:'astra',name:'Astra',executor:'codex',color:'#856fbb'}] as any;
const team=makeTeam(members),snapshot={settings:DEFAULT_SETTINGS,profile:DEFAULT_PROFILE,members,projects:[],providers:[{id:'codex',available:true,auth:'subscription',capabilities:{}}],sessions:[],runs:[],events:[],approvals:[],backendReady:true} as unknown as Snapshot;
const invoke:any=async(method:string,params:any)=>{
  const fixture=window as any;
  if(method==='appearance.textCache.read')return fixture.fixtureReadTextCache();
  if(method==='appearance.textCache.write')return fixture.fixtureWriteTextCache(params);
  if(method==='appearance.contrastFrame')return fixture.fixtureContrastFrame();
  if(method==='background.get')return fixture.fixtureBackground(params.page);
  return {saved:true};
};
(window as any).hivelab={invoke,onEvent:()=>()=>{}};
(window as any).fixtureDismiss=()=>{document.getElementById('hivelab-startup')!.hidden=true;};
document.documentElement.dataset.theme='dark';
function Fixture(){
  useAdaptiveTextPage('home','dark');const bg=useHomeBackground();
  return <TeamProvider value={team}><SidebarLayout transparency={100} wallpaper={<HomeBackground preferences={bg.preferences}/>}><aside className="sidebar"><span className="brand-text">HiveLab</span><div className="sidebar-footer">设置与连接</div></aside><div className="workspace"><FilePreviewWorkspace headerTransparency={bg.preferences.headerTransparency} previewTransparency={bg.preferences.previewTransparency} terminalTransparency={bg.preferences.terminalTransparency} ><WorkspaceBackground page="home" title="首页"><StandeeHome team={team} snapshot={snapshot} moods={{}} invoke={invoke} onSettingsTab={()=>{}} onProject={()=>{}} onCard={()=>{}} onDesk={()=>{}} onCollaboration={()=>{}}/></WorkspaceBackground></FilePreviewWorkspace></div><AttentionBubble onOpen={()=>{}}/></SidebarLayout></TeamProvider>;
}
void Promise.all([warmAdaptiveTextCache(),warmHomeBackground()]).finally(()=>createRoot(document.getElementById('root')!).render(<React.StrictMode><LiquidGlassAppearance/><AdaptiveTextAppearance/><FilePreviewProvider><Fixture/></FilePreviewProvider></React.StrictMode>));

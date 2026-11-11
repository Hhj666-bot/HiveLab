import React,{useCallback,useEffect,useState} from 'react';
import {Terminal} from 'lucide-react';
import {createRoot} from 'react-dom/client';
import {FilePreviewWorkspace} from '../../src/renderer/file-preview-panel';
import {FilePreviewProvider,useFilePreview} from '../../src/renderer/preview-context';
import {SidebarLayout} from '../../src/renderer/sidebar-layout';
import {MemberNoticeStack,useFocusedMemberNotices,type ForegroundNotice} from '../../src/renderer/member-notifications';
import {AppearanceSettings} from '../../src/renderer/appearance-settings';
import {LiquidGlassAppearance} from '../../src/renderer/liquid-glass';
import {AdaptiveTextAppearance,warmAdaptiveTextCache} from '../../src/renderer/adaptive-text';
import {Modal} from '../../src/renderer/modals';
import {Markdown} from '../../src/renderer/Markdown';
import {Avatar,makeTeam,TeamProvider,TeamColors} from '../../src/renderer/members';
import {WorkspaceBackground} from '../../src/renderer/home-background';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import {defaultBackground} from '../../src/shared/background';
import {memberSignal,type MemberNotice} from '../../src/shared/member-notifications';
import type {Snapshot} from '../../src/shared/types';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';

const members=[{id:'sol',name:'Sol',executor:'codex',templateId:'codex',color:'#579879',motto:''},{id:'astra',name:'Astra',executor:'codex',color:'#856fbb',motto:''}] as any;
const team=makeTeam(members),member=team.get('sol')!;
const notice=(id:string,kind:MemberNotice['kind'],title:string):MemberNotice=>({id,kind,title,body:'检查代码、文件与当前任务的保存结果。',target:{sessionId:'session'}});
const paragraph='普通正文含有跨行代码胶囊：`40% + var(--bg-deep) + var(--chat-reply-opacity) + var(--workspace-header-opacity)`。胶囊旁边的文字应保持清晰。';
const invoke:any=async(method:string,p:any)=>{
 if(method==='appearance.textCache.read')return {version:1,contexts:{}};
 if(method==='appearance.textCache.write')return {saved:true};
 if(method==='appearance.contrastFrame')return (window as any).fixtureContrastFrame?.()??null;
 if(method==='background.get')return defaultBackground(p.page);
 if(method==='explorer.read')return {name:p.path,content:'const field = "test";',encoding:'utf8',version:'v1'};
 if(method==='file.preview'){
  const name=p.name??p.path;
  if(name.endsWith('.html'))return {name,kind:'html',content:'<h1>HTML preview</h1>',previewUrl:'data:text/html,'+encodeURIComponent('<h1>HTML preview</h1>')};
  if(name==='large.png')return {name,kind:'image',dataUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><rect width="1600" height="1600" fill="#579879"/></svg>')};
  if(name.endsWith('.png'))return {name,kind:'image',dataUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#579879"/></svg>')};
  if(name.endsWith('.ts'))return {name,kind:'text',language:'ts',content:'const field = "test";'};
  return {name,kind:'markdown',content:'# Preview zoom\n\nReadable text and **formatting**.'};
 }
 return {saved:true};
};
(window as any).hivelab={invoke,onEvent:()=>()=>{}};
function Fixture(){
 const [items,setItems]=useState<ForegroundNotice[]>([]),[unread,setUnread]=useState(false),[settings,setSettings]=useState(false),[toast,setToast]=useState<{id:number;text:string;error?:boolean}|null>(null),[opened,setOpened]=useState(0),[theme,setTheme]=useState<'light'|'dark'|'system'>('dark'),[phase,setPhase]=useState('idle'),[focused,setFocused]=useState(false),preview=useFilePreview()!;
 const snapshot={settings:DEFAULT_SETTINGS,profile:DEFAULT_PROFILE,members,providers:[],projects:[],sessions:[{id:'session',memberId:'sol',provider:'codex',title:'保存结果',roomId:'desk:sol',roomThreadId:'topic'}],runs:phase==='idle'?[]:[{id:'run',sessionId:'session',status:phase==='working'?'running':phase==='question'?'waiting_user':'ended',...(phase==='done'?{completedAt:'done'}:{})}],events:[],approvals:[],room:{state:{active:false}},rooms:[{roomId:'desk:sol',memberId:'sol',sessionId:'session',currentThreadId:'topic',revision:1,unread,state:{active:phase==='working',mode:'chat'}}],dataDirectory:'isolated-notice',backendReady:true} as unknown as Snapshot;
 const dismiss=useCallback((id:string)=>setItems(items=>items.filter(item=>item.notice.id!==id)),[]),read=useCallback((ids:string[])=>{setItems(items=>items.filter(item=>!ids.includes(item.notice.id)));setUnread(false);},[]),focus=useCallback(()=>focused?{roomId:'desk:sol' as const,threadId:'topic'}:undefined,[focused]);
 useFocusedMemberNotices(snapshot,items,focus,read);
 useEffect(()=>{const open=()=>setSettings(true);window.addEventListener('hivelab:open-appearance',open);return()=>window.removeEventListener('hivelab:open-appearance',open);},[]);
 useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
 (window as any).fixtureNotify=()=>{setFocused(false);setUnread(true);setPhase('done');const open=()=>{setOpened(value=>value+1);setFocused(true);};setItems([{notice:notice('done','completed','Sol 完成了'),open},{notice:notice('question','question','Sol 在等你回应'),open}]);};
 (window as any).fixtureReadSignal=()=>setUnread(false);(window as any).fixturePhase=(value:string)=>{setPhase(value);setUnread(value==='done');};(window as any).fixtureFocus=()=>setFocused(true);(window as any).fixtureToast=()=>setToast({id:1,text:'设置已保存'});(window as any).fixtureClearToast=()=>setToast(null);(window as any).fixtureOpened=opened;
 (window as any).fixtureOpen=(name:string,source='workspace')=>preview.open({source:source as any,id:'session',path:name,name},invoke);
 const signal=memberSignal(snapshot,'sol',items.map(item=>item.notice));
 return <TeamProvider value={team}><TeamColors team={team}/><LiquidGlassAppearance/><AdaptiveTextAppearance/><SidebarLayout wallpaper={<div style={{position:'absolute',inset:0,zIndex:-2,background:'linear-gradient(135deg,#124934,#426eae 50%,#af536c)'}}/>}><aside className="sidebar"><div className="team-roster"><div className="roster-with-desk member-sol" data-member-signal={signal}>{signal!=='idle'&&<span className="roster-signal" aria-hidden="true"/>}<button type="button" className="roster-row glass-content-action" aria-label="Sol 的工位" onClick={()=>setFocused(true)}><span className="member-signal-avatar"><Avatar member={member} size={28} signal={signal} mood={phase==='working'?'working':phase==='question'?'waiting':'resting'}/></span><span className="roster-text"><strong>Sol</strong><small>当前任务</small></span></button></div></div></aside><div className="workspace"><FilePreviewWorkspace notifications={<MemberNoticeStack snapshot={snapshot} items={items} onDismiss={dismiss} toast={toast}/>} tools={<button type="button" className="button quiet small" aria-label="终端" title="终端"><Terminal size={15}/></button>} ><WorkspaceBackground page="desk:sol" title="Sol 的工位"><main className="room personal-room member-sol" style={{padding:30}}>{members.map((member:any)=><div key={member.id} className={'room-line member-'+member.id} style={{width:560,maxWidth:'100%'}}><div className="room-bubble" style={{width:'100%'}}><Markdown text={paragraph}/></div></div>)}</main></WorkspaceBackground></FilePreviewWorkspace></div>{settings&&<Modal title="外观设置" onClose={()=>setSettings(false)} className="settings-modal"><div className="modal-body"><AppearanceSettings snapshot={snapshot} theme={theme} onTheme={setTheme} page="desk:sol" title="Sol 的工位"/></div></Modal>}</SidebarLayout></TeamProvider>;
}
void warmAdaptiveTextCache().finally(()=>createRoot(document.getElementById('root')!).render(<FilePreviewProvider><Fixture/></FilePreviewProvider>));

import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SidebarLayout} from '../../src/renderer/sidebar-layout';
import {StandeeHome} from '../../src/renderer/standee-home';
import {RoomView} from '../../src/renderer/room';
import {makeTeam,TeamProvider,Avatar} from '../../src/renderer/members';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import {defaultBackground} from '../../src/shared/background';
import type {Snapshot} from '../../src/shared/types';
import {HYPERFRAMES_MEMBERS} from '../../src/shared/message-skills';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';
const members=['Astra','Sol','DS','deepsleep','Gemini','Kimi','GLM','Claude'].map((name,i)=>({id:'m'+i,name,executor:i<2?'codex':'dsh',templateId:['codex','codex','dsh','dsh','gemini','claude','claude','claude'][i],color:'#579879',motto:'测试',height:i===1?145:165}));
const choices=[{source:'codex',id:'humanizer',name:'Humanizer',description:'Improve natural language',enabled:true},{source:'dsh',id:'coding',name:'DSH Coding',description:'Code tasks',enabled:null},{source:'common',id:'handoff',name:'Team handoff',description:'Prepare a handoff',enabled:true}];
if(new URLSearchParams(location.search).has('groups')){
 choices.push(...[...HYPERFRAMES_MEMBERS].map(name=>({source:'common',id:name,name,description:'OFFICIAL_LONG_DESCRIPTION '+name+' '+('Detailed official instructions. '.repeat(30)),enabled:true,group:{id:'common:family:hyperframes',name:'HyperFrames'}})));
 choices.push(...['hyperframes','hyperframes-core'].map(name=>({source:'codex',id:'native-'+name,name,description:'Native HyperFrames',enabled:true,group:{id:'codex:family:hyperframes',name:'HyperFrames'}})));
 choices.push(...Array.from({length:12},(_,i)=>({source:'common',id:'extra-'+i,name:'Utility '+i,description:'Long official utility introduction. '.repeat(20),enabled:true})));
}
const calls:any[]=[];(window as any).testCalls=calls;
function Fixture(){
 const [home,setHome]=useState(true),[messages,setMessages]=useState<any[]>([]),[thread,setThread]=useState('topic');(window as any).showHome=()=>setHome(true);(window as any).showChat=()=>setHome(false);(window as any).changeTopic=()=>setThread('another');
 const invoke:any=async(method:string,p:any)=>{calls.push({method,params:p});if(method==='background.get')return defaultBackground(p.page);if(method==='messageSkills.list'){const notes=JSON.parse(localStorage.getItem('fixture-skill-notes')??'{}');return {items:choices.map(c=>({...c,note:notes[c.source+':'+c.id]??''})),warnings:[]};}if(method==='messageSkills.note'){const notes=JSON.parse(localStorage.getItem('fixture-skill-notes')??'{}'),note=p.note.trim();notes[p.source+':'+p.id]=note;localStorage.setItem('fixture-skill-notes',JSON.stringify(notes));return {note};}if(method==='composer.draft.get')return null;if(method==='room.send'){setMessages(old=>[...old,{id:String(old.length),author:'user',text:p.text,skills:p.skills.map((s:any)=>choices.find(c=>c.id===s.id)),at:new Date().toISOString()}]);return {delivery:'prepared'};}return {saved:true};};
 (window as any).hivelab={invoke,onEvent:()=>()=>{}};
 const team=makeTeam(members as any),snapshot={settings:DEFAULT_SETTINGS,members,profile:DEFAULT_PROFILE,backendReady:true,dataDirectory:'responsive-fixture',projects:[],sessions:[],runs:[],events:[],approvals:[],collaborations:[],room:{currentThreadId:thread,threads:[{id:thread,title:'测试话题',createdAt:''}],hasMore:false,state:{active:false,mode:'chat'},messages},providers:[{id:'codex',available:true,auth:'subscription',capabilities:{}},{id:'dsh',available:true,auth:'account',capabilities:{}}]} as unknown as Snapshot;
 return <TeamProvider value={team}><SidebarLayout><aside className="sidebar"><button className="brand"><span className="brand-mark"/><span className="brand-text">HiveLab</span></button><div className="sidebar-scroll"><div className="sidebar-section-label">团队</div>{team.members.map(m=><div className="roster-with-desk" key={m.id}><button className="roster-row" title={m.name} onClick={()=>setHome(false)}><Avatar member={m} size={32}/><span className="roster-text">{m.name}</span></button></div>)}<button className="room-entry" title="茶歇室" onClick={()=>setHome(false)}>☕<span>茶歇室</span></button></div><div className="sidebar-footer"><button className="sidebar-settings">⚙<span>设置与连接</span></button></div></aside><div className="workspace">{home?<StandeeHome team={team} snapshot={snapshot} moods={{}} invoke={invoke} onSettingsTab={()=>{}} onProject={()=>{}} onCard={()=>{}} onDesk={()=>setHome(false)} onCollaboration={()=>setHome(false)}/>:<RoomView snapshot={snapshot} invoke={invoke}/>}</div></SidebarLayout></TeamProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

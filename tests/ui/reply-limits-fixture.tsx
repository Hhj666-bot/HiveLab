import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RoomView} from '../../src/renderer/room';
import {makeTeam,TeamProvider} from '../../src/renderer/members';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import {createReplyBudget,normalizeReplyLimits} from '../../src/shared/reply-limits';
import type {Snapshot,RoomMessage,RoomState} from '../../src/shared/types';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';

const members=[{id:'a',name:'Alice',executor:'codex',color:'#4f7467'},{id:'b',name:'Bob',executor:'codex',color:'#b26a3c'},{id:'c',name:'Carol',executor:'codex',color:'#5969ab'}];
const team=makeTeam(members as any),calls:any[]=[];let serial=0;
for(const scope of ['reply-fixture:global:topic'])if(!localStorage.getItem('hivelab.message-skills.'+scope))localStorage.setItem('hivelab.message-skills.'+scope,JSON.stringify({confirm:false,remember:false}));
(window as any).testCalls=calls;
function Fixture(){
  const [messages,setMessages]=useState<RoomMessage[]>([]),[state,setState]=useState<RoomState>({mode:'chat',active:false});
  const invoke:any=async(method:string,params:any)=>{
    calls.push({method,params});
    if(method==='messageSkills.list')return {items:[],warnings:[]};
    if(method==='composer.draft.get')return null;
    if(method==='room.send'){
      const id='message-'+(++serial),budget=createReplyBudget(normalizeReplyLimits(params.replyLimits),params.memberIds,id);
      setMessages(old=>[...old,{id,threadId:'topic',author:'user',text:params.text,at:new Date().toISOString(),status:'done'}]);
      setState({active:true,mode:'discuss',speaking:'a',discussion:{id:'discussion-'+serial,members:params.memberIds,phase:'talking',revision:1,style:params.style,seen:{},lastSpoke:{},priority:[],questions:[],reviewRequired:[],calls:0,limit:0,allowance:0,minutes:0,deadline:0,noProgress:0,latestUserId:id,replyBudget:budget}});return {accepted:true};
    }
    if(method==='room.stop')return new Promise(resolve=>{(window as any).finishStop=()=>{setState(old=>({...old,active:false,speaking:undefined,discussion:old.discussion?{...old.discussion,phase:params.endDiscussion?'idle':'paused',endedBy:params.endDiscussion?'user':undefined,reason:'已停止'}:undefined}));resolve({stopping:true});};});
    if(method==='room.history')return {threadId:'topic',messages:[],hasMore:false};
    return {saved:true};
  };
  (window as any).pauseLegacy=()=>setState(old=>({...old,active:false,discussion:old.discussion?{...old.discussion,phase:'paused',endedBy:undefined,unknownRunId:'old-unknown',unknownRunIds:['old-unknown'],skippedMembers:{b:{reason:'结果未知',runId:'old-unknown',unknown:true}}}:undefined}));
  (window as any).hivelab={invoke,onEvent:()=>()=>{}};
  const snapshot={settings:DEFAULT_SETTINGS,members,profile:DEFAULT_PROFILE,backendReady:true,dataDirectory:'reply-fixture',projects:[],sessions:[],runs:[],events:[],approvals:[],collaborations:[],room:{currentThreadId:'topic',threads:[{id:'topic',title:'次数与停止测试',createdAt:''}],hasMore:false,state,messages},providers:[{id:'codex',available:true,auth:'subscription',capabilities:{}}]} as unknown as Snapshot;
  return <TeamProvider value={team}><div className="app-shell" style={{gridTemplateColumns:'minmax(0,1fr)'}}><div className="workspace"><RoomView snapshot={snapshot} invoke={invoke}/></div></div></TeamProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

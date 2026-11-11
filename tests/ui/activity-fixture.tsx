import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RoomView} from '../../src/renderer/room';
import {MemberActivityDialog} from '../../src/renderer/run-activity';
import {makeTeam,TeamProvider} from '../../src/renderer/members';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import type {Snapshot,TimelineEvent,RunSummary} from '../../src/shared/types';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';

const members=[{id:'astra',name:'Astra',executor:'codex',color:'#438868',motto:''},{id:'sol',name:'Sol',executor:'codex',color:'#5b9562',motto:''},{id:'deepseek',name:'DeepSeek',executor:'dsh',color:'#4582ba',motto:''}] as any;
const run=(member:string,active=false):RunSummary=>({id:member+'-run',provider:member==='deepseek'?'dsh':'codex',sessionId:member+'-session',projectId:'project',inputPreview:'隔离测试任务',inputLength:6,status:active?'running':'ended',createdAt:'2026-10-18T03:00:00.000Z',updatedAt:'2026-10-18T03:00:00.000Z',completedAt:active?undefined:'2026-10-18T03:05:00.000Z',delivery:'confirmed',revision:1});
const event=(id:string,kind:TimelineEvent['kind'],text:string,sequence:number,data?:unknown,member='astra'):TimelineEvent=>({id,kind,text,sequence,data,runId:member+'-run',sessionId:member+'-session',provider:member==='deepseek'?'dsh':'codex',at:'2026-10-18T03:00:00.000Z',fidelity:'native'});
const initial=[event('progress','progress','正在核对实际配置。',1),event('thinking','reasoning','先检查现有配置，再运行测试。',2),event('tool','tool','执行测试',3,{id:'cmd',type:'commandExecution',command:'npm test',cwd:'D:/测试项目',hivelabPhase:'started'})];
const histories:Record<string,TimelineEvent[]>={'astra-run':initial,'sol-run':[event('sol-thinking','reasoning','Sol 的独立任务记录。',10,undefined,'sol'),event('sol-tool','tool','读取文件',11,{toolCallId:'read',title:'读取文件',status:'completed',rawInput:{path:'README.md'},rawOutput:'Sol 文件内容'},'sol')],'deepseek-run':[event('dsh-tool','tool','DeepSeek 操作记录',20,{toolCallId:'ds',title:'DeepSeek 操作记录',status:'completed',rawOutput:'检查成功'},'deepseek')]};
const thread={id:'topic',roomId:'desk:astra',title:'活动面板测试',createdAt:'2026-10-18T03:00:00.000Z'};
const room={roomId:'desk:astra',sessionId:'astra-session',currentThreadId:thread.id,threads:[thread],messages:[{id:'user-supplement',author:'user',text:'补充要求',deliveryId:'receipt',deliveryKind:'supplement',threadId:thread.id,roomId:'desk:astra',at:'2026-10-18T03:00:00.000Z'},{id:'reply',author:'astra',text:'',status:'speaking',runId:'astra-run',threadId:thread.id,roomId:'desk:astra',at:'2026-10-18T03:00:00.000Z'}],hasMore:false,state:{active:true,mode:'chat',speaking:'astra'}} as any;
const base={deliveryReceipts:[{id:'receipt',runId:'astra-run',delivery:'confirmed',createdAt:'2026-10-18T03:00:00.000Z'}],settings:DEFAULT_SETTINGS,projects:[{id:'project',name:'示例项目'}],sessions:members.map((m:any)=>({id:m.id+'-session',memberId:m.id,provider:m.executor,projectId:'project',writeMode:true,workspaceKind:'original'})),runs:[run('astra',true),run('sol'),run('deepseek')],events:initial,approvals:[],collaborations:[],dataDirectory:'isolated-test',backendReady:true,members,profile:DEFAULT_PROFILE,room,rooms:[{roomId:'desk:astra',currentThreadId:thread.id,sessionId:'astra-session',revision:1,state:room.state}],providers:[{id:'codex',available:true,auth:'subscription',capabilities:{steer:true},detail:'test'}]} as unknown as Snapshot;
const listeners=new Set<(event:any)=>void>(),calls:any[]=[];let held='',fail='',release:(()=>void)|undefined;
(window as any).hivelab={onEvent:(listener:any)=>{listeners.add(listener);return()=>listeners.delete(listener);}};
(window as any).testCalls=calls;
(window as any).holdRun=(id:string)=>{held=id;};
(window as any).failRun=(id:string)=>{fail=id;};
(window as any).releaseRun=()=>{held='';release?.();release=undefined;};
(window as any).emitActivity=(value:TimelineEvent)=>{histories[value.runId].push(value);for(const listener of listeners)listener({type:'event',event:value});};
const invoke=async(method:string,params?:any):Promise<any>=>{
  calls.push({method,params});
  if(method==='room.get')return room;
  if(method==='composer.draft.get')return null;
  if(method==='run.diagnostics')return {provider:params.runId==='deepseek-run'?'dsh':'codex',runId:params.runId,fetchedAt:'2026-10-23T01:03:00.000Z',sections:[{id:'delivery',label:'任务投递',items:[{id:'delivery',label:'投递回执',state:'observed',value:'原生已确认 · '+params.runId,reason:'回合确认不表示成果已验收。',source:'运行记录',observedAt:'2026-10-23T01:00:00.000Z'}]}]};
  if(method==='run.activity'){
    if(params.runId===held)await new Promise<void>(resolve=>{release=resolve;});
    if(params.runId===fail){fail='';throw Error('模拟读取失败');}
    if(params.before)return {runId:params.runId,events:[event('older','status','较早：任务已接收',1)],hasMore:false};
    return {runId:params.runId,events:[...histories[params.runId]],hasMore:params.runId==='astra-run',before:params.runId==='astra-run'?'older':undefined};
  }
  return {};
};
function Fixture(){
  const [snapshot,setSnapshot]=useState(base),[dialog,setDialog]=useState(false);
  (window as any).finishAstra=()=>{room.state={active:false,mode:'chat'};room.messages=room.messages.map((m:any)=>m.author==='user'?m:{...m,status:'done',text:'测试任务已完成。'});setSnapshot(old=>({...old,events:[],runs:old.runs.map(r=>r.id==='astra-run'?{...r,status:'ended',completedAt:'2026-10-18T03:05:00.000Z'}:r),room:{...room},rooms:old.rooms?.map(r=>({...r,revision:2,state:room.state}))}));};
  return <TeamProvider value={makeTeam(members)}><div style={{height:'100vh',display:'flex',flexDirection:'column',padding:18}}><button className="button" onClick={()=>setDialog(true)}>成员活动：思考与操作</button><RoomView snapshot={snapshot} invoke={invoke} roomId="desk:astra" personal={{kind:'desk',memberId:'astra',title:'Astra 工位',hint:'隔离测试'}}/></div>{dialog&&<MemberActivityDialog snapshot={snapshot} invoke={invoke} onClose={()=>setDialog(false)}/>}</TeamProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

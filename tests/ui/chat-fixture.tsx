import React from 'react';
import {createRoot} from 'react-dom/client';
import {RoomView} from '../../src/renderer/room';
import {makeTeam,TeamProvider} from '../../src/renderer/members';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import type {Snapshot} from '../../src/shared/types';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';

const member={id:'test-member',name:'测试成员',executor:'codex' as const,color:'#438868',motto:''};
const thread={id:'test-topic',roomId:'desk:test-member',title:'正在运行的测试任务',createdAt:new Date().toISOString()};
const room={roomId:'desk:test-member',sessionId:'test-session',currentThreadId:thread.id,threads:[thread],messages:[],hasMore:false,state:{active:true,mode:'chat' as const,speaking:member.id}};
let queued=false,attachments:any[]=[];
const calls:any[]=[];(window as any).testCalls=calls;
(window as any).setQueued=(value:boolean)=>{queued=value;};
const invoke=async (method:string,params?:any):Promise<any>=>{
  calls.push({method,params});
  if(method==='room.get')return room;
  if(method==='composer.draft.get')return null;
  if(method==='messageSkills.list')return {items:[],warnings:[]};
  if(method==='attachment.paste'){
    attachments=params.images.map((image:any,index:number)=>({id:`00000000-0000-0000-0000-00000000000${index}`,name:image.name,kind:'image',mime:'image/png',size:70}));return attachments;
  }
  if(method==='room.send')return {delivery:queued?'queued':'current',runId:'test-run'};
  return {};
};
const snapshot={settings:DEFAULT_SETTINGS,projects:[],sessions:[{id:'test-session',provider:'codex',memberId:member.id,writeMode:true,workspaceKind:'original'}],runs:[],events:[],approvals:[],collaborations:[],dataDirectory:'test-isolated',backendReady:true,members:[member],profile:DEFAULT_PROFILE,room,rooms:[{roomId:'desk:test-member',currentThreadId:thread.id,sessionId:'test-session',revision:1,state:room.state}],providers:[{id:'codex',available:true,auth:'subscription',capabilities:{steer:true},detail:'test'}]} as unknown as Snapshot;
createRoot(document.getElementById('root')!).render(<TeamProvider value={makeTeam([member])}><RoomView snapshot={snapshot} invoke={invoke} roomId="desk:test-member" personal={{kind:'desk',memberId:member.id,title:'测试工位',hint:'隔离测试'}}/></TeamProvider>);

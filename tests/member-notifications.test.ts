import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {memberNotices,memberNoticeState,normalizeMemberNotice,noticeMemberId,memberHasNews,memberSignal,noticeIsFocused,type MemberNotice} from '../src/shared/member-notifications';
import {MemberNotifications} from '../src/main/member-notifications';
import {DEFAULT_SETTINGS,DEFAULT_PROFILE} from '../src/shared/defaults';
import type {Snapshot} from '../src/shared/types';
import {refreshAfterRpc} from '../src/shared/rpc-refresh';
const base=()=>({backendReady:true,settings:DEFAULT_SETTINGS,profile:DEFAULT_PROFILE,members:[{id:'m-one',name:'测试成员',executor:'codex'}],providers:[{id:'codex',auth:'subscription'}],sessions:[{id:'session',provider:'codex',memberId:'m-one',title:'测试话题'}],runs:[],approvals:[],projects:[],events:[],room:{},dataDirectory:'isolated'} as unknown as Snapshot);
const notice:MemberNotice={id:'run:one:done',kind:'completed',title:'测试成员 完成了',body:'测试话题',target:{sessionId:'session'}};
test('member indicators resolve notice targets and unread report rooms without marking unrelated members',()=>{
 const snapshot=base();assert.equal(noticeMemberId(snapshot,notice),'m-one');assert.equal(memberHasNews(snapshot,'m-one',[notice]),true);assert.equal(memberHasNews(snapshot,'other',[notice]),false);assert.equal(memberHasNews(snapshot,'m-one'),false);
 snapshot.rooms=[{roomId:'report:project:m-one',currentThreadId:'thread',revision:1,pending:true,state:{active:false,mode:'chat'}}];assert.equal(memberHasNews(snapshot,'m-one'),true);
 snapshot.attention={items:[{id:'decision',memberId:'other'}]} as Snapshot['attention'];assert.equal(noticeMemberId(snapshot,{...notice,target:{attentionId:'decision'}}),'other');
});
test('member signals clear read completions and retain working or pending attention',()=>{
 const snapshot=base();snapshot.runs=[{id:'r',sessionId:'session',status:'running'}] as Snapshot['runs'];assert.equal(memberSignal(snapshot,'m-one'),'working');snapshot.runs[0].status='waiting_user';assert.equal(memberSignal(snapshot,'m-one'),'attention');snapshot.runs[0].status='ended';snapshot.runs[0].completedAt='done';assert.equal(memberSignal(snapshot,'m-one',[notice]),'unread');assert.equal(memberSignal(snapshot,'m-one'),'idle');
 snapshot.runs[0].status='running';snapshot.runs[0].completedAt=undefined;assert.equal(memberSignal(snapshot,'m-one',[{...notice,kind:'question'}]),'attention');
});
test('automatic notice reading requires the corresponding session or exact room topic',()=>{
 const snapshot=base();snapshot.sessions[0]={...snapshot.sessions[0],roomId:'desk:m-one',roomThreadId:'topic'};snapshot.rooms=[{roomId:'desk:m-one',currentThreadId:'topic',sessionId:'session',revision:1,state:{active:false,mode:'chat'}}];
 assert.equal(noticeIsFocused(snapshot,notice,{sessionId:'session'}),true);assert.equal(noticeIsFocused(snapshot,notice,{roomId:'desk:m-one',threadId:'topic'}),true);assert.equal(noticeIsFocused(snapshot,notice,{roomId:'desk:m-one',threadId:'other'}),false);assert.equal(noticeIsFocused(snapshot,notice,{roomId:'global',threadId:'topic'}),false);
});

test('fresh fast completions, late completion timestamps and errors notify once, while read/acceptance and restore do not replay history',()=>{
 const initial=base(),before=memberNoticeState(initial),ended={...initial,runs:[{id:'one',sessionId:'session',status:'ended',completedAt:'now'}]} as unknown as Snapshot;
 assert.equal(memberNotices(before,ended)[0].kind,'completed');assert.equal(memberNotices(memberNoticeState(ended),ended).length,0);
 const accepted={...ended,runs:[{...ended.runs[0],status:'completed'}]} as Snapshot;assert.equal(memberNotices(memberNoticeState(ended),accepted).length,0);
 const waiting={...ended,runs:[{...ended.runs[0],completedAt:undefined}]} as Snapshot;assert.equal(memberNotices(memberNoticeState(waiting),ended).length,1);
 const failed={...initial,runs:[{id:'failure',sessionId:'session',status:'failed',error:'offline fixture error'}]} as unknown as Snapshot;assert.equal(memberNotices(before,failed)[0].kind,'error');
 assert.equal(memberNotices(before,{...ended,restoreEpoch:'restored'}).length,0);
});

test('questions, approvals and attention decisions retain navigation targets without duplicate notices for the same question or run',()=>{
 const initial=base(),question={id:'q',sessionId:'session',runId:'one',state:'pending',type:'question',title:'需要回答',detail:'请选择方案'};
 const current={...initial,approvals:[question],attention:{items:[{id:'question:q',approvalId:'q',runId:'one',sessionId:'session',kind:'question',title:'等待回答',detail:'请选择方案'},{id:'decision:one',kind:'decision',title:'请选择下一步',detail:'项目需要决定',action:{view:'project-room'}}]}} as unknown as Snapshot;
 const values=memberNotices(memberNoticeState(initial),current);assert.equal(values.length,2);assert.equal(values[0].kind,'question');assert.deepEqual(values[0].target,{sessionId:'session'});assert.equal(values[1].target.attentionId,'decision:one');
 assert.equal(memberNotices(memberNoticeState(current),current).length,0);
 const approval={...initial,approvals:[{...question,type:'approval'}]} as unknown as Snapshot;assert.equal(memberNotices(memberNoticeState(initial),approval)[0].kind,'approval');
});

test('native delivery chooses foreground cards or background toasts, flashes the taskbar, deduplicates, and clicks only navigate',()=>{
 class Native extends EventEmitter{shown=0;closed=0;show(){this.shown++;}close(){this.closed++;this.emit('close');}}
 let focused=true,supported=true,flashes=0,opened=0;const created:Native[]=[];
 const service=new MemberNotifications({focused:()=>focused,supported:()=>supported,create:()=>{const native=new Native();created.push(native);return native;},flash:()=>flashes++,open:target=>{assert.equal(target.sessionId,'session');opened++;},fallback:()=>{}});
 assert.equal(service.show(notice).delivery,'foreground');assert.equal(created.length,0);assert.equal(service.show(notice).delivery,'duplicate');
 focused=false;assert.equal(service.show({...notice,id:'background'}).delivery,'desktop');assert.equal(flashes,1);assert.equal(created[0].shown,1);created[0].emit('click');assert.equal(opened,1);assert.equal(created[0].closed,1);
 supported=false;assert.equal(service.show({...notice,id:'unsupported'}).delivery,'fallback');assert.equal(flashes,2);service.close();
 assert.equal(refreshAfterRpc('window.notify'),false);assert.throws(()=>normalizeMemberNotice({id:'invalid'}),/格式/);assert.deepEqual(normalizeMemberNotice(notice),notice);
});

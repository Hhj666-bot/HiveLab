import {t} from './i18n';
import type {Session,Snapshot,RunSummary} from './types';
import type {RoomId} from './types';
export interface MemberNoticeTarget {sessionId?:string;attentionId?:string}
export interface MemberNotice {id:string;kind:'completed'|'question'|'approval'|'error'|'attention';title:string;body:string;target:MemberNoticeTarget}
export function noticeMemberId(snapshot:Snapshot,notice:MemberNotice):string|undefined{
 const item=notice.target.attentionId?snapshot.attention?.items.find(item=>item.id===notice.target.attentionId):undefined;
 const session=snapshot.sessions.find(session=>session.id===(notice.target.sessionId??item?.sessionId));
 return item?.memberId??session?.memberId??session?.provider??item?.provider;
}
export function memberHasNews(snapshot:Snapshot,memberId:string,notices:MemberNotice[]=[]){
 return Boolean(snapshot.rooms?.some(room=>(room.memberId===memberId||room.roomId===`desk:${memberId}`||room.roomId.startsWith('report:')&&room.roomId.endsWith(':'+memberId))&&(room.unread||room.pending))||notices.some(notice=>noticeMemberId(snapshot,notice)===memberId));
}
export type MemberSignal='idle'|'working'|'unread'|'attention';
export function memberSignal(snapshot:Snapshot,memberId:string,notices:MemberNotice[]=[]):MemberSignal{
 const sessions=new Set(snapshot.sessions.filter(session=>(session.memberId??session.provider)===memberId).map(session=>session.id)),rooms=snapshot.rooms?.filter(room=>room.memberId===memberId||room.roomId===`desk:${memberId}`||room.roomId.startsWith('report:')&&room.roomId.endsWith(':'+memberId))??[];
 if(rooms.some(room=>room.pending)||snapshot.approvals.some(item=>item.state==='pending'&&sessions.has(item.sessionId))||snapshot.runs.some(run=>sessions.has(run.sessionId)&&run.status==='waiting_user')||notices.some(notice=>notice.kind!=='completed'&&noticeMemberId(snapshot,notice)===memberId))return 'attention';
 if(rooms.some(room=>room.state.active)||snapshot.room.state?.active&&snapshot.room.state.speaking===memberId||snapshot.runs.some(run=>sessions.has(run.sessionId)&&['running','queued','stopping'].includes(run.status)&&!run.completedAt))return 'working';
 return memberHasNews(snapshot,memberId,notices)?'unread':'idle';
}
export interface MemberNoticeFocus {roomId?:RoomId;threadId?:string;sessionId?:string;settingsMemberId?:string}
export function noticeIsFocused(snapshot:Snapshot,notice:MemberNotice,active:MemberNoticeFocus){
 const item=notice.target.attentionId?snapshot.attention?.items.find(item=>item.id===notice.target.attentionId):undefined;
 const targetSession=notice.target.sessionId??item?.sessionId;
 if(active.sessionId)return active.sessionId===targetSession;
 if(item?.action.view==='member-settings')return Boolean(active.settingsMemberId&&[item.memberId,item.provider].includes(active.settingsMemberId));
 if(!active.roomId)return false;
 if(targetSession){
  const current=snapshot.rooms?.find(room=>room.roomId===active.roomId);
  if(current?.sessionId)return (!active.threadId||current.currentThreadId===active.threadId)&&current.sessionId===targetSession;
  const session=snapshot.sessions.find(session=>session.id===targetSession);
  return Boolean(session?.roomId===active.roomId&&(!active.threadId||session.roomThreadId===active.threadId));
 }
 const roomId=item?.roomId??(item?.action.view==='room'?'global':item?.action.view==='project-room'&&item.projectId?`project:${item.projectId}`:undefined);
 return Boolean(roomId===active.roomId&&(!item?.threadId||!active.threadId||item.threadId===active.threadId));
}
export function memberNoticeState(snapshot:Snapshot){return {runs:new Map(snapshot.runs.map(run=>[run.id,run.status])),completed:new Set(snapshot.runs.filter(run=>run.completedAt).map(run=>run.id)),approvals:new Set(snapshot.approvals.filter(item=>item.state==='pending').map(item=>item.id)),attention:new Set(snapshot.attention?.items.map(item=>item.id)??[]),auth:new Map(snapshot.providers.map(provider=>[provider.id,provider.auth])),epoch:snapshot.restoreEpoch};}
export type MemberNoticeState=ReturnType<typeof memberNoticeState>;
const done=(status:RunSummary['status']|undefined)=>status==='ended'||status==='completed';
const short=(text:string)=>[...text.replace(/\s+/gu,' ').trim()].slice(0,180).join('');
/** Diffs operational state only: no historical replay on first load or restore. */
export function memberNotices(before:MemberNoticeState,snapshot:Snapshot,labels?:{name:(session:Session)=>string;topic:(session:Session)=>string}):MemberNotice[]{
 if(before.epoch!==snapshot.restoreEpoch)return [];
 const sessions=new Map(snapshot.sessions.map(session=>[session.id,session])),notices:MemberNotice[]=[],handledRuns=new Set<string>(),handledApprovals=new Set<string>();
 const name=(session:Session)=>labels?.name(session)??snapshot.members.find(member=>member.id===(session.memberId??session.provider))?.name??t("成员");
 const topic=(session:Session)=>labels?.topic(session)??session.title??t("对话任务");
 for(const approval of snapshot.approvals){
  if(approval.state!=='pending'||before.approvals.has(approval.id))continue;
  const session=sessions.get(approval.sessionId);if(!session)continue;
  notices.push({id:'approval:'+approval.id,kind:approval.type==='question'?'question':'approval',title:t("{0} 在等你回应", name(session)),body:short(approval.type==='question'?approval.detail||approval.title:approval.title),target:{sessionId:session.id}});handledApprovals.add(approval.id);handledRuns.add(approval.runId);
 }
 for(const item of snapshot.attention?.items??[]){
  if(before.attention.has(item.id)||item.approvalId&&handledApprovals.has(item.approvalId)||item.runId&&handledRuns.has(item.runId))continue;
  if(item.kind==='login'&&(!item.provider||!['api','account','subscription'].includes(before.auth.get(item.provider)??'')))continue;
  notices.push({id:'attention:'+item.id,kind:item.kind==='question'?'question':item.kind==='approval'?'approval':'attention',title:item.title,body:short(item.detail),target:{attentionId:item.id,...(item.sessionId?{sessionId:item.sessionId}:{})}});if(item.runId)handledRuns.add(item.runId);
 }
 for(const run of snapshot.runs){
  const was=before.runs.get(run.id),session=sessions.get(run.sessionId);if(!session||was===run.status&&before.completed.has(run.id)===Boolean(run.completedAt)||handledRuns.has(run.id))continue;
  if(done(run.status)&&run.completedAt&&(!done(was)||!before.completed.has(run.id)))notices.push({id:'run:'+run.id+':done',kind:'completed',title:t("{0} 完成了", name(session)),body:short(topic(session)),target:{sessionId:session.id}});
  else if(['failed','unknown','interrupted'].includes(run.status)&&was!==run.status)notices.push({id:'run:'+run.id+':'+run.status,kind:'error',title:t("{0} 需要你核对结果", name(session)),body:short(topic(session)+' · '+(run.error??t("本轮未完成，请查看说明"))),target:{sessionId:session.id}});
  else if(run.status==='rate_limited'&&run.completedAt)notices.push({id:'run:'+run.id+':limited',kind:'error',title:t("{0} 的额度受限", name(session)),body:short(topic(session)),target:{sessionId:session.id}});
 }
 return notices;
}
export function normalizeMemberNotice(value:unknown):MemberNotice{
 const source=value&&typeof value==='object'?value as Record<string,any>:{};
 const text=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';
 const id=text(source.id,180),title=text(source.title,100),kind=source.kind,sessionId=text(source.target?.sessionId,180),attentionId=text(source.target?.attentionId,180),target={...(sessionId?{sessionId}:{}),...(attentionId?{attentionId}:{})};
 if(!id||!title||!['completed','question','approval','error','attention'].includes(kind)||!target.sessionId&&!target.attentionId)throw Error(t("消息提醒格式无效。"));
 return {id,kind,title,body:text(source.body,240),target};
}

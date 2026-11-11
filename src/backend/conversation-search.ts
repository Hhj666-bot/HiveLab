import type {Store} from './store';
import type {ConversationMatch,ConversationSearchPage} from '../shared/conversation-search';
import type {DeskTopic,PersonalRoom} from '../shared/member-workspaces';
import type {MemberProfile,Project,RoomId} from '../shared/types';
import type {RoundtableTopic} from '../shared/roundtable';
import {readableContent} from '../shared/content-presentation';
import {roundtableContextMessage} from '../shared/roundtable';

export function searchConversations(store:Store,params:Record<string,unknown>):ConversationSearchPage {
  const query=String(params.query??'').trim();
  if(!query)return {matches:[],hasMore:false,nextOffset:0};
  if(query.length>200)throw new Error('搜索文字最多 200 字');
  if(params.scope!=='current'&&params.scope!=='all')throw new Error('请选择搜索范围');
  const offset=Number(params.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0)throw new Error('搜索分页无效');
  const threadId=params.scope==='current'?String(params.threadId??''):undefined;
  if(threadId)store.roomThread(threadId,store.validateRoomId(params.roomId));
  else if(params.scope==='current')return {matches:[],hasMore:false,nextOffset:0};
  const rows=store.searchRoomMessages(query,threadId,offset);
  const matches:ConversationMatch[]=rows.slice(0,50).flatMap(({message:stored,thread})=>{
    const roomId:RoomId=thread.roomId??'global',message=roundtableContextMessage(stored,roomId);
    if(message.contextOnly)return [];
    const personal=store.get<PersonalRoom>('personal_rooms',roomId);
    const member=personal&&store.get<MemberProfile>('members',personal.memberId);
    const projectId=personal?.projectId??thread.projectId??(roomId.startsWith('project:')?roomId.slice(8):undefined);
    const project=projectId?store.get<Project>('projects',projectId):undefined;
    const roundtable=roomId.startsWith('roundtable:')?store.get<RoundtableTopic>('roundtable_topics',roomId.slice(11)):undefined;
    const roomTitle=roomId==='global'?'茶歇室':personal?.kind==='desk'?`${member?.name??personal.memberId} 的工位`:personal?.kind==='report'?`${project?.name??'项目'} · ${member?.name??personal.memberId} 的汇报`:roundtable?`圆桌 · ${roundtable.title}`:`${project?.name??'项目'} 的会议室`;
    const text=message.author==='user'?message.text:readableContent(message.text),at=text.toLowerCase().indexOf(query.toLowerCase()),start=Math.max(0,at-45),end=Math.min(text.length,Math.max(start+200,at+query.length+60));
    const author=message.authorName??(message.author==='user'?store.profile().name:store.get<MemberProfile>('members',message.author)?.name)??message.author;
    return [{roomId,threadId:thread.id,messageId:message.id,roomTitle,title:thread.title,author,at:message.at,excerpt:(start?'…':'')+text.slice(start,end)+(end<text.length?'…':''),...(personal?.kind==='desk'?{directory:store.get<DeskTopic>('desk_topics',thread.id)?.directory}:{})}];
  });
  return {matches,hasMore:rows.length>50,nextOffset:offset+Math.min(rows.length,50)};
}

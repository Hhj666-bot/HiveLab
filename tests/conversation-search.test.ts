import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Store} from '../src/backend/store';
import {searchConversations} from '../src/backend/conversation-search';
import type {RoomId,RoomMessage} from '../src/shared/types';

test('conversation search scopes saved text, preserves literal queries, and pages older matches with navigation metadata',()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'conversation-search-')),store=new Store(root);
  try{
    store.put('members','sol',{id:'sol',name:'Sol',executor:'codex'});
    store.put('personal_rooms','desk:sol',{id:'desk:sol',kind:'desk',memberId:'sol'});
    store.put('personal_rooms','report:project:sol',{id:'report:project:sol',kind:'report',memberId:'sol',projectId:'project'});
    store.put('projects','project',{id:'project',name:'设计项目'});
    store.put('roundtable_topics','review',{id:'review',title:'设计评审'});
    const rooms:RoomId[]=['global','desk:sol','report:project:sol','project:project','roundtable:review'];
    const add=(id:string,threadId:string,text:string,extra:Partial<RoomMessage>={})=>store.put('room_messages',id,{id,threadId,text,author:'user',at:'2026-10-27T00:00:00Z',...extra});
    rooms.forEach((roomId,index)=>{const id='thread-'+index;store.put('room_threads',id,{id,roomId,title:'旧话题 '+index,archivedAt:'2026-10-01'});add('match-'+index,id,'搜索关键字 100%_literal');});
    const directory=path.join(root,'older-desk-folder');store.put('desk_topics','thread-1',{id:'thread-1',memberId:'sol',directory});
    for(let i=0;i<120;i++)add('new-'+i,'thread-0','普通新消息');
    add('hidden','thread-0','搜索关键字',{contextOnly:true});add('control','thread-0','搜索关键字',{discussionControl:true});
    add('metadata','thread-0','正文没有匹配词',{authorName:'搜索关键字'});
    assert.deepEqual(searchConversations(store,{scope:'current',roomId:'global',threadId:'thread-0',query:'搜索关键字'}).matches.map(m=>m.messageId),['match-0']);
    const all=searchConversations(store,{scope:'all',query:'搜索关键字'});
    assert.equal(all.matches.length,5);assert.deepEqual(new Set(all.matches.map(m=>m.roomId)),new Set(rooms));
    const desk=all.matches.find(m=>m.roomId==='desk:sol')!;assert.equal(desk.directory,directory);assert.equal(desk.roomTitle,'Sol 的工位');assert.equal(desk.title,'旧话题 1');
    assert.ok(all.matches.find(m=>m.roomId==='report:project:sol')!.roomTitle.includes('设计项目'));
    assert.equal(searchConversations(store,{scope:'all',query:'100%_LITERAL'}).matches.length,5);
    assert.throws(()=>searchConversations(store,{scope:'current',roomId:'global',threadId:'thread-1',query:'搜索关键字'}),/不属于/);
    for(let i=0;i<53;i++)add('page-'+i,'thread-0','分页关键字');
    const first=searchConversations(store,{scope:'all',query:'分页关键字'}),next=searchConversations(store,{scope:'all',query:'分页关键字',offset:first.nextOffset});
    assert.equal(first.matches.length,50);assert.equal(first.hasMore,true);assert.equal(next.matches.length,3);assert.equal(next.hasMore,false);assert.equal(new Set([...first.matches,...next.matches].map(m=>m.messageId)).size,53);
  }finally{store.close();assert.equal(path.dirname(root),path.resolve(process.env.TEMP!));assert.match(path.basename(root),/^conversation-search-/);rmSync(root,{recursive:true,force:true});}
});

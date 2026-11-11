import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Engine} from '../src/backend/engine';
import type {AdapterContext,RoomMessage,Run} from '../src/shared/types';
import type {DiscussionStyle,RoomDiscussion} from '../src/shared/discussion';
import {nextDiscussionSpeaker,requiredDiscussionSpeaker} from '../src/shared/discussion';
import {normalizeReplyLimits,createReplyBudget,replyRemaining,reserveReply} from '../src/shared/reply-limits';

async function until(read:()=>boolean){for(let i=0;i<500;i++){if(read())return;await new Promise(r=>setTimeout(r,10));}throw Error('discussion did not settle');}
function setup(options:{holdTea?:boolean;holdDesk?:boolean;holdStop?:boolean;correction?:boolean}={}){
  const root=mkdtempSync(path.join(process.env.TEMP!,'reply-limits-')),starts:AdapterContext[]=[],stops:string[]=[],release=new Map<string,()=>void>();let releaseStop=()=>{};
  const stopGate=options.holdStop?new Promise<void>(r=>releaseStop=r):Promise.resolve();
  const engine=new Engine(root,()=>{},()=>{},id=>{
    let ctx:AdapterContext|undefined,stopped=false,done=()=>{};
    return {
      async probe(){return {id,name:id,auth:'subscription',available:true,detail:'mock, no model calls',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true}};},
      async start(context,input){
        ctx=context;starts.push(ctx);ctx.markDelivery('confirmed');
        const member=ctx.session.memberId??ctx.run.provider;
        if(ctx.conversation==='desk'&&options.holdDesk||ctx.conversation==='room'&&options.holdTea)await new Promise<void>(r=>{done=r;release.set(member,r);});
        if(stopped)return {stopped:true};
        if(ctx.conversation==='desk'){ctx.emit('message','工位任务完成',{source:'assistant'});return {};}
        const marker=input.lastIndexOf('HIVELAB_CONTEXT\n');if(marker<0)throw Error('missing discussion prompt');
        const packet=JSON.parse(input.slice(marker+'HIVELAB_CONTEXT\n'.length));
        const text=options.correction&&starts.filter(c=>c.conversation==='room').length===1?'{}':JSON.stringify({version:1,turn:packet.turn,revision:packet.revision,action:'speak',body:`${member} 的第 ${starts.length} 次实际回复`,...(member==='a'?{}:{next:'a'})});
        ctx.emit('message',text,{source:'assistant'});return {};
      },
      async stop(){if(ctx){stops.push(ctx.session.memberId??ctx.run.provider);await stopGate;stopped=true;done();}},
    };
  },{maintenanceOnly:true});
  for(const [id,name]of [['a','Alice'],['b','Bob'],['c','Carol']])engine.store.put('members',id,{id,name,executor:'codex',color:'#35685d'});
  const state=()=>engine.store.roomState();
  const send=(style:DiscussionStyle,replyLimits:unknown,text='开始本轮')=>engine.invoke('room.send',{text:style==='chat'?'@Alice '+text:text,memberIds:['a','b','c'],mode:'discuss',style,replyLimits});
  const tea=()=>starts.filter(c=>c.conversation==='room');
  const dispose=async()=>{releaseStop();for(const done of release.values())done();await engine.close();rmSync(root,{recursive:true,force:true});};
  return {root,engine,starts,tea,stops,release,releaseStop:()=>releaseStop(),state,send,dispose};
}

test('reply allowances validate numbers and preserve mute/unlimited values',()=>{
  for(const n of [-1,1.5,101,'2',undefined,NaN])assert.throws(()=>normalizeReplyLimits({perMember:n}),/次数/);
  const settings=normalizeReplyLimits({perMember:2,overrides:{a:0,b:null}}),budget=createReplyBudget(settings,['a','b','c'],'message')!;
  assert.equal(replyRemaining(budget,'a'),0);assert.equal(replyRemaining(budget,'b'),Infinity);assert.equal(replyRemaining(budget,'c'),2);assert.equal(replyRemaining(budget,'absent'),0);
  assert.throws(()=>reserveReply(budget,'a'),/已用完/);assert.equal(replyRemaining(reserveReply(budget,'c'),'c'),1);
});

for(const style of ['chat','work'] as const)test(`${style}: per-member limits are enforced and reset only for the next human message`,async()=>{
  const h=setup();
  try{
    await h.engine.probe('codex');
    await h.send(style,{perMember:3,overrides:{b:1,c:0}});
    await until(()=>h.state().discussion?.phase==='waiting_user'&&!h.state().active);
    const first=h.state().discussion!.replyBudget!;
    assert.deepEqual(first.used,{a:3,b:1});assert.equal(h.tea().length,4);
    assert.ok(h.tea().every(c=>['a','b'].includes(c.session.memberId!)));
    await h.engine.invoke('room.resume',{acknowledgeUnknown:true});
    await until(()=>h.state().discussion?.phase==='waiting_user'&&!h.state().active);
    assert.equal(h.tea().length,4,'resume cannot refill an exhausted message allowance');
    await h.send(style,{perMember:1,overrides:{a:0,b:2}},'下一条消息');
    await until(()=>h.state().discussion?.phase==='waiting_user'&&!h.state().active);
    const second=h.state().discussion!.replyBudget!;assert.notEqual(first.messageId,second.messageId);assert.deepEqual(second.used,{b:2,c:1});assert.equal(h.tea().length,7);
    assert.ok(h.engine.store.list<RoomMessage>('room_messages').some(m=>m.text.includes('开始本轮')));
  }finally{await h.dispose();}
});

test('meeting limits allow more than the legacy two-total-per-member budget, in seating order',async()=>{
  const h=setup();
  try{await h.engine.probe('codex');await h.send('work',{perMember:3,overrides:{}});await until(()=>h.state().discussion?.phase==='waiting_user'&&!h.state().active);assert.deepEqual(h.tea().map(c=>c.session.memberId),['a','b','c','a','b','c','a','b','c']);}
  finally{await h.dispose();}
});

for(const style of ['chat','work'] as const)test(`${style}: an interjection gets a fresh budget without charging it for an older in-flight reply`,async()=>{
  const h=setup({holdTea:true});
  try{
    await h.engine.probe('codex');await h.send(style,{perMember:1,overrides:{c:0}},'第一条消息');await until(()=>h.tea().length===1);
    const oldMessage=h.state().discussion!.replyBudget!.messageId;
    await h.send(style,{perMember:0,overrides:{b:1}},'新的问题，只请 Bob 回答');
    assert.notEqual(h.state().discussion!.replyBudget!.messageId,oldMessage);
    h.release.get('a')?.();await until(()=>h.tea().length===2);assert.equal(h.tea()[1].session.memberId,'b');h.release.get('b')?.();
    await until(()=>h.state().discussion?.phase==='waiting_user'&&!h.state().active);
    assert.deepEqual(h.state().discussion!.replyBudget!.used,{b:1});assert.deepEqual(h.tea().map(c=>c.session.memberId),['a','b']);
  }finally{await h.dispose();}
});

for(const style of ['chat','work'] as const)test(`${style}: zero allowance stores the human message without dispatching an agent`,async()=>{
  const h=setup();try{await h.engine.probe('codex');await h.send(style,{perMember:0,overrides:{}});await until(()=>h.state().discussion?.phase==='waiting_user'&&!h.state().active);assert.equal(h.tea().length,0);assert.equal(h.engine.store.list<Run>('runs').length,0);}
  finally{await h.dispose();}
});

test('meeting hand votes do not dispatch members who have exhausted their reply opportunity',async()=>{
  const h=setup();try{await h.engine.probe('codex');await h.engine.invoke('room.send',{text:'举手会议',memberIds:['a','b'],mode:'discuss',style:'work',replyLimits:{perMember:1,overrides:{}},handRaise:true,hostPick:true});await until(()=>h.state().discussion?.phase==='waiting_user'&&!h.state().active);assert.equal(h.tea().length,2);assert.ok(h.tea().every(c=>c.session.purpose!=='room-hand'));}
  finally{await h.dispose();}
});

test('a single format correction does not grant another formal speaking opportunity',async()=>{
  const h=setup({correction:true});try{await h.engine.probe('codex');await h.engine.invoke('room.send',{text:'格式补正测试',memberIds:['a'],mode:'discuss',style:'work',replyLimits:{perMember:1,overrides:{}}});await until(()=>h.state().discussion?.phase==='waiting_user'&&!h.state().active);assert.equal(h.tea().length,2);assert.deepEqual(h.state().discussion!.replyBudget!.used,{a:1});}
  finally{await h.dispose();}
});

test('directed questions and handoffs cannot select an exhausted member',()=>{
  const budget=createReplyBudget({perMember:1,overrides:{a:0}},['a','b'],'m');
  const d={id:'d',members:['a','b'],phase:'talking',style:'chat',priority:['a'],questions:[{id:'q',from:'b',to:'a',text:'再说一遍',messageId:'m'}],reviewRequired:['a'],lastSpoke:{},passed:[],calls:1,replyBudget:budget} as unknown as RoomDiscussion;
  assert.equal(requiredDiscussionSpeaker(d),undefined);assert.equal(nextDiscussionSpeaker(d,[],()=>0), 'b');
});

for(const style of ['chat','work'] as const)test(`${style}: stop cancels current and future room speech, joins repeated stops and preserves another desk`,async()=>{
  const h=setup({holdTea:true,holdDesk:true,holdStop:true});
  try{
    await h.engine.probe('codex');await h.engine.invoke('desk.open',{memberId:'c'});await h.engine.invoke('desk.topic',{memberId:'c'});await h.engine.invoke('room.send',{roomId:'desk:c',text:'工位独立任务'});await until(()=>h.starts.some(c=>c.conversation==='desk'));
    await h.engine.invoke('room.send',{text:style==='chat'?'@Alice 可终止的讨论':'可终止的讨论',memberIds:['a','b'],mode:'discuss',style,replyLimits:{perMember:3,overrides:{}}});await until(()=>h.tea().length===1);
    const first=h.engine.invoke('room.stop'),second=h.engine.invoke('room.stop');await until(()=>h.stops.length===1);
    await assert.rejects(h.send(style,{perMember:1,overrides:{}},'停止过程中发送'),/正在终止/);
    await assert.rejects(h.engine.invoke('room.resume'),/正在终止/);
    assert.deepEqual(h.stops,['a']);h.releaseStop();await Promise.all([first,second]);await until(()=>!h.state().active);
    assert.equal(h.state().discussion!.phase,'paused');assert.equal(h.tea().length,1);assert.equal(h.engine.store.list<Run>('runs').filter(r=>r.status==='queued').length,0);
    assert.ok(h.engine.store.list<Run>('runs').some(r=>r.status==='running'&&h.engine.store.get<any>('sessions',r.sessionId)?.memberId==='c'));
    h.release.get('c')?.();await until(()=>h.engine.store.list<Run>('runs').every(r=>!['running','queued','stopping'].includes(r.status)));
  }finally{await h.dispose();}
});

for(const style of ['chat','work'] as const)for(const endDiscussion of [false,true])test(`${style}: ${endDiscussion?'terminate':'stop'} withdraws a room turn waiting behind a busy desk execution slot`,async()=>{
  const h=setup({holdDesk:true});
  try{
    h.engine.settings.maxParallel=1;await h.engine.probe('codex');await h.engine.invoke('desk.open',{memberId:'c'});await h.engine.invoke('desk.topic',{memberId:'c'});await h.engine.invoke('room.send',{roomId:'desk:c',text:'占用执行位置'});await until(()=>h.starts.some(c=>c.conversation==='desk'));
    await h.engine.invoke('room.send',{text:'排队讨论',memberIds:['a','b'],mode:'discuss',style,replyLimits:{perMember:2,overrides:{}}});await until(()=>h.engine.store.list<Run>('runs').some(r=>r.status==='queued'));
    await h.engine.invoke('room.stop',{endDiscussion});await until(()=>!h.state().active);assert.equal(h.tea().length,0);assert.equal(h.stops.length,0);if(endDiscussion)assert.equal(h.state().discussion!.phase,'idle');
    h.release.get('c')?.();await until(()=>h.engine.store.list<Run>('runs').every(r=>!['running','queued','stopping'].includes(r.status)));assert.equal(h.tea().length,0);
  }finally{await h.dispose();}
});

for(const style of ['chat','work'] as const)test(`${style}: terminate joins cancellation, ends the discussion and accepts a fresh roster without stopping another desk`,async()=>{
  const h=setup({holdTea:true,holdDesk:true,holdStop:true});
  try{
    await h.engine.probe('codex');await h.engine.invoke('desk.open',{memberId:'c'});await h.engine.invoke('desk.topic',{memberId:'c'});await h.engine.invoke('room.send',{roomId:'desk:c',text:'独立工位任务'});await until(()=>h.starts.some(c=>c.conversation==='desk'));
    await h.engine.invoke('room.send',{text:'可终止的本轮讨论',memberIds:['a','b'],mode:'discuss',style,replyLimits:{perMember:3,overrides:{}}});await until(()=>h.tea().length===1);const original=h.state().discussion!.id;
    const pausing=h.engine.invoke('room.stop');await until(()=>h.stops.length===1);const terminating=h.engine.invoke('room.stop',{endDiscussion:true});
    await assert.rejects(h.send(style,{perMember:1,overrides:{}},'停止期间发送'),/正在终止/);h.releaseStop();await Promise.all([pausing,terminating]);
    assert.equal(h.state().active,false);assert.equal(h.state().discussion!.phase,'idle');assert.equal(h.state().discussion!.endedBy,'user');assert.ok(h.state().discussion!.endedAt);assert.deepEqual(h.state().discussion!.mentionQueue,[]);assert.equal(h.tea().length,1);
    assert.ok(h.engine.store.list<Run>('runs').some(r=>r.status==='running'&&h.engine.store.get<any>('sessions',r.sessionId)?.memberId==='c'));
    await assert.rejects(h.engine.invoke('room.resume'),/没有可继续/);
    await h.engine.invoke('room.send',{text:'调整名单后的新一轮',memberIds:['b'],mode:'discuss',style,replyLimits:{perMember:0,overrides:{}}});await until(()=>h.state().discussion?.phase==='waiting_user');assert.notEqual(h.state().discussion!.id,original);assert.deepEqual(h.state().discussion!.members,['b']);assert.equal(h.tea().length,1);
  }finally{await h.dispose();}
});

test('terminate releases an already paused discussion with unknown results without pretending those results were acknowledged',async()=>{
  const h=setup();try{
    await h.engine.probe('codex');await h.send('chat',{perMember:0,overrides:{}});await h.engine.invoke('room.pause');
    const state=h.state(),d=state.discussion!,unknown='previous-unknown-run';h.engine.store.put('room_states','global',{...state,discussion:{...d,unknownRunId:unknown,unknownRunIds:[unknown],skippedMembers:{a:{reason:'结果未知',runId:unknown,unknown:true}}}});
    await h.engine.invoke('room.stop',{endDiscussion:true});const ended=h.state().discussion!;assert.equal(ended.phase,'idle');assert.equal(ended.endedBy,'user');assert.deepEqual(ended.unknownRunIds,[unknown]);assert(!ended.acknowledgedRunIds?.includes(unknown));
    await assert.rejects(h.engine.invoke('room.resume',{acknowledgeUnknown:true}),/没有可继续/);
    await h.engine.invoke('room.send',{text:'新要求',memberIds:['b'],mode:'discuss',style:'chat',replyLimits:{perMember:0,overrides:{}}});assert.deepEqual(h.state().discussion!.members,['b']);assert.equal(h.state().discussion!.skippedMembers,undefined);assert.notEqual(h.state().discussion!.id,d.id);
  }finally{await h.dispose();}
});

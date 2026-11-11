import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {runDurationMs,formatRunDuration} from '../src/shared/run-duration';
import {tokenActivity} from '../src/shared/token-activity';
import {CodexAdapter} from '../src/backend/adapters/codex';
import {Store} from '../src/backend/store';
import type {TimelineEvent} from '../src/shared/types';

test('reply duration freezes at completion, handles live/stopped/legacy records and never uses updatedAt',()=>{
  const createdAt='2026-10-24T01:00:00Z',completedAt='2026-10-24T01:01:05Z';
  for(const status of ['ended','failed','stopped','unknown','rate_limited'] as const)
    assert.equal(runDurationMs({createdAt,completedAt,status},Date.parse(completedAt)+86400000),65000);
  assert.equal(runDurationMs({createdAt,status:'running'},Date.parse(createdAt)+5000),5000);
  assert.equal(runDurationMs({createdAt,status:'unknown'}),undefined);
  assert.equal(runDurationMs({createdAt:'invalid',completedAt,status:'ended'}),undefined);
  assert.equal(runDurationMs({createdAt:completedAt,completedAt:createdAt,status:'ended'}),undefined);
  assert.equal(formatRunDuration(65000),'1 分 5 秒');assert.equal(formatRunDuration(3661000),'1 小时 1 分 1 秒');assert.equal(formatRunDuration(0),'不到 1 秒');
});

test('Codex rate limits never replace native subscription token usage and old turns are ignored',()=>{
  const adapter:any=new CodexAdapter(),events:any[]=[];
  adapter.context={emit:(kind:string,text:string,data:any)=>events.push({kind,text,data})};adapter.threadId='thread';adapter.turnId='turn';adapter.delivered=true;
  const usage={threadId:'thread',turnId:'turn',tokenUsage:{total:{totalTokens:120},last:{totalTokens:120}}};
  adapter.notification('thread/tokenUsage/updated',usage);
  adapter.notification('account/rateLimits/updated',{rateLimits:{primary:{usedPercent:17}}});
  assert.deepEqual(adapter.usage,usage);assert.equal(events[0].data.auth,'subscription');assert.equal(events.length,2);
  adapter.notification('thread/tokenUsage/updated',{...usage,turnId:'old'});assert.equal(events.length,2);
});

test('stored auth receipts distinguish subscription and API history without reclassifying from current settings',()=>{
  const directory=mkdtempSync(path.join(process.env.TEMP!,'usage-history-'));let store=new Store(directory);
  const at='2026-10-24T01:00:00Z',runs=['codex','claude-sub','claude-api','claude-unknown'].map(id=>({id,sessionId:id,provider:id==='codex'?'codex' as const:'claude' as const,createdAt:at}));
  const events:any[]=[
    {runId:'codex',provider:'codex',kind:'usage',data:{threadId:'thread',tokenUsage:{total:{totalTokens:120},last:{totalTokens:120}}}},
    {runId:'codex',provider:'codex',kind:'usage',data:{threadId:'thread',tokenUsage:{total:{totalTokens:120},last:{totalTokens:120}}}},
    {runId:'claude-sub',provider:'claude',kind:'status',data:{auth:'subscription'}},
    {runId:'claude-sub',provider:'claude',kind:'usage',data:{usage:{input_tokens:10,output_tokens:20}}},
    {runId:'claude-api',provider:'claude',kind:'status',data:{auth:'api'}},
    {runId:'claude-api',provider:'claude',kind:'usage',data:{usage:{input_tokens:20,output_tokens:30}}},
    {runId:'claude-unknown',provider:'claude',kind:'usage',data:{usage:{input_tokens:30,output_tokens:40}}},
    {runId:'codex',provider:'codex',kind:'usage',data:{rateLimits:{primary:{usedPercent:80}}}},
  ].map((e,index)=>({...e,id:String(index),sessionId:e.runId,at,text:'',fidelity:'native'}));
  try{
    for(const e of events)store.appendEvent(e as TimelineEvent);store.close();store=new Store(directory);
    const sessions=runs.map(r=>({id:r.sessionId,provider:r.provider,memberId:r.id}));
    const result=tokenActivity(store.tokenUsageEvents(),sessions,runs,[],{now:at});
    assert.equal(result.total,270);assert.equal(result.subscription,150);assert.equal(result.days.at(-1)?.subscription,150);assert.equal(result.reportedRuns,4);
    assert.deepEqual(result.providers,[{provider:'claude',total:150,subscription:30},{provider:'codex',total:120,subscription:120}]);
    const api=tokenActivity(store.tokenUsageEvents(),sessions,runs,[],{now:at,memberId:'claude-api'});assert.equal(api.total,50);assert.equal(api.subscription,null);
    const empty=tokenActivity([],sessions,runs,[],{now:at});assert.equal(empty.subscription,null);assert.equal(empty.days.at(-1)?.total,null);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

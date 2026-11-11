import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Store} from '../src/backend/store';
import {Engine} from '../src/backend/engine';
import {activityEntries,activityMemberId,activityPreview,mergeActivityEvents} from '../src/shared/run-activity';
import {refreshAfterRpc} from '../src/shared/rpc-refresh';
import {RENDERER_METHODS} from '../src/shared/rpc-methods';
import type {TimelineEvent,Run} from '../src/shared/types';

const event=(id:string,kind:TimelineEvent['kind'],text:string,data?:unknown,runId='astra-run'):TimelineEvent=>({id,kind,text,data,runId,sessionId:'astra-session',provider:'codex',at:'2026-10-18T03:00:00.000Z',fidelity:'native'});

test('native Codex command lifecycle preserves command, streamed output, final output and nonzero exit',()=>{
  const events=[event('a','reasoning','检查配置'),event('b','reasoning','与测试。'),
    event('c','tool','开始命令',{id:'cmd',type:'commandExecution',command:'npm test',cwd:'D:/project',hivelabPhase:'started',status:'inProgress'}),
    event('d','output','正在运行\n',{itemId:'cmd'}),event('e','tool','结束命令',{id:'cmd',type:'commandExecution',hivelabPhase:'completed',status:'completed',aggregatedOutput:'测试失败',exitCode:1}),
    event('f','message','最终回复')];
  const rows=activityEntries(events,false);assert.equal(rows.length,2);assert.equal(rows[0].text,'检查配置与测试。');
  assert.equal(rows[1].input,'npm test\n工作目录：D:/project');assert.equal(rows[1].state,'failed');assert.equal(rows[1].output,'测试失败\n退出码：1');
  assert.equal(activityEntries(events.slice(0,4),true)[1].state,'running');assert.equal(activityEntries(events.slice(0,4),true)[1].output,'正在运行\n');
  assert.equal(activityEntries(events.slice(0,4),false)[1].state,'unknown','an ended run must not imply tool success');
  assert.match(activityEntries([event('diff','tool','文件差异已更新',{type:'diff',diff:'--- a/file\n+++ b/file\n+changed'})],false)[0].output!,/changed/);
});

test('DSH and future ACP partial updates merge by tool ID; Claude parent tools keep IDs separate',()=>{
  const acp=activityEntries([event('a','tool','读取文件',{toolCallId:'read',title:'读取文件',status:'in_progress',rawInput:{path:'README.md'}}),
    event('b','tool','read',{toolCallId:'read',status:'completed',content:[{type:'content',content:{type:'text',text:'文件内容'}}]}),
    event('c','tool','失败的工具',{toolCallId:'bad',status:'failed',rawOutput:{error:'权限不足'}})],true);
  assert.equal(acp.length,2);assert.equal(acp[0].title,'读取文件');assert.match(acp[0].input!,/README.md/);assert.match(acp[0].output!,/文件内容/);assert.equal(acp[0].state,'completed');assert.equal(acp[1].state,'failed');
  const claude=activityEntries([event('a','tool','Read',{id:'same',type:'tool_use',name:'Read',input:{path:'one'}}),
    event('b','tool','Read',{id:'same',type:'tool_use',name:'Read',input:{path:'two'},parent_tool_use_id:'child'}),
    event('c','tool','result',{tool_use_id:'same',type:'tool_result',content:'读取成功'}),
    event('d','tool','result',{tool_use_id:'same',type:'tool_result',parent_tool_use_id:'child',content:'读取失败',is_error:true})],false);
  assert.equal(claude.length,2);assert.equal(claude[0].state,'completed');assert.equal(claude[1].state,'failed');
  assert.equal(activityEntries([event('a','tool','end',{id:'bad',hivelabPhase:'completed',status:'failed',error:{message:'declined'}})],false)[0].state,'failed');
});

test('live/history merges deduplicate by ID and database order; members sharing Codex remain separate',()=>{
  const a={...event('a','reasoning','第一段'),sequence:1},b={...event('b','reasoning','第二段'),sequence:2};
  const rows=mergeActivityEvents([b],[a,b,{...a,sequence:undefined}]);assert.deepEqual(rows.map(row=>row.id),['a','b']);assert.equal(rows[0].sequence,1);
  const snapshot={sessions:[{id:'astra-session',memberId:'astra',provider:'codex'},{id:'sol-session',memberId:'sol',provider:'codex'}]} as any;
  assert.equal(activityMemberId(snapshot,a),'astra');assert.equal(activityMemberId(snapshot,{sessionId:'sol-session',provider:'codex'}),'sol');
});

test('activity history paginates finished runs without mixing sessions, preserving originals and redaction',()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'activity-history-')),store=new Store(root);
  try{
    for(let i=0;i<205;i++)store.appendEvent(event('a'+i,'reasoning','片段 '+i));
    store.appendEvent(event('reply','message','不要作为活动显示'));
    store.appendEvent(event('other','reasoning','Sol 私有任务',undefined,'sol-run'));
    const binary=event('binary','tool','媒体结果',{id:'media',status:'completed',rawInput:{api_key:'secret-example'},rawOutput:[{type:'image',data:'a'.repeat(50000)},{type:'text',text:'x'.repeat(50000)}]});store.appendEvent(binary);
    assert.equal(store.liveEvents().length,0,'completed history must not be required in live snapshots');
    let page=store.runActivity('astra-run',undefined,100),all=[...page.events],pages=1;
    assert.equal(page.events.length,100);assert.ok(page.before);assert.throws(()=>store.runActivity('sol-run',page.before),/分页位置/);assert.throws(()=>store.runActivity('astra-run','not-a-cursor'),/分页位置/);
    while(page.hasMore){page=store.runActivity('astra-run',page.before,100);all=[...page.events,...all];pages++;}
    assert.equal(pages,3);assert.equal(all.length,206);assert.equal(new Set(all.map(row=>row.id)).size,206);assert.equal(all[0].id,'a0');assert.ok(all.every(row=>row.runId==='astra-run'&&row.kind!=='message'));
    assert.ok(all.every((row,index)=>index===0||row.sequence!>all[index-1].sequence!));
    const display=JSON.stringify(all.at(-1));assert.doesNotMatch(display,/secret-example|a{5000}/);assert.match(display,/credential redacted/);assert.ok(display.length<27000);
    const original=store.runEvents('astra-run').at(-1)!;assert.equal((original.data as any).rawOutput[0].data.length,50000);assert.equal((original.data as any).rawOutput[1].text.length,50000);
    const preview=activityPreview(event('long','output','data:image/png;base64,'+'a'.repeat(50000)));assert.equal(preview.text,'[二进制内容已省略]');
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('activity RPC is a whitelisted read and rejects unknown runs without starting an executor',async()=>{
  assert.ok(RENDERER_METHODS.includes('run.activity'));assert.equal(refreshAfterRpc('run.activity'),false);
  const root=mkdtempSync(path.join(process.env.TEMP!,'activity-rpc-'));let starts=0;
  const engine=new Engine(root,()=>{},()=>{},()=>{starts++;throw Error('executor must not start');},{maintenanceOnly:true});
  try{
    engine.store.put('runs','astra-run',{id:'astra-run',sessionId:'astra-session',projectId:'p',provider:'codex',status:'ended',input:'prompt',createdAt:'2026-10-18',updatedAt:'2026-10-18',completedAt:'2026-10-18',bootId:'test',revision:1,delivery:'confirmed'} satisfies Run);
    engine.store.appendEvent(event('a','reasoning','真实记录'));
    const page=await engine.invoke('run.activity',{runId:'astra-run'}) as any;assert.equal(page.events[0].text,'真实记录');
    await assert.rejects(engine.invoke('run.activity',{runId:'missing'}));assert.equal(starts,0);
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

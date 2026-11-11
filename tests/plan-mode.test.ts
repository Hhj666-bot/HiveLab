import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {ClaudePermissionHost} from '../src/backend/adapters/claude';
import {codexCollaborationMode} from '../src/backend/adapters/codex';
import {Engine} from '../src/backend/engine';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';
import {PLAN_EXECUTE_TEXT,planCapable,planInTurn} from '../src/shared/plan-mode';
import type {Approval,Run,Session} from '../src/shared/types';

test('plan mode covers Claude, Codex and DSH; only Claude reviews inside the turn',()=>{
  for(const id of ['claude','codex','dsh'])assert.ok(planCapable(id));
  assert.ok(planCapable('acp-x','claude'));assert.ok(!planCapable('acp-y','kimi'));assert.ok(!planCapable('deepseek'));
  assert.ok(planInTurn('claude')&&planInTurn('acp-x','claude')&&!planInTurn('codex')&&!planInTurn('dsh'));
  assert.deepEqual(codexCollaborationMode(true,'gpt-x','high'),{mode:'plan',settings:{model:'gpt-x',reasoning_effort:'high',developer_instructions:null}});
  assert.equal(codexCollaborationMode(false,'gpt-x',undefined)?.mode,'default');
  assert.equal(codexCollaborationMode(true,undefined,undefined),undefined);
});

test('Claude plans without edits, asks for commands, and resumes on approval',async()=>{
  const asked:any[]=[];let answer:{choice:string;answers?:unknown}={choice:'revise',answers:{feedback:'先补测试'}};
  const context:any={run:{planMode:true},session:{writeMode:true},cwd:'D:/work',settings:{permissions:{claude:{mode:'full',commands:'auto',fileScope:'any',network:true}}},approve:async(request:any)=>{asked.push(request);return answer;}};
  const host=new ClaudePermissionHost(context,()=>context.settings.permissions.claude) as any;
  assert.equal((await host.handle('permission',{tool_name:'Edit',input:{file_path:'D:/work/a.ts'}})).behavior,'deny');
  answer={choice:'allow'};
  assert.equal((await host.handle('permission',{tool_name:'Bash',input:{command:'git log'}})).behavior,'allow');
  assert.equal(asked.at(-1).type,'approval');assert.match(asked.at(-1).detail,/计划阶段/);
  answer={choice:'revise',answers:{feedback:'先补测试'}};
  const revised=await host.handle('permission',{tool_name:'ExitPlanMode',input:{plan:'# 计划\n- 改 a.ts'}});
  assert.equal(asked.at(-1).type,'plan');assert.equal(asked.at(-1).detail,'# 计划\n- 改 a.ts');
  assert.equal(revised.behavior,'deny');assert.match(revised.message,/先补测试/);
  answer={choice:'execute'};
  const approved=await host.handle('permission',{tool_name:'ExitPlanMode',input:{plan:'# 计划'}});
  assert.equal(approved.behavior,'allow');assert.deepEqual(approved.updatedPermissions,[{type:'setMode',mode:'default',destination:'session'}]);
  // After approval the turn works normally: full access edits and commands go through without asking.
  const before=asked.length;
  assert.equal((await host.handle('permission',{tool_name:'Edit',input:{file_path:'D:/work/a.ts'}})).behavior,'allow');
  assert.equal((await host.handle('permission',{tool_name:'Bash',input:{command:'npm test'}})).behavior,'allow');
  assert.equal(asked.length,before);
  await host.close();
});

function fixture(provider:'codex'|'claude'|'dsh'){
  const root=mkdtempSync(path.join(process.env.TEMP!,'plan-mode-'));
  const turns:any[]=[];
  const engine=new Engine(root,()=>{},()=>{},id=>({
    async probe(){return {id,name:id,auth:'subscription',available:true,detail:'isolated',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true}};},
    async start(ctx,text){
      turns.push({planMode:ctx.run.planMode,writeMode:ctx.session.writeMode,text});ctx.markDelivery('confirmed');
      if(ctx.run.planMode&&id==='codex'){
        // A command the planner wants is never answered automatically before the plan is approved.
        const asked=ctx.approve({type:'approval',title:'Codex 请求执行命令',detail:'npm install',options:[{id:'accept',label:'允许'},{id:'decline',label:'拒绝'}],allowChoice:'accept',denyChoice:'decline',category:'command'});
        await new Promise(r=>setTimeout(r,50));const waiting=(engine.snapshot().approvals as Approval[]).filter(a=>a.state==='pending');turns.at(-1).pendingApprovals=waiting.length;
        if(waiting[0])await engine.invoke('approval.answer',{id:waiting[0].id,choice:'decline'});await asked;
        ctx.emit('plan','# 计划\n1. 读代码',{type:'plan',hivelabPlan:'# 计划\n1. 读代码'});
      }
      if(ctx.run.planMode&&id==='claude'){const reply=await ctx.approve({type:'plan',title:'Claude 提交了计划',detail:'# 计划\n1. 改代码',options:[{id:'execute',label:'按计划执行'},{id:'revise',label:'修改计划'}]});turns.at(-1).reply=reply;}
      ctx.emit('message','完成',{source:'assistant'});return {};
    },async stop(){}}),{maintenanceOnly:true});
  const until=async(read:()=>boolean)=>{for(let i=0;i<400;i++){if(read())return;await new Promise(r=>setTimeout(r,10));}throw Error('did not settle');};
  const runs=()=>engine.snapshot().runs as unknown as Run[],session=()=>(engine.snapshot().sessions as Session[]).find(s=>s.memberId==='sol')!;
  return {root,engine,turns,until,runs,session,async open(){
    engine.store.put('members','sol',{id:'sol',executor:provider,name:'Sol',color:'#339966',motto:''});
    await engine.probe(provider);await engine.invoke('desk.open',{memberId:'sol'});await engine.invoke('desk.topic',{memberId:'sol'});
  }};
}

test('Codex plans in its own mode, then the card starts the execution turn',async()=>{
  const f=fixture('codex');
  try{
    await f.open();
    await f.engine.invoke('member.permission',{memberId:'sol',mode:'full'});
    await assert.rejects(f.engine.invoke('session.planMode',{sessionId:f.session().id,on:'yes'}));
    await f.engine.invoke('session.planMode',{sessionId:f.session().id,on:true});assert.equal(f.session().planMode,true);
    await f.engine.invoke('room.send',{roomId:'desk:sol',text:'加一个导出按钮'});
    await f.until(()=>f.runs().some(r=>r.planProposal?.status==='ready'));
    assert.deepEqual({planMode:f.turns[0].planMode,writeMode:f.turns[0].writeMode,pendingApprovals:f.turns[0].pendingApprovals},{planMode:true,writeMode:true,pendingApprovals:1});
    const planned=f.runs().find(r=>r.planProposal)!;assert.equal(planned.planProposal!.text,'# 计划\n1. 读代码');
    // Feedback keeps plan mode and plans again; the earlier plan can no longer be approved.
    await assert.rejects(f.engine.invoke('plan.revise',{runId:planned.id,text:''}),/修改意见/);
    await f.engine.invoke('plan.revise',{runId:planned.id,text:'按钮放到右上角'});
    await f.until(()=>f.runs().filter(r=>r.planProposal?.status==='ready').length===1&&f.runs().length===2&&f.runs().every(r=>r.completedAt));
    assert.equal(f.runs().find(r=>r.id===planned.id)!.planProposal!.status,'revising');
    assert.equal(f.turns[1].planMode,true);assert.match(f.turns[1].text,/右上角/);
    await assert.rejects(f.engine.invoke('plan.execute',{runId:planned.id}));
    const second=f.runs().find(r=>r.planProposal?.status==='ready')!;
    await f.engine.invoke('plan.execute',{runId:second.id});
    await f.until(()=>f.turns.length===3&&f.runs().every(r=>r.completedAt));
    assert.equal(f.session().planMode,undefined);
    assert.deepEqual({planMode:f.turns[2].planMode,writeMode:f.turns[2].writeMode},{planMode:undefined,writeMode:true});
    assert.match(f.turns[2].text,new RegExp(PLAN_EXECUTE_TEXT));
    assert.equal(f.runs().find(r=>r.id===second.id)!.planProposal!.status,'approved');
    assert.equal(f.runs().find(r=>!r.planMode)?.planProposal,undefined);
  }finally{await f.engine.close();rmSync(f.root,{recursive:true,force:true});}
});

test('Claude reviews inside the turn; approval is never automatic and ends plan mode',async()=>{
  const f=fixture('claude');
  try{
    await f.open();
    await f.engine.invoke('member.permission',{memberId:'sol',mode:'full'});
    await f.engine.invoke('session.planMode',{sessionId:f.session().id,on:true});
    await f.engine.invoke('room.send',{roomId:'desk:sol',text:'重构'});
    await f.until(()=>f.runs().some(r=>r.planProposal?.status==='pending'));
    assert.equal(f.turns[0].writeMode,true);
    const run=f.runs().find(r=>r.planProposal)!,approval=(f.engine.snapshot().approvals as Approval[]).find(a=>a.id===run.planProposal!.approvalId)!;
    assert.equal(approval.type,'plan');assert.equal(approval.state,'pending');assert.equal(approval.autoApproved,undefined);
    await assert.rejects(f.engine.invoke('plan.execute',{runId:run.id}));
    await f.engine.invoke('approval.answer',{id:approval.id,choice:'execute'});
    await f.until(()=>f.runs().every(r=>r.completedAt));
    assert.deepEqual(f.turns[0].reply,{choice:'execute',answers:undefined});
    assert.equal(f.runs()[0].planProposal!.status,'approved');assert.equal(f.session().planMode,undefined);
  }finally{await f.engine.close();rmSync(f.root,{recursive:true,force:true});}
});

test('plan mode refuses unsupported executors and missing topics',async()=>{
  const f=fixture('codex');
  try{
    await f.open();
    await assert.rejects(f.engine.invoke('session.planMode',{sessionId:'missing',on:true}));
    const desk=f.session();f.engine.store.put('sessions',desk.id,{...desk,provider:'deepseek'});
    await assert.rejects(f.engine.invoke('session.planMode',{sessionId:desk.id,on:true}),/不支持/);
  }finally{await f.engine.close();rmSync(f.root,{recursive:true,force:true});}
});

test('DSH plans with its write and shell tools removed, in its own sandbox; its reply is the plan',async()=>{
  const f=fixture('dsh');
  try{
    await f.open();
    await f.engine.invoke('session.planMode',{sessionId:f.session().id,on:true});
    await f.engine.invoke('room.send',{roomId:'desk:sol',text:'整理目录'});
    await f.until(()=>f.runs().some(r=>r.planProposal?.status==='ready'));
    assert.deepEqual({planMode:f.turns[0].planMode,writeMode:f.turns[0].writeMode},{planMode:true,writeMode:true});
    assert.equal(f.runs()[0].planProposal!.text,undefined);
    const {dshPermissionDenial,dshSessionPolicy,buildDshPatch}=await import('../src/backend/adapters/dsh');
    const planning=dshSessionPolicy({mode:'full',commands:'auto',fileScope:'any',network:true},true,true);
    assert.equal(planning.sandboxMode,'danger-full-access');
    for(const tool of ['write','edit','ops_replace','pwsh','ops_bash','mcp__hivelab__create_file'])assert.ok(dshPermissionDenial(tool,{path:'a'},planning,'D:/work'),tool);
    for(const tool of ['read','ops_glob','ops_grep','web_fetch'])assert.equal(dshPermissionDenial(tool,{path:'a'},planning,'D:/work'),undefined,tool);
    const guard=(buildDshPatch({...DEFAULT_SETTINGS,permissions:{...DEFAULT_SETTINGS.permissions,dsh:{mode:'full',commands:'auto',fileScope:'any',network:true}}} as any,'D:/work',true,'D:/guard.mjs',undefined,[],undefined,true) as any[]).find(item=>item.insert?.[0]?.id==='hivelab-policy');
    // Only global tools may be hidden with tools.restrict(); per-agent ones are refused when called.
    const {DSH_GUARD_SOURCE}=await import('../src/backend/adapters/dsh');
    assert.match(DSH_GUARD_SOURCE,/planBlocked\(exec\.name, config\)/);
    assert.equal(guard.insert[0].config.planning,true);assert.equal(guard.insert[0].config.sandboxMode,'danger-full-access');
  }finally{await f.engine.close();rmSync(f.root,{recursive:true,force:true});}
});

test('DSH launches of one profile take turns until each has its config',async()=>{
  const {dshLaunchGate}=await import('../src/backend/adapters/dsh');
  const order:string[]=[];
  const first=await dshLaunchGate('profile-a');order.push('first');
  const second=dshLaunchGate('profile-a').then(release=>{order.push('second');return release;});
  const other=await dshLaunchGate('profile-b');order.push('other');other();
  await new Promise(r=>setTimeout(r,20));assert.deepEqual(order,['first','other']);
  first();(await second)();assert.deepEqual(order,['first','other','second']);
  // A launch that never reports still lets the next one go.
  await dshLaunchGate('profile-c',30);const next=await dshLaunchGate('profile-c');next();
});

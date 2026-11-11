import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {ClaudeTaskTracker,normalizeTodos,todoStatus} from '../src/shared/task-list';
import {claudeSessionPolicy,gitBashPath,CLAUDE_TASK_TOOLS} from '../src/backend/adapters/claude';
import {buildDshPatch,DSH_PARALLEL_TOOL_CALLS} from '../src/backend/adapters/dsh';
import {CODEX_PLAN_TOOL} from '../src/backend/adapters/codex';
import {Engine} from '../src/backend/engine';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';

test('task lists from Codex, DSH and TodoWrite share one shape',()=>{
  assert.deepEqual(normalizeTodos([{step:'读代码',status:'completed'},{step:'改测试',status:'inProgress'},{step:'部署',status:'pending'}]),[{content:'读代码',status:'completed'},{content:'改测试',status:'in_progress'},{content:'部署',status:'pending'}]);
  assert.deepEqual(normalizeTodos([{content:'检查',status:'in_progress'},{content:'',status:'pending'},null]),[{content:'检查',status:'in_progress'}]);
  assert.equal(normalizeTodos('x'),undefined);assert.equal(todoStatus('done'),'completed');assert.equal(todoStatus(undefined),'pending');
});

test('Claude Task tools build the list call by call',()=>{
  const tracker=new ClaudeTaskTracker();
  assert.equal(tracker.use('TaskCreate','t1',{subject:'读取配置',description:'x'}),undefined);
  assert.deepEqual(tracker.result('t1','Task #1 created successfully: 读取配置'),[{content:'读取配置',status:'pending'}]);
  tracker.use('TaskCreate','t2',{subject:'运行测试'});tracker.result('t2',[{type:'text',text:'Task #2 created successfully'}]);
  assert.deepEqual(tracker.use('TaskUpdate',undefined,{taskId:'1',status:'in_progress'}),[{content:'读取配置',status:'in_progress'},{content:'运行测试',status:'pending'}]);
  assert.deepEqual(tracker.use('TaskUpdate',undefined,{taskId:'1',status:'completed'})?.[0],{content:'读取配置',status:'completed'});
  assert.deepEqual(tracker.use('TaskUpdate',undefined,{taskId:'2',status:'deleted'}),[{content:'读取配置',status:'completed'}]);
  // A task from an earlier turn still shows instead of disappearing.
  assert.deepEqual(tracker.use('TaskUpdate',undefined,{taskId:'7',status:'in_progress'})?.at(-1),{content:'任务 #7',status:'in_progress'});
  assert.deepEqual(new ClaudeTaskTracker().use('TodoWrite','x',{todos:[{content:'A',status:'completed',activeForm:'a'}]}),[{content:'A',status:'completed'}]);
  assert.equal(tracker.use('Read','r',{file_path:'x'}),undefined);
});

test('Claude keeps task tools in every session and PowerShell beside Bash',()=>{
  const full={...DEFAULT_SETTINGS.permissions.claude,commands:'auto',network:true} as any;
  const readOnly=claudeSessionPolicy(full,false),write=claudeSessionPolicy(full,true),offline=claudeSessionPolicy({...full,network:false},true),denied=claudeSessionPolicy({...full,commands:'deny'},true);
  for(const policy of [readOnly,write,offline,denied])assert.ok(CLAUDE_TASK_TOOLS.every(tool=>policy.tools.includes(tool)));
  assert.ok(write.tools.includes('Bash')&&write.tools.includes('PowerShell'));
  for(const policy of [readOnly,offline,denied])assert.ok(!policy.tools.includes('Bash')&&!policy.tools.includes('PowerShell'));
});

test('Git Bash is found next to git.exe in non-standard installs',()=>{
  const files=new Set([path.resolve('D:/Git/cmd/git.exe'),path.resolve('D:/Git/bin/bash.exe')]);
  const exists=(file:string)=>files.has(path.resolve(file));
  assert.equal(gitBashPath({HIVELAB_TEST_WINDOWS_PATHS:'1',Path:'C:/Windows;D:/Git/cmd'},exists),path.resolve('D:/Git/bin/bash.exe'));
  files.delete(path.resolve('D:/Git/cmd/git.exe'));files.add(path.resolve('D:/Git/mingw64/bin/git.exe'));
  assert.equal(gitBashPath({HIVELAB_TEST_WINDOWS_PATHS:'1',Path:'D:/Git/mingw64/bin'},exists),path.resolve('D:/Git/bin/bash.exe'));
  assert.equal(gitBashPath({HIVELAB_TEST_WINDOWS_PATHS:'1',Path:'C:/Windows'},()=>false),undefined);
});

test('Codex turns on its update_plan task list',()=>{
  // Codex 0.166 rejects a boolean here; the table form is what it accepts.
  assert.deepEqual(CODEX_PLAN_TOOL,{'tools.update_plan.enabled':true});
});

test('DSH runs independent tool calls of one step together',()=>{
  const patch=buildDshPatch(DEFAULT_SETTINGS,'D:/work',true,'D:/guard.mjs');
  assert.equal((patch.find((item:any)=>item.id==='tools') as any).config.maxParallelSubCalls,DSH_PARALLEL_TOOL_CALLS);
  assert.ok(DSH_PARALLEL_TOOL_CALLS>1);
});

test('the latest task list is kept on the run for the card',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'task-list-'));let started=false;
  const engine=new Engine(root,()=>{},()=>{},id=>({async probe(){return {id,name:id,auth:'subscription',available:true,detail:'isolated',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true}};},
    async start(ctx){started=true;ctx.markDelivery('confirmed');ctx.emit('plan','· 读代码',{hivelabTodos:[{content:'读代码',status:'pending'}]});ctx.emit('plan','✓ 读代码',{hivelabTodos:[{content:'读代码',status:'completed'},{content:'写测试',status:'in_progress'}]});ctx.emit('message','完成',{source:'assistant'});return {};},async stop(){}}),{maintenanceOnly:true});
  const until=async(read:()=>boolean)=>{for(let i=0;i<300;i++){if(read())return;await new Promise(r=>setTimeout(r,10));}throw Error('did not settle');};
  try{
    engine.store.put('members','sol',{id:'sol',executor:'codex',name:'Sol',color:'#339966',motto:''});
    await engine.probe('codex');await engine.invoke('desk.open',{memberId:'sol'});await engine.invoke('desk.topic',{memberId:'sol'});await engine.invoke('room.send',{roomId:'desk:sol',text:'任务'});
    await until(()=>started&&engine.snapshot().runs.some(r=>!!r.completedAt));
    assert.deepEqual(engine.snapshot().runs.find(r=>r.todos)?.todos,[{content:'读代码',status:'completed'},{content:'写测试',status:'in_progress'}]);
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

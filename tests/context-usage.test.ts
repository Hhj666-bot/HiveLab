import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {contextBudget,contextReading,contextRows,contextTokens,estimateTokens,parseContextTokens,type ContextUsage} from '../src/shared/context-usage';
import {claudeContextEnvironment} from '../src/backend/adapters/claude';
import {codexContextConfig} from '../src/backend/adapters/codex';
import {buildDshPatch,dshContextPatch} from '../src/backend/adapters/dsh';
import {Engine} from '../src/backend/engine';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';

test('each executor report becomes one context reading',()=>{
  // Codex: the last request and the model window.
  assert.deepEqual(contextReading('codex',{tokenUsage:{total:{totalTokens:9e6},last:{totalTokens:240115,inputTokens:239796,cachedInputTokens:234240,outputTokens:319},modelContextWindow:475000}}),{used:240115,window:475000,input:239796,cached:234240,output:319});
  // Claude: the last request of the turn with cache reads and writes; the window of the main model.
  const claude=contextReading('claude',{usage:{input_tokens:12,cache_read_input_tokens:270230,cache_creation_input_tokens:54916,output_tokens:1674,iterations:[{input_tokens:2,output_tokens:1109,cache_read_input_tokens:54673,cache_creation_input_tokens:243}]},modelUsage:{'claude-opus-5-5':{outputTokens:1674,contextWindow:1000000},'claude-haiku':{outputTokens:10,contextWindow:200000}}});
  assert.deepEqual(claude,{used:54918+1109,window:1000000,input:54918,cached:54673,output:1109,model:'claude-opus-5-5'});
  // ACP standard usage_update (DSH, Antigravity, Kimi).
  assert.deepEqual(contextReading('acp-92d9d835acff',{sessionUpdate:'usage_update',used:76732,size:1048576}),{used:76732,window:1048576});
  // DSH per-step usage: cache reads are outside its input count.
  assert.equal(contextReading('dsh',{hivelabTokenUsage:{inputTokens:238,outputTokens:544,cacheReadTokens:524416,totalTokens:525198}})!.used,525198);
  // OpenAI-style prompt_tokens already include the cached part.
  assert.equal(contextReading('acp-catalogzcode',{usage:{prompt_tokens:33049,completion_tokens:932,prompt_tokens_details:{cached_tokens:19136}}})!.used,33981);
  // Rate limits and quota notices are not readings.
  assert.equal(contextReading('codex',{rateLimits:{primary:{usedPercent:60}}}),undefined);
  assert.equal(contextReading('acp-catalogzcode',{requests:2,limit:12}),undefined);
});

test('the user limit never exceeds the window; the panel rows add up to the limit',()=>{
  assert.deepEqual(contextBudget({window:1_000_000,provider:'claude'},{contextLimit:400_000}),{limit:400_000,window:1_000_000,custom:400_000,percent:85,threshold:340_000});
  assert.equal(contextBudget({window:200_000,provider:'codex'},{contextLimit:400_000}).limit,200_000);
  const usage:ContextUsage={sessionId:'s',runId:'r',provider:'claude',at:'',used:300_000,window:1_000_000,previous:250_000,baseline:40_000,
    parts:{persona:3000,skills:1000,notes:2000,tools:0,mcpTools:{count:12,tokens:4000,names:['read_file']},memoryFiles:[{name:'CLAUDE.md',tokens:500}]}};
  const view=contextRows(usage,{contextLimit:400_000,contextPercent:80});
  const get=(key:string)=>view.rows.find(row=>row.key===key)!.tokens;
  assert.equal(get('since'),50_000);assert.equal(get('native'),40_000-10_500);assert.equal(get('messages'),250_000-29_500-10_500);
  assert.equal(get('buffer'),80_000);assert.equal(get('free'),20_000);assert.equal(view.left,20_000);
  assert.equal(view.rows.reduce((sum,row)=>sum+row.tokens,0),400_000);
  assert.equal(parseContextTokens('400k'),400_000);assert.equal(parseContextTokens('1M'),1_000_000);assert.equal(parseContextTokens('200'),200_000);assert.equal(parseContextTokens('20万'),200_000);assert.equal(parseContextTokens('abc'),undefined);
  assert.equal(contextTokens(576_800),'576.8k');assert.equal(contextTokens(1_000_000),'1M');
  assert.equal(estimateTokens('你好world!!'),2+2);
});

test('the budget reaches Claude, Codex and DSH as their own compaction settings',()=>{
  assert.deepEqual(claudeContextEnvironment({limit:400_000,percent:80}),{CLAUDE_CODE_AUTO_COMPACT_WINDOW:'400000',CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:'80'});
  // Claude counts only the conversation: the fixed part comes off its point (85k total − 57k fixed = 28k of 100k).
  assert.deepEqual(claudeContextEnvironment({limit:100_000,percent:85,prefix:57_000}),{CLAUDE_CODE_AUTO_COMPACT_WINDOW:'100000',CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:'28'});
  assert.equal(claudeContextEnvironment({limit:50_000,percent:80}).CLAUDE_CODE_AUTO_COMPACT_WINDOW,'100000');
  assert.deepEqual(claudeContextEnvironment(undefined),{});
  assert.deepEqual(codexContextConfig({limit:200_000,percent:85}),{model_auto_compact_token_limit:170_000,model_auto_compact_token_limit_scope:'total'});
  assert.deepEqual(dshContextPatch({limit:400_000,percent:80,window:1_000_000}),[{id:'compaction-basic',config:{thresholdRatio:0.32,retainRatio:0.16}}]);
  assert.deepEqual(dshContextPatch({limit:100_000,percent:60,window:1_000_000}),[{id:'compaction-basic',config:{thresholdRatio:0.06,retainRatio:0.03}}]);
  assert.deepEqual(dshContextPatch({limit:100_000,percent:60}),[]);
  const patch=buildDshPatch(DEFAULT_SETTINGS,'D:/work',true,'D:/guard.mjs',undefined,[],undefined,false,{limit:500_000,percent:90,window:1_000_000}) as any[];
  assert.deepEqual(patch.find(item=>item.id==='compaction-basic').config,{thresholdRatio:0.45,retainRatio:0.16});
});

test('the engine keeps one reading per topic and checks the user limit against the window',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'context-'));const turns:any[]=[];
  const engine=new Engine(root,()=>{},()=>{},id=>({async probe(){return {id,name:id,auth:'subscription',available:true,detail:'isolated',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true}};},
    async start(ctx){turns.push(ctx);ctx.markDelivery('confirmed');ctx.persistNativeSession('thread-1','hivelab');
      const used=turns.length===1?60_000:90_000;
      ctx.emit('usage','用量',{tokenUsage:{last:{totalTokens:used,inputTokens:used-500,outputTokens:500},modelContextWindow:400_000}});
      ctx.emit('message','好',{source:'assistant'});return {};},async stop(){}}),{maintenanceOnly:true});
  const until=async(read:()=>boolean)=>{for(let i=0;i<300;i++){if(read())return;await new Promise(r=>setTimeout(r,10));}throw Error('did not settle');};
  try{
    engine.store.put('members','sol',{id:'sol',executor:'codex',name:'Sol',color:'#339966',motto:'',persona:'Sol 的人设'});
    await engine.probe('codex');await engine.invoke('desk.open',{memberId:'sol'});await engine.invoke('desk.topic',{memberId:'sol'});
    const session=()=>engine.snapshot().sessions.find(s=>s.memberId==='sol')!;
    await assert.rejects(engine.invoke('context.config',{sessionId:session().id,limit:200_000}),/还没有读到/);
    await engine.invoke('room.send',{roomId:'desk:sol',text:'第一轮'});
    await until(()=>engine.snapshot().runs.some(r=>!!r.completedAt));
    let usage=engine.snapshot().contextUsage!.find(u=>u.sessionId===session().id)!;
    assert.equal(usage.used,60_000);assert.equal(usage.window,400_000);assert.equal(usage.baseline,60_000);assert.equal(usage.previous,undefined);
    assert.ok(usage.parts!.persona>0&&usage.parts!.mcpTools.count>0,'HiveLab parts are recorded');
    await assert.rejects(engine.invoke('context.config',{sessionId:session().id,limit:500_000}),/不能超过模型自带的上限 400k/);
    await assert.rejects(engine.invoke('context.config',{sessionId:session().id,limit:1000}),/不能低于/);
    await assert.rejects(engine.invoke('context.config',{sessionId:session().id,percent:99}),/50% 到 95%/);
    // A point below 1.5 × the topic's fixed part (60k) would compact every turn.
    await assert.rejects(engine.invoke('context.config',{sessionId:session().id,limit:100_000,percent:80}),/压缩点太低.*至少要 90k/);
    await engine.invoke('context.config',{sessionId:session().id,limit:200_000,percent:80});
    assert.equal(session().contextLimit,200_000);assert.equal(engine.store.members().find(m=>m.id==='sol')!.contextLimit,200_000);
    await engine.invoke('room.send',{roomId:'desk:sol',text:'第二轮'});
    await until(()=>engine.snapshot().runs.filter(r=>!!r.completedAt).length===2);
    assert.deepEqual(turns[1].contextBudget,{limit:200_000,percent:80,window:400_000,prefix:60_000});assert.equal(turns[0].contextBudget,undefined);
    usage=engine.snapshot().contextUsage!.find(u=>u.sessionId===session().id)!;
    assert.equal(usage.used,90_000);assert.equal(usage.previous,60_000);assert.equal(usage.baseline,60_000);
    await engine.invoke('context.config',{sessionId:session().id,limit:null,percent:null});
    assert.equal(session().contextLimit,undefined);assert.equal(engine.store.members().find(m=>m.id==='sol')!.contextLimit,undefined);
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('a long Claude system prompt goes through a private file, not the command line',async()=>{
  const {writeClaudePromptFile}=await import('../src/backend/adapters/claude');
  const {readFileSync,mkdtempSync:temp,rmSync:remove,existsSync}=await import('node:fs');
  const folder=temp(path.join(process.env.TEMP!,'claude-prompt-'));
  try{const text='人设'.repeat(20_000);const file=writeClaudePromptFile(folder,text);assert.equal(readFileSync(file,'utf8'),text);assert.ok(file.startsWith(path.join(folder,'hivelab-prompts')));assert.ok(existsSync(file));}
  finally{remove(folder,{recursive:true,force:true});}
});

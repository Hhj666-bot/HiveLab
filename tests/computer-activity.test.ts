import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComputerActivityTracker } from '../src/shared/computer-activity';
import type { TimelineEvent } from '../src/shared/types';
const event=(runId:string,data:unknown,provider='codex')=>({runId,provider,kind:'tool',data} as TimelineEvent);
test('Codex, DSH/ACP and Claude share one concurrent tool activity lifecycle',()=>{
  const tracker=new ComputerActivityTracker();
  tracker.event(event('astra',{id:'a',type:'mcpToolCall',tool:'mcp__node_repl__js',arguments:{code:'await sky.click({x:1})'},hivelabPhase:'started'}));
  tracker.event(event('ds',{toolCallId:'a',title:'pwsh',status:'in_progress',rawInput:{command:'node task.js'}},'dsh'));
  tracker.event(event('claude',{id:'c',type:'tool_use',name:'computer',input:{action:'click'}},'claude'));
  assert.equal(tracker.current().computer,true);assert.deepEqual(tracker.current().runIds,['astra','ds','claude']);
  tracker.event(event('astra',{id:'a',hivelabPhase:'completed'}));
  tracker.event(event('claude',{type:'tool_result',tool_use_id:'c'},'claude'));
  assert.deepEqual(tracker.current().runIds,['ds']);assert.equal(tracker.current().computer,false);
  tracker.event(event('ds',{toolCallId:'a',status:'failed'},'dsh'));
  assert.equal(tracker.current().active,false);
});
test('duplicates, cancellation, worker loss and late events cannot leave a stale indicator',()=>{
  const tracker=new ComputerActivityTracker();
  tracker.event(event('r',{id:'x',type:'tool_use',name:'computer'}));
  tracker.event(event('r',{type:'tool_result',tool_use_id:'x'}));
  tracker.event(event('r',{id:'x',type:'tool_use',name:'computer'}));
  assert.equal(tracker.current().active,false);
  tracker.event(event('s',{toolCallId:'y',title:'browser',status:'in_progress'},'acp-other123'));
  tracker.reconcile([{id:'s',status:'stopped'}]);assert.equal(tracker.current().active,false);
  tracker.event(event('s',{id:'z',type:'commandExecution',hivelabPhase:'started'}));tracker.clear();assert.equal(tracker.current().active,false);
});
test('ordinary model text and native read/search events do not claim desktop control',()=>{
  const tracker=new ComputerActivityTracker();
  tracker.event({...event('r',{id:'a',name:'computer'}),kind:'message'});
  tracker.event(event('r',{toolCallId:'b',title:'Read file',kind:'read',status:'completed'},'dsh'));
  tracker.event(event('r',{toolCallId:'c',title:'browser',status:'pending'},'acp-other123'));
  assert.equal(tracker.current().active,false);
});

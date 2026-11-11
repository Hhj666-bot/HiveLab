import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Engine} from '../src/backend/engine';
import {latestPersona} from '../src/backend/native-context';
import {SUBAGENT_BRIEF,SUBAGENT_BRIEF_MARK,subagentWaitCap,type SubagentRecord} from '../src/shared/subagents';

test('subagent brief passes through adapters unchanged, member cards stay wrapped',()=>{
  assert.equal(latestPersona(SUBAGENT_BRIEF),SUBAGENT_BRIEF);
  assert.match(latestPersona('人设：Sol'),/人物与记忆更新/);
  assert.equal(subagentWaitCap('dsh'),50);assert.equal(subagentWaitCap('codex'),600);
});

test('main agent sends subagents through the shared tool bridge without the member card',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'subagents-'));
  let main:any,releaseMain!:()=>void;const mainDone=new Promise<void>(r=>releaseMain=r);
  const subs:any[]=[];const hold=new Map<string,()=>void>();
  const engine=new Engine(root,()=>{},()=>{},id=>{
    let ctx:any,stopRelease:(()=>void)|undefined;
    return {
      async probe(){return {id,name:id,auth:'subscription',available:true,detail:'isolated',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true},modelOptions:[{id:'fast-model',label:'Fast',efforts:['low','high']},{id:'deep-model',label:'Deep',efforts:['high'],isDefault:true}]};},
      async start(context,text){
        ctx=context;
        if(!context.persona?.startsWith(SUBAGENT_BRIEF_MARK)){main=context;context.markDelivery('confirmed');await mainDone;context.emit('message','主回答',{source:'assistant'});return {};}
        subs.push({context,text});
        if(text.includes('挂起')){await new Promise<void>(r=>{stopRelease=r;hold.set(context.run.id,r);});return {stopped:true};}
        context.emit('delta','我先看看',undefined);context.emit('tool','调用：Read',{name:'Read'});context.emit('delta','答案：',undefined);context.emit('delta','42',undefined);
        return {summary:'答案：42'};
      },
      async stop(){stopRelease?.();},
    };
  },{maintenanceOnly:true});
  const until=async(read:()=>boolean)=>{for(let i=0;i<300;i++){if(read())return;await new Promise(r=>setTimeout(r,10));}throw Error('did not settle');};
  const call=async(env:any,name:string,args:any={})=>{const r=await fetch(env.HIVELAB_CONTROL_URL,{method:'POST',headers:{Authorization:'Bearer '+env.HIVELAB_CONTROL_TOKEN},body:JSON.stringify({name,arguments:args})});const data=await r.json() as any;if(r.status!==200)throw Error(data.error);return data.result;};
  try{
    engine.store.put('members','sol',{id:'sol',executor:'codex',name:'Sol',color:'#339966',motto:'',persona:'Sol 的独特人设'});
    await engine.probe('codex');await engine.invoke('desk.open',{memberId:'sol'});await engine.invoke('desk.topic',{memberId:'sol'});await engine.invoke('room.send',{roomId:'desk:sol',text:'主任务'});
    await until(()=>!!main);
    assert.match(main.persona,/subagent_start/);
    const listed=await fetch(main.env.HIVELAB_CONTROL_URL,{method:'POST',headers:{Authorization:'Bearer '+main.env.HIVELAB_CONTROL_TOKEN},body:JSON.stringify({name:'list'})}).then(r=>r.json()) as any;
    assert.ok(['subagent_models','subagent_start','subagent_wait','subagent_stop'].every(n=>listed.tools.some((t:any)=>t.name===n)));
    const models=await call(main.env,'subagent_models');assert.deepEqual(models.models.map((m:any)=>m.id),['fast-model','deep-model']);
    await assert.rejects(call(main.env,'subagent_start',{task:'x',model:'nope'}),/没有模型/);
    await assert.rejects(call(main.env,'subagent_start',{task:'x',model:'deep-model',effort:'low'}),/不支持思考程度/);
    const started=await call(main.env,'subagent_start',{task:'查找配置项的默认值',title:'检索配置',model:'fast-model',effort:'low'});
    assert.equal(started.status,'running');assert.equal(started.index,1);
    const waited=await call(main.env,'subagent_wait',{seconds:5});
    assert.equal(waited.subagents.length,1);assert.equal(waited.subagents[0].status,'completed');assert.equal(waited.subagents[0].result,'答案：42');
    const sub=subs[0];
    assert.equal(sub.context.persona,SUBAGENT_BRIEF);assert.doesNotMatch(sub.context.persona,/Sol/);
    assert.match(sub.text,/查找配置项的默认值/);assert.match(sub.text,/只读/);
    assert.equal(sub.context.settings.models.codex,'fast-model');assert.equal(sub.context.settings.efforts.codex,'low');
    assert.equal(sub.context.cwd,main.cwd);assert.equal(sub.context.session.writeMode,false);
    assert.notEqual(sub.context.env.HIVELAB_CONTROL_TOKEN,main.env.HIVELAB_CONTROL_TOKEN);
    const record=engine.snapshot().subagents!.find((r:SubagentRecord)=>r.id===started.id)!;
    assert.equal(record.status,'completed');assert.equal(record.delivered,true);assert.ok(record.entries.some(e=>e.kind==='tool'&&/Read/.test(e.text)));
    // Already delivered results are not waited on again.
    assert.equal((await call(main.env,'subagent_wait',{seconds:1})).subagents.length,0);
    // A subagent of a read-only session cannot write, and runs at most four at a time.
    if(!main.session.writeMode)await assert.rejects(call(main.env,'subagent_start',{task:'改文件',write:true}),/只读/);
    const hung=await call(main.env,'subagent_start',{task:'挂起等待'});
    await until(()=>subs.length===2);
    const subEnv=subs[1].context.env;
    const subTools=await fetch(subEnv.HIVELAB_CONTROL_URL,{method:'POST',headers:{Authorization:'Bearer '+subEnv.HIVELAB_CONTROL_TOKEN},body:JSON.stringify({name:'list'})}).then(r=>r.json()) as any;
    assert.ok(!subTools.tools.some((t:any)=>t.name.startsWith('subagent_')||t.name==='ask_user'||t.name==='update_persona'));
    await assert.rejects(call(subEnv,'subagent_start',{task:'嵌套'}),/子代理只能使用|工具未知/);
    await assert.rejects(call(subEnv,'members'),/子代理只能使用|工具未知/);
    const partial=await call(main.env,'subagent_wait',{ids:[hung.id],seconds:0});assert.equal(partial.subagents[0].status,'running');
    const stopped=await call(main.env,'subagent_stop',{id:hung.id});assert.equal(stopped.status,'stopped');
    // Ending the main turn stops subagents that are still running.
    const orphan=await call(main.env,'subagent_start',{task:'挂起直到主任务结束'});
    await until(()=>subs.length===3);
    releaseMain();
    await until(()=>engine.store.get<SubagentRecord>('subagents',orphan.id)?.status==='stopped');
    assert.match(engine.store.get<SubagentRecord>('subagents',orphan.id)!.error!,/主代理/);
  }finally{releaseMain();for(const r of hold.values())r();await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('Antigravity (Gemini over ACP) sends subagents through the same bridge with a short wait cap',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'subagents-ag-'));
  let main:any,releaseMain!:()=>void;const mainDone=new Promise<void>(r=>releaseMain=r);const subs:any[]=[];
  const engine=new Engine(root,()=>{},()=>{},id=>id==='acp-0a1b2c3d4e5f'||id==='acp-0f0e0d0c0b0a'?{
    async probe(){return {id,name:'Antigravity',auth:'subscription',available:true,detail:'acp',capabilities:{steer:false,cancel:'native',streaming:true,write:true,history:true},modelOptions:[{id:'gemini-3.8-flash',label:'Flash',efforts:['low','high']},{id:'gemini-4-argon',label:'Argon',efforts:[]}]} as any;},
    async start(context,text){
      if(!context.persona?.startsWith(SUBAGENT_BRIEF_MARK)){main=context;context.markDelivery('confirmed');await mainDone;return {};}
      subs.push({context,text});context.emit('delta','Gemini 子代理答案',undefined);return {summary:'Gemini 子代理答案'};
    },async stop(){}}:undefined as any,{maintenanceOnly:true});
  const until=async(read:()=>boolean)=>{for(let i=0;i<300;i++){if(read())return;await new Promise(r=>setTimeout(r,10));}throw Error('did not settle');};
  const call=async(env:any,name:string,args:any={})=>{const r=await fetch(env.HIVELAB_CONTROL_URL,{method:'POST',headers:{Authorization:'Bearer '+env.HIVELAB_CONTROL_TOKEN},body:JSON.stringify({name,arguments:args})});const data=await r.json() as any;if(r.status!==200)throw Error(data.error);return data.result;};
  try{
    assert.equal(subagentWaitCap('acp-0a1b2c3d4e5f','antigravity'),50);assert.equal(subagentWaitCap('acp-x','claude'),600);
    engine.store.put('executors','acp-0a1b2c3d4e5f',{id:'acp-0a1b2c3d4e5f',name:'Antigravity',catalogId:'antigravity',command:'agy_acp_server.exe',args:[],env:{},permissions:{commands:'ask',fileScope:'workspace',network:true}});
    engine.store.put('members','gem',{id:'gem',executor:'acp-0a1b2c3d4e5f',name:'Gemini',color:'#8866cc',motto:'',persona:'Gemini 的人设'});
    await engine.probe('acp-0a1b2c3d4e5f' as any);await engine.invoke('desk.open',{memberId:'gem'});await engine.invoke('desk.topic',{memberId:'gem'});await engine.invoke('room.send',{roomId:'desk:gem',text:'主任务'});
    await until(()=>!!main);
    assert.match(main.persona,/subagent_start/);
    assert.deepEqual((await call(main.env,'subagent_models')).models.map((m:any)=>m.id),['gemini-3.8-flash','gemini-4-argon']);
    const started=await call(main.env,'subagent_start',{task:'统计 src 下的文件数',model:'gemini-3.8-flash',effort:'low'});
    const waited=await call(main.env,'subagent_wait',{seconds:600});
    assert.equal(waited.subagents[0].status,'completed');assert.equal(waited.subagents[0].result,'Gemini 子代理答案');
    const sub=subs[0];assert.equal(sub.context.persona,SUBAGENT_BRIEF);assert.doesNotMatch(sub.context.persona,/Gemini 的人设/);
    assert.equal(sub.context.run.provider,'acp-0a1b2c3d4e5f');assert.equal(sub.context.run.requestedConfig.model,'gemini-3.8-flash');assert.equal(sub.context.session.writeMode,false);
    assert.equal(engine.snapshot().subagents!.find((r:SubagentRecord)=>r.id===started.id)!.provider,'acp-0a1b2c3d4e5f');
    // Other ACP programs are not eligible until verified.
    engine.store.put('executors','acp-0f0e0d0c0b0a',{id:'acp-0f0e0d0c0b0a',name:'Kimi',catalogId:'kimi',command:'kimi',args:[],env:{},permissions:{commands:'ask',fileScope:'workspace',network:true}});
    assert.equal((engine as any).subagents.eligible({...[...engine['active'].values()][0],ctx:{...main,run:{...main.run,provider:'acp-0f0e0d0c0b0a'}}} as any),false);
  }finally{releaseMain();await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('a real ACP adapter run: the Antigravity main agent reaches subagent tools over MCP, the subagent prompt has no member brief',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'subagents-acp-'));
  const engine=new Engine(root,()=>{},()=>{},undefined,{maintenanceOnly:true});
  const until=async(read:()=>boolean,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(read())return;await new Promise(r=>setTimeout(r,50));}throw Error('did not settle');};
  try{
    const id='acp-0a1b2c3d4e6f';
    engine.store.put('executors',id,{id,name:'Antigravity',catalogId:'antigravity',command:path.resolve('tests/fixtures/subagent-acp.mjs'),args:[],env:{},permissions:{mode:'full',commands:'auto',fileScope:'any',network:true},createdAt:new Date(0).toISOString()});
    engine.store.put('members','gem',{id:'gem',executor:id,name:'Gemini',color:'#8866cc',motto:'',persona:'Gemini 的人设：说话带星星'});
    await engine.probe(id as any);await engine.invoke('desk.open',{memberId:'gem'});await engine.invoke('desk.topic',{memberId:'gem'});await engine.invoke('room.send',{roomId:'desk:gem',text:'派一个子代理'});
    // The read-only subagent's command waits for the user even under full access; its edit is refused outright.
    await until(()=>engine.snapshot().approvals.some(a=>a.state==='pending'));
    const asked=engine.snapshot().approvals.filter(a=>a.state==='pending');
    assert.equal(asked.length,1);assert.equal(asked[0].category,'subagent-readonly-command');assert.match(asked[0].title,/子代理 #1/);assert.match(asked[0].detail,/只读子代理/);
    // "本话题都允许" covers the later read-only commands of this topic.
    await engine.invoke('approval.answer',{id:asked[0].id,choice:'hivelab:allow-category'});
    await until(()=>engine.snapshot().runs.some(r=>r.provider===id&&!!r.completedAt));
    const room=await engine.invoke('room.get',{roomId:'desk:gem'}) as any,reply=room.messages.filter((m:any)=>m.author==='gem').at(-1)?.text??'';
    assert.match(reply,/MAIN models=.* status=completed result=cmd=allow edit=deny again=allow SUB brief=clean card=no task=ok/);
    assert.match(engine.snapshot().approvals.find(a=>/dir \/a/.test(a.detail))?.autoApproved??'',/只读子代理的命令/);
    const record=engine.snapshot().subagents!.at(-1)!;assert.equal(record.provider,id);assert.equal(record.status,'completed');
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

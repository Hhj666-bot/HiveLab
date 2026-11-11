import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {Engine} from '../src/backend/engine';
import {Store} from '../src/backend/store';
import {RoomDiscussionController} from '../src/backend/room-discussion';
import {loungeDeskEnabled} from '../src/shared/lounge-capabilities';
import {plainRoomSpeech,deskRoomSpeech} from '../src/backend/adapters/chat-policy';
import {codexSessionPolicy} from '../src/backend/adapters/codex';
import {claudeSessionPolicy} from '../src/backend/adapters/claude';
import {dshSessionPolicy} from '../src/backend/adapters/dsh';
import {acpDenial} from '../src/backend/adapters/acp';
import type {Session,Run,AdapterContext,ProviderId} from '../src/shared/types';

test('desk-capable tea-room tasks can work longer than the limited speech idle window',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'lounge-long-work-'));
  let captured:AdapterContext|undefined;
  const engine=new Engine(root,()=>{},()=>{},id=>({
    async probe(){return {id,name:id,available:true,auth:'subscription',detail:'mock',capabilities:{steer:false,cancel:'request',streaming:true,write:true,history:true}};},
    async start(ctx){captured=ctx;ctx.markDelivery('confirmed');await new Promise(r=>setTimeout(r,120));if(ctx.session.writeMode)writeFileSync(path.join(ctx.cwd,'completed.txt'),'completed in work mode');ctx.emit('message','完成');return {};},
    async stop(){},
  }),{maintenanceOnly:true,roomReplyIdleMs:20,runBudgetMs:2000});
  engine.store.put('members','sol',{id:'sol',name:'Sol',executor:'codex',color:'#123456'});
  try{
    await engine.invoke('member.permission',{memberId:'sol',mode:'full'});await engine.probe('codex');
    await engine.invoke('room.capabilities',{mode:'desk'});
    const session:Session=await (engine as any).loungeSession(engine.store.members().find(m=>m.id==='sol'));
    const sent=await engine.invoke('session.send',{sessionId:session.id,text:'测试长工具任务'}) as {runId:string};
    for(let i=0;i<200&&engine.store.get<Run>('runs',sent.runId)?.status!=='ended';i++)await new Promise(r=>setTimeout(r,10));
    const run=engine.store.get<Run>('runs',sent.runId)!;
    assert.equal(run.status,'ended',run.error??'work-capable turn should finish');assert.equal(captured?.session.writeMode,true);
    assert.equal(readFileSync(path.join(root,'lounge','completed.txt'),'utf8'),'completed in work mode');
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('tea-room capability switch persists, keeps visible history and separates native contexts',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'lounge-capabilities-'));
  const engine=new Engine(root,()=>{},()=>{},undefined,{maintenanceOnly:true}),internals=engine as any;
  engine.store.put('members','sol',{id:'sol',name:'Sol',executor:'codex',color:'#123456'});
  try{
    const member=engine.store.members().find(m=>m.id==='sol')!;
    const limited:Session=await internals.loungeSession(member);
    assert.equal(limited.writeMode,false);
    engine.store.put('sessions',limited.id,{...limited,nativeId:'restricted-context',nativeHome:'hivelab'});
    const thread=engine.store.currentRoomThread();
    engine.store.put('room_messages','kept-message',{id:'kept-message',author:'user',text:'保留已有决定',at:new Date().toISOString(),threadId:thread.id,status:'done'});
    await engine.invoke('room.capabilities',{mode:'desk'});
    assert.equal(engine.store.roomState().capabilityMode,'desk');
    assert.ok(engine.store.get<Session>('sessions',limited.id)?.roomRetiredAt);
    const work:Session=await internals.loungeSession(member);
    assert.notEqual(work.id,limited.id);assert.equal(work.nativeId,undefined);
    assert.equal(work.writeMode,true);assert.equal(work.workspaceKind,'original');
    assert.equal(work.workspace,path.join(root,'lounge'));
    assert.ok(engine.store.get('room_messages','kept-message'));
    for(const purpose of ['room-hand','room-image','room-minutes'] as const)assert.equal((await internals.loungeSession(member,purpose)).writeMode,false);
    assert.equal((await internals.loungeSession(member,undefined,undefined,true)).writeMode,false,'automatic greetings remain limited');
    await engine.invoke('room.capabilities',{mode:'limited'});
    const again:Session=await internals.loungeSession(member);assert.equal(again.writeMode,false);assert.notEqual(again.id,limited.id);
    await engine.invoke('room.capabilities',{mode:'desk'});
  }finally{await engine.close();}
  const reopened=new Store(root);
  try{assert.equal(reopened.roomState().capabilityMode,'desk');assert.ok(reopened.get('room_messages','kept-message'));}
  finally{reopened.close();rmSync(root,{recursive:true,force:true});}
});

for(const provider of ['codex','claude','dsh','acp-testlounge'] as const)test(`${provider}: tea-room work uses desk permissions; switching back restores room restrictions`,async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'lounge-policy-')),engine=new Engine(root,()=>{},()=>{},undefined,{maintenanceOnly:true}),internals=engine as any;
  engine.store.put('members','member',{id:'member',name:'测试成员',executor:provider,color:'#123456'});
  if(provider==='acp-testlounge')engine.store.put('executors',provider,{id:provider,name:'测试 ACP',command:'mock',args:[],env:{},permissions:{commands:'auto',fileScope:'any',network:true},createdAt:new Date().toISOString()});
  try{
    await engine.invoke('member.permission',{memberId:'member',mode:'full'});
    const member=engine.store.members().find(m=>m.id==='member')!;
    const context=(session:Session):AdapterContext=>internals.context({id:'test-'+session.id,sessionId:session.id,projectId:session.projectId,provider,input:'测试',revision:1,status:'queued',createdAt:new Date().toISOString(),requestedConfig:{}} as unknown as Run,session);
    const limited=context(await internals.loungeSession(member));
    assert.equal(limited.settings.permissions[provider].commands,'deny');assert.equal(limited.session.writeMode,false);assert.equal(plainRoomSpeech(limited),true);
    await engine.invoke('room.capabilities',{mode:'desk'});
    const work=context(await internals.loungeSession(member));
    assert.equal(work.settings.permissions[provider].commands,'auto');assert.equal(work.settings.permissions[provider].fileScope,'any');assert.equal(work.session.writeMode,true);assert.equal(plainRoomSpeech(work),false);assert.equal(deskRoomSpeech(work),true);
    if(provider==='codex'){assert.equal(codexSessionPolicy(work.settings.permissions.codex,work.session.writeMode,work.session.autoApprove).sandbox,'danger-full-access');assert.equal(codexSessionPolicy(limited.settings.permissions.codex,limited.session.writeMode).sandbox,'read-only');}
    if(provider==='claude'){const full=claudeSessionPolicy(work.settings.permissions.claude,work.session.writeMode),restricted=claudeSessionPolicy(limited.settings.permissions.claude,limited.session.writeMode);assert.ok(full.tools.includes('Write')&&full.tools.includes('Bash'));assert.ok(!restricted.tools.includes('Write')&&!restricted.tools.includes('Bash'));}
    if(provider==='dsh')assert.equal(dshSessionPolicy(work.settings.permissions.dsh,work.session.writeMode).sandboxMode,'danger-full-access');
    if(provider==='acp-testlounge'){assert.equal(acpDenial('execute',work.settings.permissions[provider],work.session.writeMode),undefined);assert.ok(acpDenial('execute',limited.settings.permissions[provider],limited.session.writeMode));}
    await engine.invoke('member.permission',{memberId:'member',mode:'request'});
    const requested=context(await internals.loungeSession(member));
    assert.equal(requested.settings.permissions[provider].mode,'request');assert.equal(requested.settings.permissions[provider].fileScope,'workspace','work mode does not override member restrictions');
    await engine.invoke('room.capabilities',{mode:'limited'});
    assert.equal(context(await internals.loungeSession(member)).settings.permissions[provider].commands,'deny');
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('capability changes reject active turns, invalid values and project-room escalation',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'lounge-busy-')),engine=new Engine(root,()=>{},()=>{},undefined,{maintenanceOnly:true});
  try{
    await assert.rejects(engine.invoke('room.capabilities',{mode:'anything'}),/请选择/);
    engine.store.put('room','state',{...engine.store.roomState(),active:true});
    await assert.rejects(engine.invoke('room.capabilities',{mode:'desk'}),/先暂停/);
    engine.store.put('room','state',{...engine.store.roomState(),active:false});
    engine.store.put('projects','p',{id:'p',name:'测试项目',directory:root,createdAt:new Date().toISOString(),collaborationPaused:false});engine.store.ensureProjectRoom('p');
    await assert.rejects(engine.invoke('room.capabilities',{roomId:'project:p',mode:'desk'}),/仅用于茶歇室/);
    assert.equal(loungeDeskEnabled('project:p','desk'),false);
    assert.equal(loungeDeskEnabled('global','desk','room-hand'),false);
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('both full and incremental discussion prompts follow the selected tool capability',async()=>{
  const root=mkdtempSync(path.join(process.env.TEMP!,'lounge-prompt-')),store=new Store(root);
  try{
    const controller=new RoomDiscussionController(store,{changed(){},alive:()=>true,busy:()=>false} as any) as any;
    const discussion={style:'chat',phase:'talking',members:['sol'],seen:{},priority:[],questions:[],reviewRequired:[],calls:0,limit:0,revision:1};
    const member={id:'sol',executor:'codex',name:'Sol',color:'#123456'},view={messages:[],references:[],recent:[],background:[],incremental:false,caughtUp:true,through:1};
    store.put('room','state',{...store.roomState(),capabilityMode:'limited'});
    assert.match(controller.prompt(discussion,member,'turn',view),/不要使用工具、读写文件或执行命令/);
    store.put('room','state',{...store.roomState(),capabilityMode:'desk'});
    for(const incremental of [false,true]){
      const prompt=controller.prompt(discussion,member,'turn',{...view,incremental});assert.match(prompt,/茶歇室已启用工位能力/);assert.ok(!prompt.includes('普通发言不使用工具、读写文件或执行命令'));
    }
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

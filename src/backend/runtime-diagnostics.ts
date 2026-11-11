import {createHash} from 'node:crypto';
import {closeSync,existsSync,openSync,readFileSync,readSync,statSync} from 'node:fs';
import path from 'node:path';
import type {AdapterContext,ProviderId,ProviderInfo,Run,Session,Settings,TimelineEvent} from '../shared/types';
import type {DiagnosticItem,DiagnosticState,RunDiagnosticContext,RuntimeDiagnostics} from '../shared/runtime-diagnostics';
import {effectiveConfigText} from '../shared/executor-config';
import {redact} from './security';

const text=(value:unknown)=>typeof value==='string'?value.slice(0,1500):undefined;
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const item=(id:string,label:string,state:DiagnosticState,value:string,reason:string,source:string,observedAt?:string,eventId?:string):DiagnosticItem=>({id,label,state,value,reason,source,observedAt:observedAt??null,eventId});

export function captureRunDiagnosticContext(ctx:AdapterContext):RunDiagnosticContext {
  const homeKey=ctx.run.provider==='codex'?'HIVELAB_CODEX_HOME':ctx.run.provider==='claude'?'HIVELAB_CLAUDE_HOME':ctx.run.provider==='dsh'?'HIVELAB_DSH_HOME':undefined;
  const home=homeKey?ctx.env[homeKey]:undefined;
  const permissions=ctx.run.provider==='deepseek'?undefined:ctx.settings.permissions[ctx.run.provider];
  return {capturedAt:new Date().toISOString(),cwd:ctx.cwd,home:home&&path.isAbsolute(home)?home:undefined,
    permissions:permissions?{...permissions}:undefined,
    writeMode:ctx.session.writeMode,autoApprove:ctx.session.autoApprove===true};
}

/** Read only the plugin's known Codex storage layout. Never import or execute plugin code. */
function stopThatShit(home:string|undefined,nativeId:string|undefined,run:Run|undefined):DiagnosticItem[] {
  const rows:DiagnosticItem[]=[];
  if(!home||!path.isAbsolute(home))return [item('plugin','原生插件配置','unknown','独立目录未确认','不会回退读取桌面端的 Codex home。','执行端目录'),item('contract','Stop That Shit 合同','unknown','合同未确认','缺少本轮独立目录，不查询其他账号的数据。','本轮运行记录')];
  const configFile=path.join(home,'config.toml');
  try{
    if(statSync(configFile).size>1024*1024)throw Error('配置超过读取范围');
    const config=readFileSync(configFile,'utf8');
    // Recognize only this literal table and a single boolean; unfamiliar TOML remains unknown.
    const tables=[...config.matchAll(/^\[plugins\."stop-that-shit@stop-that-shit"\][ \t]*(?:#.*)?\r?\n([^]*?)(?=^\s*\[|$(?![^]))/gm)];
    const matches=tables.length===1?[...tables[0][1].matchAll(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/gm)]:[];
    rows.push(item('plugin','原生插件配置',matches.length===1?'configured':'unknown',matches.length===1?(matches[0][1]==='true'?'已启用':'已停用'):'未确认',
      '配置启用与逐消息 Skill 选择独立；配置文件不能证明 Hook 已加载或已受信任。',configFile,statSync(configFile).mtime.toISOString()));
  }catch(error){rows.push(item('plugin','原生插件配置','unknown','配置不可读取',`未执行原生安装器：${(error as Error).message}`,configFile));}
  rows.push(item('hook-trust','Hook 加载与信任','unknown','未单独观测','插件配置与信任文件不作为本次宿主实际执行证明。','原生宿主'));
  if(!nativeId){rows.push(item('contract','Stop That Shit 合同','unknown','本轮原生会话未确认','不会使用当前会话的其他 native ID 查询历史运行。','本轮运行记录'));return rows;}
  const key=createHash('sha256').update(nativeId).digest('hex').slice(0,24);
  const root=path.join(home,'plugins','data','stop-that-shit-stop-that-shit');
  const file=path.join(root,'sessions',key+'.json');
  try{
    if(existsSync(file+'.lock'))throw Error('合同正在更新或遗留锁尚未核对');
    if(statSync(file).size>1024*1024)throw Error('合同超过读取范围');
    const saved=JSON.parse(readFileSync(file,'utf8')),contract=saved.contract;
    if(saved.schemaVersion!==4||!object(contract)||saved.storageError
      ||!['unconfirmed','answer','review','change','monitor','open'].includes(contract.mode)
      ||!['watch','guard','lock','off'].includes(contract.level))throw Error('合同格式不受支持或记录已损坏');
    rows.push(item('contract','Stop That Shit 合同','configured',`${contract.mode} / ${contract.level}`,
      `当前原生会话的持久记录，可能晚于所选运行；来源：${text(contract.source)??'未记录'}。不表示宿主约束已实际生效。`,file,statSync(file).mtime.toISOString()));
  }catch(error){rows.push(item('contract','Stop That Shit 合同','unknown','合同未确认',`没有推断为 change：${(error as Error).message}`,file));}
  const auditFile=path.join(root,'runtime',key+'.jsonl');
  try{
    // Bounded tail read: large audit logs do not block the workbench or copy tool inputs.
    const length=statSync(auditFile).size,offset=Math.max(0,length-256*1024),buffer=Buffer.alloc(length-offset);
    const fd=openSync(auditFile,'r');try{readSync(fd,buffer,0,buffer.length,offset);}finally{closeSync(fd);}
    const lines=buffer.toString('utf8').split('\n');if(offset)lines.shift();
    const start=run?Date.parse(run.createdAt):0,end=run?.completedAt?Date.parse(run.completedAt):Date.now();
    const events=lines.flatMap(line=>{try{const e=JSON.parse(line);return e.schemaVersion===1&&e.sessionKey===key&&Date.parse(e.occurredAt)>=start&&Date.parse(e.occurredAt)<=end?[e]:[];}catch{return [];}});
    const latest=events.at(-1),denied=events.filter(e=>['deny','block','ask'].includes(e.decision?.policyOutcome)).at(-1);
    if(latest)rows.push(item('hook-event','Hook 调用记录','observed',`${text(latest.controlState)??'未知'} · ${text(latest.decision?.responseOutcome)??'未报告响应'}`,
      '插件记录了调用；hostEffect 仍为 unobserved，不推断工具已被宿主阻止。',auditFile,latest.occurredAt,text(latest.eventId)));
    if(denied)rows.push(item('hook-refusal','本轮最近插件拒绝/询问','observed',text(denied.decision?.reasonCode)??'未报告原因',
      `插件政策结论：${text(denied.decision?.policyOutcome)}；宿主执行效果未观测。`,auditFile,denied.occurredAt,text(denied.eventId)));
    if(!latest)rows.push(item('hook-event','Hook 调用记录','unknown','未找到本轮调用','缺少记录不等于 Hook 未启用。',auditFile));
  }catch{rows.push(item('hook-event','Hook 调用记录','unknown','调用日志不可读取','不执行 Hook，也不生成诊断日志来补造证据。',auditFile));}
  return rows;
}

export function runtimeDiagnostics(input:{provider:ProviderId;info?:ProviderInfo;run?:Run;session?:Session;events:TimelineEvent[];settings:Settings;home?:string}):RuntimeDiagnostics {
  const {provider,info,run,session,settings}=input,at=new Date().toISOString(),context=run?.diagnosticContext;
  const events=input.events.filter(e=>e.runId===run?.id&&e.sessionId===run?.sessionId);
  const nativeEvent=events.filter(e=>e.kind==='session'&&object(e.data)&&typeof e.data.nativeId==='string').at(-1);
  const nativeId=context?.nativeId??(nativeEvent&&object(nativeEvent.data)?nativeEvent.data.nativeId:undefined);
  // Historical runs never borrow a home or session ID from the current provider/session.
  const home=run?context?.home:input.home,identity=run?.executorIdentity;
  const programPath=run?identity?.path:info?.path,version=run?identity?.version:info?.version;
  const infoSource=info?.connectionCheck?.source==='run'?'执行端连接记录（由运行确认）':'执行端连接检查';
  const permission=context?.permissions??(!run&&provider!=='deepseek'?settings.permissions[provider]:undefined);
  const permissionMode={full:'完全访问',assist:'帮我批准',request:'请求批准'};
  const auth={subscription:'订阅登录',account:'原生账号',api:'API 认证',none:'未登录',unknown:'未确认'};
  const delivery={prepared:'待发送',sent:'已发出',confirmed:'原生已确认',unknown:'投递待核对',withdrawn:'已撤回'};
  const failure=events.filter(e=>e.kind==='error'||e.kind==='approval'||e.kind==='question').at(-1);
  const rowSource=context?'运行派发快照':run?'本轮未保存快照':'当前工作台设置';
  const sections:RuntimeDiagnostics['sections']=[
    {id:'skill-evidence',label:'本轮技能证据',items:[
      ...(run?.messageSkills??[]).map(s=>item('selected:'+s.source+':'+s.id,s.name+' · 用户选择','observed',`${s.source} · ${s.contentHash??'历史记录未保存摘要'}`,`发送时冻结；${s.provenance?.manager??'来源管理者未记录'}；${s.provenance?.version?'版本 '+s.provenance.version:'以内容摘要标识版本'}。`,s.path,s.frozenAt??run?.createdAt)),
      ...(run?.messageSkills??[]).filter(s=>s.source!=='common').map(s=>item('native-discovery:'+s.source+':'+s.id,s.name+' · 原生目录发现',s.provenance?'observed':'unknown',s.provenance?`${s.provenance.source} · ${s.provenance.home}`:'本轮未保存目录发现快照','仅采用发送时的目录观察；不会用后来磁盘上的版本改写本轮证据。',s.path,s.provenance?.inspectedAt)),
      item('attached','工作台附加正文',run?.skillAttachments?.length?'observed':'unknown',run?.skillAttachments?.map(s=>`${s.name} (${s.source}) · ${s.contentHash}`).join('；')??'没有本轮附加记录','正文已放入本轮输入，与原生自动加载及任务投递分别记录。','本轮 skillAttachments',run?.skillAttachments?.[0]?.attachedAt),
      ...events.filter(e=>e.fidelity==='derived'&&object(e.data)&&object(e.data.hivelabSkillRead)).map(e=>item('skill-read:'+e.id,'按需读取技能正文','observed',`${text((e.data as any).hivelabSkillRead.id)} · ${text((e.data as any).hivelabSkillRead.contentHash)}`,'工作台 read_skill 成功返回正文；不推断后续步骤已执行。',text((e.data as any).hivelabSkillRead.path)??'技能工具桥',e.at,e.id)),
      item('native-skill-loading','原生自动加载','unknown','当前执行端未提供逐技能加载凭据','目录发现、已启用、用户选择及正文附加均不作为原生加载证明；Hook 记录单列。','原生端'),
    ]},
    {id:'connection',label:'程序与连接',items:[
      item('program','执行端程序',programPath?(run?'observed':'configured'):'unknown',programPath??'未记录',run?'仅显示本轮执行端身份；缺少历史身份时不借用当前程序路径。':'最近检查记录；不会启动执行端查询。',run?'本轮 executorIdentity':infoSource,run?run.updatedAt:info?.checkedAt),
      item('version','程序版本',version?(run?'observed':'configured'):'unknown',version??'未报告',identity?.versionSource==='manifest'?'来自本轮程序包清单。':'以来源记录为准；历史运行缺少版本时不借用当前版本。',run?'本轮 executorIdentity':infoSource,run?run.updatedAt:info?.checkedAt),
      item('connection','连接检查',info?.stale?'stale':info?.available?'observed':info?.checkedAt?'blocked':'unknown',info?.stale?'记录待刷新':info?.available?'检查可用':'未确认可用',info?.detail??'尚无连接检查记录。',infoSource,info?.checkedAt),
    ]},
    {id:'account',label:'账号',items:[item('account','认证记录',info?.stale?'stale':info?.auth&&info.auth!=='unknown'?'observed':'unknown',auth[info?.auth??'unknown'],'显示最近检查记录，不读取凭据或发起登录。',infoSource,info?.checkedAt),item('home','独立数据目录',home?'configured':'unknown',home??'本轮未记录','只使用该执行端的独立目录。',context?rowSource:'执行端环境',context?.capturedAt)]},
    {id:'session',label:'会话与配置',items:[
      item('session','工作台会话',session?'observed':'unknown',run?.sessionId??'未选择运行','按所选运行关联，不按成员名称猜测。','运行记录',run?.createdAt),
      item('native','原生会话',nativeId?'observed':'unknown',nativeId??'未记录','仅采用本轮捕获的 ID，不借用后续会话。',context?.nativeId?rowSource:'本轮原生会话事件',nativeEvent?.at??context?.capturedAt,nativeEvent?.id),
      item('cwd','实际工作目录',context?'configured':'unknown',context?.cwd??'本轮未记录','派发时的执行位置；历史记录不会用当前目录补写。',rowSource,context?.capturedAt),
      item('model','模型与思考程度',run?.effectiveConfig?.modelStatus==='reported'||run?.effectiveConfig?.effortStatus==='reported'?'observed':run?.effectiveConfig?'configured':'unknown',effectiveConfigText(run?.requestedConfig,run?.effectiveConfig),'“已接受请求”与“原生报告实际值”按原始配置记录区分。',run?.effectiveConfig?.source??'本轮配置记录',run?.effectiveConfig?.at??run?.requestedConfig?.capturedAt),
    ]},
    {id:'delivery',label:'任务投递',items:[
      item('delivery','投递回执',run?.delivery==='unknown'?'unknown':run?'observed':'unknown',run?delivery[run.delivery]:'未选择运行','原生确认表示执行端接收了回合，业务成果仍需核对。','运行投递记录',run?.updatedAt),
      item('status','运行状态',run?.status==='unknown'?'unknown':run?'observed':'unknown',run?.status??'无运行','保留原始运行状态，完成与成果验收分别处理。','运行记录',run?.updatedAt),
      item('blocker','最近阻塞/询问',failure||run?.error?'observed':'unknown',text(failure?.text??run?.error)??'本轮未记录','显示最近记录，不表示问题仍未解决；没有记录不推断为无阻塞。',failure?'本轮事件':'运行记录',failure?.at??run?.updatedAt,failure?.id),
    ]},
    {id:'permissions',label:'工具权限',items:[item('permissions','工作台权限配置',permission?'configured':'unknown',permission?`${permission.mode?permissionMode[permission.mode]:'自定义'} · 命令${{auto:'自动批准',ask:'询问',deny:'禁止'}[permission.commands]} · 文件${permission.fileScope==='any'?'不限制':'限于工作区'} · 联网${permission.network?'允许':'关闭'}`:'本轮未保存权限快照','这是请求配置，不是所有原生权限与 Hook 的生效证明。',rowSource,context?.capturedAt),
      item('write','本轮写入与审批',context?'configured':'unknown',context?`${context.writeMode?'允许写入':'只读'} · ${context.autoApprove?'会话自动批准':'按审批设置'}`:'本轮未记录','按派发快照展示，不从当前设置回推历史运行。',rowSource,context?.capturedAt)]},
    {id:'hooks',label:'技能、原生插件与 Hook',items:[
      item('skills','本条消息选择的 Skills',run?'observed':'unknown',run?(run.messageSkills?.map(s=>`${s.name} (${s.source})`).join('、')||'未选择'):'未选择运行','这里只表示本轮选择与冻结记录；不表示原生未加载其他技能，也不负责启停 Hook。','本轮 messageSkills',run?.createdAt),
      ...(provider==='codex'?stopThatShit(home,nativeId,run):[item('contract','Stop That Shit 合同','unknown','当前执行端未提供只读诊断','首版支持 Codex 已知存储格式；不跨执行端或账号猜测。','原生插件')]),
    ]},
  ];
  return redact({provider,runId:run?.id,sessionId:run?.sessionId,nativeId,fetchedAt:at,sections});
}

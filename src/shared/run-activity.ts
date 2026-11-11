import {t} from './i18n';
import type { RunSummary, Snapshot, TimelineEvent } from './types';

export const ACTIVITY_KINDS = ['progress','reasoning','plan','tool','output','status','warning','error','approval','question'] as const;
export const isActivityEvent = (event: TimelineEvent) => (ACTIVITY_KINDS as readonly string[]).includes(event.kind);
export const activeActivityRun = (run: Pick<RunSummary,'status'|'completedAt'>) => !run.completedAt && ['queued','running','waiting_user','stopping','rate_limited'].includes(run.status);
export function liveWorkLabel(run:RunSummary|undefined,events:TimelineEvent[]){
  if(!run)return t("等待执行端返回内容");
  if(run.status==='queued')return t("已排队，等待执行");
  if(run.status==='waiting_user')return t("等待审批或补充信息");
  if(run.status==='stopping')return t("正在停止并核对执行状态");
  const entries=activityEntries(events.filter(e=>e.runId===run.id),true),tool=entries.findLast(e=>e.kind==='tool'&&['running','pending'].includes(e.state??''));
  if(tool)return `${tool.state==='pending'?t("等待执行"):t("正在执行")}：${tool.title}`;
  return entries.at(-1)?.kind==='reasoning'?t("执行端正在返回思考摘要"):entries.at(-1)?.kind==='progress'?t("正在处理，查看进度说明"):t("等待执行端返回内容");
}
export interface RunActivityPage { runId: string; events: TimelineEvent[]; hasMore: boolean; before?: string }
export interface ActivityEntry {
  id: string; kind: TimelineEvent['kind']; at: string; text: string; fidelity: TimelineEvent['fidelity'];
  toolId?: string; title?: string; state?: 'running'|'pending'|'completed'|'failed'|'unknown'; input?: string; output?: string;
}
const object = (value: unknown): Record<string,any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,any> : {};

/** Keep previews textual and bounded; screenshots and other binary tool results are not log text. */
export function activityText(value: unknown, max = 24000): string {
  if(value===undefined||value===null)return '';
  let text: string;
  if(typeof value==='string')text=/^data:(image|audio)\/[^,]+;base64,/i.test(value)||value.length>4096&&/^[A-Za-z0-9+/=\r\n]+$/.test(value)?t("[二进制内容已省略]"):value;
  else try{text=JSON.stringify(value,(_key,item)=>{
    if(item&&typeof item==='object'&&['image','audio'].includes(item.type))return {type:item.type,note:t("媒体内容已省略")};
    if(typeof item==='string'&&item.length>4096&&/^[A-Za-z0-9+/=\r\n]+$/.test(item))return t("[二进制内容已省略]");
    return typeof item==='string'&&item.length>max?t("{0}\n[内容较长，后续已省略]", item.slice(0,max)):item;
  },2);}catch{text=t("[内容无法显示]");}
  return text.length>max?t("{0}\n[内容较长，后续已省略]", text.slice(0,max)):text;
}
/** Transport projection only. Original events stay intact in the database. */
export function activityPreview(event: TimelineEvent): TimelineEvent {
  let budget=128000;
  const preview=(value:any,depth=0):any=>{
    if(depth>10||budget<=0)return t("[内容已省略]");
    if(typeof value==='string'){const text=activityText(value,Math.max(0,Math.min(24000,budget)));budget-=text.length;return text.length>4096&&/^[A-Za-z0-9+/=\r\n]+$/.test(text)?t("[二进制内容已省略]"):text;}
    if(Array.isArray(value))return value.slice(0,80).map(item=>preview(item,depth+1));
    if(value&&typeof value==='object'){
      if(['image','audio'].includes(value.type))return {type:value.type,note:t("媒体内容已省略")};
      return Object.fromEntries(Object.entries(value).slice(0,80).map(([key,item])=>[key,preview(item,depth+1)]));
    }
    return value;
  };
  const data=event.data===undefined?undefined:preview(event.data);
  return {...event,text:activityText(event.text,64000),...(data===undefined?{}:{data})};
}
export function mergeActivityEvents(before: TimelineEvent[], after: TimelineEvent[]) {
  const events=new Map(before.map(event=>[event.id,event]));
  for(const event of after){const old=events.get(event.id);events.set(event.id,old?.sequence!==undefined&&event.sequence===undefined?old:event);}
  return [...events.values()].sort((a,b)=>a.sequence!==undefined&&b.sequence!==undefined?a.sequence-b.sequence:a.at.localeCompare(b.at));
}
export const activityMemberId = (snapshot: Pick<Snapshot,'sessions'>, run: Pick<RunSummary,'provider'|'sessionId'>) => {
  const session=snapshot.sessions.find(session=>session.id===run.sessionId);
  return session?.memberId??session?.provider??run.provider;
};
const titleOf = (data: Record<string,any>, fallback: string) => data.type==='commandExecution'?t("执行命令"):data.type==='fileChange'?t("修改文件"):String(data.title??data.name??data.tool??data.type??fallback??t("工具操作")).replace(/^(开始|结束|调用)：/,'').split('\n')[0].slice(0,140);

/** Coalesce native lifecycles into tool cards without fabricating success or hidden reasoning. */
export function activityEntries(events: TimelineEvent[], active: boolean): ActivityEntry[] {
  const rows: ActivityEntry[]=[], tools=new Map<string,ActivityEntry>();
  let textRow: ActivityEntry|undefined;
  for(const event of events){
    if(!isActivityEvent(event))continue;
    const data=object(event.data);
    if(event.kind==='tool'){
      textRow=undefined;
      const rawId=data.toolCallId??data.tool_use_id??data.id;
      const toolId=typeof rawId==='string'?JSON.stringify([data.parent_tool_use_id??'',rawId]):undefined;
      const key=toolId??event.id;
      let row=tools.get(key);
      if(!row){row={id:event.id,kind:'tool',toolId:rawId,at:event.at,text:'',fidelity:event.fidelity,title:titleOf(data,event.text)};tools.set(key,row);rows.push(row);}
      if(data.name||data.title||data.tool||data.command||!row.title)row.title=titleOf(data,event.text);
      const input=data.rawInput??data.arguments??data.input??data.command??data.changes??data.action??data.prompt;
      if(input!==undefined)row.input=activityText(input);
      const output=data.rawOutput??data.aggregatedOutput??data.result??data.diff??data.patch??data.contentItems??data.content;
      if(output!==undefined)row.output=activityText(output);
      if(data.cwd)row.input=[row.input,t("工作目录：{0}", data.cwd)].filter(Boolean).join('\n');
      const phase=data.hivelabPhase??data.phase??data.status;
      const failed=[phase,data.status].some(value=>['failed','error','declined','cancelled','canceled','interrupted'].includes(value))||data.is_error===true||data.isError===true||data.success===false||Boolean(data.error)||typeof data.exitCode==='number'&&data.exitCode!==0;
      if(failed)row.state='failed';
      else if(data.type==='tool_result'||phase==='completed')row.state='completed';
      else if(row.state!=='completed'&&row.state!=='failed')row.state=phase==='pending'?'pending':active?'running':'unknown';
      if(data.exitCode!==undefined)row.output=[row.output,t("退出码：{0}", data.exitCode)].filter(Boolean).join('\n');
      if(data.error)row.output=[row.output,activityText(data.error)].filter(Boolean).join('\n');
      continue;
    }
    if(event.kind==='output'){
      const id=data.itemId??data.toolCallId??data.tool_use_id;
      const row=typeof id==='string'?tools.get(JSON.stringify([data.parent_tool_use_id??'',id])):undefined;
      if(row){row.output=activityText((row.output??'')+event.text,48000);textRow=undefined;continue;}
    }
    if(!event.text.trim())continue;
    if(textRow&&textRow.kind===event.kind&&['progress','reasoning','output'].includes(event.kind)&&textRow.fidelity===event.fidelity){textRow.text=activityText(textRow.text+event.text,48000);continue;}
    textRow={id:event.id,kind:event.kind,at:event.at,text:event.text,fidelity:event.fidelity};rows.push(textRow);
  }
  return rows;
}

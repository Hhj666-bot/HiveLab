import type {TimelineEvent,Session,RunSummary} from './types';
export function formatTokenCount(value:number|null){
 if(value===null||!Number.isFinite(value)||value<0)return '—';
 const units=['','K','M','B','T'];let unit=0,amount=value;
 while(amount>=1000&&unit<units.length-1){amount/=1000;unit++;}
 let rounded=Number(amount.toFixed(unit===0?0:amount>=100?0:amount>=10?1:2));
 if(rounded>=1000&&unit<units.length-1){rounded/=1000;unit++;}
 return rounded.toLocaleString('en-US',{maximumFractionDigits:2})+units[unit];
}
export type TokenCounts={total:number;input?:number;output?:number;cached?:number;reasoning?:number};
export type TokenDay={date:string;total:number|null;input:number|null;output:number|null;cached:number|null;reasoning:number|null;runs:number;reportedRuns:number;subscription:number|null};
export type TokenActivity={days:TokenDay[];timeZone:string;today:string;members:{id:string;name:string}[];reportedRuns:number;totalRuns:number;total:number;subscription:number|null;providers:{provider:string;total:number;subscription:number|null}[]};
const record=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:undefined;
/** Cache/reasoning counts are subsets for OpenAI/DSH. Anthropic input excludes cache reads/writes. */
export function tokenCounts(raw:unknown,anthropic=false):TokenCounts|undefined{
  const v=record(raw),input=count(v.inputTokens??v.prompt_tokens??v.input_tokens),output=count(v.outputTokens??v.completion_tokens??v.output_tokens);
  const cached=count(v.cachedInputTokens??v.cacheReadTokens??v.cache_read_input_tokens??v.prompt_cache_hit_tokens??v.input_tokens_details?.cached_tokens??v.prompt_tokens_details?.cached_tokens);
  const write=count(v.cacheWriteInputTokens??v.cacheWriteTokens??v.cache_creation_input_tokens);
  const total=count(v.totalTokens??v.total_tokens)??(input!==undefined&&output!==undefined?input+output+(anthropic?(cached??0)+(write??0):0):undefined);
  if(total===undefined)return;
  return {total,...(input===undefined?{}:{input:input+(anthropic?(cached??0)+(write??0):0)}),...(output===undefined?{}:{output}),...(cached===undefined?{}:{cached}),...(count(v.reasoningOutputTokens??v.reasoningTokens??v.completion_tokens_details?.reasoning_tokens)===undefined?{}:{reasoning:count(v.reasoningOutputTokens??v.reasoningTokens??v.completion_tokens_details?.reasoning_tokens)})};
}
export function calendarDate(at:string,timeZone:string){const date=new Date(at);if(!Number.isFinite(date.getTime()))return '';const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),part=(type:string)=>parts.find(p=>p.type===type)?.value;return `${part('year')}-${part('month')}-${part('day')}`;}
export function calendarShift(date:string,days:number){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function tokenActivity(events:TimelineEvent[],sessions:Pick<Session,'id'|'memberId'|'provider'>[],runs:Pick<RunSummary,'id'|'sessionId'|'createdAt'|'provider'>[],members:{id:string;name:string}[],options:{timeZone?:string;memberId?:string;now?:string}={}):TokenActivity{
  const timeZone=options.timeZone??'Asia/Shanghai';new Intl.DateTimeFormat('en',{timeZone}).format();
  const today=calendarDate(options.now??new Date().toISOString(),timeZone),from=calendarShift(today,-364),bySession=new Map(sessions.map(s=>[s.id,s])),byRun=new Map(runs.map(r=>[r.id,r]));
  const authByRun=new Map<string,string>();
  for(const event of events){const auth=record(event.data).auth;if(auth==='subscription'||auth==='api')authByRun.set(event.runId,auth);}
  const nativeTotals=new Map<string,TokenCounts>(),samples=new Map<string,{event:TimelineEvent;counts:TokenCounts}>();
  // Fold the full retained event history before date filtering, so cumulative threads have a baseline.
  for(const event of events){
    if(event.kind&&event.kind!=='usage')continue;
    const data=record(event.data);let counts:TokenCounts|undefined,key='';
    if(event.provider==='codex'&&data.tokenUsage){
      const total=tokenCounts(data.tokenUsage.total),last=tokenCounts(data.tokenUsage.last);if(!total&&!last)continue;
      const thread=String(data.threadId??event.sessionId),prior=nativeTotals.get(thread);
      if(total){nativeTotals.set(thread,total);if(prior&&total.total>=prior.total){counts={total:total.total-prior.total};for(const field of ['input','output','cached','reasoning'] as const)if(total[field]!==undefined&&prior[field]!==undefined)counts[field]=Math.max(0,total[field]!-prior[field]!);}else counts=last??total;}else counts=last;
      key=event.id;
    }else if(event.provider==='claude'){counts=tokenCounts(data.usage??data,true);key='claude:'+event.runId;}
    else{counts=tokenCounts(data.hivelabTokenUsage??data.usage??data);key=data.hivelabUsageId?`${event.provider}:${data.hivelabUsageId}`:event.id;}
    if(counts)samples.set(key,{event,counts});
  }
  const days=new Map<string,TokenDay>();for(let date=from;date<=today;date=calendarShift(date,1))days.set(date,{date,total:null,input:null,output:null,cached:null,reasoning:null,runs:0,reportedRuns:0,subscription:null});
  const selected=(run:{sessionId:string;provider:string})=>!options.memberId||(bySession.get(run.sessionId)?.memberId??run.provider)===options.memberId;
  const providers=new Map<string,{provider:string;total:number;subscription:number|null}>();
  const reported=new Map<string,Set<string>>(),seen=new Set<string>();
  for(const {event,counts} of samples.values()){
    const run=byRun.get(event.runId);if(!run||!selected(run))continue;const date=calendarDate(event.at,timeZone),day=days.get(date);if(!day)continue;
    const subscription=(authByRun.get(event.runId)??(event.provider==='codex'?'subscription':undefined))==='subscription';
    const provider=providers.get(event.provider)??{provider:event.provider,total:0,subscription:null};provider.total+=counts.total;
    if(subscription){day.subscription=(day.subscription??0)+counts.total;provider.subscription=(provider.subscription??0)+counts.total;}providers.set(event.provider,provider);
    day.total=(day.total??0)+counts.total;for(const field of ['input','output','cached','reasoning'] as const)if(counts[field]!==undefined)day[field]=(day[field]??0)+counts[field]!;
    const ids=reported.get(date)??new Set<string>();ids.add(event.runId);reported.set(date,ids);seen.add(event.runId);
  }
  const included=runs.filter(run=>selected(run)&&days.has(calendarDate(run.createdAt,timeZone)));
  const dayRuns=new Map<string,Set<string>>();for(const run of included){const date=calendarDate(run.createdAt,timeZone),ids=dayRuns.get(date)??new Set<string>();ids.add(run.id);dayRuns.set(date,ids);}
  for(const [date,ids] of reported){const all=dayRuns.get(date)??new Set<string>();for(const id of ids)all.add(id);dayRuns.set(date,all);days.get(date)!.reportedRuns=ids.size;}for(const [date,ids] of dayRuns)days.get(date)!.runs=ids.size;
  return {days:[...days.values()],timeZone,today,members,reportedRuns:seen.size,totalRuns:new Set([...included.map(r=>r.id),...seen]).size,total:[...days.values()].reduce((sum,d)=>sum+(d.total??0),0),subscription:[...days.values()].some(d=>d.subscription!==null)?[...days.values()].reduce((sum,d)=>sum+(d.subscription??0),0):null,providers:[...providers.values()].sort((a,b)=>b.total-a.total)};
}

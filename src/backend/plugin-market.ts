import {fetch,ProxyAgent} from 'undici';
import {StringDecoder} from 'node:string_decoder';
import path from 'node:path';
import type {Settings} from '../shared/types';
import type {MarketItem,MarketQuery,MarketResult} from '../shared/plugin-market';
import {NativePlugins} from './native-plugins';
import {validateProxyUrl} from './security';

export const DSH_MARKET_SOURCE='https://awesome-dsh-plugin.com/plugins.json';
const npmName=/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/;
const github=(value:unknown)=>{try{const u=new URL(String(value));return u.protocol==='https:'&&u.hostname==='github.com'&&!u.username&&!u.password&&/^\/[\w.-]+\/[\w.-]+\/?$/.test(u.pathname)?u.origin+u.pathname.replace(/\/$/,''):undefined;}catch{return undefined;}};
export function normalizeDshIndex(value:any):MarketItem[]{
 const rows=Array.isArray(value)?value:value?.plugins;if(!Array.isArray(rows))throw Error('DSH 社区索引没有 plugins 数组');
 return rows.slice(0,20000).flatMap((p:any)=>{if(!p||typeof p.name!=='string')return [];const repo=github(p.url),pkg=typeof p.npm==='string'&&npmName.test(p.npm)?p.npm:undefined;if(!pkg&&!repo)return [];const version=typeof p.version==='string'&&/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(p.version)?p.version:undefined;return [{id:'dsh:'+String(pkg??repo),ecosystem:'dsh' as const,name:String(p.name).slice(0,200),description:String(typeof p.description==='string'?p.description:p.description?.zh??p.description?.en??'').slice(0,2000),sourceLabel:'DSH 社区索引',source:pkg?pkg+(version?'@'+version:''):repo!,sourceKind:pkg?'npm' as const:'github' as const,version,installed:false,category:typeof p.category==='string'?p.category:undefined,inspectSource:repo,inspectKind:repo?'github' as const:undefined}];});
}
export function normalizeCodexCatalog(rows:any[]):MarketItem[]{const seen=new Set<string>();return rows.flatMap(p=>{if(typeof p?.pluginId!=='string'||seen.has(p.pluginId))return [];seen.add(p.pluginId);const local=p.source?.source==='local'&&typeof p.source.path==='string'&&path.isAbsolute(p.source.path)?p.source.path:undefined,repo=github(p.marketplaceSource?.source);return [{id:'codex:'+p.pluginId,ecosystem:'codex' as const,name:String(p.interface?.displayName??p.name??p.pluginId).slice(0,200),description:String(p.description??p.interface?.shortDescription??'').slice(0,2000),sourceLabel:String(p.marketplaceName??'Codex 原生市场'),source:p.pluginId,sourceKind:'catalog' as const,installed:!!p.installed,version:p.version,inspectSource:local??repo,inspectKind:local?'local' as const:repo?'github' as const:undefined}];});}
export class PluginMarket{
 private cache=new Map<string,{at:number;items:MarketItem[]}>();private pending=new Map<string,Promise<MarketItem[]>>();
 constructor(private native:NativePlugins,private settings:()=>Settings,private request:typeof fetch=fetch){}
 private async dsh(){const settings=this.settings(),proxy=settings.networkMode==='proxy'?new ProxyAgent(validateProxyUrl(settings.proxyUrl).toString()):undefined;try{const response=await this.request(DSH_MARKET_SOURCE,{dispatcher:proxy,signal:AbortSignal.timeout(25000),redirect:'error'});if(!response.ok)throw Error('DSH 社区索引 HTTP '+response.status);let size=0,text='';const decoder=new StringDecoder('utf8');for await(const chunk of response.body??[]){size+=chunk.length;if(size>15*1024*1024)throw Error('DSH 社区索引超过 15 MB');text+=decoder.write(Buffer.from(chunk));}text+=decoder.end();return normalizeDshIndex(JSON.parse(text));}finally{await proxy?.close();}}
 private load(kind:'codex'|'dsh',refresh:boolean){const cached=this.cache.get(kind);if(!refresh&&cached&&Date.now()-cached.at<5*60*1000)return Promise.resolve(cached.items);if(this.pending.has(kind))return this.pending.get(kind)!;const task=(kind==='codex'?this.native.catalog().then(normalizeCodexCatalog):this.dsh()).then(items=>{this.cache.set(kind,{at:Date.now(),items});return items;}).finally(()=>this.pending.delete(kind));this.pending.set(kind,task);return task;}
 async search(query:MarketQuery={}):Promise<MarketResult>{
  const kinds=(query.ecosystem&&query.ecosystem!=='all'?[query.ecosystem]:['codex','dsh']) as ('codex'|'dsh')[];if(kinds.some(k=>!['codex','dsh'].includes(k)))throw Error('请选择 Codex、DSH 或全部来源');const sources:MarketResult['sources']=[],warnings:string[]=[],items:MarketItem[]=[];
  const results=await Promise.allSettled(kinds.map(kind=>this.load(kind,!!query.refresh)));results.forEach((r,i)=>{if(r.status==='fulfilled'){sources.push({name:kinds[i]==='codex'?'Codex 原生市场':'DSH 社区索引',count:r.value.length});items.push(...r.value);}else warnings.push(kinds[i]+'：'+String(r.reason?.message??r.reason));});
  const words=String(query.query??'').slice(0,200).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),filtered=items.filter(item=>words.every(word=>[item.name,item.description,item.sourceLabel,item.category??'',item.source].join(' ').toLocaleLowerCase().includes(word)));filtered.sort((a,b)=>Number(b.installed)-Number(a.installed)||a.name.localeCompare(b.name));const page=Math.max(1,Math.floor(Number(query.page)||1));return {items:filtered.slice((page-1)*30,page*30),total:filtered.length,sources,warnings};
 }
}

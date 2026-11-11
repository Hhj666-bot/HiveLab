import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProviderRegistry} from '../src/backend/provider-registry';
import {newerVersion} from '../src/shared/member-versions';
import type {ProviderInfo} from '../src/shared/types';

const connection='acp-8283bd696750';
function registry(options:{alive?:boolean;maintenance?:boolean}={}){
 const stored=new Map<string,ProviderInfo>(),broadcasts={count:0};
 const host={alive:options.alive??true,maintenance:options.maintenance??false,settings:{networkMode:'direct',proxyUrl:'',paths:{}},broadcast:()=>{broadcasts.count++;},
  store:{dataDirectory:'data',get:(entity:string,id:string)=>entity==='executors'&&id===connection?{id,catalogId:'claude'}:undefined,put:(_:string,id:string,value:ProviderInfo)=>{stored.set(id,value);}}};
 const value=new ProviderRegistry(host as never);
 const member=(id:string,version?:string)=>({id,name:id,available:true,auth:'subscription',detail:'',capabilities:{},version}) as unknown as ProviderInfo;
 return {registry:value,host,stored,broadcasts,member};
}

test('Versions are compared as releases, not as different strings',()=>{
 assert.equal(newerVersion('2.1.314','2.1.292'),true);
 assert.equal(newerVersion('2.1.292','2.1.314'),false,'a build ahead of the registry is not offered a downgrade');
 assert.equal(newerVersion('2.1.292','2.1.292'),false);
 assert.equal(newerVersion('2.1.10','2.1.9'),true,'parts compare as numbers');
 assert.equal(newerVersion('0.2.0','0.2.0-rc.2'),true,'a release outranks its prerelease');
 assert.equal(newerVersion('0.2.0-rc.1','0.2.0'),false);
 assert.equal(newerVersion('0.2.0-rc.10','0.2.0-rc.2'),true);
 assert.equal(newerVersion('0.2.0-rc.2','0.2.0-1'),true,'text identifiers outrank numeric ones');
 assert.equal(newerVersion('0.2.0-rc.2.1','0.2.0-rc.2'),true);
 assert.equal(newerVersion('2026.10.1','2.1.292'),true);
 assert.equal(newerVersion('2.1.314','not-a-version'),true,'outside SemVer any difference counts');
 assert.equal(newerVersion('nightly','nightly'),false);
 assert.equal(newerVersion('2.1.314',undefined),true);
});

test('Each member using a package is told about a release, including connections that pin their own program',async()=>{
 const {registry:value,stored,member}=registry(),lookups:string[]=[];
 value.providers.push(member('claude','2.1.314 (Claude Code)'),member(connection,'2.1.292 (Claude Code)'),member('deepseek','1.0.0'),member('codex'));
 assert.equal(await value.checkUpdates(async id=>{lookups.push(id);return '2.1.314';}),true);
 assert.deepEqual(lookups,['claude'],'one lookup per package, nothing for a program that is not installed');
 assert.equal(value.providers.find(item=>item.id==='claude')!.updateVersion,undefined);
 assert.equal(value.providers.find(item=>item.id===connection)!.updateVersion,'2.1.314');
 assert.equal(stored.get(connection)!.updateVersion,'2.1.314');
});

test('An installed update clears the offer and a stored offer does not outlive its check',async()=>{
 const {registry:value,member}=registry();
 value.providers.push(member('claude','2.1.292'));
 await value.checkUpdates(async()=>'2.1.314');
 assert.equal(value.providers[0].updateVersion,'2.1.314');
 value.publishProvider({...value.providers[0],stale:true});
 assert.equal(value.providers[0].updateVersion,'2.1.314','a re-probe keeps a still-valid offer');
 value.publishProvider({...value.providers[0],version:'2.1.314'});
 assert.equal(value.providers[0].updateVersion,undefined);
 assert.equal('updateVersion' in value.providers[0],false);
 const restarted=registry();
 restarted.registry.publishProvider({...member('claude','2.1.292'),updateVersion:'2.1.300'});
 assert.equal(restarted.registry.providers[0].updateVersion,undefined);
});

test('A manual check updates members the same way, without rewriting unchanged ones',()=>{
 const {registry:value,member,broadcasts}=registry();
 value.providers.push(member('claude','2.1.292'));
 value.rememberLatest('claude','2.1.314');
 assert.equal(value.providers[0].updateVersion,'2.1.314');
 assert.equal(broadcasts.count,1);
 value.rememberLatest('claude','2.1.314');
 assert.equal(broadcasts.count,1);
 value.rememberLatest('claude','2.1.320');
 assert.equal(value.providers[0].updateVersion,'2.1.320');
});

test('A failed lookup keeps what is known and asks for a retry; other packages still run',async()=>{
 const {registry:value,member}=registry();
 value.providers.push(member('claude','2.1.292'),member('codex','0.160.0'));
 assert.equal(await value.checkUpdates(async id=>{if(id==='claude')throw new Error('offline');return '0.170.0';}),false);
 assert.equal(value.providers[0].updateVersion,undefined);
 assert.equal(value.providers[1].updateVersion,'0.170.0');
});

test('No lookup runs while stopped or restoring, and shutdown during a lookup changes nothing',async()=>{
 const stopped=registry({alive:false}),restoring=registry({maintenance:true});
 for(const item of [stopped,restoring]){
  item.registry.providers.push(item.member('claude','2.1.292'));
  assert.equal(await item.registry.checkUpdates(async()=>{throw new Error('must not run');}),false);
 }
 const closing=registry();
 closing.registry.providers.push(closing.member('claude','2.1.292'));
 assert.equal(await closing.registry.checkUpdates(async()=>{closing.host.alive=false;return '2.1.314';}),false);
 assert.equal(closing.registry.providers[0].updateVersion,undefined);
 assert.equal(closing.stored.size,0);
});

test('The schedule starts once and close cancels it',()=>{
 const {registry:value}=registry();
 value.startUpdateChecks(60_000);
 const timer=(value as unknown as {updateCheckTimer?:NodeJS.Timeout}).updateCheckTimer;
 assert.ok(timer);
 value.startUpdateChecks(60_000);
 assert.equal((value as unknown as {updateCheckTimer?:NodeJS.Timeout}).updateCheckTimer,timer);
 value.close();
 assert.equal((value as unknown as {updateCheckTimer?:NodeJS.Timeout}).updateCheckTimer,undefined);
});

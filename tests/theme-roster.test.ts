import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMembersApi} from '../src/backend/api/members';
import {normalizeMember} from '../src/shared/defaults';
import {DEFAULT_ACCENT,accentColor,resolveAccent} from '../src/shared/theme-accent';
test('sidebar and home arrangements persist independently through member normalization',async()=>{
 const members=new Map(['a','b','c'].map((id,i)=>[id,{id,name:id,executor:'codex',standeeOrder:i}] as const));let broadcasts=0;
 const api=createMembersApi({store:{members:()=>[...members.values()],put:(_kind:string,id:string,value:any)=>members.set(id,value)},broadcast:()=>broadcasts++} as any);
 await api['team.arrange']({ids:['c','a','b'],scope:'sidebar'});
 assert.deepEqual([...members.values()].map((m:any)=>[m.id,m.standeeOrder,m.sidebarOrder]),[['a',0,1],['b',1,2],['c',2,0]]);
 await api['team.arrange']({ids:['b','c','a']});
 assert.deepEqual([...members.values()].map((m:any)=>[m.id,m.standeeOrder,m.sidebarOrder]),[['a',2,1],['b',0,2],['c',1,0]]);
 const saved=normalizeMember(members.get('a'));assert.equal(saved.sidebarOrder,1);assert.equal(saved.standeeOrder,2);assert.equal(broadcasts,2);
 await assert.rejects(api['team.arrange']({ids:['missing'],scope:'sidebar'}),/成员列表/);
});
test('accent modes select the shared colour or current personal member colour',()=>{
 assert.equal(resolveAccent('global','#9bb9ce','#579879'),'#9bb9ce');assert.equal(resolveAccent('contextual','#9bb9ce','#579879'),'#579879');assert.equal(resolveAccent('contextual','#9bb9ce'),'#9bb9ce');assert.equal(accentColor(null),DEFAULT_ACCENT);assert.equal(accentColor('#cba9b3'),'#cba9b3');
});

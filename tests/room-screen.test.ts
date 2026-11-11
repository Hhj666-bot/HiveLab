import {test} from 'node:test';
import assert from 'node:assert/strict';
import {screenStart} from '../src/shared/room';

test('a page opens with about one screen of its newest messages',()=>{
 const short=(count:number)=>Array.from({length:count},()=>({text:'你好'}));
 assert.equal(screenStart([]),0);assert.equal(screenStart(short(5)),0);assert.equal(screenStart(short(16)),0);assert.equal(screenStart(short(40)),24);
 assert.equal(screenStart([...short(30),{text:'长'.repeat(3000)}]),15);assert.equal(screenStart([{}, {}, {}]),0);
 assert.equal(screenStart([...short(30),{text:'长'.repeat(3000),author:'user'}]),30);
 assert.equal(screenStart([...short(30),{text:'长'.repeat(3000),status:'speaking'}]),30);
 assert.equal(screenStart(Array.from({length:30},()=>({text:'长'.repeat(5000),author:'a',status:'done'}))),23);
});

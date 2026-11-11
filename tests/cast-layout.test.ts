import {test} from 'node:test';
import assert from 'node:assert/strict';
import {castLayout,castMiddle} from '../src/shared/cast-layout';

test('the cast fits the stage, and each standee knows where its middle stands at any width',()=>{
 const wide=castLayout(1386,700,8,.75),narrow=castLayout(1178,700,8,.75);
 assert.ok(narrow.slot<wide.slot);assert.ok(narrow.height<wide.height);assert.ok(wide.slot>=100&&wide.slot<=300);
 // A cast that fits is centred, its standees one slot and one gap apart.
 const middles=[...Array(8).keys()].map(index=>castMiddle(wide,1386,8,index));
 assert.ok(Math.abs(middles[0]+middles[7])<1e-6);assert.ok(middles.slice(1).every((at,index)=>Math.abs(at-middles[index]-wide.slot-wide.gap)<1e-6));
 // One too wide to fit starts at the edge, after the padding.
 const crowded=castLayout(400,700,8,1);
 assert.ok(Math.abs(castMiddle(crowded,400,8,0)-(crowded.padding+crowded.slot/2-200))<1e-6);
});

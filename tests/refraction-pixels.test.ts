import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildRefractionMap} from '../src/renderer/liquid-refraction';
test('lens optimization preserves baseline pixels and displacement strength',()=>{
 const cases:[number[],string,number][]=[
 [[700,650],'91f600ab706a959017363a2751c874b9f6e5c9f9b0a807f6088c605e4c17e553',51.94691302186696],
 [[68,950],'685f95217ef15e0e178d44946d6909e7db5835b6d0afe236f1cb5517f3b8f502',51.94691302186696],
 [[320,200,1,1.3],'40207bd7fd46e33b0f04d00d9fa2c028dec5cc99830179328b2a227a8775e9d7',58.94424601819345],
 [[901,513,.7,1],'01922cc5e8fbbd1c55d606b18ffcb4a90b71e5bfdf53a1e9fc7223631db27a5e',37.72317347906251],
 ];
 for(const [args,hash,scale] of cases){const result=buildRefractionMap(args[0],args[1],args[2],args[3]);assert.equal(createHash('sha256').update(result.displacement).digest('hex'),hash);assert.equal(result.scale,scale);}
});

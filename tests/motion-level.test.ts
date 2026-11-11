import assert from 'node:assert/strict';
import {test} from 'node:test';
import {motionLevel,MOTION_PREFERENCES,parseMotionPreference} from '../src/shared/motion';

test('the saved motion choice decides the level, and only "system" follows Windows',()=>{
 assert.equal(motionLevel('system',false),'full');
 assert.equal(motionLevel('system',true),'reduced');
 assert.equal(motionLevel('full',true),'full');
 assert.equal(motionLevel('reduced',false),'reduced');
 assert.equal(motionLevel('off',false),'off');
});
test('unknown or missing motion choices fall back to following the system',()=>{
 for(const value of [null,undefined,'','fast',1])assert.equal(parseMotionPreference(value),'system');
 for(const [value] of MOTION_PREFERENCES)assert.equal(parseMotionPreference(value),value);
});

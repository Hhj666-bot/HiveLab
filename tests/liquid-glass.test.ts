import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calmedSpring,DEFAULT_LIQUID_GLASS,LIQUID_GLASS_PHYSICS,parseLiquidGlassSettings} from '../src/shared/liquid-glass';

test('missing or legacy material preferences use the adopted defaults',()=>{
 for(const value of [null,undefined,false,42,'old',{}])assert.deepEqual(parseLiquidGlassSettings(value),DEFAULT_LIQUID_GLASS);
 assert.equal(DEFAULT_LIQUID_GLASS.blur,1.25);assert.equal(DEFAULT_LIQUID_GLASS.refraction,.9);assert.equal(DEFAULT_LIQUID_GLASS.contrast,1.2);assert.equal(DEFAULT_LIQUID_GLASS.brightness,.95);assert.equal(DEFAULT_LIQUID_GLASS.saturation,.95);assert.equal(DEFAULT_LIQUID_GLASS.motion,80);
 assert.equal(LIQUID_GLASS_PHYSICS.spring.damping,4);
});
test('saved preferences accept partial updates, clamp ranges and reject non-finite values',()=>{
 const result=parseLiquidGlassSettings({transparency:135,copyTransparency:-2,sidebarTransparency:45,blur:Infinity,refraction:NaN,edge:0,brightness:'1.4',motion:0,glow:0,unknown:'ignored'});
 assert.ok(!Object.hasOwn(result,'transparency'));assert.ok(!Object.hasOwn(result,'copyTransparency'));assert.ok(!Object.hasOwn(result,'sidebarTransparency'));assert.equal(result.blur,1.25);assert.equal(result.refraction,.9);assert.equal(result.edge,.25);assert.equal(result.brightness,.95);assert.equal(result.motion,0);assert.ok(!Object.hasOwn(result,'glow'));assert.ok(!Object.hasOwn(result,'unknown'));
 assert.deepEqual(parseLiquidGlassSettings(JSON.parse(JSON.stringify(result))),result);
});
test('a long bubble trip is damped so it overshoots by the same few pixels',()=>{
  const spring={response:.3,dampingFraction:.62},peak=(distance:number)=>{const z=calmedSpring(spring,distance).dampingFraction;return distance*Math.exp(-Math.PI*z/Math.sqrt(1-z*z));};
  assert.equal(calmedSpring(spring,20).dampingFraction,.62);assert.ok(peak(400)<6.01);assert.ok(peak(120)<6.01);
});

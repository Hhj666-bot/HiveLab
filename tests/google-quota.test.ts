import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {parseGoogleQuota,readGoogleQuota} from '../src/backend/adapters/google-quota';
import {quotaReport,quotaPreference,mergeQuota} from '../src/shared/quota';
test('Google fully restored fraction without amount, exhausted zero, malformed and hidden models',()=>{
  const q=parseGoogleQuota({}, {models:{pro:{displayName:'Pro',quotaInfo:{remainingFraction:1}},flash:{displayName:'Flash',quotaInfo:{remainingFraction:0}},missing:{displayName:'Missing',quotaInfo:{}},bad:{displayName:'Bad',quotaInfo:{remainingFraction:2}},internal:{displayName:'Hidden',isInternal:true,quotaInfo:{remainingFraction:.3}}}});
  assert.deepEqual(q.windows.map(row=>[row.id,row.usedPercent]),[['flash',100],['pro',0]]);
  assert.ok(!JSON.stringify(q).includes('access_token'));
});
test('Google refresh failure clears old readings; a different exhausted model cannot block selected model',()=>{
  const at=new Date().toISOString(),provider='acp-google' as const;
  const ready=quotaReport(provider,{googleQuota:parseGoogleQuota({buckets:[{modelId:'gemini-pro',remainingFraction:1},{modelId:'gemini-flash',remainingFraction:0}]},{},at)},at,'probe')!;
  assert.equal(quotaPreference(ready,Date.parse(at),'gemini-pro'),1);
  assert.equal(quotaPreference(ready,Date.parse(at),'gemini-flash'),0);
  assert.equal(quotaPreference(ready,Date.parse(at)),1);
  const failed=quotaReport(provider,{googleQuota:{status:'unavailable',reason:'offline'}},at,'probe')!;
  assert.equal(mergeQuota(ready,failed).windows.length,0);
  assert.equal(failed.queryDetail,'offline');
});
test('A missing official login is unavailable, never a fabricated zero quota',async()=>{
  const result=await readGoogleQuota(path.join(tmpdir(),'missing-google-quota-'+randomUUID()));
  assert.equal(result.status,'unavailable');assert.equal(result.signedOut,true);assert.deepEqual(result.windows,[]);
});
test('Multiple Google buckets use the most restrictive reported quota for the same visible model',()=>{
  const q=parseGoogleQuota({buckets:[{modelId:'gemini-pro',remainingFraction:.4},{modelId:'gemini-pro',remainingFraction:.7},{modelId:'chat_internal',remainingFraction:0}]},{models:{'gemini-pro':{displayName:'Pro',quotaInfo:{remainingFraction:.9}}}});
  assert.equal(q.windows.length,1);assert.equal(q.windows[0].usedPercent,60);
});

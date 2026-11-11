import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseKimiBalance} from '../src/backend/adapters/kimi-balance';
import {quotaReport,balanceExhausted} from '../src/shared/quota';
test('Kimi preserves reported available/cash/voucher without double counting or subtracting debt',()=>{
  const q=parseKimiBalance({status:true,code:0,data:{available_balance:5,cash_balance:-3,voucher_balance:5}});
  assert.equal(q.available?.balance,'5');assert.equal(q.wallets[0].balance,'-3');assert.equal(balanceExhausted(q),false);
  const report=quotaReport('acp-catalogkimi',{accountBalance:q},q.checkedAt,'probe')!;
  assert.equal(report.balance?.available?.balance,'5');assert.equal(report.balance?.kind,'kimi-api');
  assert.equal(parseKimiBalance({status:false,data:{available_balance:0}}).status,'unavailable');
  assert.equal(parseKimiBalance({status:true,code:0,data:{available_balance:NaN,cash_balance:0,voucher_balance:0}}).status,'unavailable');
});

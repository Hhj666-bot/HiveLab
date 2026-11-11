import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogAuthentication} from '../src/backend/executor-catalog';
import {failureMessage} from '../src/backend/adapter-failure';
import type {AcpExecutor} from '../src/shared/types';
import {ACP_DEFAULT_PERMISSIONS} from '../src/shared/defaults';
const executor:AcpExecutor={id:'acp-catalogkimi',catalogId:'kimi',name:'Kimi',command:'kimi',args:['acp'],env:{},permissions:ACP_DEFAULT_PERMISSIONS,createdAt:new Date(0).toISOString()};
test('Kimi coding membership and Moonshot platform keys use separate official endpoints',()=>{
  const expected={'kimi-api':'https://api.moonshot.ai/v1','kimi-api-cn':'https://api.moonshot.cn/v1','kimi-code-key':'https://api.kimi.com/coding/v1','kimi-code-key-global':'https://api.kimi.ai/coding/v1'};
  for(const [authentication,url] of Object.entries(expected)){
    const result=catalogAuthentication(executor,{authentication,model:'k3',secrets:{KIMI_MODEL_API_KEY:'test-placeholder'}});
    assert.equal(result.executor.env.KIMI_MODEL_BASE_URL,url);
    assert.equal(result.executor.env.KIMI_MODEL_NAME,'k3');
    assert.ok(!JSON.stringify(result.executor.env).includes('test-placeholder'));
    const withoutModel=catalogAuthentication(executor,{authentication,model:'',secrets:{KIMI_MODEL_API_KEY:'test-placeholder'}});assert.equal(withoutModel.executor.model,undefined);assert.equal(withoutModel.executor.env.KIMI_MODEL_NAME,undefined);assert.equal(withoutModel.secrets.KIMI_MODEL_API_KEY,'test-placeholder');
  }
  assert.throws(()=>catalogAuthentication(executor,{authentication:'kimi-code-key',model:'Kimi K3',secrets:{KIMI_MODEL_API_KEY:'test-placeholder'}}),/Model ID/);
});
test('An invalid API key does not get misreported as a confirmed expired browser login',()=>{
  assert.match(failureMessage('Authentication required: 401 Invalid Authentication'),/服务地址/);
});

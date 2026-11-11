import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runnable} from '../src/renderer/ui';
import type {ProviderInfo} from '../src/shared/types';

test('saved Kimi and GLM API connections are selectable after startup checks',()=>{
  for(const id of ['acp-catalogkimi','acp-catalogzcode'] as const){
    const info:ProviderInfo={id,name:id,available:true,auth:'api',stale:false,detail:'saved API connection',capabilities:{steer:false,cancel:'request',streaming:true,write:false,history:true}};
    assert.equal(runnable(info),true,id+' is ready for the home page and lounge');
    assert.equal(runnable({...info,auth:'none'}),false,'missing login stays unavailable');
    assert.equal(runnable({...info,available:false}),false,'failed connection stays unavailable');
    assert.equal(runnable({...info,stale:true}),false,'old status still needs the startup check');
  }
  assert.equal(runnable({id:'codex',available:true,auth:'api',stale:false} as ProviderInfo),false,'Codex still requires its subscription login');
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeClaudeBaseUrl} from '../src/shared/claude-api';
import {buildEnvironment} from '../src/backend/security';
import {claudeEnvironment,setClaudeApiKey,setClaudeOAuthToken} from '../src/backend/adapters/claude';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';
import {Engine} from '../src/backend/engine';

test('Claude API roots are normalized and malformed credential destinations are rejected',()=>{
  assert.equal(normalizeClaudeBaseUrl(undefined),'');
  assert.equal(normalizeClaudeBaseUrl('  '),'');
  assert.equal(normalizeClaudeBaseUrl(' https://relay.example/v1/ '),'https://relay.example');
  assert.equal(normalizeClaudeBaseUrl('https://relay.example/anthropic/'),'https://relay.example/anthropic');
  for(const value of ['http://relay.example','https://','https:relay.example','https://user:password@relay.example','https://relay.example?key=value','https://relay.example/#fragment','https://relay.example/v1/messages','https://relay.example\\path',42,null]){
    assert.throws(()=>normalizeClaudeBaseUrl(value),/Claude API 地址/);
  }
});

test('saving a new Claude API root retires idle runtimes, checks the new connection and rejects invalid saves',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'claude-api-settings-'));
  const checkedUrls:string[]=[];
  const engine=new Engine(root,()=>{},()=>{},id=>({
    async probe(settings,env){
      checkedUrls.push(env.HIVELAB_CLAUDE_BASE_URL??'');
      return {id,name:id,auth:'api',available:true,detail:'offline test',capabilities:{steer:false,cancel:'process',streaming:true,write:true,history:true}};
    },
    async start(){return {};},async stop(){},
  }),{maintenanceOnly:true});
  try{
    engine.store.put('members','test-claude',{id:'test-claude',name:'Test Claude',executor:'claude'});
    await engine.invoke('settings.save',{settings:{claudeAuthMode:'api'}});
    await engine.probe('claude');
    const pool=(engine as any).roomRuntimes,original=pool.invalidate.bind(pool);let invalidations=0;
    pool.invalidate=async(predicate:any)=>{invalidations++;await original(predicate);};
    await engine.invoke('settings.save',{settings:{claudeBaseUrl:'https://relay.example/v1'}});
    assert.equal(invalidations,1);
    assert.equal(checkedUrls.at(-1),'https://relay.example');
    assert.equal(engine.store.get<any>('settings','main')?.claudeBaseUrl,'https://relay.example/v1');
    await assert.rejects(()=>engine.invoke('settings.save',{settings:{claudeBaseUrl:'http://relay.example'}}),/Claude API 地址/);
    assert.equal(engine.settings.claudeBaseUrl,'https://relay.example/v1');
    assert.equal(invalidations,1);
    await engine.invoke('settings.save',{settings:{claudeBaseUrl:''}});
    assert.equal(invalidations,2);
    assert.equal(checkedUrls.at(-1),'');
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

test('only the configured API endpoint receives the saved key; subscription and official defaults stay isolated',()=>{
  const home=mkdtempSync(path.join(tmpdir(),'claude-api-'));
  const previous=process.env.HIVELAB_CLAUDE_BASE_URL;
  process.env.HIVELAB_CLAUDE_BASE_URL='https://inherited.example';
  setClaudeApiKey('test-relay-key');setClaudeOAuthToken('test-subscription-token');
  const environment=(mode:'api'|'subscription',url?:string)=>claudeEnvironment({
    ...buildEnvironment({...DEFAULT_SETTINGS,claudeAuthMode:mode,claudeBaseUrl:url}),
    HIVELAB_CLAUDE_HOME:home,ANTHROPIC_BASE_URL:'https://untrusted.example',ANTHROPIC_AUTH_TOKEN:'untrusted-token',
  });
  try{
    const relay=environment('api','https://relay.example/v1');
    assert.equal(relay.ANTHROPIC_BASE_URL,'https://relay.example');
    assert.equal(relay.ANTHROPIC_API_KEY,'test-relay-key');
    assert.equal(relay.ANTHROPIC_AUTH_TOKEN,undefined);
    assert.equal(relay.CLAUDE_CODE_OAUTH_TOKEN,undefined);
    const official=environment('api','');
    assert.equal(official.ANTHROPIC_BASE_URL,undefined);
    assert.equal(official.HIVELAB_CLAUDE_BASE_URL,undefined);
    const subscription=environment('subscription','https://relay.example');
    assert.equal(subscription.ANTHROPIC_BASE_URL,undefined);
    assert.equal(subscription.HIVELAB_CLAUDE_BASE_URL,undefined);
    assert.equal(subscription.ANTHROPIC_API_KEY,undefined);
    assert.equal(subscription.CLAUDE_CODE_OAUTH_TOKEN,'test-subscription-token');
    assert.throws(()=>environment('api','http://relay.example'),/Claude API 地址/);
  }finally{
    if(previous===undefined)delete process.env.HIVELAB_CLAUDE_BASE_URL;else process.env.HIVELAB_CLAUDE_BASE_URL=previous;
    setClaudeApiKey();setClaudeOAuthToken();rmSync(home,{recursive:true,force:true});
  }
});

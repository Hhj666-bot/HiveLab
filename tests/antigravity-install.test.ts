import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {antigravityRelease} from '../src/backend/antigravity-install';
import {managedCatalogEnvironment} from '../src/backend/executor-catalog';
import {catalogEntry} from '../src/shared/executor-catalog';
import {officialExecutorLoginOutput} from '../src/backend/official-login';
import {ACP_DEFAULT_PERMISSIONS} from '../src/shared/defaults';
import type {AcpExecutor} from '../src/shared/types';

test('official Antigravity distribution is pinned by full-archive digest and rejects mismatched releases',()=>{
 const known=antigravityRelease('1.4.5',undefined);assert.match(known.url,/^https:\/\/dl.google.com\/.+windows-x86_64.zip$/);assert.equal(known.sha256.length,64);
 assert.notEqual(antigravityRelease('1.4.5',undefined,'arm64').sha256,known.sha256);
 assert.throws(()=>antigravityRelease('../../outside',{}));assert.throws(()=>antigravityRelease('1.4.6',{id:'antigravity-acp',version:'1.4.6',distribution:{binary:{'windows-x86_64':{archive:'https://example.test/arbitrary.zip',cmd:'./agy_acp_server.exe',sha256:'a'.repeat(64)}}}}));
 const next={id:'antigravity-acp',version:'1.4.6',distribution:{binary:{'windows-x86_64':{archive:'https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.4.6-windows-x86_64.zip',cmd:'./agy_acp_server.exe',sha256:'a'.repeat(64)}}}};
 assert.equal(antigravityRelease('1.4.6',next).sha256,'a'.repeat(64));
});

test('managed Antigravity keeps an isolated OAuth home, removes inherited cloud credentials and exposes official login links',()=>{
 const command=path.resolve('fixtures/antigravity/agy_acp_server.exe'),home=path.resolve('fixtures/antigravity-account');
 const executor:AcpExecutor={id:'acp-antigravity',name:'Antigravity',catalogId:'antigravity',authentication:'oauth-personal',command,args:[],env:{GEMINI_API_KEY:'must-not-propagate',AGY_ADC_AUTH:'1'},permissions:ACP_DEFAULT_PERMISSIONS,createdAt:new Date(0).toISOString()};
 const env=managedCatalogEnvironment(executor,{Path:'original-path',GOOGLE_APPLICATION_CREDENTIALS:'not-this-account',GCLOUD_PROJECT:'other-project',CLOUDSDK_CONFIG:'other-home',HTTPS_PROXY:'http://127.0.0.1:7897'},home);
 assert.equal(env.HOME,home);assert.equal(env.USERPROFILE,home);assert.equal(env.PATH,path.dirname(command)+path.delimiter+'original-path');assert.equal(env.Path,undefined);assert.equal(env.HTTPS_PROXY,'http://127.0.0.1:7897');
 for(const key of ['GEMINI_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','GCLOUD_PROJECT','CLOUDSDK_CONFIG','AGY_ADC_AUTH'])assert.equal(env[key],undefined);
 assert.equal(catalogEntry('antigravity').login?.viaAcp,true);
 const states:any[]=[],parser=officialExecutorLoginOutput('antigravity',state=>states.push(state));parser.write(Buffer.from('Authorize: https://accounts.google.com/o/oauth2/v2/auth?state=fixture\n'));parser.end();assert.ok(states.some(state=>state.phase==='waiting'&&state.url?.startsWith('https://accounts.google.com/')));
});

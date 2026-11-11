import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DEFAULT_LANGUAGE,LANGUAGES,format,getLanguage,parseLanguage,setLanguage,t,translateExact} from '../src/shared/i18n';
import {EN_MESSAGES} from '../src/renderer/locales/en';
import '../src/renderer/i18n';
import {localizeProps} from '../src/renderer/jsx/jsx-runtime';
import {DEFAULT_SETTINGS} from '../src/shared/defaults';
import {Engine} from '../src/backend/engine';

const CJK=/[㐀-鿿豈-﫿]/;
/** Run with the interface in English, then return to the default so other tests see Chinese. */
function inEnglish(run:()=>void){setLanguage('en');try{run();}finally{setLanguage(DEFAULT_LANGUAGE);}}

test('Chinese is the default: text comes back as written, with placeholders filled',()=>{
  assert.equal(getLanguage(),'zh-CN');
  assert.equal(DEFAULT_SETTINGS.language,'zh-CN');
  assert.equal(t('保存'),'保存');
  assert.equal(t('已用 {0}%',42),'已用 42%');
  assert.equal(format('{0}/{1}',[1]),'1/{1}');
  assert.deepEqual(LANGUAGES.map(([id])=>id),['zh-CN','en']);
  for(const value of [undefined,null,'fr','EN',1])assert.equal(parseLanguage(value),'zh-CN');
  assert.equal(parseLanguage('en'),'en');
});

test('English looks up the Chinese source text and keeps the surrounding whitespace',()=>inEnglish(()=>{
  assert.equal(t('保存'),'Save');
  assert.equal(t(' 保存 '),' Save ');
  assert.equal(t('删除「{0}」？','notes.md'),'Delete “notes.md”?');
  assert.equal(t('这个项目里的 {0} 个会话会一起删除。',1),'The 1 session in this project will be deleted too.');
  assert.equal(t('这个项目里的 {0} 个会话会一起删除。',3),'The 3 sessions in this project will be deleted too.');
  // A sentence nobody translated stays readable in Chinese instead of disappearing.
  assert.equal(t('这句话没有英文版本'),'这句话没有英文版本');
  assert.equal(t('还没有英文的 {0} 句子','x'),'还没有英文的 x 句子');
}));

test('text that arrives finished (backend notices) translates whole, or through placeholder entries',()=>inEnglish(()=>{
  assert.equal(t('Claudia 需要登录'),'Claudia needs to sign in');
  assert.equal(t('请先停止当前任务。'),'Stop the current task first.');
  // The display pass only replaces exact phrases, so a user's own sentence is never rewritten piecemeal.
  assert.equal(translateExact('保存'),'Save');
  assert.equal(translateExact('Claudia 需要登录'),'Claudia 需要登录');
  assert.equal(translateExact('我想保存这份文件'),'我想保存这份文件');
  assert.equal(translateExact('Save'),'Save');
}));

test('the JSX display pass translates host text and labels but leaves components and opted-out elements alone',()=>{
  const props={children:['保存',' · ','Claudia'],title:'刷新',placeholder:'搜索',value:'保存'};
  assert.equal(localizeProps('button',props),props,'Chinese needs no work');
  inEnglish(()=>{
    const host=localizeProps('button',props);
    assert.deepEqual(host.children,['Save',' · ','Claudia']);
    assert.equal(host.title,'Refresh');
    assert.equal(host.placeholder,'Search');
    assert.equal(host.value,'保存','input values are user data');
    assert.equal(localizeProps(function Card(){},props),props);
    const kept={children:'保存',translate:'no'};
    assert.equal(localizeProps('span',kept),kept);
  });
});

/** Every message written as t("…") in the renderer and shared code must have an English entry. */
function sourceKeys(){
  const keys=new Map<string,string>();
  const RE=/(?<![\w$.])(?:t|tr)\(\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)')/g;
  const walk=(dir:string)=>{for(const name of readdirSync(dir)){const file=path.join(dir,name);if(statSync(file).isDirectory()){if(name!=='locales')walk(file);continue;}if(!/\.tsx?$/.test(name))continue;
    const source=readFileSync(file,'utf8');for(const match of source.matchAll(RE)){const raw=match[1]!==undefined?JSON.parse(`"${match[1]}"`) as string:match[2].replace(/\\'/g,"'");const key=raw.trim();if(CJK.test(key)&&!keys.has(key))keys.set(key,path.relative(process.cwd(),file));}}};
  walk(path.join('src','renderer'));walk(path.join('src','shared'));
  return keys;
}
test('every interface message has an English entry with the same placeholders',()=>{
  const keys=sourceKeys();
  assert.ok(keys.size>3000,`found only ${keys.size} messages`);
  const missing=[...keys].filter(([key])=>EN_MESSAGES[key]===undefined).map(([key,file])=>`${file}: ${key}`);
  assert.deepEqual(missing,[]);
  const marks=(text:string)=>[...new Set(text.match(/\{\d/g)??[])].sort().join();
  const mismatched=Object.entries(EN_MESSAGES).filter(([key,value])=>marks(key)!==marks(value)).map(([key])=>key);
  assert.deepEqual(mismatched,[]);
  assert.deepEqual(Object.entries(EN_MESSAGES).filter(([key,value])=>!value.trim()||key!==key.trim()).map(([key])=>key),[]);
});

test('the language is saved in settings, survives a restart and is never reverted by a stale settings save',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'hivelab-language-'));
  const runtime=(id:string)=>({async probe(){return {id,name:id,auth:'none' as const,available:false,detail:'offline test',capabilities:{steer:false,cancel:'process' as const,streaming:true,write:true,history:true}};},async start(){return {};},async stop(){}});
  let engine=new Engine(root,()=>{},()=>{},runtime as any,{maintenanceOnly:true});
  try{
    assert.equal(engine.settings.language,'zh-CN');
    const stale={...engine.settings};
    const saved=await engine.invoke('settings.language',{language:'en'}) as {language?:string};
    assert.equal(saved.language,'en');
    await assert.rejects(()=>engine.invoke('settings.language',{language:'fr'}),/界面语言无效/);
    // A settings dialog opened before the switch still holds the old language; saving it keeps English.
    await engine.invoke('settings.save',{settings:{...stale,maxParallel:2}});
    assert.equal(engine.settings.language,'en');
    assert.equal(engine.settings.maxParallel,2);
    await engine.close();
    engine=new Engine(root,()=>{},()=>{},runtime as any,{maintenanceOnly:true});
    assert.equal(engine.settings.language,'en');
    assert.equal(engine.snapshot().settings.language,'en');
  }finally{await engine.close();rmSync(root,{recursive:true,force:true});}
});

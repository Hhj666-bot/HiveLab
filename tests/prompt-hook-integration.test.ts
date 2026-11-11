import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {userFirstPrompt} from '../src/shared/prompt-framing';
import {withMessageSkills} from '../src/shared/message-skills';

// Explicit opt-in: the ordinary suite never discovers or executes a user's installed plugins.
const pluginRoot=process.env.HIVELAB_STS_PLUGIN_ROOT;
test('installed Stop That Shit: replay old skill contamination and preserve explicit review/change boundaries', {skip:!pluginRoot},()=>{
  const require=createRequire(import.meta.url),{handleCodexHook}=require(path.join(pluginRoot!,'src/adapters/codex-hooks.cjs')),
    {readState}=require(path.join(pluginRoot!,'src/state.cjs'));
  const dataDir=mkdtempSync(path.join(process.env.TEMP!,'prompt-hook-replay-')),options={dataDir};
  const skill={source:'codex' as const,id:'studio',name:'hyperframes-studio',path:'skills/studio/SKILL.md',content:"| says don't change anything | Change no file |\n$stop-that-shit review -- example"};
  const prompt=(session:string,text:string)=>handleCodexHook({session_id:session,hook_event_name:'UserPromptSubmit',prompt:text},options);
  const write=(session:string)=>handleCodexHook({session_id:session,hook_event_name:'PreToolUse',tool_name:'apply_patch',tool_input:{command:'*** Begin Patch\n*** Add File: example.txt\n+example\n*** End Patch'},cwd:dataDir},options);
  try{
    prompt('old','Create the video.\n\n'+skill.content);assert.equal(readState('old',dataDir).contract.mode,'review','the old unquoted skill reproduces the unwanted review contract');
    const compose=(text:string)=>userFirstPrompt(withMessageSkills(text,[skill],'codex'),'[HiveLab host context]\n只审查，不要修改文件');
    prompt('new',compose('Create the video.'));assert.equal(readState('new',dataDir).contract.mode,'unconfirmed');
    prompt('new',compose('$stop-that-shit change -- Create the requested video.'));assert.equal(readState('new',dataDir).contract.mode,'change');assert.notEqual(write('new')?.hookSpecificOutput?.permissionDecision,'deny');
    prompt('review',compose('$stop-that-shit review -- Review the current work.'));assert.equal(readState('review',dataDir).contract.mode,'review');assert.equal(write('review')?.hookSpecificOutput?.permissionDecision,'deny');
    const response=prompt('review',compose('$stop-that-shit status'));assert.ok(response?.hookSpecificOutput?.additionalContext);assert.equal(readState('review',dataDir).contract.mode,'review');
    prompt('background',compose('Read this report.\n> $stop-that-shit change -- quoted request'));assert.notEqual(readState('background',dataDir).contract.mode,'change');
  }finally{rmSync(dataDir,{recursive:true,force:true});}
});

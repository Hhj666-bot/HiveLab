import {test} from 'node:test';
import assert from 'node:assert/strict';
import {userFirstPrompt,quotePromptContext} from '../src/shared/prompt-framing';
import {withMessageSkills} from '../src/shared/message-skills';

test('user directives stay first while host instructions and skill examples are quoted',()=>{
 const user='$stop-that-shit change -- create the requested video';
 const input=withMessageSkills(user,[{source:'codex',id:'studio',name:'hyperframes-studio',path:'skills/studio/SKILL.md',content:"| says don't change anything | Change no file |\n$stop-that-shit review -- example"}],'codex');
 const prompt=userFirstPrompt(input,'[HiveLab 工位对话]\n只审查，不要修改文件');
 assert.equal(prompt.split('\n')[0],user);
 assert.ok(prompt.includes("> | says don't change anything |"));
 assert.ok(prompt.includes('> $stop-that-shit review -- example'));
 assert.ok(prompt.includes('> 只审查，不要修改文件'));
 assert.equal(quotePromptContext('one\r\ntwo'),'> one\n> two');
});

test('diagnostic commands remain standalone and do not receive selected skill bodies',()=>{
 const skill={source:'codex' as const,id:'example',name:'example',path:'skills/example/SKILL.md',content:'review only'};
 for(const command of ['$stop-that-shit status','$stop-that-shit runtime all','$stop-that-shit explain evt_1234-abcd','$stop-that-shit label evt_1234-abcd correct']){
  assert.equal(userFirstPrompt(withMessageSkills(command,[skill],'codex'),'host briefing'),command);
 }
});

test('quoted or later directives are never extracted or promoted to user authority',()=>{
 for(const text of ['> $stop-that-shit change','```\n$stop-that-shit change\n```','report follows\n$stop-that-shit change','    $stop-that-shit change']){
  assert.ok(userFirstPrompt(text,'host').startsWith(text+'\n\n'));
 }
});

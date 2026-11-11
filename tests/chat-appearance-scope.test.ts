import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatAppearanceFor,parseChatAppearance,setChatApplyAll,updateChatSurface,chatColorMode} from '../src/shared/chat-appearance';
test('old shared settings remain global; opting out isolates only one surface on one page',()=>{
 let data=parseChatAppearance({reply:{color:'#123456',transparency:60},mine:{color:'',transparency:40}});
 assert.equal(chatAppearanceFor(data,'desk:a').reply.transparency,60);assert.equal(chatAppearanceFor(data,'lounge').reply.transparency,60);
 data=setChatApplyAll(data,'desk:a','reply',false);data=updateChatSurface(data,'desk:a','reply',{transparency:85});
 assert.equal(chatAppearanceFor(data,'desk:a').reply.transparency,85);assert.equal(chatAppearanceFor(data,'lounge').reply.transparency,60);assert.equal(data.defaults.reply.transparency,60);assert.equal(chatAppearanceFor(data,'desk:a').mine.transparency,40);
 const restored=parseChatAppearance(JSON.parse(JSON.stringify({...data.defaults,pages:data.pages})));assert.deepEqual(restored,data);
});
test('checking apply-all carries the current value to every existing and future page',()=>{
 let data=parseChatAppearance(null);data=setChatApplyAll(data,'desk:a','input',false);data=updateChatSurface(data,'desk:a','input',{color:'#112233',transparency:70});data=setChatApplyAll(data,'lounge','input',false);data=updateChatSurface(data,'lounge','input',{transparency:30});
 data=setChatApplyAll(data,'desk:a','input',true);
 for(const page of ['desk:a','lounge','desk:new','report:project:member'])assert.deepEqual(chatAppearanceFor(data,page).input,{color:'#112233',transparency:70});assert.deepEqual(data.pages,{});
});
test('replies default to member colours, legacy empty colours migrate, and explicit theme choices survive reload',()=>{
 let data=parseChatAppearance({reply:{color:'',transparency:65},mine:{color:'#123456',transparency:40}});assert.equal(data.defaults.reply.color,'member');assert.equal(data.defaults.reply.transparency,65);assert.equal(chatColorMode(data.defaults.reply),'member');assert.equal(data.defaults.mine.color,'#123456');
 data=updateChatSurface(data,undefined,'reply',{color:'theme'});data=parseChatAppearance({...data.defaults,pages:data.pages});assert.equal(chatColorMode(data.defaults.reply),'theme');
 data=updateChatSurface(data,undefined,'input',{color:'member'});assert.equal(chatColorMode(parseChatAppearance({...data.defaults,pages:data.pages}).defaults.input),'member');
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowClipboardPermission} from '../src/main/clipboard-permissions';

const appUrl='file:///app/dist/renderer/index.html';
test('copy is allowed only in the owned top-level app document',()=>{
  for(const permission of ['clipboard-sanitized-write','clipboard-write'])assert.equal(allowClipboardPermission(permission,true,{isMainFrame:true,requestingUrl:appUrl},appUrl),true);
  const requests=[{isMainFrame:false,requestingUrl:appUrl},{isMainFrame:false,requestingUrl:'hivelab-wallpaper://player/index.html'},{isMainFrame:true,requestingUrl:'https://example.test/'},{isMainFrame:true}];
  for(const details of requests)assert.equal(allowClipboardPermission('clipboard-sanitized-write',true,details,appUrl),false);
  assert.equal(allowClipboardPermission('clipboard-sanitized-write',false,{isMainFrame:true,requestingUrl:appUrl},appUrl),false);
});
test('clipboard reading and unrelated permissions are denied even for the app',()=>{
  for(const permission of ['clipboard-read','deprecated-sync-clipboard-read','media','notifications','unknown'])assert.equal(allowClipboardPermission(permission,true,{isMainFrame:true,requestingUrl:appUrl},appUrl),false);
});

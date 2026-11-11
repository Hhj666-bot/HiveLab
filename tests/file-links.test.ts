import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localFileLink} from '../src/shared/file-links';

test('document links retain names and normalize supported local paths',()=>{
 for(const file of ['./报告.md','D:/资料/报告.pdf','C:\\资料\\表格.xlsx','./演示.pptx','./音频.mp3','.env'])assert.equal(localFileLink(file),file);
 assert.equal(localFileLink('file:///C:/资料/报告%20A.pdf#page=2'),'C:/资料/报告 A.pdf');
 assert.equal(localFileLink('D:/代码/App.tsx:12:3'),'D:/代码/App.tsx');
 assert.equal(localFileLink('./说明.md#L10-L20'),'./说明.md');
 for(const href of ['javascript:alert(1)','data:text/html,file.md','https://example.com/a.pdf','file:///C:/Windows/notepad.exe','bad%zz.md'])assert.equal(localFileLink(href),undefined);
});

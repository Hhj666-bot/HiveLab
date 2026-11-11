import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { importClipboardImages, resolveAttachments } from '../src/backend/attachments';
import { ATTACHMENT_MAX_BYTES } from '../src/shared/attachments';

export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
test('clipboard PNG without a file path becomes a resolvable persistent image attachment', () => {
  const root=mkdtempSync(path.join(process.env.TEMP!,'clipboard-'));
  try {
    const [image]=importClipboardImages(root,[{name:'../../截图.exe',dataUrl:'data:image/png;base64,'+PNG}]);
    assert.equal(image.kind,'image');assert.equal(image.name,'截图.png');assert.equal(image.mime,'image/png');
    const [resolved]=resolveAttachments(root,[image]);assert.deepEqual(readFileSync(resolved.path),Buffer.from(PNG,'base64'));
    assert.equal(image.size,Buffer.from(PNG,'base64').length);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('invalid, oversized and over-count clipboard batches do not partially store images', () => {
  const root=mkdtempSync(path.join(process.env.TEMP!,'clipboard-'));
  try {
    const valid={dataUrl:'data:image/png;base64,'+PNG};
    for(const invalid of [[],Array(11).fill(valid),[valid,{dataUrl:'data:image/png;base64,YWJjZA=='}],[{dataUrl:'data:text/html;base64,YWJjZA=='}],[{dataUrl:'data:image/png;base64,'+'a'.repeat(Math.ceil(ATTACHMENT_MAX_BYTES/3)*4+100)}]])assert.throws(()=>importClipboardImages(root,invalid));
    assert.deepEqual(readdirSync(root),[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});

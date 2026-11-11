import assert from 'node:assert/strict';
import {test} from 'node:test';
import {externalWebUrl} from '../src/shared/web-links';
import {RENDERER_METHODS} from '../src/shared/rpc-methods';

test('web links retain HTTPS destinations, query strings and fragments',()=>{
  assert.equal(externalWebUrl('https://policies.google.com/terms/generative-ai/use-policy'),'https://policies.google.com/terms/generative-ai/use-policy');
  assert.equal(externalWebUrl('HTTP://EXAMPLE.COM/a?q=hello%20world#part'),'http://example.com/a?q=hello%20world#part');
  assert.ok(RENDERER_METHODS.includes('link.open'));
});
test('system-browser action only accepts HTTP and HTTPS, leaving file preview and executable schemes separate',()=>{
  for(const value of [undefined,null,{},'/relative.md','D:/work/file.md','file:///C:/Windows/notepad.exe','javascript:alert(1)','data:text/html,<script>1</script>','ftp://example.com/file','mailto:a@example.com','hivelab-file://00000000-0000-4000-8000-000000000001','https://'])assert.equal(externalWebUrl(value),undefined,String(value));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnOwned } from '../src/backend/process-supervisor';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function launch(args: string[]) {
  return new Promise<{ code: number | null; errorCode?: string }>((resolve) => {
    let settled = false;
    const finish = (value: { code: number | null; errorCode?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish({ code: null, errorCode: 'TIMEOUT' }), 20000);
    process.env.HIVELAB_APP_ROOT = root;
    try {
      const child = spawnOwned('C:\\Windows\\System32\\cmd.exe', args, {
        cwd: root,
        env: { ...process.env },
        stdio: ['ignore', 'ignore', 'ignore'],
      } as never);
      child.once('error', (error: NodeJS.ErrnoException) => finish({ code: null, errorCode: error.code }));
      child.once('close', (code: number | null) => finish({ code }));
    } catch (error) {
      finish({ code: null, errorCode: (error as NodeJS.ErrnoException).code ?? String(error) });
    }
  });
}

/** Windows wraps every launch spec into one base64 command-line argument; a long system
 *  prompt (Claude's persona) overflowed it and failed with spawn ENAMETOOLONG. The spec must
 *  therefore travel through a file once the encoded payload gets large. */
test('spawnOwned survives launch specs beyond the Windows command-line limit', { skip: process.platform !== 'win32' }, async () => {
  const small = await launch(['/c', 'exit', '0']);
  assert.equal(small.errorCode, undefined, `小参数不应失败：${small.errorCode}`);

  const large = await launch(['/c', 'exit', '0', 'x'.repeat(40000)]);
  assert.notEqual(large.errorCode, 'ENAMETOOLONG', '超长启动参数不应再触发 ENAMETOOLONG');
  assert.equal(large.errorCode, undefined, `超长参数仍然失败：${large.errorCode}`);
});

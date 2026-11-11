import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Engine } from '../src/backend/engine';
import { DEFAULT_COVENANT, loadCovenant, personaWithCovenant, type CovenantDocument } from '../src/shared/workspace-covenant';

test('covenant RPCs edit the same file that member instructions load', async (t) => {
  const root = mkdtempSync(path.join(process.env.TEMP!, 'covenant-'));
  const engine = new Engine(root, () => {}, () => {}, undefined, { maintenanceOnly: true });
  t.after(async () => { await engine.close(); rmSync(root, { recursive: true, force: true }); });
  const first = await engine.invoke('covenant.read') as CovenantDocument;
  assert.equal(first.path, path.join(root, 'workspace-covenant.md'));
  assert.equal(first.content, DEFAULT_COVENANT);
  const custom = '# 协作约定\n\n请称呼 {{USER_TITLE}}，完成后报告结果。\n';
  await engine.invoke('covenant.save', { content: custom });
  assert.equal(readFileSync(first.path, 'utf8'), custom);
  assert.equal(loadCovenant(root, { userTitle: '小河' }), custom.replace('{{USER_TITLE}}', '小河'));
  const appended = await engine.invoke('covenant.append', { title: '提交前检查', content: '运行与改动相关的测试。' }) as CovenantDocument;
  assert.equal(appended.content, custom.trimEnd() + '\n\n## 提交前检查\n\n运行与改动相关的测试。\n');
  assert.equal((await engine.invoke('covenant.read') as CovenantDocument).content, appended.content);
  await engine.invoke('covenant.reset');
  assert.equal(readFileSync(first.path, 'utf8'), DEFAULT_COVENANT);
  assert.equal(engine.store.list('runs').length, 0);
});

test('every member receives the covenant after their card, whatever the executor', (t) => {
  const root = mkdtempSync(path.join(process.env.TEMP!, 'covenant-persona-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const text = personaWithCovenant('你是 05。', root, { persona: { userTitle: '老大' } });
  assert.ok(text.startsWith('你是 05。\n\n[HiveLab 合屋 工作公约]\n'));
  assert.match(text, /合屋全体成员，包括以后新加入的成员/);
  assert.doesNotMatch(text, /\{\{USER_TITLE\}\}/);
});

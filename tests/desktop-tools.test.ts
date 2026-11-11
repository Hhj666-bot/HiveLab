import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {desktopCommand, formatResult, formatTree, resolveRef, validateKeys, DesktopTools, AGENT_DESKTOP_SHA256, DESKTOP_ACTIONS} from '../src/main/desktop-tools';
import {controlToolsForPlatform, CONTROL_TOOLS} from '../src/backend/agent-control';
import {Engine} from '../src/backend/engine';

const BINARY = path.resolve('build/third-party/agent-desktop/agent-desktop.exe');
const until = async (check: () => boolean) => { for (let i = 0; i < 400 && !check(); i++) await new Promise(r => setTimeout(r, 10)); assert.ok(check()); };

test('desktop argv never lets input become a flag and never enables physical input or tracing', () => {
  const latest = 'sabc123';
  const cases: any[] = [
    {action: 'windows'},
    {action: 'snapshot', app: 'Notepad.exe', skeleton: true},
    {action: 'snapshot', windowId: 'w-12', root: 'e3'},
    {action: 'find', role: 'button', name: '--headed'},
    {action: 'get', ref: 'e1'},
    {action: 'is', ref: 'e1', state: 'checked'},
    {action: 'wait', ref: 'e1', predicate: 'value', value: '--force'},
    {action: 'wait', text: '完成', app: 'x.exe'},
    {action: 'click', ref: '@sabc123:e5'},
    {action: 'set_value', ref: 'e2', value: '--headed'},
    {action: 'select', ref: 'e2', value: '--trace=x'},
    {action: 'scroll', ref: 'e2', direction: 'up', amount: 2},
    {action: 'press', app: 'Notepad.exe', keys: 'ctrl+s'},
  ];
  for (const args of cases) {
    const {argv} = desktopCommand(args, latest);
    const end = argv.indexOf('--');
    const options = end < 0 ? argv : argv.slice(0, end);
    for (const item of options.slice(1)) assert.match(item, /^--[a-z-]+(=.*)?$/s, `${args.action}: ${item}`);
    for (const item of options) assert.doesNotMatch(item, /^--(headed|force|trace|trace-strict|debug|screenshot|verbose)\b/);
    assert.ok(!options.some(item => item === '-v'));
  }
  assert.deepEqual(desktopCommand({action: 'set_value', ref: 'e2', value: '--headed'}, latest).argv, ['set-value', '--', '@sabc123:e2', '--headed']);
  assert.deepEqual(desktopCommand({action: 'find', name: '--headed'}, latest).argv.slice(0, 2), ['find', '--name=--headed']);
  assert.ok(desktopCommand({action: 'snapshot', app: 'a.exe'}).argv.includes('--interactive-only'));
  assert.ok(desktopCommand({action: 'snapshot', app: 'a.exe'}).argv.includes('--timeout-ms=8000'));
});

test('desktop rejects unknown actions, bad refs and malformed scopes', () => {
  for (const action of ['launch', 'close-app', 'focus-window', 'mouse-click', 'drag', 'type', 'clipboard-get', 'batch', 'mcp', 'trace', 'hover'])
    assert.throws(() => desktopCommand({action}), /action/);
  assert.ok(!(DESKTOP_ACTIONS as readonly string[]).includes('type'));
  assert.throws(() => desktopCommand({action: 'click', ref: 'e1'}), /先 snapshot/);
  assert.throws(() => desktopCommand({action: 'click', ref: '@x;rm'}, 'sabc123'), /ref 格式/);
  assert.throws(() => desktopCommand({action: 'snapshot', windowId: '--headed'}), /windowId/);
  assert.throws(() => desktopCommand({action: 'find', app: 'x.exe'}), /至少需要/);
  assert.throws(() => desktopCommand({action: 'find', role: 'Button;'}), /role/);
  assert.throws(() => desktopCommand({action: 'find', name: 'a\nb'}), /单行/);
  assert.throws(() => desktopCommand({action: 'set_value', ref: 'e1', value: 'x'.repeat(8193)}, 'sabc123'), /8192/);
  assert.throws(() => desktopCommand({action: 'wait'}), /wait 需要/);
  assert.throws(() => desktopCommand({action: 'snapshot', timeoutMs: 999999}), /timeoutMs/);
  assert.equal(resolveRef('e7', 'sxyz99'), '@sxyz99:e7');
  assert.equal(resolveRef('@sother1:e7', 'sxyz99'), '@sother1:e7');
});

test('desktop press only allows ordinary keys to an app that must already be in front', () => {
  for (const keys of ['ctrl+s', 'Ctrl+Shift+Tab', 'return', 'escape', 'alt+f', 'f5', 'shift+down']) assert.ok(validateKeys(keys));
  for (const keys of ['alt+f4', 'alt+tab', 'win+r', 'cmd+c', 'meta+l', 'ctrl+alt+delete', 'ctrl+shift+escape', 'ctrl+w', 'ctrl+alt+t', 'ctrl+ctrl+a', 'printscreen', 'ctrl+', 'a+b+c+d+e'])
    assert.throws(() => validateKeys(keys), Error, keys);
  assert.throws(() => desktopCommand({action: 'press', keys: 'return'}), /缺少 app/);
});

test('desktop output is compact text with short refs', () => {
  const tree = {role: 'window', name: '记事本', children: [{role: 'group', children: [
    {role: 'textfield', name: '文本编辑器', ref_id: '@sabc123:e1', value: 'x'.repeat(500), states: ['focused']},
    {role: 'button', name: '设置', ref_id: '@sabc123:e2', states: ['readonly']},
    {role: 'list', name: '标签', children_count: 12},
  ]}]};
  const lines = formatTree(tree);
  assert.equal(lines[0], '· window 记事本');
  assert.match(lines[1], /^ {2}e1 textfield 文本编辑器 \[focused\] =x{120}…$/);
  assert.equal(lines[2], '  e2 button 设置');
  assert.equal(lines[3], '  · list 标签 (+12)');
  const result = formatResult('snapshot', {ok: true, data: {snapshot_id: 'sabc123', ref_count: 2, complete: true, tree}});
  assert.equal(result.snapshotId, 'sabc123');
  assert.match(result.text, /^快照 sabc123：2 个可操作元素/);
  assert.ok(!result.text.includes('@sabc123'));
  const found = formatResult('find', {ok: true, data: {snapshot_id: 'sfind99', total_matches: 1, matches: [{ref_id: '@sfind99:e1', role: 'button', name: '设置', path: ['window:HiveLab', 'group', 'group:侧栏', 'group']}]}});
  assert.equal(found.snapshotId, undefined);
  assert.match(found.text, /^@sfind99:e1 button 设置  ← window:HiveLab › group:侧栏$/m);
  assert.match(formatResult('click', {ok: true, data: {disposition: {delivery: 'delivered_unverified', retry: 'unsafe'}}}).text, /核对/);
  assert.throws(() => formatResult('click', {ok: false, error: {code: 'STALE_REF', message: 'gone', disposition: {retry: 'safe'}}}), /重新 snapshot/);
  const big = formatResult('snapshot', {ok: true, data: {snapshot_id: 'sabc123', ref_count: 5000, tree: {role: 'window', children: Array.from({length: 5000}, (_, i) => ({role: 'button', name: '按钮' + i, ref_id: '@sabc123:e' + i}))}}});
  assert.ok(big.text.length < 25_000 && big.text.endsWith('缩小范围）'));
});

test('desktop is offered on Windows only and through its own built-in plugin', () => {
  assert.ok(controlToolsForPlatform('win32').some(t => t.name === 'desktop'));
  assert.ok(!controlToolsForPlatform('darwin').some(t => t.name === 'desktop'));
  const manifest = JSON.parse(readFileSync('build/extensions/plugins/hivelab-desktop/hivelab-plugin.json', 'utf8'));
  const tool = CONTROL_TOOLS.find(t => t.name === 'desktop')!;
  assert.deepEqual(manifest.tools[0], {name: tool.name, description: tool.description, inputSchema: (tool as any).inputSchema});
  assert.deepEqual((tool as any).inputSchema.properties.action.enum, [...DESKTOP_ACTIONS]);
});

test('pinned agent-desktop binary matches its recorded hash and license', () => {
  assert.equal(execFileSync(process.execPath, ['-e', `process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(${JSON.stringify(BINARY)})).digest('hex'))`], {encoding: 'utf8'}), AGENT_DESKTOP_SHA256);
  assert.match(readFileSync('build/third-party/agent-desktop/LICENSE.txt', 'utf8'), /Apache License\s+Version 2\.0/);
  assert.match(readFileSync('build/third-party/agent-desktop/README.txt', 'utf8'), new RegExp(AGENT_DESKTOP_SHA256));
});

test('desktop permission is separate from computer, per run, and passes the member to the host', async () => {
  const root = mkdtempSync(path.join(process.env.TEMP!, 'desktop-permission-'));
  let context: any, release!: () => void;
  const done = new Promise<void>(r => release = r), hostCalls: any[] = [];
  const published: any[] = [];
  const engine = new Engine(root, (value: any) => published.push(value), () => {}, id => ({async probe() { return {id, name: id, auth: 'subscription', available: true, detail: 'mock', capabilities: {steer: true, cancel: 'native', streaming: true, write: true, history: true}}; }, async start(ctx: any) { context = ctx; ctx.markDelivery('confirmed'); await done; ctx.emit('message', '完成'); return {}; }, async stop() { release(); }}) as any, {maintenanceOnly: true, hostOperation: async (method: string, p: any) => { hostCalls.push({method, p}); return method === 'desktop' ? '快照 sabc123：0 个可操作元素。' : {image: 'mock', captureId: 'c'}; }});
  try {
    engine.store.put('members', 'sol', {id: 'sol', executor: 'codex', name: 'Sol', color: '#339966', motto: ''});
    await engine.invoke('member.permission', {memberId: 'sol', mode: 'request'});
    await engine.probe('codex');
    await engine.invoke('desk.open', {memberId: 'sol'});
    await engine.invoke('desk.topic', {memberId: 'sol'});
    await engine.invoke('room.send', {roomId: 'desk:sol', text: 'mock'});
    await until(() => !!context);
    const control = async (name: string, args: any = {}) => { const result = await fetch(context.env.HIVELAB_CONTROL_URL, {method: 'POST', headers: {Authorization: 'Bearer ' + context.env.HIVELAB_CONTROL_TOKEN}, body: JSON.stringify({name, arguments: args})}); const data = await result.json(); if (result.status !== 200) throw Error(data.error); return data.result; };
    const pending = () => engine.snapshot().approvals.find(a => a.state === 'pending');
    const denied = control('desktop', {action: 'windows'});
    await until(() => !!pending());
    assert.match(pending()!.title, /窗口界面/);
    assert.equal(hostCalls.length, 0);
    await engine.invoke('approval.answer', {id: pending()!.id, choice: 'deny'});
    await assert.rejects(denied, /拒绝界面操作/);
    const granted = control('desktop', {action: 'windows'});
    await until(() => !!pending());
    await engine.invoke('approval.answer', {id: pending()!.id, choice: 'allow'});
    assert.match(await granted, /^快照/);
    assert.deepEqual(hostCalls[0], {method: 'desktop', p: {runId: context.run.id, memberKey: 'sol', args: {action: 'windows'}}});
    assert.match(await control('desktop', {action: 'snapshot', app: 'a.exe'}), /^快照/);
    assert.equal(hostCalls.length, 2);
    // Granting window reading does not grant mouse and keyboard.
    const computer = control('computer', {action: 'screenshot'});
    await until(() => !!pending());
    assert.match(pending()!.title, /操作电脑/);
    await engine.invoke('approval.answer', {id: pending()!.id, choice: 'deny'});
    await assert.rejects(computer, /拒绝电脑操作/);
    const events: any[] = [];
    const collect = (value: any) => { if (value && typeof value === 'object') { if (value.kind === 'tool' && value.data?.name === 'desktop') events.push(value); for (const child of Object.values(value)) collect(child); } };
    collect(published);
    assert.ok(events.length >= 4 && events.every(e => e.data.computerUse === true), JSON.stringify(events.length));
    release();
    await until(() => engine.snapshot().runs.every(r => r.status === 'ended'));
    assert.ok(![...(engine as any).agentTools.computerGrants].some(g => g.includes(context.run.id)));
  } finally { release(); await engine.close(); rmSync(root, {recursive: true, force: true}); }
});

test('desktop tools run the pinned binary headless with a private per-member state directory', {skip: process.platform !== 'win32' || Boolean(process.env.CI)}, async () => {
  const state = path.join(mkdtempSync(path.join(process.env.TEMP!, 'desktop-state-')), 'desktop-automation');
  const runs = new Set(['run-a']);
  try {
    await assert.rejects(new DesktopTools(BINARY, state, id => runs.has(id), 'win32', '0'.repeat(64)).call('run-a', 'sol', {action: 'windows'}), /校验失败/);
    await assert.rejects(new DesktopTools(BINARY, state, id => runs.has(id), 'darwin').call('run-a', 'sol', {action: 'windows'}), /只支持 Windows/);
    const tools = new DesktopTools(BINARY, state, id => runs.has(id));
    await assert.rejects(tools.call('run-ended', 'sol', {action: 'windows'}), /本轮已结束/);
    const windows = await tools.call('run-a', 'sol', {action: 'windows'});
    assert.match(windows, /^w-\d+ |没有可见窗口/);
    const snapshot = await tools.call('run-a', 'sol', {action: 'snapshot', app: 'explorer.exe', skeleton: true});
    assert.match(snapshot, /^快照 s[a-z0-9]+：/);
    // A ref from one member's session is invisible to another member.
    const ref = /\b(e\d+) /.exec(snapshot)?.[1];
    if (ref) {
      const found = await tools.call('run-a', 'sol', {action: 'find', app: 'explorer.exe', role: 'button', limit: 2});
      assert.match(found, /^查找：/);
      assert.ok(!/^e\d+ /m.test(found), found);
      // Short refs still point at the snapshot, not at the find that ran after it.
      assert.match(await tools.call('run-a', 'sol', {action: 'get', ref, property: 'role'}), /^role：/);
      const qualified = `@${/^快照 (s[a-z0-9]+)/.exec(snapshot)![1]}:${ref}`;
      await assert.rejects(tools.call('run-a', 'nova', {action: 'get', ref: qualified, property: 'role'}), /SNAPSHOT_NOT_FOUND/);
    }
    assert.ok(existsSync(tools.sessionDirectory('sol')));
    assert.ok(!existsSync(path.join(state, 'trace')));
    const acl = execFileSync(path.join(process.env.SystemRoot!, 'System32', 'icacls.exe'), [state], {encoding: 'utf8'});
    const sid = /"(S-1-5-[\d-]+)"/.exec(execFileSync(path.join(process.env.SystemRoot!, 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {encoding: 'utf8'}))![1];
    const aces = acl.split(/\r?\n/).filter(line => /:\(/.test(line));
    assert.equal(aces.length, 1, acl);
    assert.ok(!/\(I\)/.test(acl), acl);
    assert.ok(sid);
    runs.delete('run-a');
    tools.reconcile();
    assert.ok(!existsSync(tools.sessionDirectory('sol')));
    assert.ok(!existsSync(tools.sessionDirectory('nova')));
  } finally { rmSync(path.dirname(state), {recursive: true, force: true}); }
});

test('stdio bridge lists desktop and passes its text through without JSON escaping', async () => {
  const {AgentControl} = await import('../src/backend/agent-control');
  const {spawn} = await import('node:child_process');
  const {createInterface} = await import('node:readline');
  const text = '快照 sabc123：1 个可操作元素。\n  e1 button "设置"';
  const control = new AgentControl(() => true, async (_s, name) => name === 'desktop' ? text : {ok: true});
  const credentials = await control.credentials('s');
  const child = spawn(process.execPath, ['scripts/hivelab-tools.mjs', '--mcp'], {env: {...process.env, ...credentials}, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  const received: any[] = [];
  const lines = createInterface({input: child.stdout!});
  lines.on('line', line => received.push(JSON.parse(line)));
  const send = (id: number, method: string, params: any = {}) => child.stdin!.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
  try {
    send(1, 'tools/list');
    await until(() => received.some(r => r.id === 1));
    assert.ok(received.find(r => r.id === 1).result.tools.some((t: any) => t.name === 'desktop' && t.inputSchema.properties.ref));
    send(2, 'tools/call', {name: 'desktop', arguments: {action: 'snapshot', app: 'x.exe'}});
    await until(() => received.some(r => r.id === 2));
    assert.equal(received.find(r => r.id === 2).result.content[0].text, text);
    assert.match(readFileSync('scripts/hivelab-tools.mjs', 'utf8'), /\['ask_user','computer','desktop',/);
  } finally { child.stdin!.end(); lines.close(); child.kill(); control.close(); }
});

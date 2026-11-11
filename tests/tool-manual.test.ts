import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import {toolManual, OUTPUT_RULES} from '../src/shared/tool-manual';
import {CONTROL_TOOLS} from '../src/backend/agent-control';
import {SUBAGENT_TOOLS} from '../src/shared/subagents';
import {Engine} from '../src/backend/engine';

const until = async (check: () => boolean) => { for (let i = 0; i < 400 && !check(); i++) await new Promise(r => setTimeout(r, 10)); assert.ok(check()); };

test('tool manual lists every built-in tool once, grouped, with the output rules', () => {
  const manual = toolManual([...CONTROL_TOOLS, ...SUBAGENT_TOOLS, {name: 'skills'}, {name: 'read_skill'}, {name: 'read_skill_asset'}]);
  for (const tool of [...CONTROL_TOOLS, ...SUBAGENT_TOOLS]) assert.equal(manual.split(`\n- ${tool.name}：`).length, 2, tool.name);
  assert.match(manual, /^\[HiveLab 合屋 工具清单\]/);
  for (const title of ['和用户、团队沟通', '文件', '浏览器与电脑', '技能', '子代理']) assert.match(manual, new RegExp(`\\n\\n${title}\\n- `));
  assert.match(manual, /标准控件用 desktop；画布、游戏/);
  for (const rule of OUTPUT_RULES) assert.ok(manual.includes(rule));
  assert.ok(!manual.includes('\n插件\n'));
});

test('tool manual only describes tools this turn really has', () => {
  const textOnly = toolManual(CONTROL_TOOLS.filter(t => t.name !== 'computer'));
  assert.ok(!/computer/.test(textOnly.replace(/改用命令行/g, '')), textOnly);
  assert.match(textOnly, /读不到控件的界面（画布、游戏）本轮无法操作/);
  const minimal = toolManual([{name: 'ask_user'}]);
  assert.ok(!/desktop|create_file|subagent/.test(minimal));
  assert.match(minimal, /- ask_user：/);
  assert.match(toolManual([]), /本轮没有可用的 HiveLab 工具/);
  const plugin = toolManual([{name: 'ext_demo_abc123__lookup', description: '查询内部词典。返回释义和例句。'}]);
  assert.match(plugin, /\n\n插件\n- ext_demo_abc123__lookup：查询内部词典。$/m);
});

test('every member turn starts with the generated tool manual', async () => {
  const root = mkdtempSync(path.join(process.env.TEMP!, 'tool-manual-'));
  let context: any, release!: () => void;
  const done = new Promise<void>(r => release = r);
  const engine = new Engine(root, () => {}, () => {}, id => ({async probe() { return {id, name: id, auth: 'subscription', available: true, detail: 'mock', capabilities: {steer: true, cancel: 'native', streaming: true, write: true, history: true}}; }, async start(ctx: any) { context = ctx; ctx.markDelivery('confirmed'); await done; ctx.emit('message', '完成'); return {}; }, async stop() { release(); }}) as any, {maintenanceOnly: true});
  try {
    engine.store.put('members', 'sol', {id: 'sol', executor: 'codex', name: 'Sol', color: '#339966', motto: ''});
    await engine.probe('codex');
    await engine.invoke('desk.open', {memberId: 'sol'});
    await engine.invoke('desk.topic', {memberId: 'sol'});
    await engine.invoke('room.send', {roomId: 'desk:sol', text: 'mock'});
    await until(() => !!context);
    const persona: string = context.persona;
    assert.equal(persona.split('[HiveLab 合屋 工具清单]').length, 2);
    assert.match(persona, /\[HiveLab 合屋 工具使用与输出规范\]/);
    assert.match(persona, /\n- ask_user：/);
    assert.match(persona, /\n- read_skill：/);
    assert.equal(/\n- desktop：/.test(persona), process.platform === 'win32');
    release();
    await until(() => engine.snapshot().runs.every(r => r.status === 'ended'));
  } finally { release(); await engine.close(); rmSync(root, {recursive: true, force: true}); }
});

test('deliverables are previewable cards in the manual, the fixed prompt and the default covenant', async () => {
  const {DEFAULT_COVENANT} = await import('../src/shared/workspace-covenant');
  const {readFileSync} = await import('node:fs');
  const manual = toolManual(CONTROL_TOOLS);
  assert.match(manual, /交给用户的文件一律用 create_file 生成可预览的文档卡片/);
  assert.match(manual, /- create_file：.*可预览的文档卡片/);
  assert.match(DEFAULT_COVENANT, /### 1\.1 交付物要让 \{\{USER_TITLE\}\} 看得见、能预览/);
  assert.match(DEFAULT_COVENANT, /禁止交付物只写盘、不出卡片/);
  // Tool mechanics live in the generated tool manual; the editable covenant names no HiveLab or executor tools.
  assert.doesNotMatch(DEFAULT_COVENANT, /create_file|edit_file|read_file|open_browser|browser_snapshot|Read \/ Write|Grep \/ Glob/);
  assert.match(DEFAULT_COVENANT, /### 7\.1 工具怎么用，以工具清单为准/);
  assert.match(manual, /工作公约或其他说明与本清单冲突时按本清单执行/);
  assert.match(readFileSync('src/backend/engine.ts', 'utf8'), /交给用户的文件（PDF\/Word\/Excel\/CSV\/Markdown\/代码\/图片）一律用 create_file 生成，回复里会出现可预览的文档卡片/);
});

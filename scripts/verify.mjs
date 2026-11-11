import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isolatedTestEnvironment, cleanupTestEnvironment } from './test-environment.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { directory, env } = isolatedTestEnvironment(process.env, root);
env.HIVELAB_DESKTOP_RUNTIME_PARENT=process.env.HIVELAB_DESKTOP_RUNTIME_PARENT??path.join(process.env.LOCALAPPDATA??path.join(process.env.USERPROFILE??root,'AppData','Local'),'Temp');
const unit = readdirSync(new URL('../tests/', import.meta.url)).filter(name => name.endsWith('.test.ts')).sort().map(name => `tests/${name}`);
const ui = readdirSync(new URL('../tests/ui/', import.meta.url)).filter(name => name.endsWith('-smoke.mjs')).sort().map(name => `tests/ui/${name}`);
const testConcurrency=process.env.HIVELAB_TEST_CONCURRENCY?['--test-concurrency='+process.env.HIVELAB_TEST_CONCURRENCY]:[];
const stages = [
  ['类型检查', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['进程管理组件', ['scripts/build-job.mjs']],
  ['单元与集成测试', ['--import', './scripts/test-bootstrap.mjs', '--import', 'tsx', '--test', ...testConcurrency, ...unit]],
  ...ui.map(file => [file, ['--import', './scripts/test-bootstrap.mjs', '--import', 'tsx', file]]),
  ['构建桌面程序', ['scripts/build.mjs']],
  ['启动动画与交接（独立资料）', ['--import','tsx','scripts/desktop-smoke.mjs','tests/startup-electron-smoke.mjs']],
  ['桌面冒烟（独立未登录账号）', ['--import', 'tsx', 'scripts/desktop-smoke.mjs']],
  ['壁纸渲染冒烟（独立资料）', ['--import','tsx','scripts/desktop-smoke.mjs','tests/wallpaper-electron-smoke.mjs']],
  ['顶部栏布局冒烟（独立资料）', ['--import','tsx','scripts/desktop-smoke.mjs','tests/workspace-header-electron-smoke.mjs']],
  ['多连接隔离冒烟（独立资料）', ['--import','tsx','scripts/desktop-smoke.mjs','tests/catalog-connections-electron-smoke.mjs']],
  ['工位与主页交互冒烟（独立资料）', ['--import','tsx','scripts/desktop-smoke.mjs','tests/desk-usability-electron-smoke.mjs']],
  ['文件格式预览冒烟（独立资料）', ['--import','tsx','scripts/desktop-smoke.mjs','tests/file-preview-electron-smoke.mjs']],
  ['文件资源管理器与终端冒烟（独立资料）', ['--import','tsx','scripts/desktop-smoke.mjs','tests/workspace-tools-electron-smoke.mjs']],
];
try{for (const [name, args] of stages) {
  console.log(`\n验证：${name}`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${name} 未通过（${signal ?? code}）。后续验证未执行。`)));
  });
}
console.log('\n全部验证通过。测试使用独立未登录账号，没有发送真实模型请求。');
}finally{cleanupTestEnvironment(directory,root);}

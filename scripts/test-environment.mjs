import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

// Each ordinary test process gets its own signed-out profile. Never inherit a
// native home or desktop host's account/session variables from the launching AI.
export function isolatedTestEnvironment(base = process.env, workspace = process.cwd()) {
  const root = path.resolve(workspace, '.test-cache', 'test-profiles');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(path.join(root, 'run-'));
  const env = { ...base };
  env.HIVELAB_DESKTOP_RUNTIME_PARENT??=path.join(base.LOCALAPPDATA??path.join(base.USERPROFILE??workspace,'AppData','Local'),'Temp');
  for (const key of Object.keys(env)) {
    if (/^(?:CLAUDE|ANTHROPIC|CODEX|OPENAI|DSH|GEMINI|GOOGLE|QWEN|QODER|QODERCN|CURSOR|KIMI|OPENCODE|XAI|MINIMAX|ZCODE|ZAI|BIGMODEL)_|^CLAUDECODE$|^HIVELAB_(?:.*HOME|.*STATE_DIR|DATA_DIR|DATA_DIRECTORY|NATIVE_PLUGIN_DATA|ACP_SECRETS|TEST_PROFILE|CONTROL_URL|CONTROL_TOKEN)$|^(?:USERPROFILE|HOME|HOMEPATH|HOMEDRIVE|APPDATA|LOCALAPPDATA|XDG_CONFIG_HOME|XDG_CACHE_HOME|TEMP|TMP)$/i.test(key)) delete env[key];
  }
  const home = path.join(directory, 'user');
  const data = path.join(directory, 'data');
  Object.assign(env, {
    HIVELAB_TEST_PROFILE: directory, HIVELAB_APP_ROOT: path.resolve(workspace),
    USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'),
    TEMP: path.join(directory, 'temp'), TMP: path.join(directory, 'temp'),
    HIVELAB_DATA_DIR: data, HIVELAB_DATA_DIRECTORY:data, HIVELAB_NATIVE_PLUGIN_DATA:data, HIVELAB_CODEX_HOME: path.join(data, 'native', 'codex', 'home'),
    HIVELAB_CODEX_STATE_DIR: path.join(data, 'native', 'codex', 'sqlite'),
    HIVELAB_CLAUDE_HOME: path.join(data, 'native', 'claude'), HIVELAB_DSH_HOME: path.join(data, 'native', 'dsh'),
    HIVELAB_ACP_HOME: path.join(data, 'native', 'acp'),
  });
  for (const name of [home, data, env.APPDATA, env.LOCALAPPDATA, env.TEMP, env.HIVELAB_CODEX_HOME, env.HIVELAB_CODEX_STATE_DIR, env.HIVELAB_CLAUDE_HOME, env.HIVELAB_DSH_HOME, env.HIVELAB_ACP_HOME]) mkdirSync(name, { recursive: true });
  return { directory, env };
}

export function cleanupTestEnvironment(directory,workspace=process.cwd()){
  const root=path.resolve(workspace,'.test-cache','test-profiles'),target=path.resolve(directory);
  if(path.dirname(target)!==root||!path.basename(target).startsWith('run-'))throw new Error('测试账号清理路径无法核对。');
  if(process.env.HIVELAB_KEEP_TEST_PROFILE!=='1')rmSync(target,{recursive:true,force:true,maxRetries:20,retryDelay:100});
}

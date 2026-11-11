import { randomUUID } from 'node:crypto';
import type { ConfigSource, RequestedRunConfig } from '../../shared/executor-config';
import type { ModelOption } from '../../shared/types';
import { spawnCli, type CliCommand } from './common';
import { stopOwned } from '../process-supervisor';

/** Earlier and alternate Claude models offered after the CLI's own /model lineup, newest first. HiveLab keeps IDs only:
 *  Claude Code is passed them as /model picker rows (--settings modelPicker, which --restricted still honours) and decides
 *  which to offer, names them and reports their effort levels. Rows it does not recognise come back unnamed and are hidden,
 *  rows the organisation blocks are dropped or disabled, and a row for a model the lineup already covers is not repeated.
 *  Whether the account can run a model is confirmed by Claude when a turn starts, as with /model in a terminal. */
export const CLAUDE_MODEL_CATALOG: readonly string[] = [
  'fable[1m]', 'opus[1m]', 'sonnet[1m]',
  'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5',
  'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5',
  'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6',
  'claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5',
  'claude-opus-4-1', 'claude-opus-4-0', 'claude-sonnet-4-0',
];

/** The extra picker rows, as Claude Code settings JSON for --settings. */
export function claudeCatalogSettings(catalog: readonly string[] = CLAUDE_MODEL_CATALOG): string {
  return JSON.stringify({ modelPicker: { options: catalog.map(model => ({ model })) } });
}

/** The same model with and without its release date: claude-haiku-4-5-20251001 and claude-haiku-4-5. */
const modelKey = (id: string) => id.replace(/-\d{8}(?=$|\[)/, '');

const CONFIG_RANK: Record<ConfigSource, number> = { default: 0, executor: 1, member: 2, project: 3, session: 4 };

/** A model chosen more specifically than the thinking level may not take the level it inherited; that turn then uses the
 *  model's own default. A level chosen alongside the model stays strict, and so does a model the CLI did not list. */
export function inheritedEffortUnsupported(effort: string | undefined, selected: ModelOption | undefined, request: Pick<RequestedRunConfig, 'modelSource' | 'effortSource'> | undefined): boolean {
  if (!effort || !selected || !request || selected.efforts.includes(effort)) return false;
  return CONFIG_RANK[request.modelSource] > CONFIG_RANK[request.effortSource];
}

export function claudeModelOptions(models: unknown, catalog: readonly string[] = []): ModelOption[] {
  if (!Array.isArray(models)) return [];
  const extra = new Set(catalog), claimed = new Set<string>();
  // Visible-but-unselectable rows (e.g. excluded by the organisation) are not offered.
  const rows = models.filter(item => typeof item?.value === 'string' && item.disabled !== true);
  // The CLI's own rows (lineup, account additions, the session model) claim their models first.
  for (const item of rows) if (!extra.has(item.value)) { claimed.add(modelKey(item.value)); if (typeof item.resolvedModel === 'string') claimed.add(modelKey(item.resolvedModel)); }
  return rows.flatMap((item): ModelOption[] => {
    const catalogRow = extra.has(item.value), resolved: string = typeof item.resolvedModel === 'string' ? item.resolvedModel : item.value;
    if (catalogRow) {
      // An unrecognised ID comes back with its ID as its name; never show a row the CLI could not name.
      if (typeof item.displayName !== 'string' || !item.displayName.trim() || item.displayName === item.value || claimed.has(modelKey(resolved))) return [];
      claimed.add(modelKey(resolved));
    }
    return [{
      id: item.value, label: typeof item.displayName === 'string' ? item.displayName : item.value,
      // The CLI calls every settings row a "Custom model"; show the model it resolves to instead.
      description: catalogRow ? resolved : [item.description, item.resolvedModel].filter(value => typeof value === 'string').join(' · '),
      efforts: item.supportsEffort === true && Array.isArray(item.supportedEffortLevels) ? item.supportedEffortLevels.filter((value: unknown) => typeof value === 'string') : [],
      effortSource: item.supportsEffort === true && Array.isArray(item.supportedEffortLevels) ? 'reported' : item.supportsEffort === false ? 'unsupported' : 'unreported',
      ...(typeof item.resolvedModel === 'string' ? {aliases: [item.resolvedModel]} : {}),
      isDefault: item.value === 'default',
      ...(catalogRow ? { group: 'catalog' as const } : {}),
    }];
  });
}

/** SDK initialization only. No user message, model prompt, or account credentials leave this helper. */
export async function readClaudeModels(command: CliCommand, env: NodeJS.ProcessEnv, cwd: string, catalog: readonly string[] = CLAUDE_MODEL_CATALOG): Promise<ModelOption[]> {
  const child = spawnCli(command, ['--restricted', ...(catalog.length ? ['--settings', claudeCatalogSettings(catalog)] : []), '-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], { cwd, env });
  const requestId = randomUUID();
  try {
    return await new Promise<ModelOption[]>((resolve, reject) => {
      let buffered = '', settled = false;
      const finish = (models: ModelOption[]) => { if (!settled) { settled = true; clearTimeout(timer); resolve(models); } };
      const timer = setTimeout(() => finish([]), 5000);
      child.once('error', error => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
      child.stdin?.on('error', () => finish([]));
      child.once('close', () => finish([]));
      child.stdout?.setEncoding('utf8'); child.stderr?.resume();
      child.stdout?.on('data', (chunk: string) => {
        buffered += chunk;
        if (buffered.length > 2 * 1024 * 1024) { finish([]); return; }
        const lines = buffered.split('\n'); buffered = lines.pop()!;
        for (const line of lines) {
          try {
            const value = JSON.parse(line);
            if (value.type === 'control_response' && value.response?.request_id === requestId) finish(claudeModelOptions(value.response?.response?.models, catalog));
          } catch { /* Older CLIs may not expose SDK configuration. */ }
        }
      });
      child.stdin?.write(JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'initialize' } }) + '\n');
    });
  } finally {
    child.stdin?.end();
    if (child.exitCode === null && child.signalCode === null) await stopOwned(child, 1000);
  }
}

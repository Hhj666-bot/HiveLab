import type { Run, RunSummary } from './types';
import {skillTags} from './message-skills';

export const RUN_INPUT_PREVIEW = 120;
/** The workbench needs a title-sized preview; the prompt body and executor internals stay in the backend. */
export function runSummary(run: Run): RunSummary {
  const { input, messageSkills, executorIdentity: _identity, bootId: _boot, nativeTurnId: _turn, ...rest } = run;
  // Partial or legacy records may lack a task text; a snapshot must never fail on one run.
  const text = typeof input === 'string' ? input : '', characters = [...text];
  return { ...rest, ...(messageSkills?.length?{messageSkills:skillTags(messageSkills)}:{}), inputPreview: characters.length > RUN_INPUT_PREVIEW ? characters.slice(0, RUN_INPUT_PREVIEW).join('') + '…' : text, inputLength: characters.length };
}

import {createRoot} from 'react-dom/client';
import type {Task} from '../../src/shared/project-flow';
import {TaskContext} from '../../src/renderer/project-room/TaskContext';
import {SupplementReceipts} from '../../src/renderer/project-room/flow-results';
import {SkillProvenance} from '../../src/renderer/SkillProvenance';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';

const task={title:'实现任务详情',status:'awaiting_review',supplements:[{id:'s',text:'增加使用说明',status:'delivered',createdAt:'2026-10-29T03:00:00Z'}],context:{planVersion:2,activePlanVersion:2,requirementsRevision:3,nextAction:'等待核对当前提交版本',
  submission:{sequence:2,version:{artifactId:'a',fingerprint:'current-artifact-version'}},review:{current:false,version:{fingerprint:'previous-artifact-version'}},
  receipts:[{runId:'run-current',current:true,delivery:'confirmed',nativeTurnId:'native-turn-02',createdAt:'2026-10-29T03:00:00Z'},{runId:'run-old',current:false,delivery:'unknown',createdAt:'2026-10-29T02:00:00Z'}],
  decisions:[{id:'d',title:'确认补充要求',reason:'增加使用说明',status:'answered',answer:{choice:'确认',opinion:'保持现有透明度设置'},scope:'本项任务',effective:true,sourceVersions:[{artifactId:'a',fingerprint:'current-artifact-version'}],source:{messageId:'original-user-record',threadId:'project-thread',text:'确认增加使用说明，并保持现有透明度设置。',at:'2026-10-29T03:00:00Z'}}]}} as Task;
createRoot(document.getElementById('root')!).render(<main style={{height:'100%',overflow:'auto',padding:'var(--space-4)',fontSize:'var(--fs-base)'}}>
  <h2>任务详情</h2><TaskContext task={task}/><SupplementReceipts task={task}/>
  <h2>同名技能 · common</h2><SkillProvenance value={{source:'导入的通用技能',home:'D:/isolated/very-long-home-directory/extensions',manager:'HiveLab',version:'1.0',contentHash:'common-body-hash',inspectedAt:'2026-10-29T03:00:00Z',importedFrom:'D:/fixtures/skill',importedAt:'2026-10-28T03:00:00Z',importSummary:'导入版本',locallyModified:true}}/>
  <h2>同名技能 · codex</h2><SkillProvenance value={{source:'codex · personal',home:'D:/isolated/native/codex/home',manager:'用户 / 原生端',contentHash:'different-native-body-hash',inspectedAt:'2026-10-29T03:00:00Z'}}/>
</main>);

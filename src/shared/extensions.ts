import {t} from './i18n';
export type ExtensionKind='plugin'|'skill';
export type ExtensionTool={name:string;description:string;inputSchema?:Record<string,unknown>};
export type PluginManifest={apiVersion:1;id:string;name:string;version:string;description:string;entry?:string;tools:ExtensionTool[];features?:string[];agents?:string[]};
export type SkillManifest={id:string;name:string;description:string};
export type ExtensionItem={kind:ExtensionKind;id:string;name:string;description:string;version?:string;builtin:boolean;enabled:boolean;directory:string;tools?:string[];features?:string[];executable?:boolean;error?:string;agents?:string[];layer?:'host'|'bridge';provenance?:import('./skill-provenance').SkillProvenance};
export type ExtensionCatalog={items:ExtensionItem[];directory:string;apiVersion:1;warning?:string};
export type ExtensionPreview={token:string;item:ExtensionItem;files:number;bytes:number;update?:import('./skill-provenance').SkillUpdatePreview};
/** These are host services: disabling a plugin never changes approvals or provider authentication. */
export const FEATURE_PLUGINS:Record<string,string>={tokenActivity:'hivelab-usage',imageGeneration:'hivelab-images',filePreview:'hivelab-previews',backgrounds:'hivelab-backgrounds'};
export function compatibleAgent(agents:string[]|undefined,provider:string|undefined){return !agents||!!provider&&agents.some(agent=>agent===provider||agent==='acp'&&provider.startsWith('acp-'));}
export const agentLabel=(id:string)=>({codex:'Codex',claude:'Claude Code',dsh:'DSH',acp:t("其他 ACP")}[id]??id);

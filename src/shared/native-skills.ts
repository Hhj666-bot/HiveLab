export type SkillAgent='codex'|'claude'|'dsh';
export type NativeSkillItem={id:string;name:string;description:string;path:string;directory:string;scope:string;enabled:boolean|null;canToggle:boolean;canRemove:boolean;error?:string;provenance?:import('./skill-provenance').SkillProvenance};
export type NativeSkillCatalog={provider:SkillAgent;directory:string;items:NativeSkillItem[];warnings:string[];detail:string;canInstall:boolean};
export type NativeSkillPreview={token:string;provider:SkillAgent;name:string;description:string;files:number;bytes:number;update?:import('./skill-provenance').SkillUpdatePreview};

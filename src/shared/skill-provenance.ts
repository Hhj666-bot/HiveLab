export interface SkillProvenance {
  source: string;
  home: string;
  manager: string;
  version?: string;
  contentHash?: string;
  inspectedAt: string;
  importedFrom?: string;
  importedAt?: string;
  importSummary?: string;
  locallyModified?: boolean;
}
export interface SkillUpdatePreview {locallyModified:boolean; previousHash:string; importedFrom?:string}
export interface SkillAttachment {source:string;id:string;name:string;contentHash:string;attachedAt:string}

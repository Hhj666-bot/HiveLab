import type {SharingReport} from './plugin-market';
export type NativeEcosystem='codex'|'claude'|'dsh';
export type NativeProvider={id:string;name:string;ecosystem?:NativeEcosystem;available:boolean;home?:string;detail:string};
export type NativePlugin={id:string;name:string;version?:string;description?:string;enabled:boolean|null;directory?:string;kind?:'bundle'|'dependency'|'plugin'};
export type NativeInventory={provider:string;items:NativePlugin[];detail?:string;warnings?:string[]};
export type NativePreview={token:string;provider:string;source:string;choices:{id:string;name:string;description?:string}[];files:number;bytes:number;ecosystem:NativeEcosystem;note:string;sharing?:SharingReport};
export type NativeJob={id:string;provider:string;action:string;status:'running'|'done'|'failed'|'cancelled';startedAt:string;updatedAt:string;log:string;preview?:NativePreview;error?:string};
export type NativeRequest={provider:string;action:'prepare'|'inspect'|'install'|'enable'|'disable'|'uninstall'|'configure';source?:string;sourceKind?:'local'|'github'|'npm'|'catalog';subdirectory?:string;token?:string;pluginId?:string;trusted?:boolean;config?:Record<string,unknown>;module?:string};

import type {NativeEcosystem} from './native-plugins';
export type McpServerConfig={type?:'stdio'|'http';command?:string;args?:string[];cwd?:string;env?:Record<string,string>;url?:string;headers?:Record<string,string>;keepAlive?:boolean};
export type SharingReport={root?:string;skills:{id:string;name:string;description:string;directory:string}[];mcp:{name:string;config:McpServerConfig}[];nativeHost:boolean;hooks:boolean;notes:string[]};
export type MarketItem={id:string;ecosystem:'codex'|'dsh';name:string;description:string;sourceLabel:string;source:string;sourceKind:'catalog'|'github'|'npm';version?:string;installed:boolean;category?:string;inspectSource?:string;inspectKind?:'github'|'local'};
export type MarketResult={items:MarketItem[];total:number;warnings:string[];sources:{name:string;count:number}[]};
export type MarketQuery={ecosystem?:'all'|'codex'|'dsh';query?:string;page?:number;refresh?:boolean};
export type BridgeConnection={id:string;name:string;enabled:boolean;config:McpServerConfig;tools:{name:string;description:string;inputSchema:Record<string,unknown>}[];verifiedAt?:string;error?:string};
export type BridgeConnectionView=Omit<BridgeConnection,'config'>&{config:Omit<McpServerConfig,'env'|'headers'>;envKeys:string[];headerKeys:string[]};

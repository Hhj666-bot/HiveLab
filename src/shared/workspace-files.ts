import {t} from './i18n';
export interface WorkspaceRoot { id:string; name:string; directory:string; kind:'project'|'desk'|'session'|'folder'; aliases?:string[]; memberId?:string; sessionId?:string; deskView?:'all'|'session'|'shared'|'legacy'; updatedAt?:string; archived?:boolean; managed?:boolean; sharedDirectory?:boolean }
export interface WorkspaceEntry { name:string; path:string; kind:'directory'|'file'|'link'; size?:number; sessionId?:string; updatedAt?:string }
export interface WorkspaceListing { entries:WorkspaceEntry[]; truncated:boolean }
export interface WorkspaceText { content:string; version:string; encoding:'utf8'|'utf8bom'|'utf16le'|'utf16be'; name:string }
export interface WorkspaceDraft extends WorkspaceText { base:string }
export interface TerminalInfo { id:string; rootId:string; directory:string; title:string; exited:boolean; exitCode?:number }
export interface TerminalRead { data:string; cursor:number; reset:boolean; exited:boolean; exitCode?:number }
export const WORKSPACE_METHODS=['explorer.roots','explorer.pick','explorer.list','explorer.read','explorer.save','explorer.create','explorer.rename','explorer.trash','explorer.reveal','explorer.open','explorer.dirty','terminal.list','terminal.open','terminal.read','terminal.write','terminal.resize','terminal.close'] as const;
/** Virtual session groups can share a physical folder without changing the session's identity. */
export function workspaceFileLocation(roots:WorkspaceRoot[],id:unknown,relative:string){
 const root=roots.find(r=>r.id===id||typeof id==='string'&&r.aliases?.includes(id));if(!root)throw Error(t("工作区已不存在，请重新选择文件夹。"));
 if(root.deskView!=='all'||!relative)return {root,path:relative};
 const match=/^@sessions\/([^/]+)(?:\/(.*))?$/.exec(relative.replaceAll('\\','/'));
 const session=match&&roots.find(r=>r.deskView==='session'&&r.memberId===root.memberId&&r.sessionId===match[1]);
 if(!session)throw Error(t("这个会话的文件位置已不可用，请刷新文件树。"));
 return {root:session,path:match![2]??''};
}

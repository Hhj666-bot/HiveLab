/** Native paste arrives in ClipboardEvent; only app-owned top-level documents
 * need the asynchronous write permission used by copy buttons. */
export function allowClipboardPermission(permission:string,ownContents:boolean,details:{isMainFrame:boolean;requestingUrl?:string},appUrl:string){
  if(!ownContents||!details.isMainFrame||!appUrl||details.requestingUrl!==appUrl)return false;
  return permission==='clipboard-sanitized-write'||permission==='clipboard-write';
}

/** Web destinations supported by the system-browser action. */
export function externalWebUrl(value:unknown):string|undefined{
  if(typeof value!=='string')return undefined;
  try{
    const url=new URL(value);
    return url.protocol==='http:'||url.protocol==='https:'?url.href:undefined;
  }catch{return undefined;}
}

export interface BrowserSidebarState{
  shown:boolean;url:string;title:string;loading:boolean;canGoBack:boolean;canGoForward:boolean;error?:string;
}
export interface BrowserViewport{x:number;y:number;width:number;height:number;visible:boolean}
export type ExternalBrowser='default'|'edge'|'chrome'|'other';

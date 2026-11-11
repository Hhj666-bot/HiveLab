import type {BrowserWindow} from 'electron';

/** App-only compositor samples. No desktop capture, files or network traffic.
 * Resizing before IPC keeps the work and transfer size bounded. */
export function createContrastFrameReader(getWindow:()=>BrowserWindow|undefined){
 let pending=false,last=0;
 return async()=>{
  const win=getWindow();if(pending||Date.now()-last<600||!win||win.isDestroyed()||!win.isVisible()||win.isMinimized()||win.webContents.isDestroyed())return null;
  pending=true;last=Date.now();
  try{
   const image=await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:false});
   if(win.isDestroyed()||image.isEmpty())return null;
   const size=image.getSize(),frame=image.resize({width:Math.min(640,size.width),quality:'good'});
   return {dataUrl:frame.toDataURL()};
  }finally{pending=false;}
 };
}

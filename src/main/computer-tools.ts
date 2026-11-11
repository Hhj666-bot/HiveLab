import {desktopCapturer,screen} from 'electron';
import {execFile,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
type Capture={id:string;runId:string;at:number;width:number;height:number;physicalWidth:number;physicalHeight:number;displayId:number;scale:number};
/** Primary display only: image coordinates are mapped explicitly to physical Windows pixels. */
export class ComputerTools{
  private capture?:Capture;private busy=false;
  private input?:{runId:string;child:ChildProcess};
  constructor(private dist:string,private active:(id:string)=>boolean){}
  reconcile(){if(this.capture&&!this.active(this.capture.runId))this.capture=undefined;const input=this.input;if(input&&!this.active(input.runId)){this.input=undefined;input.child.once('exit',()=>{const reset=execFile(path.join(this.dist,'windows-computer.exe'),[],{windowsHide:true,timeout:3000},()=>{});reset.stdin?.on('error',()=>{});reset.stdin?.end(JSON.stringify({action:'reset'}));});input.child.kill();}}
  async call(runId:string,args:any){if(process.platform!=='win32')throw Error('此平台的屏幕与输入控制尚未接入；当前电脑工具只支持 Windows');if(this.busy)throw Error('电脑正在执行另一项操作，请稍后重试');if(!this.active(runId))throw Error('本轮已结束，电脑操作未执行');this.busy=true;
    try{const display=screen.getPrimaryDisplay();if(args.action==='screenshot'){const physicalWidth=Math.round(display.size.width*display.scaleFactor),physicalHeight=Math.round(display.size.height*display.scaleFactor),ratio=Math.min(1,1920/physicalWidth);const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(physicalWidth*ratio),height:Math.round(physicalHeight*ratio)}});if(!this.active(runId))throw Error('本轮已结束');const source=sources.find(s=>s.display_id===String(display.id));if(!source||source.thumbnail.isEmpty())throw Error('未获得主屏幕截图');const size=source.thumbnail.getSize(),capture=this.capture={id:randomUUID(),runId,at:Date.now(),...size,physicalWidth,physicalHeight,displayId:display.id,scale:display.scaleFactor};return {image:source.thumbnail.toPNG().toString('base64'),captureId:capture.id,width:size.width,height:size.height,display:'primary',coordinates:'截图像素，左上角为 (0,0)',expiresInSeconds:30};}
      const capture=this.capture;if(!capture||capture.runId!==runId||capture.id!==args.captureId||Date.now()-capture.at>30000)throw Error('请先获取新的截图，再根据截图操作');if(capture.displayId!==display.id||capture.scale!==display.scaleFactor||capture.physicalWidth!==Math.round(display.size.width*display.scaleFactor)||capture.physicalHeight!==Math.round(display.size.height*display.scaleFactor))throw Error('屏幕配置已改变，请重新截图');
      const command:any={action:args.action};const coordinate=(name:string,size:number,physical:number)=>{const value=args[name];if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>=size)throw Error('坐标须位于最近截图内');return Math.round(value/size*physical);};
      if(['click','move','drag'].includes(args.action)){command.x=coordinate('x',capture.width,capture.physicalWidth);command.y=coordinate('y',capture.height,capture.physicalHeight);if(args.action==='click'){command.button=args.button??'left';command.count=args.count??1;if(!['left','right','middle'].includes(command.button)||![1,2].includes(command.count))throw Error('无效的鼠标操作');}if(args.action==='drag'){command.toX=coordinate('toX',capture.width,capture.physicalWidth);command.toY=coordinate('toY',capture.height,capture.physicalHeight);}}
      else if(args.action==='type'){if(typeof args.text!=='string'||args.text.length>8192)throw Error('一次输入最多 8192 字符');command.text=args.text;}
      else if(args.action==='key'){if(typeof args.keys!=='string'||args.keys.length>100||args.keys.split('+').length>5)throw Error('快捷键无效');command.keys=args.keys;}
      else if(args.action==='scroll'){if(!Number.isInteger(args.amount)||Math.abs(args.amount)>20)throw Error('滚动量为 -20 到 20 的整数，正数向上');command.amount=args.amount;}
      else throw Error('未知电脑操作');
      if(!this.active(runId))throw Error('本轮已停止');await new Promise<void>((resolve,reject)=>{const child=execFile(path.join(this.dist,'windows-computer.exe'),[],{windowsHide:true,timeout:10000,maxBuffer:65536,encoding:'utf8'},(error,_out,stderr)=>{if(this.input?.child===child)this.input=undefined;error?reject(Error(stderr||error.message)):resolve();});this.input={runId,child};child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify(command));});this.capture=undefined;return {ok:true,next:'屏幕可能已改变，下一次操作前请重新截图'};
    }finally{this.busy=false;}
  }
}

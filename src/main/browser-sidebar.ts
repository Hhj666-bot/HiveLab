import {WebContentsView,Menu,clipboard,dialog,shell,type BrowserWindow} from 'electron';
import {browserExecutable,launchBrowser} from './external-browsers';
import {externalWebUrl,type BrowserSidebarState,type BrowserViewport,type ExternalBrowser} from '../shared/web-links';

/** One isolated webpage view, positioned inside the renderer's right sidebar. */
export class BrowserSidebar{
  private view?:WebContentsView;
  private requestedUrl?:string;
  private state:BrowserSidebarState={shown:false,url:'',title:'网页浏览器',loading:false,canGoBack:false,canGoForward:false};
  private viewport:BrowserViewport={x:0,y:0,width:0,height:0,visible:false};
  constructor(private owner:()=>BrowserWindow|undefined,private changed:(state:BrowserSidebarState)=>void){}
  snapshot(){return {...this.state};}
  private publish(){
    const contents=this.view?.webContents;
    if(contents&&!contents.isDestroyed()){
      this.state={...this.state,url:this.requestedUrl||contents.getURL()||this.state.url,title:contents.getTitle()||'网页浏览器',loading:contents.isLoading(),canGoBack:contents.navigationHistory.canGoBack(),canGoForward:contents.navigationHistory.canGoForward()};
    }
    this.changed(this.snapshot());
  }
  private ensureView(){
    if(this.view)return this.view;
    const window=this.owner();if(!window)throw Error('工作台窗口尚未就绪。');
    const view=new WebContentsView({webPreferences:{partition:'persist:hivelab-web',sandbox:true,contextIsolation:true,nodeIntegration:false}});
    this.view=view;view.setVisible(false);view.setBackgroundColor('#ffffff');window.contentView.addChildView(view);
    const contents=view.webContents;
    contents.session.setPermissionCheckHandler(()=>false);
    contents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    contents.on('will-navigate',(event,url)=>{if(!externalWebUrl(url))event.preventDefault();});
    contents.on('will-redirect',(event,url)=>{if(!externalWebUrl(url))event.preventDefault();});
    contents.setWindowOpenHandler(({url})=>{if(externalWebUrl(url))this.open(url);return {action:'deny'};});
    const refresh=()=>this.publish();
    contents.on('did-start-loading',refresh);contents.on('did-stop-loading',refresh);contents.on('did-navigate',()=>{this.requestedUrl=undefined;this.publish();});contents.on('did-navigate-in-page',refresh);contents.on('page-title-updated',refresh);
    contents.on('did-fail-load',(_event,code,description,_url,main)=>{if(main&&code!==-3){this.state.error='网页加载失败：'+description;this.publish();}});
    contents.on('context-menu',(_event,params)=>this.menu(externalWebUrl(params.linkURL)||externalWebUrl(contents.getURL())||this.state.url,params.selectionText));
    return view;
  }
  open(value:unknown){
    const url=externalWebUrl(value);if(!url)throw Error('请输入有效的 http 或 https 网页地址。');
    const view=this.ensureView(),same=view.webContents.getURL()===url&&!this.state.error;
    this.requestedUrl=same?undefined:url;
    this.state={...this.state,shown:true,url,error:undefined};
    this.publish();this.place(this.viewport);
    // did-fail-load reports navigation failures in the sidebar.
    if(!same)void view.webContents.loadURL(url).catch(()=>{});
    return this.snapshot();
  }
  place(bounds:BrowserViewport){
    this.viewport=bounds;
    const window=this.owner(),view=this.view;if(!window||!view)return {placed:false};
    const zoom=window.webContents.getZoomFactor();
    view.setBounds({x:Math.round(bounds.x*zoom),y:Math.round(bounds.y*zoom),width:Math.max(0,Math.round(bounds.width*zoom)),height:Math.max(0,Math.round(bounds.height*zoom))});
    view.setVisible(this.state.shown&&bounds.visible&&bounds.width>0&&bounds.height>0);
    return {placed:true};
  }
  hide(){this.state.shown=false;this.view?.setVisible(false);this.publish();return this.snapshot();}
  navigate(action:'back'|'forward'|'reload'|'stop'){
    const contents=this.view?.webContents;if(!contents)return this.snapshot();
    this.state.error=undefined;
    if(action==='back'&&contents.navigationHistory.canGoBack()){this.requestedUrl=undefined;contents.navigationHistory.goBack();}
    else if(action==='forward'&&contents.navigationHistory.canGoForward()){this.requestedUrl=undefined;contents.navigationHistory.goForward();}
    else if(action==='reload'){if(this.requestedUrl)void contents.loadURL(this.requestedUrl).catch(()=>{});else contents.reload();}
    else if(action==='stop')contents.stop();
    this.publish();return this.snapshot();
  }
  async external(value:unknown,browser:ExternalBrowser='default'){
    const url=externalWebUrl(value);if(!url)throw Error('只能打开有效的 http 或 https 网页链接。');
    if(browser==='default'){await shell.openExternal(url);return {opened:true};}
    if(browser==='other'){
      const picked=await dialog.showOpenDialog(this.owner()!,{title:'选择用于打开网页的浏览器',properties:['openFile'],filters:process.platform==='win32'?[{name:'浏览器程序',extensions:['exe']}]:undefined});
      if(picked.canceled||!picked.filePaths[0])return {opened:false};
      await launchBrowser(picked.filePaths[0],url);return {opened:true};
    }
    if(browser!=='edge'&&browser!=='chrome')throw Error('未知的浏览器选项。');
    const executable=browserExecutable(browser);if(!executable)throw Error(`未找到 ${browser==='edge'?'Microsoft Edge':'Google Chrome'}，可以选择其他浏览器。`);
    await launchBrowser(executable,url);return {opened:true};
  }
  menu(value:unknown,selection=''){
    const url=externalWebUrl(value);if(!url)throw Error('网页链接无效。');
    const run=(action:()=>unknown)=>{void Promise.resolve().then(action).catch(error=>dialog.showErrorBox('无法打开链接',error.message));};
    const items:Electron.MenuItemConstructorOptions[]=[
      {label:'在程序侧栏中打开',click:()=>run(()=>this.open(url))},
      {label:'使用 Microsoft Edge 打开',enabled:!!browserExecutable('edge'),click:()=>run(()=>this.external(url,'edge'))},
      {label:'使用 Google Chrome 打开',enabled:!!browserExecutable('chrome'),click:()=>run(()=>this.external(url,'chrome'))},
      {label:'使用系统默认浏览器打开',click:()=>run(()=>this.external(url,'default'))},
      {label:'选择其他浏览器…',click:()=>run(()=>this.external(url,'other'))},
      {type:'separator'},
      {label:'复制链接',click:()=>clipboard.writeText(url)},
      ...(selection?[{label:'复制选中文字',click:()=>clipboard.writeText(selection)}]:[]),
    ];
    Menu.buildFromTemplate(items).popup({window:this.owner()});return {shown:true};
  }
  dispose(){const view=this.view;if(!view)return;this.view=undefined;this.owner()?.contentView.removeChildView(view);view.webContents.close({waitForBeforeUnload:false});}
}

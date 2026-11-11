import {createRoot} from 'react-dom/client';
import {Markdown} from '../../src/renderer/Markdown';
import {BrowserSidebar} from '../../src/renderer/browser-sidebar';
import type {BrowserSidebarState} from '../../src/shared/web-links';
import type {PushEvent} from '../../src/shared/types';
import '../../src/renderer/styles.css';
const calls:unknown[]=[];(window as any).markdownLinkCalls=calls;
const listeners=new Set<(event:PushEvent)=>void>();
let browser:BrowserSidebarState={shown:false,url:'',title:'网页浏览器',loading:false,canGoBack:false,canGoForward:false};
const emitBrowser=()=>{for(const listener of listeners)listener({type:'browser-state',state:{...browser}});};
(window as any).hivelab={invoke:async(method:string,params:unknown)=>{
  calls.push({method,params});
  if(method==='browser.open'&&(window as any).failNextLink){(window as any).failNextLink=false;throw Error('网页暂时不可用');}
  if(method==='browser.open'){browser={...browser,shown:true,url:(params as {url:string}).url,title:'测试网页'};emitBrowser();return browser;}
  if(method==='browser.state')return browser;
  if(method==='browser.hide'){browser={...browser,shown:false};emitBrowser();return browser;}
  if(method==='file.preview')return {name:'README.md',kind:'markdown',content:'# 本地文件预览\n\n仍在应用内阅读。'};
  return {opened:true};
},onEvent:(listener:(event:PushEvent)=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);}};
const text=`The prompt contains sensitive words that violate Google's [Generative AI Prohibited Use policy](https://policies.google.com/terms/generative-ai/use-policy). If you think this was an error, [send feedback](http://example.com/feedback?q=gemini#form).

[工作文件](./README.md) · [脚本链接](javascript:alert(1)) · [程序文件](file:///C:/Windows/notepad.exe) · [数据链接](data:text/html,hello)

<script>window.markdownExecuted=true</script>`;
createRoot(document.getElementById('root')!).render(<main style={{height:'100%',display:'flex',minWidth:0}}><div style={{flex:1,minWidth:0,padding:24}}><Markdown text={text} sessionId="link-test-session"/></div><BrowserSidebar/></main>);

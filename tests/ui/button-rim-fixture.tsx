import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {X} from 'lucide-react';
import {TopicPanel} from '../../src/renderer/topics';
import {LiquidGlassAppearance} from '../../src/renderer/liquid-glass';
import {useAppearancePreferences} from '../../src/renderer/appearance-preferences';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS} from '../../src/shared/defaults';
import type {Snapshot} from '../../src/shared/types';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';
import '../../src/renderer/sidebar-layout.css';

const at='2026-10-29T00:00:00Z';
const snapshot={settings:DEFAULT_SETTINGS,profile:DEFAULT_PROFILE,members:[],projects:[],sessions:[],runs:[],events:[],approvals:[],providers:[],backendReady:true,room:{state:{active:false,mode:'chat'},currentThreadId:'one',messages:[],threads:[{id:'one',title:'1',createdAt:at,count:2}]}} as unknown as Snapshot;
const calls:unknown[]=[];(window as any).buttonRimCalls=calls;
const invoke:any=async(method:string,params:unknown)=>{calls.push({method,params});return {};};
(window as any).hivelab={invoke,onEvent:()=>()=>{}};
function Fixture(){
  const [open,setOpen]=useState(true),appearance=useAppearancePreferences();
  (window as any).setFixtureGlass=appearance.setLiquidGlass;
  return <><LiquidGlassAppearance/><main style={{height:'100%',overflow:'auto',padding:24,background:'linear-gradient(120deg,#263e7d,#914065)'}}>
    <section className="rim-examples" style={{display:'flex',gap:16,flexWrap:'wrap',color:'#fff'}}>
      <button className="button primary">主动作</button><button className="button secondary">次动作</button><button className="button quiet">普通动作</button><button className="button danger">危险动作</button>
      <button className="icon-button" aria-label="示例图标"><X size={16}/></button><button className="link-button">文字动作</button><button>原生按钮</button>
      <span role="button" tabIndex={0}>角色按钮</span><a className="button" href="#sample">链接按钮</a><input type="button" value="输入按钮"/>
      <details><summary>折叠按钮</summary>内容</details><button className="button quiet" disabled>暂不可用</button>
      <button className="glass-action" aria-label="独立玻璃操作"><X size={16}/></button>
      <button className="button quiet" onClick={()=>setOpen(true)}>打开话题管理</button>
    </section>
    {open&&<TopicPanel snapshot={snapshot} selectedId="one" usable={[]} invoke={invoke} busy={false} personal onSelect={()=>{}} onContinue={()=>{}} onExport={()=>{}} onClear={()=>{}} onClose={()=>setOpen(false)}/>}
  </main></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

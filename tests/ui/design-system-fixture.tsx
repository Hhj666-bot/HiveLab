import {useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {AppStoreProvider,useAppStore,useAppActions} from '../../src/renderer/app/store-context';
import {LiquidGlassAppearance} from '../../src/renderer/liquid-glass';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';

const metrics={navigation:0,snapshot:0};
(window as any).stateMetrics=metrics;
function NavigationProbe(){metrics.navigation++;const view=useAppStore(state=>state.view);return <output data-testid="view">{view}</output>;}
function SnapshotProbe(){metrics.snapshot++;const count=useAppStore(state=>state.snapshot.events.length);return <output data-testid="event-count">{count}</output>;}
function Controls(){
  const actions=useAppActions();
  useEffect(()=>{(window as any).stateActions=actions;},[actions]);
  return <main style={{height:'100%',overflow:'auto',padding:'var(--space-4)'}}>
    <h1 className="text-display">HiveLab 合屋</h1>
    <p>设计令牌与集中状态验证</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:'var(--space-2)'}}>
      <button className="button primary">创建项目</button>
      <button className="button secondary">查看文件</button>
      <button className="button quiet">取消</button>
    </div>
    <label className="field" style={{marginBlock:'var(--space-4)'}}>项目名称<input aria-label="项目名称" defaultValue="界面优化"/><small>保存在本机工作台</small></label>
    <div className="room-bubble" style={{marginBlock:'var(--space-4)'}}>回复正文随窗口宽度流动，在宽屏采用 17px。统一圆角和间距，保留液态玻璃的材质控制。</div>
    <div style={{display:'flex',gap:'var(--space-3)'}}><NavigationProbe/><SnapshotProbe/></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<AppStoreProvider><LiquidGlassAppearance/><Controls/></AppStoreProvider>);

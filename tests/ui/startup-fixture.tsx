import React from 'react';
import {createRoot} from 'react-dom/client';
import {StartupSettings} from '../../src/renderer/startup-settings';
import '../../src/renderer/styles.css';
createRoot(document.getElementById('root')!).render(<main ref={node=>{node?.querySelectorAll('details').forEach(row=>{row.open=true;});}} style={{maxWidth:700,margin:'40px auto',padding:24}}><h1>已加载的 HiveLab 工作室</h1><StartupSettings/></main>);

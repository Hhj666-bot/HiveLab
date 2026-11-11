import {t,useLanguage} from './i18n';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary, reportRenderError } from './ErrorBoundary';
import {FilePreviewProvider} from './preview-context';
import {SubagentPanelProvider} from './subagent-panel';
import {LiquidGlassAppearance} from './liquid-glass';
import {AdaptiveTextAppearance,warmAdaptiveTextCache} from './adaptive-text';
import {warmHomeBackground} from './home-background';
import './styles.css';
import './team.css';
import './project-room.css';

// Retire the saved preference for the removed header collapse control.
try{localStorage.removeItem('hivelab.room-header.collapsed');}catch{}

// Errors outside rendering (event handlers, timers, promises) never reach a boundary; record them too.
window.addEventListener('error', event => reportRenderError(t("窗口脚本"), event.error ?? event.message));
window.addEventListener('unhandledrejection', event => reportRenderError(t("后台请求"), event.reason));

// The tree is created here, so a language switch re-renders every page with the new words
// while keeping open dialogs, drafts and scroll positions.
function Root(){useLanguage();return <ErrorBoundary area={t("HiveLab 合屋 界面")} fullPage><LiquidGlassAppearance/><AdaptiveTextAppearance/><FilePreviewProvider><SubagentPanelProvider><App /></SubagentPanelProvider></FilePreviewProvider></ErrorBoundary>;}

void Promise.all([warmAdaptiveTextCache(),warmHomeBackground()]).finally(()=>createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>));

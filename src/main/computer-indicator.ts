import { BrowserWindow, ipcMain, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { ComputerActivityTracker } from '../shared/computer-activity';
import type { Snapshot, TimelineEvent } from '../shared/types';

/** A separate non-focusing window stays visible even while HiveLab is minimized. */
export class ComputerIndicator {
  private tracker = new ComputerActivityTracker();
  private window?: BrowserWindow;
  private snapshot?: Snapshot;
  private hiding?: NodeJS.Timeout;
  private signature = '';
  private loaded = false;
  private disposed = false;
  constructor(private stop: (runId: string) => Promise<unknown>, private showWorkbench: () => void, private onError: (error: unknown) => void) {
    ipcMain.on('hivelab:computer-stop', event => {
      if (event.sender !== this.window?.webContents) return;
      const { runIds } = this.tracker.current();
      this.showWorkbench();
      void Promise.allSettled(runIds.map(id => this.stop(id))).then(results => {
        for (const result of results) if (result.status === 'rejected') this.onError(result.reason);
      });
    });
  }
  event(event: TimelineEvent) { this.tracker.event(event); this.render(); }
  update(snapshot: Snapshot) { this.snapshot = snapshot; this.tracker.reconcile(snapshot.runs); this.render(); }
  clear() { this.tracker.clear(); this.render(true); }
  async ensureVisible(){const deadline=Date.now()+2500;while(Date.now()<deadline){if(this.disposed||!this.tracker.current().active)throw Error('电脑操作已停止');if(this.loaded&&this.window?.isVisible())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('电脑操作提示条未就绪，请重试');}
  destroy() { this.disposed=true;this.tracker.clear();if(this.hiding)clearTimeout(this.hiding); this.window?.destroy(); this.window = undefined; }
  private render(immediate = false) {
    if(this.disposed)return;
    const activity = this.tracker.current();
    if (!activity.active) {
      if (this.hiding) clearTimeout(this.hiding);
      if (immediate) this.window?.hide();
      else this.hiding = setTimeout(() => { if (!this.tracker.current().active) this.window?.hide(); }, 650);
      return;
    }
    if (this.hiding) {clearTimeout(this.hiding);this.hiding=undefined;}
    if (!this.window || this.window.isDestroyed()) {
      this.loaded=false;
      this.window = new BrowserWindow({ width: 480, height: 48, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, closable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: '#172a28', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: fileURLToPath(new URL('./computer-indicator-preload.cjs', import.meta.url)) } });
      this.window.setAlwaysOnTop(true, 'screen-saver');
      this.window.setMenuBarVisibility(false);
      this.window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
      this.window.webContents.on('will-navigate', event => event.preventDefault());
      this.window.on('closed', () => {this.window=undefined;this.signature='';this.loaded=false;});
      const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>*{box-sizing:border-box}body{margin:0;height:48px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#172a28;color:#f2fff9;font:13px 'Segoe UI','Microsoft YaHei',sans-serif;border:1px solid #5d9b88;border-radius:8px}i{width:8px;height:8px;background:#74e5af;border-radius:50%;flex:none}span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}button{background:#f5e0d5;color:#472019;border:0;border-radius:5px;padding:6px 10px;font:inherit;cursor:pointer}</style><i></i><span id="label" role="status">HiveLab 合屋 · 正在执行操作</span><button id="stop" type="button" aria-label="停止正在执行操作的成员">停止操作</button></html>`;
      const own = this.window;
      own.webContents.once('did-finish-load',()=>{if(this.window===own){this.loaded=true;this.signature='';this.render();}});
      void own.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(this.onError);
      return;
    }
    if (!this.loaded) return;
    const names = activity.runIds.map(id => {
      const run = this.snapshot?.runs.find(run => run.id === id), session = this.snapshot?.sessions.find(session => session.id === run?.sessionId);
      return this.snapshot?.members.find(member => member.id === (session?.memberId ?? session?.provider))?.name ?? run?.provider ?? '成员';
    });
    const label = `HiveLab 合屋 · ${[...new Set(names)].join('、')} ${activity.computer ? '正在操作电脑' : '正在执行工具操作'}`;
    if (label !== this.signature) { this.signature=label; void this.window.webContents.executeJavaScript(`document.getElementById('label').textContent=${JSON.stringify(label)}`).catch(this.onError); }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    this.window.setBounds({x:area.x+Math.floor((area.width-480)/2),y:area.y+8,width:480,height:48});
    this.window.showInactive();
  }
}

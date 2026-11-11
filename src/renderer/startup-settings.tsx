import {t} from './i18n';
import {useState} from 'react';
import {Play} from 'lucide-react';
import {SettingsFold} from './settings-fold';
import {parseStartupMedia,readStartupPreferences,saveStartupPreferences,startupMediaUrl,type StartupPreferences,type StartupMedia} from '../shared/startup-animation';

async function checkMedia(media:StartupMedia,kind:'video'|'image'){
  if(kind==='image'){const image=new Image();image.src=startupMediaUrl(media);await image.decode();if(!image.naturalWidth)throw Error(t("截图无法读取。"));return;}
  const video=document.createElement('video');video.preload='metadata';video.muted=true;
  try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(t("读取视频超时，请选择本机可播放的 MP4 或 WebM。"))),15000);video.onloadedmetadata=()=>{clearTimeout(timer);Number.isFinite(video.duration)&&video.duration>.1&&video.videoWidth>0?resolve():reject(Error(t("视频需要有可读取的画面和时长。")));};video.onerror=()=>{clearTimeout(timer);reject(Error(t("这个视频无法解码，建议使用 H.264 MP4 或 WebM。")));};video.src=startupMediaUrl(media);});}
  finally{video.pause();video.removeAttribute('src');video.load();}
}

export function StartupSettings(){
  const [preferences,setPreferences]=useState(readStartupPreferences),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  function save(patch:Partial<StartupPreferences>){
    try{setPreferences(saveStartupPreferences({...preferences,...patch}));setError('');}
    catch{setError(t("启动动画设置未能保存，请重试。"));}
  }
  async function upload(kind:'video'|'image'){
    setBusy(true);setError('');
    try{
      const result=await window.hivelab.invoke('startup.import',{kind});if(!result)return;
      const media=parseStartupMedia(result,kind);if(!media)throw Error(t("导入的素材无效。"));
      await checkMedia(media,kind);
      const next=saveStartupPreferences({...readStartupPreferences(),...(kind==='video'?{customVideo:media,enabled:true}:{homeScreenshot:media})});setPreferences(next);
    }catch(error){setError(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);}
  }
  const film=!!preferences.customVideo;
  return <SettingsFold label={t("启动动画设置")} title={t("启动动画")} hint={t("动画样式、自定义视频和音量")}>
    <button type="button" className="button quiet small" onClick={()=>window.hivelabStartup?.preview()} disabled={!window.hivelabStartup}><Play size={13}/>{t("预览启动动画")}</button>
    <div className="field"><span>{t("内置动画：隧道展开")}</span><small>{preferences.customVideo?t("正在使用自定义视频，已代替内置的隧道展开。"):t("HiveLab 标志是一个开关，按下后变成一扇小窗，沿隧道缓缓展开到当前首页背景，界面再从页面外侧滑入。更换首页背景后自动更新，无需上传。")}</small></div>
    <div className="field"><span>{t("自定义视频：{0}", preferences.customVideo?.name??t("未使用"))}</span><div className="settings-actions"><button type="button" className="button quiet small" disabled={busy||!window.hivelab} onClick={()=>void upload('video')}>{busy?t("正在导入…"):t("上传本地视频")}</button>{preferences.customVideo&&<button type="button" className="button quiet small" disabled={busy} onClick={()=>save({customVideo:undefined,homeScreenshot:undefined})}>{t("恢复默认动画")}</button>}</div><small>{t("上传后代替上面的默认动画。视频保存在本机，支持 MP4、WebM、MOV、M4V，最大 512 MB，导入后可立即预览。")}</small></div>
    {preferences.customVideo&&<div className="field"><span>{t("主页交接截图：{0}", preferences.homeScreenshot?.name??t("未设置"))}</span><div className="settings-actions"><button type="button" className="button quiet small" disabled={busy||!window.hivelab} onClick={()=>void upload('image')}>{t("上传主页截图")}</button>{preferences.homeScreenshot&&<button type="button" className="button quiet small" disabled={busy} onClick={()=>save({homeScreenshot:undefined})}>{t("移除主页截图")}</button>}</div><small>{t("可选：上传当前主页的完整截图，让视频结束后按“视频末帧 → 主页截图 → 真实主页”衔接。图片支持 PNG、JPG、WebP，最大 32 MB；截图比例与窗口一致时效果最好。")}</small></div>}
    <label className="toggle-row"><span><strong>{t("启动时播放动画")}</strong><small>{t("工作室加载完成后进入，可按 Esc 跳过。关闭后显示简洁的加载画面，之后仍先显示完整壁纸，界面再从页面外侧滑入。")}</small></span><input type="checkbox" aria-label={t("启动时播放动画")} checked={preferences.enabled} onChange={e=>save({enabled:e.target.checked})}/></label>
    {film&&<label className="field">{t("播放方式")}<select aria-label={t("启动动画播放方式")} value={preferences.playback} disabled={!preferences.enabled} onChange={e=>save({playback:e.target.value as StartupPreferences['playback']})}><option value="full">{t("完整播放后进入")}</option><option value="ready">{t("加载完成后立即进入")}</option></select><small>{t("设置从下次启动或预览生效。")}</small></label>}
    <label className="toggle-row"><span><strong>{t("跟随系统减少动态效果")}</strong><small>{t("开启后，系统关闭动画效果时改用简洁的加载画面，界面也不再滑入；手动预览仍会播放动画。")}</small></span><input type="checkbox" aria-label={t("跟随系统减少动态效果")} checked={preferences.respectReducedMotion} disabled={!preferences.enabled} onChange={e=>save({respectReducedMotion:e.target.checked})}/></label>
    {film&&<label className="toggle-row"><span><strong>{t("播放动画声音")}</strong><small>{t("默认静音，预览使用当前音量。")}</small></span><input type="checkbox" aria-label={t("播放动画声音")} checked={preferences.sound} disabled={!preferences.enabled} onChange={e=>save({sound:e.target.checked})}/></label>}
    {film&&<label className="field glass-setting"><span>{t("动画音量")}<output>{preferences.volume}%</output></span><input type="range" aria-label={t("启动动画音量")} min="0" max="100" step="1" value={preferences.volume} disabled={!preferences.enabled||!preferences.sound} onChange={e=>save({volume:Number(e.target.value)})}/></label>}
    {error&&<p role="alert" className="task-meta bad">{error}</p>}
  </SettingsFold>;
}

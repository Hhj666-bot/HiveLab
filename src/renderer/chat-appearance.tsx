import {t} from './i18n';
import {useState,useSyncExternalStore,type CSSProperties} from 'react';
import {Palette,RotateCcw} from 'lucide-react';
import {Modal} from './modals';
import {CHAT_SURFACES,chatAppearanceFor,defaultChatAppearance,parseChatAppearance,setChatApplyAll,updateChatSurface,chatColorMode,chatColorInk,type ChatSurfaceSlot as Slot,type ChatSurface as Surface,type ChatAppearanceData} from '../shared/chat-appearance';
import {useTeam} from './members';
import {CHAT_COLOR_PRESETS,chatColorPreset} from '../shared/appearance-colors';
import {useDarkAppearance} from './media-preferences';
import './chat-appearance.css';

const KEY='hivelab.chat-appearance';
const slots=CHAT_SURFACES;
const labels:Record<Slot,string>={get reply(){return t("回复气泡与思考栏")},get mine(){return t("我的消息")},get input(){return t("输入框")}};
function read():ChatAppearanceData{try{return parseChatAppearance(JSON.parse(localStorage.getItem(KEY)??'null'));}catch{return parseChatAppearance(null);}}
let shared:{data:ChatAppearanceData;error:string}|undefined;
const listeners=new Set<()=>void>(),subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const snapshot=()=>shared??(shared={data:read(),error:''});
function save(data:ChatAppearanceData){shared={data,error:''};try{localStorage.setItem(KEY,JSON.stringify({...data.defaults,pages:data.pages}));}catch{shared={data,error:t("当前外观已预览，但本机设置保存失败。")};}listeners.forEach(listener=>listener());return !shared.error;}
export function useChatAppearance(page?:string){
  const {data,error}=useSyncExternalStore(subscribe,snapshot),scope=page&&page!=='home'?page:undefined,preferences=chatAppearanceFor(data,scope);
  const team=useTeam(),memberId=scope?.startsWith('desk:')?scope.slice(5):scope?.startsWith('report:')?scope.split(':').slice(2).join(':'):undefined,memberColor=team.get(memberId)?.color??team.members[0]?.color??'#8a6a52';
  const style:Record<string,string>={};
  for(const slot of slots){const p=preferences[slot],mode=chatColorMode(p),preset=chatColorPreset(p.color);style[`--chat-${slot}-opacity`]=`${100-p.transparency}%`;style[`--chat-${slot}-ink`]='var(--chat-neutral-ink)';if(mode==='custom')style[`--chat-${slot}-color`]=p.color;else if(preset)style[`--chat-${slot}-color`]=`light-dark(${preset.light},${preset.dark})`;else if(slot==='reply'&&mode==='theme')style['--chat-reply-color']='var(--surface)';}
  return {preferences,error,memberColor,style:style as CSSProperties,canScope:!!scope,appliesToAll:(slot:Slot)=>!scope||!data.pages[scope]?.[slot],setApplyAll:(slot:Slot,all:boolean)=>{if(scope)save(setChatApplyAll(snapshot().data,scope,slot,all));},update:(slot:Slot,patch:Partial<Surface>)=>save(updateChatSurface(snapshot().data,scope,slot,patch)),reset:()=>{let next=snapshot().data;for(const slot of slots)next=updateChatSurface(next,scope,slot,defaultChatAppearance()[slot]);save(next);}};
}
export function ChatAppearanceSettings({appearance}:{appearance:ReturnType<typeof useChatAppearance>}){
 const dark=useDarkAppearance();
 return <><p className="settings-description">{t("每组均可选择应用范围：勾选时同步全体聊天页面，取消勾选后仅调整当前页。透明度 0% 为不透明，100% 为完全透明；文字和按钮保持清晰。")}</p>
  {slots.map(slot=>{const p=appearance.preferences[slot],preset=chatColorPreset(p.color);return <fieldset className="chat-appearance-field" key={slot}><legend>{labels[slot]}</legend><div className="chat-appearance-controls">
   <label className="field">{t("自定义底色")}<input type="color" aria-label={t("{0}背景颜色", labels[slot])} value={chatColorMode(p)==='custom'?p.color:preset?preset[dark?'dark':'light']:chatColorMode(p)==='member'?appearance.memberColor:dark?'#241f1b':'#fffdf9'} onChange={e=>appearance.update(slot,{color:e.target.value})}/></label>
   <button type="button" className="button quiet small" aria-label={t("{0}使用特征色", labels[slot])} aria-pressed={chatColorMode(p)==='member'} onClick={()=>appearance.update(slot,{color:'member'})}>{t("使用特征色")}</button>
   <button type="button" className="button quiet small" aria-pressed={chatColorMode(p)==='theme'} onClick={()=>appearance.update(slot,{color:'theme'})}>{chatColorMode(p)==='theme'?t("已跟随主题"):t("跟随主题")}</button>
   <label className="field chat-transparency">{t("透明度 · ")}<output>{Math.round(p.transparency)}%</output><input type="range" aria-label={t("{0}透明度", labels[slot])} min="0" max="100" step="1" value={p.transparency} onChange={e=>appearance.update(slot,{transparency:Number(e.target.value)})}/></label>
  </div><div className="chat-color-presets" role="group" aria-label={t("{0}推荐配色", labels[slot])}>{CHAT_COLOR_PRESETS.map(color=><button type="button" key={color.id} aria-label={t("{0}使用{1}配色", labels[slot], color.name)} aria-pressed={p.color===color.id} onClick={()=>appearance.update(slot,{color:color.id})}><span className="chat-color-swatch" aria-hidden="true" style={{background:`light-dark(${color.light},${color.dark})`}}/><span>{color.name}</span></button>)}</div><div className="chat-appearance-apply"><label title={appearance.canScope?t("取消勾选后，仅修改当前聊天页"):t("单页外观请从对应聊天页面打开设置")}><input type="checkbox" aria-label={t("{0}应用到全体聊天页面", labels[slot])} checked={appearance.appliesToAll(slot)} disabled={!appearance.canScope} onChange={e=>appearance.setApplyAll(slot,e.target.checked)}/>{t("应用到全体聊天页面")}</label><small>{appearance.appliesToAll(slot)?t("自动同步全部聊天页"):t("仅当前聊天页")}</small></div></fieldset>;})}
  <div className="chat-appearance-preview" style={{...appearance.style,'--m':appearance.memberColor,'--m-contrast':chatColorInk(appearance.memberColor)} as CSSProperties} aria-label={t("聊天外观预览")}><div className="chat-preview-reply" data-member-color={chatColorMode(appearance.preferences.reply)==='member'}>{t("回复示例：这是一条消息。")}</div><div className="chat-preview-mine" data-member-color={chatColorMode(appearance.preferences.mine)==='member'}>{t("我的消息示例")}</div><div className="chat-preview-input" data-member-color={chatColorMode(appearance.preferences.input)==='member'}>{t("输入框示例 · 写下你的问题…")}</div></div>
  {appearance.error&&<p role="alert" className="task-meta bad">{appearance.error}</p>}
 </>;
}
export function ChatAppearanceButton({appearance}:{appearance:ReturnType<typeof useChatAppearance>}){
  const [open,setOpen]=useState(false);
  return <><button type="button" className="button quiet small" aria-label={t("设置聊天外观")} onClick={()=>setOpen(true)}><Palette size={14}/>{t("聊天外观")}</button>
    {open&&<Modal title={t("聊天外观")} subtitle={t("按勾选范围即时生效，并自动保存在这台电脑。")} onClose={()=>setOpen(false)} className="chat-appearance-modal"><div className="modal-body">
      <ChatAppearanceSettings appearance={appearance}/>
    </div><div className="modal-footer"><button type="button" className="button quiet" onClick={appearance.reset}><RotateCcw size={14}/>{t("恢复默认外观")}</button><button type="button" className="button primary" onClick={()=>setOpen(false)}>{t("完成")}</button></div></Modal>}
  </>;
}

import {t} from './i18n';
import {useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {castLayout} from '../shared/cast-layout';
import {createPortal} from 'react-dom';
import {WorkspaceToolbar,WorkspaceToolbarLeading} from './workspace-toolbar';
import {Image,IdCard,Users,Plus} from 'lucide-react';
import type {Project,Snapshot} from '../shared/types';
import {softenStandeeMatte} from '../shared/standee-matte';
import {MEMBER_HEIGHT} from '../shared/defaults';
import {MOOD_TEXT,type Mood,type Team,type TeamMember} from './members';
import {BackgroundSettings,useHomeBackground} from './home-background';
import {Modal} from './modals';
import {greeting,runnable,type Invoke} from './ui';
import {SetupChecklist} from './setup';
import type {SettingsTab} from './settings';
import './standee-home.css';
import {DEFAULT_CAST_DENSITY,useAppearancePreferences,requestAppearance} from './appearance-preferences';
import {useInsertionArrange} from './use-insertion-arrange';

const rendered=new Map<string,Promise<string>>();function displayArt(src:string){
  let pending=rendered.get(src);if(pending)return pending;
  pending=new Promise<string>(resolve=>{
    const image=new window.Image();image.crossOrigin='anonymous';image.onload=()=>{
      try{
        const scale=Math.min(1,1400/image.naturalHeight,1000/image.naturalWidth),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        const context=canvas.getContext('2d',{willReadFrequently:true});if(!context){resolve(src);return;}
        context.drawImage(image,0,0,canvas.width,canvas.height);const data=context.getImageData(0,0,canvas.width,canvas.height);softenStandeeMatte(data.data,canvas.width,canvas.height);context.putImageData(data,0,0);resolve(canvas.toDataURL('image/png'));
      }catch{resolve(src);}
    };image.onerror=()=>resolve(src);image.src=src;
  });
  // Only the visible team is cached; original files are never rewritten.
  if(rendered.size>=24)rendered.delete(rendered.keys().next().value!);rendered.set(src,pending);return pending;
}
/** Smaller members stand shorter: the card's height (cm) scales the artwork around a standard figure.
 *  Exaggerated a little so a 20cm gap reads as a gap, and bounded so the lineup never turns into giants or dots. */
function heightScale(height?:number){
  if(!height)return 1;
  const ratio=height/MEMBER_HEIGHT.reference;
  return Math.min(1.08,Math.max(0.72,1+(ratio-1)*1.5));
}
function StandeeArt({member,matte}:{member:TeamMember;matte:boolean}){
  const [ready,setReady]=useState<{source:string;url:string}>(),[failed,setFailed]=useState(false);
  useEffect(()=>{let cancelled=false;setFailed(false);if(member.art&&matte)void displayArt(member.art).then(url=>{if(!cancelled)setReady({source:member.art!,url});});return()=>{cancelled=true;};},[member.art,matte]);
  if(!member.art||failed)return <span className="standee-initial">{member.name.slice(0,1)}</span>;
  // One source only: swapping a shown image for its processed copy blanks it while the copy decodes.
  const src=matte?(ready?.source===member.art?ready.url:undefined):member.art;
  if(!src)return <span data-art-pending="" aria-hidden="true"/>;
  return <img className="standee-art" src={src} alt="" decoding="sync" draggable={false} onError={()=>setFailed(true)}/>;
}
const releaseCast=(strip:HTMLElement)=>{for(const node of strip.children as HTMLCollectionOf<HTMLElement>)for(const name of ['translate','scale','transform-origin'])node.style.removeProperty(name);};
export function StandeeHome({project,snapshot,team,moods,invoke,onSettingsTab,onProject,onCard,onDesk,onCollaboration}:{project?:Project;snapshot:Snapshot;team:Team;moods:Record<string,Mood>;invoke:Invoke;onSettingsTab:(tab:SettingsTab,focus?:string)=>void;onProject:()=>void;onCard:(id:string,anchor:Element)=>void;onDesk:(id:string)=>void;onCollaboration:()=>void}){
  const toolbar=useContext(WorkspaceToolbar),leading=useContext(WorkspaceToolbarLeading);
  const [backgroundOpen,setBackgroundOpen]=useState(false),bg=useHomeBackground(),strip=useRef<HTMLDivElement>(null);
  const {density,setDensity}=useAppearancePreferences();
  const [layout,setLayout]=useState({slot:148,height:480,gap:8,padding:40});
  const visible=team.members.filter(member=>!member.card.cardHidden),ready=team.members.filter(member=>runnable(snapshot.providers.find(p=>p.id===member.executor))).length;
  const [overflow,setOverflow]=useState(false);
  const lineup=useMemo(()=>[...visible].sort((a,b)=>(a.card.standeeOrder??Number.MAX_SAFE_INTEGER)-(b.card.standeeOrder??Number.MAX_SAFE_INTEGER)),[team.members]);
  const arrange=useInsertionArrange(lineup.map(member=>member.id),snapshot.backendReady,'x',strip,ids=>invoke('team.arrange',{ids}));
  const shown=arrange.ids.map(id=>lineup.find(member=>member.id===id)!).filter(Boolean);
  useEffect(()=>{const node=strip.current;if(!node)return;const sync=()=>setOverflow(node.scrollWidth>node.clientWidth+1),observer=new ResizeObserver(sync);observer.observe(node);for(const child of Array.from(node.children))observer.observe(child);sync();return()=>observer.disconnect();},[shown.map(m=>m.id).join('|')]);
  useEffect(()=>{const node=strip.current;if(!node)return;const sync=()=>{const {sidebarMoving,panelMoving}=document.documentElement.dataset;if(sidebarMoving!==undefined||panelMoving!==undefined)return;const next=castLayout(node.clientWidth,node.clientHeight,shown.length,density);setLayout(old=>{if(old.slot===next.slot&&old.height===next.height&&old.gap===next.gap&&old.padding===next.padding){releaseCast(node);return old;}return next;});};const observer=new ResizeObserver(sync);observer.observe(node);sync();window.addEventListener('hivelab:page-turned',sync);return()=>{observer.disconnect();window.removeEventListener('hivelab:page-turned',sync);};},[shown.length,density]);
  // The sidebar's spring carries the standees on the way to this size; the real size takes over here.
  useLayoutEffect(()=>{if(strip.current)releaseCast(strip.current);},[layout]);
  const welcome=<div className="home-toolbar-greeting"><span>{greeting()}</span>{project&&<span className="home-project">{project.name}</span>}</div>;
  const actions=<nav className="home-toolbar-actions" aria-label={t("首页操作")}>{!toolbar&&<button type="button" className="home-action button quiet small" onClick={()=>setBackgroundOpen(true)}><Image size={15}/><span>{t("背景")}</span></button>}<button type="button" className="home-action button quiet small" onClick={()=>onSettingsTab('members')} title={t("管理人物卡")}><IdCard size={15}/><span>{t("人物")}</span></button><button type="button" className="home-action button quiet small" disabled={!snapshot.backendReady||ready<2} onClick={onCollaboration} title={t("请大家进入会议室")}><Users size={15}/><span>{t("一起聊")}</span></button>{!project&&<button type="button" className="home-action button quiet small" onClick={onProject}><Plus size={15}/><span>{t("项目")}</span></button>}</nav>;
  return <main className="standee-home" aria-label={t("立绘首页")}>
    <header className={'standee-home-header'+(leading?' standee-header-in-toolbar':'')}>{leading?createPortal(welcome,leading):welcome}{leading?createPortal(actions,leading):actions}</header>
    {visible.length>0&&<>
      <div className="standee-cast" role="list" aria-label={t("团队立绘")} ref={strip} data-density={density} style={{'--cast-count':shown.length,'--cast-slot':layout.slot+'px','--cast-height':layout.height+'px','--cast-gap':layout.gap+'px','--cast-padding':layout.padding+'px'} as CSSProperties} onPointerMove={arrange.move} onPointerUp={arrange.up} onPointerCancel={arrange.cancel} onLostPointerCapture={arrange.cancel}>
        {shown.map(member=>{const mood=moods[member.id]??'away';const carried=arrange.moving===member.id;return <div className={`standee member-${member.id} mood-${mood}${carried?' moving':''}${arrange.target?.id===member.id?' drop-target':''}`} role="listitem" data-arrange-id={member.id} data-drop-edge={arrange.target?.id===member.id?arrange.target.edge:undefined} key={member.id} onPointerDown={event=>arrange.down(event,member.id)} style={{'--standee-scale':heightScale(member.card.height),...(carried?{'--drag-x':`${arrange.offset}px`}:{})} as CSSProperties}>
          <button type="button" className="standee-chat glass-content-action" aria-label={t("与 {0} 聊天", member.name)} title={t("{0} · 左键进入工位，右键查看人物资料{1}", member.name, member.motto?'\n'+t(member.motto):'')} disabled={!snapshot.backendReady} onClick={event=>{if(arrange.suppressClick()){event.preventDefault();event.stopPropagation();return;}onDesk(member.id);}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();arrange.cancel();onCard(member.id,event.currentTarget);}} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();arrange.cancel();onCard(member.id,event.currentTarget);}}}><StandeeArt member={member} matte={bg.preferences.matte}/><span className="standee-name"><i aria-hidden="true"/><strong>{member.name}</strong>{['working','waiting'].includes(mood)&&<small>{MOOD_TEXT[mood]}</small>}</span></button>
        </div>;})}
      </div>
      <div className="standee-home-footer"><label className="cast-density">{t("紧凑")}<input type="range" aria-label={t("人物疏密")} min="0.75" max="1.25" step="0.05" value={density} onChange={e=>setDensity(Number(e.target.value))}/>{t("宽松")}</label><button type="button" className="cast-auto" onClick={()=>setDensity(DEFAULT_CAST_DENSITY)}>{t("自动")}</button>{overflow&&<span className="cast-navigation"><button type="button" aria-label={t("查看前面的成员")} onClick={()=>strip.current?.scrollBy({left:-(strip.current.clientWidth*.75),behavior:'smooth'})}>←</button><small>{t("{0} 位伙伴 · 左右浏览", visible.length)}</small><button type="button" aria-label={t("查看后面的成员")} onClick={()=>strip.current?.scrollBy({left:strip.current.clientWidth*.75,behavior:'smooth'})}>→</button></span>}</div>
    </>}
    {team.members.length>0&&!visible.length&&<div className="standee-hidden-note"><span role="status">{t("所有人物已被隐藏，可在人物设置中重新显示。")}</span><button type="button" className="standee-hidden-manage" onClick={()=>onSettingsTab('members')}>{t("管理人物卡")}</button></div>}
    {!team.members.length&&<div className="standee-onboarding">
      <div className="home-setup"><SetupChecklist snapshot={snapshot} team={team} invoke={invoke} onSettings={onSettingsTab} onProject={onProject} initialOpen={false}/></div>
      <div className="standee-empty"><h1>{t("把伙伴们请进来")}</h1><button type="button" className="button small secondary" onClick={()=>onSettingsTab('members')}>{t("管理人物卡")}</button><p>{t("添加人物卡并连接执行端，就能在这里和她们见面。")}</p></div>
    </div>}
    {backgroundOpen&&<Modal title={t("首页背景")} subtitle={t("换一幅风景，让伙伴们站在你喜欢的地方。")} onClose={()=>setBackgroundOpen(false)} className="home-background-modal"><div className="modal-body"><BackgroundSettings onAppearance={()=>{setBackgroundOpen(false);requestAppearance();}}/></div></Modal>}
  </main>;
}

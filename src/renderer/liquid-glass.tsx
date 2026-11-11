import {useLayoutEffect,useRef} from 'react';
import {useAppearancePreferences} from './appearance-preferences';
import {lensSpan,movingRefractionMaps,refractionMaps} from './liquid-refraction';
import {useMediaPreference} from './media-preferences';
import {useMotionLevel,useMotionRoot} from './motion/use-motion-level';
import {installGlassInteractions} from './liquid-glass-interactions';
import './liquid-glass.css';
import './glass-reading.css';

// Every glass backing owns its optics. Content above a toolbar backing stays
// clear so text is not filtered twice by an ancestor and a nested surface.
const MENU_SURFACES='.topic-panel,.context-menu,.model-popover,.select-popover,.workspace-menu-content,.room-mentions,.modal,.answer-export-menu,.reaction-picker,.workspace-glass-drawer,[role=menu],[role=dialog]';
const READING_SURFACES='.md-code,.md-table,.markdown blockquote,.preview-markdown table,.syntax-line-numbers,.pdf-preview>nav,.office-sheet-tabs,.office-slide,.runtime-diagnostics,.activity-code,.native-plugin-settings pre,.joint-files pre';
const SURFACES='.app-shell>.sidebar,.workspace-toolbar-glass,.workspace-header-surface,.room[data-glass-chat]>.room-top,.page-background-toolbar,.member-notice,.workspace-toast,.attention-bubble,.attention-bubble-panel,.approval-card,.run-activity,.room-bubble,.composer,.room-empty,.room-jump,.file-preview-panel,.browser-sidebar,.preview-tab,.workspace-terminal,.explorer-root,.generated-file-card,.attachment-chip,.sidebar .roster-with-desk,.sidebar .project-tree-row,.home-action,.standee-name,.cast-auto,.standee-nameplate,.home-projects,.chat-preview-reply,.chat-preview-mine,.chat-preview-input,.project-room .board,.project-room .project-progress,.project-room .project-side-rail,.flow-dock,'+MENU_SURFACES;
const FIELD_SURFACES='.topic-picker select,.conversation-search>form,.project-review-level select';
const CONTROL_SURFACES='.glass-action,.room .md-file-link';
const GLASS_SURFACES=SURFACES+','+READING_SURFACES+','+FIELD_SURFACES+','+CONTROL_SURFACES;
const ownsGlass=(node:HTMLElement)=>node.id!=='hivelab-startup'&&!node.closest('.flow-dock-content,.project-room .board-lanes')&&!node.closest('.page-turn-ghost')&&(!node.closest('.sidebar')||node.matches('.sidebar'))&&(!node.closest('.settings-modal *')||node.matches('.chat-preview-reply,.chat-preview-mine,.chat-preview-input'))&&!node.matches('.run-activity>summary,.glass-content-action,.swatch')&&node.matches(GLASS_SURFACES)&&(!node.closest('.preview-workspace-bar')||node.matches('.workspace-toolbar-glass,'+MENU_SURFACES+','+FIELD_SURFACES+','+CONTROL_SURFACES))&&(!node.matches('.page-background-toolbar')||!node.closest('.workspace-unified-header'));
const SVG='http://www.w3.org/2000/svg';
export function LiquidGlassAppearance(){
 const {liquidGlass,glass,menuTransparency}=useAppearancePreferences(),defs=useRef<SVGDefsElement>(null),settings=useRef(glass),refresh=useRef<()=>void>(()=>{});
 const reducedTransparency=useMediaPreference('(prefers-reduced-transparency: reduce)'),moreContrast=useMediaPreference('(prefers-contrast: more)'),fullMotion=useMotionLevel()==='full';
 useMotionRoot();
 useLayoutEffect(()=>{
  document.documentElement.style.setProperty('--glass-menu-opacity',(100-menuTransparency)+'%');
  return()=>{document.documentElement.style.removeProperty('--glass-menu-opacity');};
 },[menuTransparency]);
 useLayoutEffect(()=>{
  settings.current=glass;
  const values={'--liquid-finish':`blur(${glass.blur}px) contrast(${glass.contrast}) brightness(${glass.brightness}) saturate(${glass.saturation})`,'--glass-shadow':'var(--shadow-float)','--liquid-pressed-shadow':'var(--shadow-hover)'};
  for(const [name,value] of Object.entries(values))document.documentElement.style.setProperty(name,value);
  refresh.current();
  return()=>{for(const name of Object.keys(values))document.documentElement.style.removeProperty(name);};
 },[glass]);
 useLayoutEffect(()=>{
  if(!liquidGlass)return;
  document.documentElement.dataset.liquidGlass='true';
  if(reducedTransparency||moreContrast)return()=>{delete document.documentElement.dataset.liquidGlass;};
  if(!CSS.supports('backdrop-filter','url("#hivelab-glass")'))return()=>{delete document.documentElement.dataset.liquidGlass;};
  const entries=new Map<HTMLElement,{filter:SVGFilterElement;image:SVGElement;displace:SVGElement;size:string;scale:number;strength:number;span:number;motionSize?:string}>();let nextId=0,frame=0;
  const primitive=(tag:string,attributes:Record<string,string>)=>{const node=document.createElementNS(SVG,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);return node;};
  function fit(node:HTMLElement,measured?:{width:number;height:number}){
   const entry=entries.get(node),{sidebarMoving,panelMoving}=document.documentElement.dataset;if(!entry||node.closest('[data-motion-resting]'))return;
   const width=measured?.width??Math.round(node.offsetWidth),height=measured?.height??Math.round(node.offsetHeight),size=[width,height,settings.current.edge,entry.strength].join(':');if(!width||!height)return;
   const moving=sidebarMoving!==undefined||panelMoving!==undefined;
   // The map is sized in pixels: a percentage would resolve against the empty svg that holds the filters, the map
   // would vanish, and everything under the glass would stand half the scale away from where it is.
   if(entry.image.getAttribute('width')!==String(width)||entry.image.getAttribute('height')!==String(height)){entry.image.setAttribute('width',String(width));entry.image.setAttribute('height',String(height));}
   // Generate a lightweight lens at the current width AND height on the first
   // trip too; cached resting maps cannot describe an unfolding panel.
   if(moving){
    if(entry.motionSize!==size){
     const maps=movingRefractionMaps(width,height,settings.current.edge,entry.strength);
     entry.image.setAttribute('href',maps.displacement);entry.scale=maps.scale;entry.span=lensSpan(width,height);entry.motionSize=size;entry.size='';
    }
   }else{
    entry.motionSize=undefined;
    if(entry.size!==size){entry.size=size;const maps=refractionMaps(width,height,settings.current.edge,entry.strength);entry.image.setAttribute('href',maps.displacement);entry.scale=maps.scale;entry.span=lensSpan(width,height);}
   }
   const scale=String(entry.scale*settings.current.refraction*lensSpan(width,height)/entry.span);
   if(entry.displace.getAttribute('scale')!==scale)entry.displace.setAttribute('scale',scale);
  }
  const measure=(nodes:HTMLElement[])=>nodes.filter(node=>!node.closest('[data-motion-resting]')).map(node=>({node,width:Math.round(node.offsetWidth),height:Math.round(node.offsetHeight)}));
  // The chat's glass changes size while the sidebar springs too (its column and composer follow the spring), so every
  // observed surface keeps its map in step on the way, using lightweight current-size lenses; far messages at rest are skipped.
  const resize=new ResizeObserver(changes=>{const nodes=changes.map(change=>change.target as HTMLElement);for(const item of measure(nodes))fit(item.node,item);});
  function scan(){
   frame=0;
   // Existing sidebar surfaces are followed by ResizeObserver. Re-scanning the
   // entire history during its first frame would undo the offscreen layout savings.
   if(document.documentElement.dataset.sidebarMoving!==undefined)return;
   for(const [node,entry] of entries)if(!node.isConnected||!ownsGlass(node)){resize.unobserve(node);entry.filter.remove();node.style.removeProperty('--liquid-refraction');delete node.dataset.liquidSurface;entries.delete(node);}
   const measured=measure([...document.querySelectorAll<HTMLElement>(GLASS_SURFACES)].filter(ownsGlass));
   for(const {node,width,height} of measured){
    if(entries.has(node)){fit(node,{width,height});continue;}
    const id='hivelab-glass-'+(++nextId),filter=primitive('filter',{id,'color-interpolation-filters':'sRGB',x:'0%',y:'0%',width:'100%',height:'100%'}) as SVGFilterElement;
    const maps=refractionMaps(width,height,settings.current.edge);
    // feImage starts loading when it joins a filter, even before the filter is
    // attached. Give it a source first so Chromium never requests an empty URL.
    const image=primitive('feImage',{href:maps.displacement,x:'0',y:'0',width:String(width),height:String(height),preserveAspectRatio:'none',result:'edge-map'});
    const displace=primitive('feDisplacementMap',{in:'SourceGraphic',in2:'edge-map',scale:'0',xChannelSelector:'R',yChannelSelector:'G',result:'refracted'});
    filter.append(image,displace);
    defs.current?.append(filter);entries.set(node,{filter,image,displace,size:[width,height,settings.current.edge,1].join(':'),scale:maps.scale,strength:1,span:lensSpan(width,height)});node.style.setProperty('--liquid-refraction',`url("#${id}")`);node.dataset.liquidSurface='';resize.observe(node);fit(node,{width,height});
   }
  }
  const changes=new MutationObserver(records=>{if(!frame&&records.some(record=>record.type==='attributes'||[...record.addedNodes,...record.removedNodes].some(node=>node instanceof HTMLElement)))frame=requestAnimationFrame(scan);});
  changes.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});scan();
  refresh.current=()=>{const measured=measure([...entries.keys()]);for(const item of measured)fit(item.node,item);};
  const landed=()=>{if(frame)cancelAnimationFrame(frame);scan();};window.addEventListener('hivelab:page-turned',landed);
  const stopInteractions=!fullMotion?()=>{}:installGlassInteractions(()=>settings.current,(node,strength)=>{const entry=entries.get(node);if(entry){entry.strength=strength;fit(node);}});
  return()=>{window.removeEventListener('hivelab:page-turned',landed);stopInteractions();refresh.current=()=>{};cancelAnimationFrame(frame);changes.disconnect();resize.disconnect();for(const [node,entry] of entries){node.style.removeProperty('--liquid-refraction');delete node.dataset.liquidSurface;entry.filter.remove();}delete document.documentElement.dataset.liquidGlass;};
 },[liquidGlass,reducedTransparency,moreContrast,fullMotion]);
 return <svg className="liquid-glass-definitions" width="0" height="0" aria-hidden="true" focusable="false"><defs ref={defs}/></svg>;
}

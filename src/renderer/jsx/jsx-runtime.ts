/**
 * The renderer bundle's JSX runtime (wired in scripts/build.mjs as `hivelab-jsx`): React's
 * own runtime, plus a display-boundary pass for the non-default language. Text written in
 * the source goes through `t()`; this pass only catches Chinese that arrives as data — a
 * backend status, a catalog entry, a label kept in a shared constant — and replaces it
 * when the whole string is a known phrase (`translateExact`). User text rendered through
 * Markdown never passes here, and an element marked `translate="no"` (with its children
 * passed in directly) is left as it is.
 */
import {Fragment,jsx as reactJsx,jsxs as reactJsxs} from 'react/jsx-runtime';
import {isDefaultLanguage,translateExact} from '../../shared/i18n';

export {Fragment};
export type {JSX} from 'react/jsx-runtime';

const TEXT_PROPS=['title','placeholder','aria-label','aria-description','alt','label'] as const;
type Props=Record<string,unknown>&{children?:unknown};

function translateChild(child:unknown):unknown{
 if(typeof child==='string')return translateExact(child);
 if(Array.isArray(child)){
  let changed:unknown[]|undefined;
  for(let index=0;index<child.length;index++){
   const value=child[index],next=translateChild(value);
   if(next!==value){changed??=child.slice();changed[index]=next;}
  }
  return changed??child;
 }
 return child;
}

export function localizeProps(type:unknown,props:Props):Props{
 // Components receive their props untouched; they render host elements that come back here.
 if(typeof type!=='string'||isDefaultLanguage()||props.translate==='no')return props;
 let next:Props|undefined;
 for(const name of TEXT_PROPS){
  const value=props[name];
  if(typeof value==='string'){const translated=translateExact(value);if(translated!==value)(next??={...props})[name]=translated;}
 }
 if('children' in props){
  const children=translateChild(props.children);
  if(children!==props.children)(next??={...props}).children=children;
 }
 return next??props;
}

export function jsx(type:any,props:Props,key?:any){return reactJsx(type,localizeProps(type,props),key);}
export function jsxs(type:any,props:Props,key?:any){return reactJsxs(type,localizeProps(type,props),key);}

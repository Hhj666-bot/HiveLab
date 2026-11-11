import {createContext,useContext,type ReactNode} from 'react';
import './search-highlight.css';

export const SearchHighlight=createContext('');
export function matchRanges(text:string,query:string){
  const ranges:{start:number;end:number}[]=[];
  if(!query)return ranges;
  const body=text.toLowerCase(),needle=query.toLowerCase();
  let start=body.indexOf(needle);
  while(start>=0){ranges.push({start,end:start+query.length});start=body.indexOf(needle,start+query.length);}
  return ranges;
}
export function markedText(text:string,query:string,active=true,key='match'):ReactNode[]{
  const nodes:ReactNode[]=[];let previous=0;
  for(const {start,end} of matchRanges(text,query)){
    if(start>previous)nodes.push(text.slice(previous,start));
    nodes.push(<mark className={'search-capsule'+(active?' search-capsule-active':'')} key={key+start}>{text.slice(start,end)}</mark>);previous=end;
  }
  if(previous<text.length)nodes.push(text.slice(previous));
  return nodes;
}
export function HighlightText({text}:{text:string}){return <>{markedText(text,useContext(SearchHighlight))}</>;}

/** Highlight escaped syntax tokens without changing the code or its colouring. */
export function markSyntax(html:string,query:string){
  if(!query)return html;
  const template=document.createElement('template');template.innerHTML=html;
  const ranges=matchRanges(template.content.textContent??'',query),walker=document.createTreeWalker(template.content,NodeFilter.SHOW_TEXT),nodes:Text[]=[];
  let node:Node|null;while((node=walker.nextNode()))nodes.push(node as Text);
  let offset=0;
  for(const text of nodes){
    const value=text.data,end=offset+value.length,hits=ranges.filter(hit=>hit.start<end&&hit.end>offset);
    if(hits.length){const fragment=document.createDocumentFragment();let previous=0;for(const hit of hits){const start=Math.max(0,hit.start-offset),finish=Math.min(value.length,hit.end-offset);fragment.append(value.slice(previous,start));const mark=document.createElement('mark');mark.className='search-capsule search-capsule-active';mark.textContent=value.slice(start,finish);fragment.append(mark);previous=finish;}fragment.append(value.slice(previous));text.replaceWith(fragment);}
    offset=end;
  }
  return template.innerHTML;
}

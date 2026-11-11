import {useMemo,useRef} from 'react';
import type {TeamMember} from '../members';
import type {Invoke} from '../ui';
import {useInsertionArrange} from '../use-insertion-arrange';
/** Sidebar order is persisted independently from home standees. */
export function useRosterArrange(members:TeamMember[],ready:boolean,invoke:Invoke){
 const lineup=useMemo(()=>members.toSorted((a,b)=>(a.card.sidebarOrder??Infinity)-(b.card.sidebarOrder??Infinity)),[members]);
 const container=useRef<HTMLDivElement>(null),arrange=useInsertionArrange(lineup.map(m=>m.id),ready,'y',container,ids=>invoke('team.arrange',{ids,scope:'sidebar'}));
 return {...arrange,container,shown:arrange.ids.map(id=>lineup.find(m=>m.id===id)!).filter(Boolean)};
}

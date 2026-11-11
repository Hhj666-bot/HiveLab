export type InsertionTarget={id:string;edge:'before'|'after'};
/** Move one member into the queue; every other member keeps its relative order. */
export function insertMember(ids:readonly string[],moving:string,target:InsertionTarget):string[]{
 if(moving===target.id||!ids.includes(moving)||!ids.includes(target.id))return [...ids];
 const next=ids.filter(id=>id!==moving),index=next.indexOf(target.id)+(target.edge==='after'?1:0);
 next.splice(index,0,moving);return next;
}

export type PendingChange={id:string;label:string;state:'waiting'|'applying'|'applied'|'failed'|'cancelled'|'unknown'|'dismissed';createdAt:string;updatedAt:string;error?:string};

import type {Store} from '../store';

/** Called inside the business transaction: a committed change is replayable after a crash. */
export function completeFlowRequest<T>(store:Store, requestId:unknown, result:T):T {
  const id=String(requestId), receipt=store.get<{key:string;result?:unknown}>('flow_requests',id);
  if(receipt)store.put('flow_requests',id,{...receipt,result});
  return result;
}

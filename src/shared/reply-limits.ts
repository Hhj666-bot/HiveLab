import {t} from './i18n';
export interface ReplyLimitSettings { perMember:number|null; overrides:Record<string,number|null> }
export interface ReplyBudget { messageId:string; limits:Record<string,number|null>; used:Record<string,number> }
export const DEFAULT_REPLY_LIMITS:ReplyLimitSettings={perMember:1,overrides:{}};
export const MAX_MEMBER_REPLIES=100;

function count(value:unknown):number|null{
  if(value===null)return null;
  if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>MAX_MEMBER_REPLIES)throw Error(t("发言次数须为 0–100 的整数，或选择不限"));
  return value;
}
export function normalizeReplyLimits(raw:unknown):ReplyLimitSettings{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error(t("发言次数设置无效"));
  const value=raw as Record<string,unknown>,overrides:Record<string,number|null>={};
  if(value.overrides!==undefined&&(!value.overrides||typeof value.overrides!=='object'||Array.isArray(value.overrides)))throw Error(t("成员发言次数设置无效"));
  for(const [id,limit] of Object.entries(value.overrides??{})){if(!id||id.length>160)throw Error(t("成员标识无效"));Object.defineProperty(overrides,id,{value:count(limit),enumerable:true,configurable:true,writable:true});}
  return {perMember:count(value.perMember),overrides};
}
export function createReplyBudget(settings:ReplyLimitSettings|undefined,members:string[],messageId:string):ReplyBudget|undefined{
  if(!settings)return;
  return {messageId,limits:Object.fromEntries(members.map(id=>[id,Object.hasOwn(settings.overrides,id)?settings.overrides[id]:settings.perMember])),used:{}};
}
export function replyRemaining(budget:ReplyBudget|undefined,memberId:string){
  if(!budget)return Infinity;
  if(!Object.hasOwn(budget.limits,memberId))return 0;
  const limit=budget.limits[memberId];return limit===null?Infinity:Math.max(0,limit-(budget.used[memberId]??0));
}
export const canReply=(budget:ReplyBudget|undefined,memberId:string)=>replyRemaining(budget,memberId)>0;
/** Reserve before dispatch: passes, reactions and failed attempts still consume one opportunity.
 * Format correction and connection retry belong to this same opportunity. */
export function reserveReply(budget:ReplyBudget|undefined,memberId:string):ReplyBudget|undefined{
  if(!budget)return;
  if(!canReply(budget,memberId))throw Error(t("这位成员本次发言次数已用完"));
  return {...budget,used:{...budget.used,[memberId]:(budget.used[memberId]??0)+1}};
}
export const replyLimitLabel=(value:number|null)=>value===null?t("不限"):value===0?t("不发言"):t("{0} 次", value);

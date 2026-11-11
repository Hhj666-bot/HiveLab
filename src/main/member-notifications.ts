import type {MemberNotice,MemberNoticeTarget} from '../shared/member-notifications';
interface NativeNotice {once(event:string,listener:()=>void):unknown;show():void;close():void}
export class MemberNotifications {
 private seen=new Set<string>();private active=new Set<NativeNotice>();
 constructor(private host:{focused:()=>boolean;supported:()=>boolean;create:(notice:MemberNotice)=>NativeNotice;flash:()=>void;open:(target:MemberNoticeTarget)=>void;fallback:(notice:MemberNotice)=>void}){}
 show(notice:MemberNotice):{delivery:'foreground'|'desktop'|'fallback'|'duplicate'}{
  if(this.seen.has(notice.id))return {delivery:'duplicate'};this.seen.add(notice.id);if(this.seen.size>512)this.seen.delete(this.seen.values().next().value!);
  if(this.host.focused())return {delivery:'foreground'};
  this.host.flash();if(!this.host.supported())return {delivery:'fallback'};
  try{
   const native=this.host.create(notice);this.active.add(native);
   native.once('click',()=>{this.host.open(notice.target);native.close();});native.once('close',()=>this.active.delete(native));native.once('failed',()=>{this.active.delete(native);this.host.fallback(notice);});native.show();return {delivery:'desktop'};
  }catch{return {delivery:'fallback'};}
 }
 close(){for(const notice of this.active)notice.close();this.active.clear();}
}

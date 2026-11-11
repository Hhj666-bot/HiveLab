import {t} from './i18n';
import type {RoomMessage,Snapshot} from './types';
export type DeliveryReceipt={id:string;runId:string;delivery:string;createdAt:string;updatedAt?:string};
export function messageDelivery(message:RoomMessage,snapshot:Pick<Snapshot,'runs'|'deliveryReceipts'>){
  if(message.author!=='user'||!message.deliveryKind)return '';
  if(message.deliveryKind==='supplement'){
    const receipt=snapshot.deliveryReceipts?.find(r=>r.id===message.deliveryId);
    return receipt?.delivery==='confirmed'?t("执行端已接收补充 · 采用情况请核对回复"):receipt?.delivery==='unknown'||message.deliveryState==='unknown'?t("补充送达结果待核对 · 不会自动重发"):receipt?.delivery==='withdrawn'?t("执行端未接收，已转为下一轮"):t("正在向执行端投递补充");
  }
  const run=snapshot.runs.find(r=>r.id===message.runId);
  if(!run)return t("已保存 · 运行回执未加载");
  if(run.status==='queued')return t("已排队 · 等待下一轮执行");
  if(run.delivery==='unknown'||run.status==='unknown')return t("投递结果待核对 · 不会自动重发");
  if(run.delivery==='withdrawn')return t("已撤回");
  return run.delivery==='confirmed'?t("执行端已接收 · 采用情况请核对回复"):t("已提交 · 等待执行端确认");
}

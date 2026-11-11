import {t} from './i18n';
import type {MemberPermissions} from '../shared/types';
import {PERMISSION_MODES,permissionPreset,isPermissionMode} from '../shared/permission-modes';
export function PermissionModePicker({value,onChange,label,inherit,onInherit}:{value:MemberPermissions;onChange:(value:MemberPermissions)=>void;label:string;inherit?:boolean;onInherit?:()=>void}){
  return <label className="field">{t("权限等级")}<select aria-label={label} value={inherit?'inherit':value.mode??'custom'} onChange={event=>{if(event.target.value==='inherit')onInherit?.();else if(isPermissionMode(event.target.value))onChange(permissionPreset(event.target.value));}}>{onInherit&&<option value="inherit">{t("继承执行端权限")}</option>}{!value.mode&&<option value="custom">{t("自定义 · 保留已有配置")}</option>}{PERMISSION_MODES.map(mode=><option key={mode.id} value={mode.id}>{mode.label}</option>)}</select><small>{PERMISSION_MODES.find(mode=>mode.id===value.mode)?.description??t("正在使用原有的命令、文件和网络限制，未自动放宽。")}</small></label>;
}

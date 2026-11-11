import type {ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';

/** One closed row of a long settings page: its name and a line on what is inside, opened on demand. */
export function SettingsFold({title,hint,label,children}:{title:string;hint:string;label:string;children:ReactNode}){
 return <details className="settings-group settings-fold"><summary><span><h3>{title}</h3><small>{hint}</small></span><ChevronDown size={16} aria-hidden="true"/></summary><section className="settings-fold-body" aria-label={label}>{children}</section></details>;
}

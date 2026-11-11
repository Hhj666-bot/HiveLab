import {t as tr,useLanguage} from './i18n';
import {memo,useState} from 'react';
import {CheckCircle2,ChevronDown,Circle,CircleDot,ListChecks,LoaderCircle} from 'lucide-react';
import type {TodoItem} from '../shared/task-list';
import './task-list.css';

const LABEL={get pending(){return tr("待办")},get in_progress(){return tr("进行中")},get completed(){return tr("已完成")}} as const;

/** The executor's own progress list for this turn, shared by Claude, Codex and DSH. */
export const TaskListCard=memo(function TaskListCard({todos,active}:{todos?:TodoItem[];active:boolean}){useLanguage();
  const done=todos?.filter(t=>t.status==='completed').length??0,total=todos?.length??0;
  // A finished turn whose list is complete starts folded; anything still open stays visible.
  const [open,setOpen]=useState(()=>active||done<total);
  if(!total)return null;
  return <details className="task-list-card" open={open} onToggle={event=>setOpen((event.currentTarget as HTMLDetailsElement).open)}>
    <summary><ListChecks size={15} aria-hidden="true"/><strong>{tr("任务清单")}</strong><span className="task-list-count" aria-label={tr("已完成 {0} 项，共 {1} 项", done, total)}>{done}/{total}</span><span className="task-list-progress" aria-hidden="true"><span style={{width:`${total?done/total*100:0}%`}}/></span><ChevronDown size={14} aria-hidden="true"/></summary>
    <ol className="task-list-items" aria-label={tr("任务清单")}>
      {todos!.map((todo,index)=><li key={index+':'+todo.content} className={'task-list-item '+todo.status}>
        {todo.status==='completed'?<CheckCircle2 size={14} aria-hidden="true"/>:todo.status==='in_progress'?(active?<LoaderCircle size={14} className="task-list-spin" aria-hidden="true"/>:<CircleDot size={14} aria-hidden="true"/>):<Circle size={14} aria-hidden="true"/>}
        <span>{todo.content}</span><small className="visually-hidden">{LABEL[todo.status]}</small>
      </li>)}
    </ol>
  </details>;
});

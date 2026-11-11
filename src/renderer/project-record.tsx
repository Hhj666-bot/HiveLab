import {t} from './i18n';
import {useEffect,useState} from 'react';
import type {Project} from '../shared/types';
import type {ProjectRecord} from '../shared/project-workbench';
import {Modal} from './modals';
import {Markdown} from './Markdown';
import type {Invoke} from './ui';
export function ProjectRecordView({project,flowId,invoke,onClose}:{project:Project;flowId:string;invoke:Invoke;onClose:()=>void}){
  const [record,setRecord]=useState<ProjectRecord>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=()=>invoke<ProjectRecord>('projectFlow.record',{projectId:project.id,flowId}).then(setRecord);
  useEffect(()=>{let alive=true;void invoke<ProjectRecord>('projectFlow.record',{projectId:project.id,flowId}).then(r=>{if(alive)setRecord(r);}).catch(e=>{if(alive)setError((e as Error).message);});return()=>{alive=false;};},[project.id,flowId]);
  async function write(){setBusy(true);try{await invoke('projectFlow.record.write',{requestId:crypto.randomUUID(),projectId:project.id,flowId});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal title={t("项目记录")} subtitle={t("根据保存的方案、汇报、验收和决策生成。")} onClose={onClose}>
    <div className="modal-body project-record">{error&&<p role="alert">{error}</p>}{record?<><p>{record.status==='completed'?t("已完成"):record.status==='cancelled'?t("已取消"):t("进行中 · 当前记录预览")}</p><Markdown text={record.markdown}/>{record.receipt&&<p role="status">{t("项目文件保存：")}{record.receipt.state} · {record.receipt.path}{record.receipt.error&&' · '+record.receipt.error}</p>}</>:<p>{t("正在读取记录…")}</p>}</div>
    <div className="modal-footer"><label className="project-record-setting" title={t("默认关闭；每段工作完成或取消后新建一份，不覆盖已有文件")}><input type="checkbox" checked={project.projectRecordToFolder===true} onChange={e=>void invoke('project.update',{projectId:project.id,projectRecordToFolder:e.target.checked}).catch(err=>setError((err as Error).message))}/>{t("完成或取消后，自动保存到项目的 docs/hivelab/")}</label><button className="button" disabled={!record||busy} onClick={()=>record&&void invoke('file.save',{name:record.title+'.md',content:record.markdown}).catch(e=>setError((e as Error).message))}>{t("导出 Markdown")}</button>{project.projectRecordToFolder&&record&&['completed','cancelled'].includes(record.status)&&record.receipt?.state!=='written'&&<button className="button" disabled={busy} onClick={()=>void write()}>{t("写入项目文件夹{0}", record.receipt?.state==='failed'?t("（重试）"):'')}</button>}<button className="button quiet" onClick={onClose}>{t("关闭")}</button></div>
  </Modal>;
}

import {t} from './i18n';
import {useState} from 'react';
import {AlertTriangle,FileDiff} from 'lucide-react';
import type {JointReview,JointSlot} from '../shared/joint-review';
import {Modal} from './modals';
import type {Artifact} from '../shared/types';
import type {VersionRef} from '../shared/project-flow';
import type {Invoke} from './ui';
import './joint-review.css';

export function JointReplyNotes({notes,label}:{notes?:string[];label:string}){
  if(!notes?.length)return null;
  return <details className="task-meta" aria-label={t("{0}的补充说明", label)}><summary>{t("待补充或核实（{0}）", notes.length)}</summary><ul>{[...new Set(notes)].map(note=><li key={note}>{note}</li>)}</ul></details>;
}

export function JointFiles({projectId,review,version,invoke}:{projectId:string;review:JointReview;version:VersionRef;invoke:Invoke}){
  const [files,setFiles]=useState<Omit<Artifact,'path'>[]|null>(null),[text,setText]=useState(''),[error,setError]=useState('');
  const params={projectId,jointReviewId:review.id,artifactId:version.artifactId};
  async function list(){try{setFiles(await invoke('projectFlow.jointReview.artifact.files',params));setError('');}catch(e){setError((e as Error).message);}}
  return <section className="joint-files"><small>{t("保存版本 {0}", version.fingerprint.slice(0,12))}</small><div className="joint-actions"><button className="link-button" onClick={()=>void list()}>{t("查看候选文件")}</button>{review.baseVersion&&<button className="link-button" onClick={()=>void invoke<{text:string}>('projectFlow.jointReview.artifact.diff',{...params,against:review.baseVersion!.artifactId}).then(d=>setText(d.text)).catch(e=>setError((e as Error).message))}><FileDiff size={12}/>{t("相对基线的差异")}</button>}</div>
    {files&&<ul>{files.filter(f=>!f.directory).map(f=><li key={f.relativePath}><button className="link-button" onClick={()=>void invoke<{content:string;truncated:boolean}>('projectFlow.jointReview.artifact.read',{...params,path:f.relativePath}).then(r=>{setText(r.content+(r.truncated?t("\n（内容已截断）"):''));setError('');}).catch(e=>setError((e as Error).message))}>{f.relativePath}</button></li>)}</ul>}{error&&<p role="alert" className="task-meta bad">{error}</p>}{text&&<details open><summary>{t("已保存的文件内容 ")}<button className="link-button" onClick={()=>setText('')}>{t("收起")}</button></summary><pre>{text}</pre></details>}
  </section>;
}
export function JointDecision({title,reason,busy,onDecide}:{title:string;reason:string;busy:boolean;onDecide:(choice:'accept'|'defer',opinion:string)=>void}){const [opinion,setOpinion]=useState('');return <article className="joint-decision"><h3><AlertTriangle size={14}/>{title}</h3><p>{reason}</p><textarea aria-label={t("分歧决定的理由")} placeholder={t("补充理由（可选）；此决定会保留阻塞问题或未核实状态")} value={opinion} onChange={e=>setOpinion(e.target.value)}/><div className="joint-actions"><button className="button small primary" disabled={busy} onClick={()=>onDecide('accept',opinion)}>{t("采纳问题")}</button><button className="button small secondary" disabled={busy} onClick={()=>onDecide('defer',opinion)}>{t("暂缓并保留疑点")}</button></div></article>;}

export function RoundtableRecovery({slot,busy,onResolve}:{slot:JointSlot;busy:boolean;onResolve:(choice:'recover'|'abandon'|'retry'|'skip'|'adopt',evidence:string,acknowledgeUnknown?:boolean)=>void}){
  const [evidence,setEvidence]=useState(''),[confirm,setConfirm]=useState<'retry'|'adopt'>(),caps=slot.recovery;
  function act(choice:'retry'|'adopt'){if(choice==='adopt'||caps?.needsDuplicateConfirmation)setConfirm(choice);else onResolve(choice,evidence);}
  return <div className="joint-recovery"><p>{t("只处理这一份，其他成员已完成的稿件保留。原运行与失败记录均保留。")}</p><textarea aria-label={t("评审运行核对依据")} value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder={t("补充核对情况或重写原因（可选）")}/>
    <div className="joint-actions">{caps?.canRecover&&<button className="button small secondary" disabled={busy} onClick={()=>onResolve('recover',evidence)}>{t("恢复已有完成结果")}</button>}<button className="button small secondary" disabled={busy||!caps?.canRetry} onClick={()=>act('retry')}>{t("让 TA 重写这一份")}</button><button className="button small secondary" disabled={busy||!caps?.canSkip} title={caps?.canSkip?undefined:t("至少保留一份已完成的稿件；汇总与验证不能省略")} onClick={()=>onResolve('skip',evidence)}>{t("跳过这一份，用其余的继续")}</button>{caps?.canAdopt&&<button className="button small secondary" disabled={busy} onClick={()=>act('adopt')}>{t("我核对过，采用已收到的回复")}</button>}<button className="button small quiet" disabled={busy} onClick={()=>onResolve('abandon',evidence)}>{t("放弃整个议题")}</button></div>
    {confirm&&<Modal title={confirm==='retry'?t("确认重写这一份"):t("确认采用已收到的回复")} onClose={()=>setConfirm(undefined)}><div className="modal-body"><p>{confirm==='retry'?t("原请求可能已经发出，重写可能重复执行。原记录保留，只重新派发这一份。"):t("请核对完整回复及实际文件。采用会记录为“用户确认采用”，原运行仍保持结果未知，不会写成程序确认完成。")}</p></div><div className="modal-footer"><button className="button quiet" onClick={()=>setConfirm(undefined)}>{t("返回核对")}</button><button className="button primary" disabled={busy} onClick={()=>{onResolve(confirm,evidence,true);setConfirm(undefined);}}>{confirm==='retry'?t("确认可能重复，重写这一份"):t("已核对，确认采用")}</button></div></Modal>}
  </div>;
}

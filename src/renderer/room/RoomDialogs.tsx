import {t} from '../i18n';
import {Modal} from "../modals";
import {NewTopicDialog, TopicPanel} from "../topics";
import {HandoffDialog} from "../handoff";
import {ContextMenu} from "../interactions";
import {MemoryProposalDialog} from "../memory";
import {ImageGenerationDialog} from "../generated-images";
import type {RoomController} from "./use-room-controller";
export function RoomDialogs({controller}:{controller:RoomController}){
  const {
    invoke, setReloads, room, handoff, setHandoff, menu, setMenu, proposing, setProposing, imageDialog, setImageDialog, state, historyOnly, usable,
    minutesDialog, setMinutesDialog, minutesBusy, minutesError, minutesMembers, confirmMinutes, busy, panel, setPanel, newTopic, setNewTopic, writers,
    selectedId, composer, thread, pinned, current, afterTopicChange, manage, exportTopic, name, selectTopic, snapshot, roomId, personal
  }=controller;
  return <>
    {panel && <TopicPanel onChanged={() => setReloads(n => n + 1)} snapshot={personal?{...snapshot,room}:snapshot} personal={Boolean(personal)} historyOnly={historyOnly} selectedId={selectedId} usable={writers} invoke={invoke} busy={busy}
      onSelect={id => { void selectTopic(id); setPanel(false); }} onContinue={item => personal?void selectTopic(item.id):setNewTopic({ from: item })}
      onExport={id => void exportTopic(id)} onClear={() => void manage('clear')} onClose={() => setPanel(false)} />}
    {minutesDialog&&<Modal title={t("整理会议纪要")} subtitle={t("依据目前已保存的发言整理结论、分歧和下一步；写完后结束本次会议。")} onClose={()=>{if(!minutesBusy)setMinutesDialog(undefined);}}><div className="modal-body"><label className="field">{t("整理纪要的成员")}<select aria-label={t("纪要成员")} value={minutesDialog.memberId} disabled={minutesBusy} onChange={e=>setMinutesDialog({...minutesDialog,memberId:e.target.value})}>{minutesMembers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>{minutesDialog.interrupt&&<p>{t("正在进行的发言会先中止，已保存的发言保留。")}</p>}<p>{t("预计 1 次调用。")}</p>{minutesError&&<p role="alert">{minutesError}</p>}</div><div className="modal-footer"><button className="button quiet" disabled={minutesBusy} onClick={()=>setMinutesDialog(undefined)}>{t("取消")}</button><button className="button primary" disabled={minutesBusy||!minutesDialog.memberId} onClick={()=>void confirmMinutes()}>{minutesBusy?t("正在处理…"):t("确认整理")}</button></div></Modal>}
    <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    {imageDialog&&<ImageGenerationDialog snapshot={snapshot} invoke={invoke} text={imageDialog.text} attachments={imageDialog.attachments} roomId={roomId} active={state.active} preferredMemberId={personal?.memberId} onClose={()=>setImageDialog(null)} onSent={()=>{setImageDialog(null);composer.clear(imageDialog.draftVersion);pinned.current=true;}}/>}
    {proposing && thread?.summary?.proposals?.length ? <MemoryProposalDialog snapshot={snapshot} thread={thread} invoke={invoke} onClose={() => setProposing(false)} /> : null}
    {handoff && <HandoffDialog snapshot={snapshot} invoke={invoke} source={handoff} onClose={() => setHandoff(null)} onDone={() => setHandoff(null)} />}
    {newTopic && <NewTopicDialog snapshot={personal?{...snapshot,room}:snapshot} personal={Boolean(personal)} current={current} from={newTopic.from} usable={writers} invoke={invoke} onClose={() => setNewTopic(null)} onDone={() => { setNewTopic(null); setPanel(false); afterTopicChange(); }} />}

  </>;
}

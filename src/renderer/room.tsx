import {t} from './i18n';
import {RoomBackdrop} from './room-backdrop';
import {MessageSkillDialog} from './message-skills';
import {ArrowDown} from 'lucide-react';
import {useRoomController} from './room/use-room-controller';
import {RoomToolbar} from './room/RoomToolbar';
import {RoomMessages} from './room/RoomMessages';
import {RoomComposer} from './room/RoomComposer';
import {RoomDialogs} from './room/RoomDialogs';
import type {RoomViewProps} from './room/types';
export type {RoomFocus,RoomSurface,PersonalRoomChat,ProjectRoomChat} from './room/types';

export function RoomView(props:RoomViewProps){
  const controller=useRoomController(props);
  const {floatingChat,project,personal,messageSkills,usable,unseen,jumpToLatest}=controller;
  const Root=project||personal?'section':'main';
  return <Root data-page-loading={controller.roomLoading?'':undefined} ref={floatingChat.ref} data-glass-chat={floatingChat.enabled?'':undefined} className={`room ${project?'room-embedded':''} ${personal?'personal-room member-'+personal.memberId:''}`} aria-label={personal?personal.kind==='desk'?t("工位聊天"):t("汇报对话"):project?t("会议聊天"):undefined}>
    {!project&&!personal&&<RoomBackdrop/>}
    <RoomToolbar controller={controller}/>
    {messageSkills.open&&<MessageSkillDialog control={messageSkills} participants={usable.map(m=>({name:m.name,provider:m.executor}))} onClose={()=>messageSkills.setOpen(false)}/>}
    <RoomMessages controller={controller}/>
    {unseen>0&&<button type="button" className="room-jump" onClick={jumpToLatest}><ArrowDown size={14}/>{t("有 {0} 条新消息", unseen)}</button>}
    <RoomComposer controller={controller}/>
    <RoomDialogs controller={controller}/>
  </Root>;
}

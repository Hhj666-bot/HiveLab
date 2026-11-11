import {type MutableRefObject, type ReactNode} from "react";
import type {RoomId, RoomMessage, Snapshot} from "../../shared/types";
import type {PersonalRoomData} from "../../shared/member-workspaces";
import {type Invoke} from "../ui";
import {type MenuItem} from "../interactions";
import type {MessageSkillTag} from "../../shared/message-skills";
export type RoomFocus = { threadId?: string; messageId?: string; nonce: number };

export interface ProjectRoomChat {
  /** Who takes part (chosen in 请大家一起来); toggling a chip here changes it. */
  roster: string[]; onRoster: (memberIds: string[]) => void;
  onConfigureMember?: (memberId:string)=>void;
  onTaskRequest?:(memberId:string,goal:string,mode:'add'|'supplement',skills?:MessageSkillTag[])=>Promise<boolean>;
  /** The flow dock already shows a next step, so the discussion layer does not suggest another one. */
  flowNextStep?:boolean;
  /** A live card for a plan, decision or round-report message, or undefined to show the message as text. */
  renderFlow?: (message: RoomMessage) => ReactNode | undefined;
  /** Flow state that has no message of its own: drafting, stuck items, waiting for quota, choosing a lead. */
  dock?: ReactNode;
  empty?: ReactNode;
}

export type RoomData = Snapshot['room'] & Partial<PersonalRoomData>;

export interface RoomSurface {title:string;hint:string;readOnly?:boolean;active?:boolean;renderMessage?:(message:RoomMessage,text:string)=>ReactNode|undefined;dock?:ReactNode;recordActions?:MutableRefObject<MenuItem[]>}

export interface PersonalRoomChat {
  kind:'desk'|'report'; memberId:string; title:string; hint:string;
  headerActions?:ReactNode; composerControls?:(room:RoomData)=>ReactNode;
  /** Report pages have no topics; this row takes the topic bar's place (e.g. the member switcher). */
  subbar?:ReactNode;
  renderMessage?:(message:RoomMessage)=>ReactNode|undefined;
  messageActions?:(message:RoomMessage,messages:RoomMessage[])=>ReactNode;
  dock?:ReactNode; empty?:ReactNode;
}
export type RoomViewProps={ snapshot: Snapshot; invoke: Invoke; onOpenSession?: (projectId: string, sessionId: string) => void; split?: { active: boolean; toggle: () => void }; focus?: RoomFocus; roomId?: RoomId; project?: ProjectRoomChat; personal?:PersonalRoomChat;surface?:RoomSurface };

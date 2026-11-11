import type {RoomId} from './types';

export interface ConversationTarget {roomId:RoomId;threadId:string}
export interface ConversationMatch extends ConversationTarget {
  messageId:string;roomTitle:string;title:string;author:string;at:string;excerpt:string;directory?:string;
}
export interface ConversationSearchPage {matches:ConversationMatch[];hasMore:boolean;nextOffset:number}
export interface ConversationFocus extends ConversationTarget {messageId:string;nonce:number;query:string}

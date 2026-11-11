import {useContext,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {WorkspaceToolbarLeading} from './workspace-toolbar';
import './room-header.css';

export function RoomHeader({children,className='',toolbar=false}:{children:ReactNode;className?:string;toolbar?:boolean}){
  const target=useContext(WorkspaceToolbarLeading),inToolbar=toolbar&&target;
  const header=<div className={`room-top ${className}${toolbar?' workspace-room-header':''}${inToolbar?' room-header-in-toolbar':''}`}>
    <div className="room-header-details">{children}</div>
  </div>;
  return inToolbar?createPortal(header,inToolbar):header;
}

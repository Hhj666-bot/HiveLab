import {createContext,type Dispatch,type SetStateAction} from 'react';
/** Page actions share the workspace toolbar without moving their dialogs or state. */
export const WorkspaceToolbar=createContext<HTMLElement|null>(null);
export const WorkspaceToolbarLeading=createContext<HTMLElement|null>(null);
/** Page settings appear immediately before the shared file-preview control. */
export const WorkspaceToolbarPrimary=createContext<HTMLElement|null>(null);
export const WorkspaceToolbarSecondary=createContext<HTMLElement|null>(null);
export const WorkspaceSearchPanel=createContext<HTMLElement|null>(null);
/** Active document tools share the tab strip; standalone dialogs keep their toolbar. */
export const PreviewDocumentToolbar=createContext<HTMLElement|null>(null);
export const PreviewDocumentStatus=createContext<HTMLElement|null>(null);

export const WorkspaceSummaryControl=createContext<HTMLElement|null>(null);
export const WorkspaceDrawer=createContext<{active:'search'|'summary'|undefined;setActive:Dispatch<SetStateAction<'search'|'summary'|undefined>>}|null>(null);

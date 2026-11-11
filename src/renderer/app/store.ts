import {createStore} from "zustand/vanilla";
import {devtools, persist, createJSONStorage, type StateStorage} from "zustand/middleware";
import type {SetStateAction} from "react";
import type {Project, Snapshot} from "../../shared/types";
import type {MemberReportPage} from "../../shared/project-workbench";
import type {ConversationTarget, ConversationFocus} from "../../shared/conversation-search";
import type {RoomFocus} from "../room";
import type {RoundtableRequest} from "../roundtable";
import type {MemberCardTarget} from "../member-card";
import type {ForegroundNotice} from "../member-notifications";
import type {Installs, SettingsTab, ThemeChoice} from "../settings";
import type {MenuState} from "../interactions";
import type {TerminalRequest} from "../workspace-terminal";
import {EMPTY_SNAPSHOT} from "./snapshot";

export interface AppState {
  snapshot: Snapshot;
  memberStop: {memberId:string;token:string;runs:{runId:string;title:string;location:string;projectName?:string}[]} | undefined;
  memberStopping: boolean;
  memberStopError: string;
  loaded: boolean;
  backendMessage: string;
  projectId: string;
  sessionId: string;
  sidebarTab: 'work' | 'files';
  terminalShown: boolean;
  terminalRequest: TerminalRequest | undefined;
  modal: 'project' | 'session' | 'settings' | 'collaboration' | 'invite' | null;
  hierarchy: {mode:'child'|'move';target:Project} | undefined;
  collapsedProjects: Set<string>;
  quotaOpen: boolean;
  activityOpen: boolean;
  automationOpen: boolean;
  settingsTab: SettingsTab;
  settingsEditing: string | null;
  settingsFocus: string | null;
  view: 'work' | 'room' | 'project' | 'desk' | 'reports' | 'roundtable';
  deskMemberId: string;
  reportMemberId: string;
  reportRosterState: {projectId:string;members:MemberReportPage['members']};
  roomFocus: RoomFocus | undefined;
  searchCurrent: ConversationTarget | undefined;
  searchFocus: ConversationFocus | undefined;
  roundtableRequest: RoundtableRequest | undefined;
  inviteProject: string | undefined;
  toast: {id:number;text:string;error?:boolean} | null;
  memberToasts: ForegroundNotice[];
  probing: boolean;
  restarting: boolean;
  installs: Installs;
  theme: ThemeChoice;
  menu: MenuState;
  renaming: {kind:'session'|'project';id:string;value:string} | null;
  confirm: {kind:'delete-session'|'remove-project'|'discard';id:string;discard:boolean;deleteFiles?:boolean} | null;
  switcher: boolean;
  memberCard: MemberCardTarget | null;
}
type Update<K extends keyof AppState> = (value:SetStateAction<AppState[K]>)=>void;
type AppActions = {
  setSnapshot:Update<'snapshot'>;
  setMemberStop:Update<'memberStop'>;
  setMemberStopping:Update<'memberStopping'>;
  setMemberStopError:Update<'memberStopError'>;
  setLoaded:Update<'loaded'>;
  setBackendMessage:Update<'backendMessage'>;
  setProjectId:Update<'projectId'>;
  setSessionId:Update<'sessionId'>;
  setSidebarTab:Update<'sidebarTab'>;
  setTerminalShown:Update<'terminalShown'>;
  setTerminalRequest:Update<'terminalRequest'>;
  setModal:Update<'modal'>;
  setHierarchy:Update<'hierarchy'>;
  setCollapsedProjects:Update<'collapsedProjects'>;
  setQuotaOpen:Update<'quotaOpen'>;
  setActivityOpen:Update<'activityOpen'>;
  setAutomationOpen:Update<'automationOpen'>;
  setSettingsTab:Update<'settingsTab'>;
  setSettingsEditing:Update<'settingsEditing'>;
  setSettingsFocus:Update<'settingsFocus'>;
  setView:Update<'view'>;
  setDeskMemberId:Update<'deskMemberId'>;
  setReportMemberId:Update<'reportMemberId'>;
  setReportRoster:Update<'reportRosterState'>;
  setRoomFocus:Update<'roomFocus'>;
  setSearchCurrent:Update<'searchCurrent'>;
  setSearchFocus:Update<'searchFocus'>;
  setRoundtableRequest:Update<'roundtableRequest'>;
  setInviteProject:Update<'inviteProject'>;
  setToast:Update<'toast'>;
  setMemberToasts:Update<'memberToasts'>;
  setProbing:Update<'probing'>;
  setRestarting:Update<'restarting'>;
  setInstalls:Update<'installs'>;
  setTheme:Update<'theme'>;
  setMenu:Update<'menu'>;
  setRenaming:Update<'renaming'>;
  setConfirm:Update<'confirm'>;
  setSwitcher:Update<'switcher'>;
  setMemberCard:Update<'memberCard'>;
};
type AppStore = AppState & {actions:AppActions};

function readPreference(key:string){try{return localStorage.getItem(key);}catch{return null;}}
function readTheme():ThemeChoice{const value=readPreference('hivelab.theme');return value==='light'||value==='dark'?value:'system';}
function readCollapsedProjects(){try{const ids=JSON.parse(readPreference('hivelab.project-tree.collapsed')??'[]');return new Set<string>(Array.isArray(ids)?ids.filter(id=>typeof id==='string').slice(0,5000):[]);}catch{return new Set<string>();}}

function navigationStorage(storage:StateStorage):StateStorage{
  let saved:string|undefined;
  return {
    getItem:key=>storage.getItem(key),
    removeItem:key=>{saved=undefined;return storage.removeItem(key);},
    // Streaming snapshots change often; unchanged navigation needs no disk write.
    setItem:(key,value)=>{if(value===saved)return;const result=storage.setItem(key,value);saved=value;return result;},
  };
}

/** Each window owns a store; backend snapshots and pending operations never enter localStorage. */
export function createAppStore(storage?:StateStorage){
  const initial:AppState={
    snapshot:EMPTY_SNAPSHOT,
    memberStop:undefined,
    memberStopping:false,
    memberStopError:'',
    loaded:false,
    backendMessage:'',
    projectId:'',
    sessionId:'',
    sidebarTab:readPreference('hivelab.sidebar.tab')==='files'?'files':'work',
    terminalShown:false,
    terminalRequest:undefined,
    modal:null,
    hierarchy:undefined,
    collapsedProjects:readCollapsedProjects(),
    quotaOpen:false,
    activityOpen:false,
    automationOpen:false,
    settingsTab:'members',
    settingsEditing:null,
    settingsFocus:null,
    view:'work',
    deskMemberId:'codex',
    reportMemberId:'codex',
    reportRosterState:{projectId:'',members:[]},
    roomFocus:undefined,
    searchCurrent:undefined,
    searchFocus:undefined,
    roundtableRequest:undefined,
    inviteProject:undefined,
    toast:null,
    memberToasts:[],
    probing:false,
    restarting:false,
    installs:{},
    theme:readTheme(),
    menu:null,
    renaming:null,
    confirm:null,
    switcher:false,
    memberCard:null,
  };
  return createStore<AppStore>()(devtools(persist((set)=>{
    const update=<K extends keyof AppState>(key:K):Update<K>=>value=>set(state=>{
      const next=typeof value==='function'?(value as (previous:AppState[K])=>AppState[K])(state[key]):value;
      return Object.is(next,state[key])?state:{...state,[key]:next};
    },false,`app/${key}`);
    return {...initial,actions:{
      setSnapshot:update('snapshot'),
      setMemberStop:update('memberStop'),
      setMemberStopping:update('memberStopping'),
      setMemberStopError:update('memberStopError'),
      setLoaded:update('loaded'),
      setBackendMessage:update('backendMessage'),
      setProjectId:update('projectId'),
      setSessionId:update('sessionId'),
      setSidebarTab:update('sidebarTab'),
      setTerminalShown:update('terminalShown'),
      setTerminalRequest:update('terminalRequest'),
      setModal:update('modal'),
      setHierarchy:update('hierarchy'),
      setCollapsedProjects:update('collapsedProjects'),
      setQuotaOpen:update('quotaOpen'),
      setActivityOpen:update('activityOpen'),
      setAutomationOpen:update('automationOpen'),
      setSettingsTab:update('settingsTab'),
      setSettingsEditing:update('settingsEditing'),
      setSettingsFocus:update('settingsFocus'),
      setView:update('view'),
      setDeskMemberId:update('deskMemberId'),
      setReportMemberId:update('reportMemberId'),
      setReportRoster:update('reportRosterState'),
      setRoomFocus:update('roomFocus'),
      setSearchCurrent:update('searchCurrent'),
      setSearchFocus:update('searchFocus'),
      setRoundtableRequest:update('roundtableRequest'),
      setInviteProject:update('inviteProject'),
      setToast:update('toast'),
      setMemberToasts:update('memberToasts'),
      setProbing:update('probing'),
      setRestarting:update('restarting'),
      setInstalls:update('installs'),
      setTheme:update('theme'),
      setMenu:update('menu'),
      setRenaming:update('renaming'),
      setConfirm:update('confirm'),
      setSwitcher:update('switcher'),
      setMemberCard:update('memberCard'),
    }};
  },{name:'hivelab.navigation',version:1,storage:createJSONStorage(()=>navigationStorage(storage??localStorage)),
    // 启动时总是打开主页（不保存 view，让它始终从 initial.view='work' 初始化）
    partialize:state=>({projectId:state.projectId,deskMemberId:state.deskMemberId,reportMemberId:state.reportMemberId})
  }),{name:'HiveLab App',enabled:process.env.NODE_ENV==='development'}));
}

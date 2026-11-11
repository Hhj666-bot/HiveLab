import type {MemberProfile} from '../../src/shared/types';
import {createRoot} from 'react-dom/client';
import {SettingsModal} from '../../src/renderer/settings';
import {TeamProvider,makeTeam} from '../../src/renderer/members';
import {DEFAULT_SETTINGS,DEFAULT_PROFILE} from '../../src/shared/defaults';
import {DEFAULT_DESK_FILES} from '../../src/shared/desk-files';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';
import '../../src/renderer/liquid-glass.css';
document.documentElement.dataset.liquidGlass='true';
const members:MemberProfile[]=[{id:'active',name:'现有人物',executor:'codex',color:'#579879'}],removedMembers:MemberProfile[]=[{id:'removed',name:'保留历史的人物',executor:'codex',color:'#7959a1'}];
const snapshot:any={members,removedMembers,settings:DEFAULT_SETTINGS,profile:DEFAULT_PROFILE,providers:[],executors:[],sessions:[],projects:[],runs:[],events:[],approvals:[],backendReady:true};
const usage={directory:'D:/HiveLab/local-data/data',measuredAt:'2026-11-06T03:00:00Z',total:12000000000,categories:{programs:3200000000,desks:2500000000,native:3700000000,database:68000000,attachments:31000000,media:446000000,runtime:311000000,temp:763000000,logs:142000000,backups:371000000,other:42000000},programs:[{id:'codex',name:'Codex',versions:[{version:'0.166.0',bytes:1000,inUse:true},{version:'0.160.0',bytes:2000}]}],desks:[{memberId:'removed',name:'保留历史的人物',removed:true,bytes:12000,folder:'D:/data/desks/removed',topics:[{id:'old-topic',title:'删除人物前的话题',messages:12,current:false,directory:'D:/工作文件',updatedAt:'2026-11-06T03:00:00Z'}]}],backups:[{name:'hivelab.sqlite.bak-test',bytes:4000}],logFiles:3,staleTemp:2,breakdown:{native:[{path:'native/claude',label:'Claude',bytes:3000000000,directory:true},{path:'native/acp',label:'ACP 连接（Gemini、Kimi 等）',bytes:700000000,directory:true}],media:[{path:'backgrounds',label:'壁纸与背景视频',bytes:400000000,directory:true,items:12},{path:'startup-media',label:'启动动画',bytes:46000000,directory:true,items:1}],runtime:[{path:'browsers',label:'内置浏览器',bytes:311000000,directory:true}],database:[{path:'hivelab.sqlite',label:'数据库主文件',bytes:68000000,directory:false}]}};
const calls:any[]=[];(window as any).settingsCalls=calls;
const invoke:any=async(method:string,params:any)=>{calls.push({method,params});if(method==='storage.usage')return usage;if(method==='storage.sweepTemp')return {removed:2,skipped:0,failed:0};if(method==='backup.list')return [];if(method==='deskFiles.preferences')return DEFAULT_DESK_FILES;if(method==='deskFiles.scan')return {groups:[{source:'session',rootId:'session:old-session',sessionId:'old-session',memberId:'removed',title:'在吗',directory:'D:/data/desks/removed/sessions/old-session',createdAt:'2026-11-05T00:00:00Z',updatedAt:'2026-11-05T00:00:00Z',archived:false,active:false,deleted:false,files:[],bytes:0}],recycle:[],preferences:DEFAULT_DESK_FILES};if(method==='settings.save')return params;return {};};
(window as any).hivelab={invoke,onEvent:()=>()=>{}};
function Fixture(){const tab=new URLSearchParams(location.search).get('tab')??'storage';return <TeamProvider value={makeTeam(members,removedMembers)}><SettingsModal snapshot={snapshot} invoke={invoke} notify={()=>{}} onClose={()=>{}} installs={{}} onInstall={()=>{}} theme="dark" onTheme={()=>{}} initialTab={tab as any} initialEditing={tab==='members'?'active':undefined}/></TeamProvider>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);

import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TokenActivityPanel} from '../../src/renderer/token-activity';
import {ApprovalCard} from '../../src/renderer/panels';
import {ExportAnswer,FileCards} from '../../src/renderer/file-output';
import {Markdown} from '../../src/renderer/Markdown';
import {PermissionModePicker} from '../../src/renderer/permission-mode';
import {permissionPreset} from '../../src/shared/permission-modes';
import {makeTeam,TeamProvider} from '../../src/renderer/members';
import {tokenActivity} from '../../src/shared/token-activity';
import type {Approval} from '../../src/shared/types';
import '../../src/renderer/styles.css';
import '../../src/renderer/team.css';
const calls:any[]=[];(window as any).testCalls=calls;let missing=false;(window as any).setMissing=(value:boolean)=>{missing=value;};
const members=[{id:'sol',name:'Sol',executor:'codex' as const,color:'#539879',motto:''},{id:'astra',name:'Astra',executor:'codex' as const,color:'#539879',motto:''}],team=makeTeam(members);
const stats=tokenActivity([],[],[],members,{now:'2026-10-18T05:00:00Z'});for(let i=320;i<365;i++)if(i%3){stats.days[i]={...stats.days[i],total:(i-300)*1000,input:(i-300)*900,output:(i-300)*100,cached:0,reasoning:null,runs:1,reportedRuns:1};stats.total+=stats.days[i].total!;stats.totalRuns++;stats.reportedRuns++;}
if(location.search.includes('large-tokens')){stats.days[364]={...stats.days[364],total:1234567890,input:1200000000,output:34567890,cached:123456,reasoning:2000,runs:1,reportedRuns:1};stats.total=1234567890;stats.reportedRuns=Math.max(1,stats.reportedRuns);}
stats.subscription=stats.total;stats.providers=[{provider:'codex',total:stats.total,subscription:stats.total}];for(const day of stats.days)day.subscription=day.total;
const invoke:any=async(method:string,params:any)=>{calls.push({method,params});if(method==='provider.tokenActivity')return missing?tokenActivity([],[],[],members,{now:'2026-10-18T05:00:00Z'}):stats;if(method==='file.outputs')return [{id:'file',name:'测试报告.pdf',format:'pdf',bytes:1024}];return {saved:true};};(window as any).hivelab={invoke};
function Fixture(){const [permission,setPermission]=useState(permissionPreset('request'));const approval={id:'question',runId:'r',sessionId:'s',provider:'codex',type:'question',title:'下一步怎么进行？',detail:'',createdAt:new Date().toISOString(),state:'pending',questions:[{id:'choice',question:'选择方案',options:[{label:'方案 A',description:'先完善界面'},{label:'方案 B',description:'先实现接口'}]},{id:'many',question:'选择导出格式',multiSelect:true,options:[{label:'PDF'},{label:'Word'}]}],options:[{id:'answer',label:'提交选择'},{id:'cancel',label:'取消'}]} as Approval;
return <TeamProvider value={team}><main style={{padding:24,maxWidth:960,margin:'auto'}}><TokenActivityPanel invoke={invoke}/><PermissionModePicker label="权限等级测试" value={permission} onChange={setPermission}/><ApprovalCard approval={approval} invoke={invoke} member={team.members[0]}/><Markdown text={'## 测试成果\n\n```python\nprint("你好")\n```'}/><ExportAnswer text={'# 测试成果\n正文'}/><FileCards runId="r" revision="ended" invoke={invoke}/></main></TeamProvider>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);

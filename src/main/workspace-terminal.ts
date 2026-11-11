import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {existsSync,statSync} from 'node:fs';
import type {IPty} from 'node-pty';
import type {TerminalInfo,TerminalRead} from '../shared/workspace-files';
type Session={info:TerminalInfo;pty:IPty;text:string;base:number};
/** Only an explicit terminal.open starts a shell. Each PTY retains a bounded scrollback while its panel is hidden. */
export class WorkspaceTerminals {
 private sessions=new Map<string,Session>();
 list(){return [...this.sessions.values()].map(s=>({...s.info}));}
 async open(rootId:string,directory:string,cols=100,rows=24){
  if(this.sessions.size>=6)throw Error('最多保留 6 个终端，请先关闭一个。');if(!statSync(directory).isDirectory())throw Error('终端工作文件夹不存在。');
  const {spawn}=await import('node-pty');
  if(this.sessions.size>=6)throw Error('最多保留 6 个终端，请先关闭一个。');
  const shell=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'):process.env.SHELL||'/bin/zsh';
  if(!existsSync(shell))throw Error('找不到本机终端程序。');
  const env={...process.env};for(const key of Object.keys(env))if(/^(?:ELECTRON_RUN_AS_NODE|PSModulePath$|HIVELAB_|CODEX_|CLAUDECODE|ANTHROPIC_|OPENAI_)/i.test(key))delete env[key];
  env.TERM='xterm-256color';env.COLORTERM='truecolor';
  const pty=spawn(shell,process.platform==='win32'?['-NoLogo','-NoProfile']:['-l'],{name:'xterm-256color',cwd:directory,cols:this.dimension(cols,100,500),rows:this.dimension(rows,24,200),env:env as Record<string,string>,useConpty:true});
  const info:TerminalInfo={id:randomUUID(),rootId,directory,title:process.platform==='win32'?'PowerShell':path.basename(shell),exited:false},session:Session={info,pty,text:'',base:0};this.sessions.set(info.id,session);
  pty.onData(data=>{session.text+=data;if(session.text.length>1024*1024){const drop=session.text.length-768*1024;session.text=session.text.slice(drop);session.base+=drop;}});
  pty.onExit(({exitCode})=>{session.info.exited=true;session.info.exitCode=exitCode;});return {...info};
 }
 private dimension(value:unknown,fallback:number,max:number){return typeof value==='number'&&Number.isInteger(value)?Math.max(2,Math.min(max,value)):fallback;}
 private get(id:string){const session=this.sessions.get(id);if(!session)throw Error('终端已关闭。');return session;}
 read(id:string,cursor=0):TerminalRead{const s=this.get(id),offset=Number.isSafeInteger(cursor)?cursor:0,reset=offset<s.base||offset>s.base+s.text.length;return {data:s.text.slice(Math.max(0,offset-s.base)),cursor:s.base+s.text.length,reset,exited:s.info.exited,exitCode:s.info.exitCode};}
 write(id:string,data:unknown){if(typeof data!=='string'||data.length>65536)throw Error('终端输入无效或过长。');const s=this.get(id);if(s.info.exited)throw Error('终端进程已退出，请新建终端。');s.pty.write(data);return {written:true};}
 resize(id:string,cols:number,rows:number){const s=this.get(id);if(!s.info.exited)s.pty.resize(this.dimension(cols,100,500),this.dimension(rows,24,200));return {resized:true};}
 close(id:string){const s=this.get(id);this.sessions.delete(id);if(!s.info.exited)try{s.pty.kill();}catch{}return {closed:true};}
 dispose(){for(const id of this.sessions.keys())this.close(id);}
}

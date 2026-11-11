import {t} from './i18n';
import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {LoaderCircle,Search,X} from 'lucide-react';
import type {ConversationFocus,ConversationMatch,ConversationSearchPage,ConversationTarget} from '../shared/conversation-search';
import type {Invoke} from './ui';
import {WorkspaceSearchPanel,WorkspaceDrawer} from './workspace-toolbar';
import {markedText} from './search-highlight';
import {plainText} from './Markdown';
import './conversation-search.css';

export const ConversationScope=createContext<{setCurrent:(target:ConversationTarget|undefined)=>void;focus?:ConversationFocus}|null>(null);

function resultExcerpt(text:string,query:string){const clean=plainText(text.replace(/^\s*`{3,}[^\n]*$/gm,''));return clean.toLowerCase().includes(query.toLowerCase())?clean:text;}

export function ConversationSearch({current,invoke,onOpen,onCancel}:{current?:ConversationTarget;invoke:Invoke;onOpen:(match:ConversationMatch,query:string,signal:AbortSignal)=>Promise<void>;onCancel:()=>void}){
  const [query,setQuery]=useState(''),[scope,setScope]=useState<'current'|'all'>('current'),[page,setPage]=useState<ConversationSearchPage>(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState('');
  const drawer=useContext(WorkspaceDrawer),panel=useContext(WorkspaceSearchPanel),input=useRef<HTMLInputElement>(null),request=useRef(0),navigation=useRef<AbortController|undefined>(undefined);
  useEffect(()=>()=>{request.current++;navigation.current?.abort();onCancel();},[onCancel]);
  function cancel(){request.current++;navigation.current?.abort();setQuery('');setPage(undefined);setOpen(false);if(drawer?.active==='search')drawer.setActive(undefined);setBusy(false);setError('');setSelected('');onCancel();input.current?.focus();}
  async function search(more=false,nextScope=scope){
    const text=query.trim();if(!text||nextScope==='current'&&!current)return;
    const ticket=++request.current;setBusy(true);setError('');setOpen(true);drawer?.setActive('search');if(!more){navigation.current?.abort();onCancel();setSelected('');setPage(undefined);}
    try{
      const result=await invoke<ConversationSearchPage>('conversation.search',{query:text,scope:nextScope,...current,offset:more?page?.nextOffset??0:0},undefined,{background:true});
      if(ticket===request.current)setPage(previous=>more?{...result,matches:[...previous?.matches??[],...result.matches]}:result);
    }catch(e){if(ticket===request.current)setError((e as Error).message);}finally{if(ticket===request.current)setBusy(false);}
  }
  async function reveal(match:ConversationMatch){navigation.current?.abort();const controller=new AbortController();navigation.current=controller;setBusy(true);setError('');try{await onOpen(match,query.trim(),controller.signal);if(!controller.signal.aborted)setSelected(match.messageId);}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{if(!controller.signal.aborted)setBusy(false);}}
  return <div className="conversation-search" onKeyDown={event=>{if(event.key==='Escape'&&(open||query)){cancel();event.stopPropagation();}}}>
    <form role="search" aria-label={t("会话内容搜索")} onSubmit={event=>{event.preventDefault();void search();}}>
      <button type="submit" className="conversation-search-submit" aria-label={t("搜索会话")} title={t("搜索 · Enter")} disabled={busy||!query.trim()||scope==='current'&&!current}>{busy?<LoaderCircle size={14} className="spin"/>:<Search size={14}/>}</button>
      <input ref={input} type="search" aria-label={t("搜索会话文字")} maxLength={200} value={query} onChange={event=>{const value=event.target.value;if(!value){cancel();return;}request.current++;navigation.current?.abort();setQuery(value);setPage(undefined);setError('');setBusy(false);setSelected('');onCancel();}}/>
      {!!query&&<button type="button" className="conversation-search-clear" aria-label={t("取消搜索")} title={t("取消搜索")} onClick={cancel}><X size={13}/></button>}
      <button type="button" className="conversation-search-scope" aria-label={t("搜索范围：{0}，点击切换", scope==='current'?t("本对话"):t("全部"))} aria-pressed={scope==='all'} title={scope==='current'?t("切换到全部对话"):t("切换到本对话")} onClick={()=>{const next=scope==='current'?'all':'current';request.current++;navigation.current?.abort();setScope(next);setPage(undefined);setBusy(false);setError('');setSelected('');onCancel();if(query.trim())void search(false,next);}}>{scope==='current'?t("本对话"):t("全部")}</button>
    </form>
    {open&&(!drawer||drawer.active==='search')&&panel&&createPortal(<aside className="conversation-search-panel workspace-glass-drawer" aria-label={t("会话搜索侧栏")} onKeyDown={event=>{if(event.key==='Escape'){cancel();event.stopPropagation();}}}>
      <header className="conversation-search-heading"><div><strong>{t("搜索结果")}</strong><small role="status">{busy?t("正在查找…"):error?t("搜索未完成"):t("{0} · {1} 条匹配{2}", scope==='current'?t("本对话"):t("全部"), page?.matches.length??0, page?.hasMore?t("，还有更多"):'')}</small></div><button type="button" className="preview-icon-button" aria-label={t("关闭搜索侧栏")} title={t("取消搜索")} onClick={cancel}><X size={16}/></button></header>
      <div className="conversation-search-results" aria-label={t("会话搜索结果")} aria-busy={busy}>
        {error?<p role="alert">{error}</p>:page?.matches.length?<ol>{page.matches.map(match=><li key={match.messageId}><button type="button" className="conversation-search-match" aria-current={selected===match.messageId?'true':undefined} disabled={busy} onClick={()=>void reveal(match)}><small className="conversation-search-source">{match.roomTitle}</small><strong title={match.title}>{match.title}</strong><p>{markedText(resultExcerpt(match.excerpt,query.trim()),query.trim(),false)}</p><small>{match.author} · {new Date(match.at).toLocaleString('zh-CN',{hour12:false})}</small></button></li>)}</ol>:!busy&&<p>{page?t("没有找到匹配的聊天正文。"):t("输入关键词后按 Enter 搜索。")}</p>}
        {page?.hasMore&&<button type="button" className="conversation-search-more" disabled={busy} onClick={()=>void search(true)}>{t("加载更多")}</button>}
      </div>
    </aside>,panel)}
  </div>;
}

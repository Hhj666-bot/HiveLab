import {useContext,useMemo} from 'react';
import {SearchHighlight,HighlightText,markSyntax} from './search-highlight';
import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';
import typescript from 'highlight.js/lib/languages/typescript';
import rust from 'highlight.js/lib/languages/rust';
import './syntax-code.css';
hljs.registerLanguage('powershell',powershell);
hljs.registerLanguage('typescript',typescript);
hljs.registerLanguage('rust',rust);
const aliases:Record<string,string>={js:'javascript',jsx:'javascript',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'typescript',py:'python',pyw:'python',cs:'csharp',cc:'cpp',c:'cpp',h:'cpp',hpp:'cpp',kt:'kotlin',kts:'kotlin',rs:'rust',sh:'bash',ps1:'powershell',yml:'yaml',html:'xml',htm:'xml',svg:'xml',md:'markdown',mdx:'markdown',jsonl:'json',txt:'plaintext',log:'plaintext'};

export function SyntaxCode({text,language='',lineNumbers=false}:{text:string;language?:string;lineNumbers?:boolean}){
 const lang=aliases[language.toLowerCase()]??language.toLowerCase();
 const html=useMemo(()=>hljs.getLanguage(lang)?hljs.highlight(text,{language:lang,ignoreIllegals:true}).value:undefined,[text,lang]);
 const query=useContext(SearchHighlight),marked=useMemo(()=>html===undefined?undefined:markSyntax(html,query),[html,query]);
 return <div className="syntax-code" data-language={lang||'plaintext'}>{lineNumbers&&<pre className="syntax-line-numbers" aria-hidden="true">{Array.from({length:text.split('\n').length},(_,index)=>index+1).join('\n')}</pre>}<pre className="syntax-source"><code className="hljs" {...(marked!==undefined?{dangerouslySetInnerHTML:{__html:marked}}:{children:<HighlightText text={text}/>})}/></pre></div>;
}

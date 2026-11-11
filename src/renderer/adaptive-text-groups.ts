export type TextGroup={anchor:HTMLElement;kind:string;roots:HTMLElement[];probes:HTMLElement[]};
/** Semantic identities survive entry animations, title wrapping and portal moves. */
export function textGroupCacheKey(group:TextGroup){
 const node=group.anchor,kind=group.kind;
 if(kind==='toolbar-control')return kind+':'+(node.getAttribute('aria-label')??node.getAttribute('title')??node.className);
 if(kind==='toolbar')return kind+':'+(node.matches('.room-title')?'title':node.matches('.room-topic-bar')?'topic':'workspace');
 if(kind==='toolbar-actions')return kind;
 if(kind==='toolbar-leading')return kind;
 if(kind==='home-actions')return kind;
 if(kind==='home-names')return kind;
 if(kind==='topic-controls')return kind+':'+(node.querySelector('select')?.getAttribute('aria-label')??'tools');
 if(kind==='review-control')return kind;
 if(kind==='sidebar-label')return kind+':'+(node.firstElementChild?.textContent??node.textContent??'').trim().slice(0,120);
 if(['brand','tabs','people','navigation','projects','footer','files','sidebar-label'].includes(kind))return kind+':'+node.className;
 const classes=[...node.classList].filter(name=>!['enter','selected','active','open','focused'].includes(name)).join('.'),message=node.closest<HTMLElement>('[data-message-id]');
 if(node.closest('.standee-home-footer'))return [kind,'home-footer',node.tagName,classes,node.getAttribute('aria-label')??''].join(':');
 if(node.matches('.attention-bubble-number'))return kind+':attention-count';
 if(message)return [kind,message.dataset.messageId,node.tagName,classes,...(kind==='code'?[[...message.querySelectorAll('.md-code')].indexOf(node)]:[])].join(':').slice(0,512);
 if(kind==='panel')return kind+':'+[...node.classList].filter(name=>!['enter','open','closing','selected','active','focused'].includes(name)).join('.');
 if(node.matches('.composer,.room-empty,.preview-panel-header,.preview-tabs,.browser-panel-heading,.browser-navigation,.workspace-terminal,.workspace-glass-drawer,.workspace-code-editor,.preview-content-code'))return kind+':'+classes;
 const r=node.getBoundingClientRect();
 return [kind,node.tagName,classes,Math.round(r.x/32),Math.round(r.y/32)].join(':').slice(0,512);
}
/** The same group anywhere on the page: what a list row or label learned elsewhere is a good first guess. */
export function textGroupLooseKey(group:TextGroup){
 const node=group.anchor,classes=[...node.classList].filter(name=>!['enter','selected','active','open','focused'].includes(name)).join('.');
 return ('~'+[group.kind,node.tagName,classes,node.closest('[data-message-id]')?'message':''].join(':')).slice(0,512);
}
const PRESERVE='script,style,option,svg,canvas,pre,.syntax-code,.word-layout-preview,.docx-wrapper,.panel-image-preview,.terminal-screen,#hivelab-startup';
/** A sidebar page turning in counts by where it lands, so its colours arrive with it. */
export function visibleTextElement(node:HTMLElement){if(node.closest('[data-motion-resting]'))return false;const r=node.getBoundingClientRect();return r.width>6&&r.height>6&&r.bottom>0&&r.top<innerHeight&&(!!node.closest('.sidebar-page.current')||r.right>0&&r.left<innerWidth)&&getComputedStyle(node).visibility==='visible';}
/** Group shared surfaces first, then cover remaining DOM text automatically.
 * New labels therefore participate without needing another CSS-name whitelist. */
export function collectTextGroups(scope:ParentNode=document):TextGroup[]{
 const groups:TextGroup[]=[],covered=new Set<HTMLElement>();
 function add(anchor:HTMLElement,kind:string,roots:HTMLElement[],probes:HTMLElement[]){
  roots=roots.filter(visibleTextElement);if(!roots.length)return;
  probes=probes.filter(visibleTextElement);groups.push({anchor,kind,roots,probes:probes.length?probes:roots});roots.forEach(root=>covered.add(root));
 }
 // A scoped pass (the sidebar or a panel while it moves) must count the scope itself: querySelectorAll leaves it out, and
 // the sidebar's own groups (brand, people, navigation…) would then fall apart into loose text that starts in the wrong ink.
 const nodes=(root:ParentNode,selector:string)=>[...(root!==scope||!(root instanceof HTMLElement)||!root.matches(selector)?[]:[root]),...root.querySelectorAll<HTMLElement>(selector)];
 // Floating menus have their own backing, even when nested in a tinted reply
 // or composer. Sample them before their host so they keep a matching ink.
 for(const preview of nodes(scope,'.chat-preview-reply,.chat-preview-mine,.chat-preview-input'))add(preview,'content',[preview],[preview]);
 for(const panel of nodes(scope,'.context-menu,.model-popover,.select-popover,.workspace-menu-content,.answer-export-menu,.reaction-picker,.room-mentions,.topic-panel,.workspace-glass-drawer,.modal,[role=menu]'))add(panel,'panel',[panel],[panel]);
 for(const root of nodes(scope,'.answer-export'))add(root,'answer-actions',[root],nodes(root,':scope>.md-code-bar>details>summary,:scope>.md-code-bar>button,.reaction-add,.room-reply-button'));
 for(const root of nodes(scope,'.preview-workspace-leading-tools,.standee-home-header:not(.standee-header-in-toolbar)')){const labels=nodes(root,'.home-toolbar-greeting,.workspace-page-title');add(root,'toolbar-leading',labels,labels);}
 for(const root of nodes(scope,'.home-toolbar-actions'))add(root,'home-actions',[root],nodes(root,'button'));
 for(const root of nodes(scope,'.standee-cast')){const names=nodes(root,'.standee-name');add(root,'home-names',names,names);}
 for(const root of nodes(scope,'.room-title'))add(root,'toolbar',[root],[root]);
 for(const root of nodes(scope,'.room-topic-bar'))add(root,'topic-controls',[root],nodes(root,'select,:scope>button'));
 for(const root of nodes(scope,'.project-review-level'))add(root,'review-control',[root],nodes(root,'select'));
 for(const root of nodes(scope,'.workspace-icon-actions'))add(root,'toolbar-actions',[root],nodes(root,':scope>button,:scope>.workspace-menu>summary'));
 // Topic controls and review settings keep one shared ink, including arrows.
 for(const root of nodes(scope,'.preview-workspace-primary>button,.preview-workspace-primary .workspace-menu>summary,.workspace-primary-page-tools :is(button,select),.conversation-search :is(button,input,select)'))if(!root.closest('.workspace-menu-content,.workspace-icon-actions,.room-topic-bar,.project-review-level'))add(root,'toolbar-control',[root],[root]);
 for(const root of nodes(scope,'.md-code,.preview-content-code,.workspace-code-editor')){const probes=nodes(root,'.md-code-bar,.syntax-line-numbers,textarea');add(root,'code',[root],probes.length?probes:[root]);}
 for(const root of nodes(scope,'.markdown blockquote,.md-table,.preview-markdown table'))add(root,'content',[root],[root]);
 for(const sidebar of nodes(scope,'.sidebar')){
  const app=sidebar.closest('.app-shell')??sidebar;
  for(const [selector,kind,probe] of [['.brand-text','brand',''],['.sidebar-workspace-tabs','tabs','button'],['.team-roster','people','.roster-text'],['.place-list','navigation','button'],['.project-list','projects','.list-row-main,.sidebar-empty'],['.sidebar-footer','footer','.backend-state,.sidebar-settings'],['.workspace-explorer','files','.explorer-root,.explorer-directory,.explorer-desk-scopes,.explorer-heading,.explorer-search,.explorer-row,.explorer-muted,.explorer-error,.explorer-desk-clean'],['.sidebar-section-label','sidebar-label','']] as const){
   for(const root of nodes(sidebar,selector))add(root,kind,[root],probe?nodes(root,probe):[root]);
  }
  for(const root of nodes(app,'.sidebar-edge-controls'))add(root,'navigation',[root],[root]);
 }
 function owned(node:HTMLElement){let current:HTMLElement|null=node;while(current){if(covered.has(current))return true;current=current.parentElement;}return false;}
 // Solid badges and primary actions keep their own foreground, even inside a
 // larger glass group whose other labels should all have one uniform colour.
 for(const node of nodes(scope,'.room-meta em,.button.primary,.room-send,.brand-subtitle-input'))add(node,'solid',[node],[node]);
 for(const node of nodes(scope,'.room-bubble,.answer-export,.approval-card,.run-activity,.generated-file-card,.attachment-chip,.composer.room-input,.room-meta,.room-empty,.context-menu,.model-popover,.modal,.preview-panel-header,.preview-tabs,.browser-panel-heading,.browser-navigation,.workspace-terminal,.workspace-glass-drawer'))if(!owned(node)){
  const kind=node.matches('.modal,.context-menu,.model-popover,.workspace-glass-drawer')?'panel':'content';
  const probes=kind==='panel'?nodes(node,'h1,h2,h3,p,legend,label,button,select'): [node];add(node,kind,[node],probes);
 }
 for(const node of nodes(scope,'input,textarea,select'))if(!owned(node)&&!node.closest(PRESERVE))add(node,'text',[node],[node]);
 const walker=document.createTreeWalker(scope===document?document.body:scope,NodeFilter.SHOW_TEXT);let text:Node|null,count=0;
 while((text=walker.nextNode())&&count++<12000){
  const parent=text.parentElement;if(!parent||!text.textContent?.trim()||parent.closest(PRESERVE)||owned(parent)||!visibleTextElement(parent))continue;
  add(parent,'text',[parent],[parent]);
 }
 return groups;
}

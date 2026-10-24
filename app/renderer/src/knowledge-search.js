import {Text} from '@codemirror/state';
import {SearchQuery,setSearchQuery,openSearchPanel,closeSearchPanel,findNext,findPrevious,replaceNext,replaceAll} from '@codemirror/search';

const paths={expand:'m9 5 7 7-7 7',up:'m6 15 6-6 6 6',down:'m6 9 6 6 6-6',close:'m6 6 12 12M6 18 18 6',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;

function renderedMatches(root,query) {
  const nodes=[],matches=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node,text='';
  while((node=walker.nextNode())) {
    if(node.parentElement.closest('button,script,style,svg,.katex-mathml,[hidden]'))continue;
    const collapsed=node.parentElement.closest('details:not([open])');if(collapsed&&!node.parentElement.closest('summary'))continue;
    const start=text.length;text+=node.nodeValue;nodes.push({node,start,end:text.length});
  }
  const cursor=query.getCursor(Text.of(text.split('\n')));
  for(let match=cursor.next();!match.done;match=cursor.next()) {
    const {from,to}=match.value;if(from===to)continue;
    const first=nodes.find(n=>n.end>from),last=nodes.find(n=>n.end>=to);if(!first||!last)continue;
    const range=document.createRange();range.setStart(first.node,from-first.start);range.setEnd(last.node,to-last.start);matches.push({from,to,range});
  }
  return matches;
}

// The controls belong to the workspace toolbar, not a modal or a CodeMirror
// panel. CodeMirror still owns editor matches, replacements and undo history.
export class KnowledgeFind {
  constructor(owner) {
    this.owner=owner;this.matches=[];this.index=-1;this.composing=false;
    this.highlightKey='kn-find-'+crypto.randomUUID();
    this.dom=document.createElement('div');this.dom.className='kn-find';this.dom.hidden=true;this.dom.id=this.highlightKey+'-panel';this.dom.setAttribute('role','search');this.dom.setAttribute('aria-label','查找当前笔记');
    this.dom.innerHTML=`<div class="kn-find-row">
      <button type="button" name="toggleReplace" aria-label="展开替换" aria-expanded="false" title="展开替换">${icon('expand')}</button>
      <div class="kn-find-field">${icon('search')}<input type="text" name="search" aria-label="查找当前笔记" placeholder="查找当前笔记" autocomplete="off" spellcheck="false"/>
        <button type="button" name="caseSensitive" aria-label="区分大小写" aria-pressed="false" title="区分大小写">Aa</button>
        <button type="button" name="wholeWord" aria-label="全词匹配" aria-pressed="false" title="全词匹配">ab</button>
        <button type="button" name="regexp" aria-label="正则表达式" aria-pressed="false" title="正则表达式">.*</button>
      </div>
      <output class="kn-find-count" aria-live="polite" aria-atomic="true"></output>
      <button type="button" name="previous" aria-label="上一处匹配" title="上一处匹配（Shift+Enter）">${icon('up')}</button>
      <button type="button" name="next" aria-label="下一处匹配" title="下一处匹配（Enter）">${icon('down')}</button>
      <button type="button" name="close" aria-label="关闭查找" title="关闭查找（Esc）">${icon('close')}</button>
    </div><div class="kn-replace-row" hidden>
      <input type="text" name="replace" aria-label="替换为" placeholder="替换为" autocomplete="off" spellcheck="false"/>
      <button type="button" name="replaceNext" title="替换当前匹配">替换</button><button type="button" name="replaceAll">全部替换</button>
    </div>`;
    this.input=this.dom.querySelector('[name=search]');this.replacement=this.dom.querySelector('[name=replace]');this.count=this.dom.querySelector('output');
    this.dom.addEventListener('compositionstart',()=>{this.composing=true;});
    this.dom.addEventListener('compositionend',()=>{this.composing=false;this.apply();});
    this.dom.addEventListener('input',()=>{if(!this.composing)this.apply();});
    this.dom.addEventListener('focusin',()=>{if(!this.active)this.apply(false);});
    this.dom.addEventListener('click',event=>{
      const name=event.target.closest('button')?.name;if(!name)return;
      if(['caseSensitive','wholeWord','regexp'].includes(name)) {
        const button=event.target.closest('button');button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed')!=='true'));this.apply();
      }else if(name==='toggleReplace') {
        const row=this.dom.querySelector('.kn-replace-row'),button=this.dom.querySelector('[name=toggleReplace]');row.hidden=!row.hidden;
        button.setAttribute('aria-expanded',String(!row.hidden));button.setAttribute('aria-label',row.hidden?'展开替换':'收起替换');button.title=row.hidden?'展开替换':'收起替换';
        if(!row.hidden){if(this.owner.mode==='preview')this.owner.options.onEditForSearch?.();this.replacement.focus();}
      }else if(name==='next'||name==='previous')this.move(name==='next'?1:-1);
      else if(name==='close')this.clear();
      else if(name==='replaceNext'||name==='replaceAll')this.replace(name==='replaceAll');
    });
    this.dom.addEventListener('keydown',event=>{
      if(event.isComposing||this.composing||event.keyCode===229)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.clear();}
      else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(event.target===this.replacement)this.replace(false);else this.move(event.shiftKey?-1:1);}
    });
    this.update();
  }
  attach() {
    const pane=this.owner.root.closest('.knowledge-pane'),mount=pane?.querySelector('.kn-find-mount');
    if(mount&&this.dom.parentElement!==mount)mount.replaceChildren(this.dom);
    const trigger=pane?.querySelector('[data-kn-action=find]');
    trigger?.setAttribute('aria-expanded',String(!this.dom.hidden));trigger?.setAttribute('aria-controls',this.dom.id);
  }
  query() {
    const enabled=name=>this.dom.querySelector(`[name=${name}]`).getAttribute('aria-pressed')==='true';
    return new SearchQuery({search:this.input.value,replace:this.replacement.value,caseSensitive:enabled('caseSensitive'),wholeWord:enabled('wholeWord'),regexp:enabled('regexp'),literal:true});
  }
  open() {
    this.dom.hidden=false;
    this.attach();
    const selected=this.owner.view.state.sliceDoc(this.owner.view.state.selection.main.from,this.owner.view.state.selection.main.to);
    if(selected&&!selected.includes('\n')&&selected.length<=200)this.input.value=selected;
    this.apply(false);this.input.focus({preventScroll:true});this.input.select();
  }
  apply(navigate=true) {
    this.active=true;const query=this.query(),view=this.owner.view;
    openSearchPanel(view);view.dispatch({effects:setSearchQuery.of(query)});
    this.update();
    if(navigate&&query.valid&&this.matches.length) {
      // Include a currently selected occurrence when updating the query.
      this.move(1,true);
    }
  }
  update(force=false) {
    const query=this.query(),owner=this.owner,view=owner.view;
    const cached=!force&&this.active&&this.cachedQuery?.eq(query)&&this.cachedDoc===view?.state.doc&&this.cachedMode===owner.mode&&this.cachedReading===owner.readHost.firstChild;
    if(!cached)this.matches=[];this.index=-1;
    if(query.valid&&view&&this.active) {
      if(owner.mode==='preview') {
        if(!cached)this.matches=renderedMatches(owner.readHost,query);
        this.index=Math.min(this.readIndex??0,this.matches.length-1);this.highlightReading();
      }else {
        if(!cached){const cursor=query.getCursor(view.state);
        for(let match=cursor.next();!match.done;match=cursor.next())this.matches.push(match.value);}
        const selection=view.state.selection.main;this.index=this.matches.findIndex(m=>m.from===selection.from&&m.to===selection.to);
        // Tables and other live widgets replace Markdown spans. Highlight their
        // visible text too, so a found table cell never looks like a blank hit.
        const widgets=[...owner.editHost.querySelectorAll('.kn-live-widget')].flatMap(el=>renderedMatches(el,query));
        this.setHighlights(widgets.map(m=>m.range));
      }
    }else this.clearHighlights();
    this.cachedDoc=view?.state.doc;this.cachedQuery=query;this.cachedMode=owner.mode;this.cachedReading=owner.readHost.firstChild;
    const invalid=Boolean(this.input.value&&!query.valid);
    this.input.setAttribute('aria-invalid',String(invalid));
    this.count.textContent=invalid?'无效正则':!this.input.value?'':!this.matches.length?'无结果':`${this.index<0?0:this.index+1}/${this.matches.length}`;
    this.count.title=invalid?'请检查正则表达式':this.matches.length?`共 ${this.matches.length} 处匹配`:'没有匹配结果';
    this.dom.dataset.empty=String(Boolean(this.input.value&&!this.matches.length));
    for(const name of ['previous','next','replaceNext','replaceAll'])this.dom.querySelector(`[name=${name}]`).disabled=!this.matches.length||invalid;
    this.dom.querySelector('[name=toggleReplace]').title=this.owner.mode==='preview'?'展开替换（切换到源码）':this.dom.querySelector('.kn-replace-row').hidden?'展开替换':'收起替换';
  }
  move(direction,includeCurrent=false) {
    if(!this.matches.length)return;
    if(this.owner.mode==='preview') {
      this.readIndex=includeCurrent?0:((this.index+direction+this.matches.length)%this.matches.length);this.index=this.readIndex;this.highlightReading();
      const range=this.matches[this.index].range;range.startContainer.parentElement.scrollIntoView({block:'center',behavior:'instant'});this.update();
    }else {
      const view=this.owner.view;
      if(includeCurrent) {
        const at=view.state.selection.main.from,next=this.matches.find(m=>m.from>=at)||this.matches[0];
        view.dispatch({selection:{anchor:next.from,head:next.to},effects:this.owner.searchScrollEffect(next.from)});
      }else (direction>0?findNext:findPrevious)(view);
      this.update();
    }
  }
  replace(all) {
    if(!this.matches.length||this.composing)return;
    // Replacements operate on Markdown and its single undo history. Reading
    // remains read-only until the user explicitly requests a replacement.
    if(this.owner.mode==='preview')this.owner.options.onEditForSearch?.();
    if(this.owner.mode==='preview')return;
    this.apply(false);(all?replaceAll:replaceNext)(this.owner.view);this.update();
  }
  highlightReading() {
    this.setHighlights(this.matches.map(m=>m.range),this.matches[this.index]?[this.matches[this.index].range]:[]);
  }
  setHighlights(ranges,active=[]) {
    if(!window.Highlight)return;
    CSS.highlights.set(this.highlightKey,new Highlight(...ranges));
    CSS.highlights.set(this.highlightKey+'-active',new Highlight(...active));
    if(!this.style) {this.style=document.createElement('style');this.style.textContent=`::highlight(${this.highlightKey}){background:var(--kn-find-match);color:var(--text)}::highlight(${this.highlightKey}-active){background:var(--kn-find-current);color:var(--text)}`;document.head.append(this.style);}
  }
  clearHighlights(){CSS.highlights?.delete(this.highlightKey);CSS.highlights?.delete(this.highlightKey+'-active');}
  clear() {
    this.active=false;this.dom.hidden=true;this.attach();this.input.value='';this.replacement.value='';this.readIndex=0;
    this.dom.querySelector('.kn-replace-row').hidden=true;const toggle=this.dom.querySelector('[name=toggleReplace]');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','展开替换');toggle.title='展开替换';
    this.owner.view.dispatch({effects:setSearchQuery.of(this.query())});closeSearchPanel(this.owner.view);this.update();
    if(this.owner.mode==='preview')this.owner.readHost.focus({preventScroll:true});else this.owner.view.focus();
  }
  destroy(){this.clearHighlights();this.style?.remove();this.dom.remove();}
}

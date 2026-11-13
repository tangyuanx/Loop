import {EditorSelection,StateField,Text} from '@codemirror/state';
import {Decoration,EditorView,ViewPlugin,WidgetType} from '@codemirror/view';
import {syntaxTree} from '@codemirror/language';
import {SearchQuery,setSearchQuery} from '@codemirror/search';

const paths={expand:'m9 5 7 7-7 7',up:'m6 15 6-6 6 6',down:'m6 9 6 6 6-6',close:'m6 6 12 12M6 18 18 6',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;

function matchesIn(query,doc) {
  if(!query?.valid)return [];
  const cursor=query.getCursor(doc),matches=[];
  for(let step=cursor.next();!step.done;step=cursor.next())matches.push(step.value);
  return matches;
}

function matchIndex(matches,{from,to}) {
  const index=firstMatch(matches,m=>m.from>=from);
  return matches[index]?.from===from&&matches[index].to===to?index:-1;
}

function firstMatch(matches,predicate) {
  let from=0,to=matches.length;
  while(from<to){
    const mid=(from+to)>>>1;
    if(predicate(matches[mid]))to=mid;else from=mid+1;
  }
  return from;
}

const sourceFind=StateField.define({
  create:()=>({query:null,matches:[]}),
  update(value,tr){
    let query=value.query;
    for(const effect of tr.effects)if(effect.is(setSearchQuery))query=effect.value;
    if(!tr.docChanged&&(query===value.query||query?.eq(value.query||{})))return value;
    return {query,matches:matchesIn(query,tr.state)};
  }
});

const matchMark=Decoration.mark({class:'cm-searchMatch'});
const currentMark=Decoration.mark({class:'cm-searchMatch cm-searchMatch-selected'});
class EmptyMatch extends WidgetType {
  constructor(current){super();this.current=current;}
  eq(other){return this.current===other.current;}
  toDOM(){
    const mark=document.createElement('span');
    mark.className=this.current?'cm-searchMatch cm-searchMatch-selected kn-find-empty':'cm-searchMatch kn-find-empty';
    mark.setAttribute('aria-hidden','true');return mark;
  }
}

export const knowledgeFindMarks=[sourceFind,ViewPlugin.fromClass(class {
  constructor(view){this.draw(view);}
  update(update){
    if(update.viewportChanged||update.selectionSet||update.state.field(sourceFind)!==update.startState.field(sourceFind))this.draw(update.view);
  }
  draw(view){
    const {matches}=view.state.field(sourceFind),selection=view.state.selection.main;
    const {from,to}=view.viewport,ranges=[];
    for(let i=firstMatch(matches,m=>m.to>=from);i<matches.length&&matches[i].from<=to;i++){
      const match=matches[i],current=match.from===selection.from&&match.to===selection.to;
      if(match.from===match.to)ranges.push(Decoration.widget({widget:new EmptyMatch(current),side:1}).range(match.from));
      else ranges.push((current?currentMark:matchMark).range(match.from,match.to));
    }
    this.decorations=Decoration.set(ranges,true);
  }
},{decorations:plugin=>plugin.decorations})];

function renderedMatches(root,query) {
  const nodes=[],matches=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
  let node,text='',block=null;
  while((node=walker.nextNode())){
    const parent=node.nodeType===Node.TEXT_NODE?node.parentElement:node;
    if(parent.closest('button,script,style,svg,.katex-mathml,.kn-table-cell-content,[hidden]'))continue;
    const collapsed=parent.closest('details:not([open])');if(collapsed&&!parent.closest('summary'))continue;
    if(node.nodeName==='BR'){text+='\n';continue;}
    if(node.nodeType!==Node.TEXT_NODE||!node.length)continue;
    const current=parent.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,pre,summary,blockquote,div');
    if(text&&current!==block)text+='\n';
    block=current;
    const start=text.length;text+=node.nodeValue;nodes.push({node,start,end:text.length});
  }
  let first=0,last=0;
  for(const {from,to} of matchesIn(query,Text.of(text.split('\n')))){
    if(from===to)continue;
    while(nodes[first]?.end<=from)first++;
    last=Math.max(last,first);
    while(nodes[last]?.end<to)last++;
    const start=nodes[first],end=nodes[last];
    if(!start||!end||from<start.start||to<=end.start)continue;
    const range=document.createRange();range.setStart(start.node,from-start.start);range.setEnd(end.node,to-end.start);matches.push({range});
  }
  return matches;
}

function revealRect(rect,element,body,tools) {
  if(!rect||!body?.clientHeight)return;
  let {left,right,top,bottom}=rect;
  for(let parent=element;parent&&parent!==body;parent=parent.parentElement){
    const style=getComputedStyle(parent);
    const x=parent.scrollWidth>parent.clientWidth&&/^(auto|scroll)$/.test(style.overflowX);
    const y=parent.scrollHeight>parent.clientHeight&&/^(auto|scroll)$/.test(style.overflowY);
    if(!x&&!y)continue;
    const box=parent.getBoundingClientRect();
    if(x){
      const before=parent.scrollLeft;
      parent.scrollLeft+=left<box.left?left-box.left:Math.max(0,right-box.left-parent.clientWidth);
      const moved=parent.scrollLeft-before;left-=moved;right-=moved;
    }
    if(y){
      const before=parent.scrollTop;
      parent.scrollTop+=top<box.top?top-box.top:Math.max(0,bottom-box.top-parent.clientHeight);
      const moved=parent.scrollTop-before;top-=moved;bottom-=moved;
    }
  }
  const box=body.getBoundingClientRect(),toolbar=tools?.getBoundingClientRect();
  const upper=toolbar&&left<toolbar.right&&right>toolbar.left?Math.max(box.top,toolbar.bottom+4):box.top;
  const lower=box.top+body.clientHeight;
  if(top<upper||bottom>lower)body.scrollTop+=(top+bottom-upper-lower)/2;
}

// The controls belong to the workspace toolbar, not a modal or a CodeMirror
// panel. CodeMirror's query cursor, editor positions and undo history are used
// directly so counts, marks and navigation can share the exact same matches.
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
    this.dom.addEventListener('compositionend',event=>{this.composing=false;if(event.target===this.input)this.apply();});
    this.input.addEventListener('input',()=>{if(!this.composing)this.apply();});
    this.dom.addEventListener('focusin',()=>{if(!this.active)this.apply(false);});
    this.dom.addEventListener('click',event=>{
      const name=event.target.closest('button')?.name;if(!name)return;
      if(['caseSensitive','wholeWord','regexp'].includes(name)) {
        const button=event.target.closest('button');button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed')!=='true'));this.apply();
      }else if(name==='toggleReplace') {
        const row=this.dom.querySelector('.kn-replace-row'),button=this.dom.querySelector('[name=toggleReplace]');row.hidden=!row.hidden;
        button.setAttribute('aria-expanded',String(!row.hidden));button.setAttribute('aria-label',row.hidden?'展开替换':'收起替换');button.title=row.hidden?'展开替换':'收起替换';
        if(!row.hidden){if(this.renderedRoot())this.owner.options.onEditForSearch?.();this.replacement.focus();}
      }else if(name==='next'||name==='previous')this.move(name==='next'?1:-1);
      else if(name==='close')this.clear();
      else if(name==='replaceNext'||name==='replaceAll')this.replace(name==='replaceAll');
    });
    this.dom.addEventListener('keydown',event=>{
      if(event.isComposing||this.composing||event.keyCode===229)return;
      if(event.key==='F3'||((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='g'&&!event.altKey)){
        event.preventDefault();event.stopPropagation();this.move(event.shiftKey?-1:1);
      }else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.clear();}
      else if(event.key==='Enter'&&(event.target===this.input||event.target===this.replacement)){
        event.preventDefault();event.stopPropagation();
        if(event.target===this.replacement)this.replace(false);else this.move(event.shiftKey?-1:1);
      }
    });
    this.update();
  }
  attach() {
    const pane=this.owner.root.closest('.knowledge-pane'),mount=pane?.querySelector('.kn-find-mount');
    if(mount&&this.dom.parentElement!==mount)mount.replaceChildren(this.dom);
    const trigger=pane?.querySelector('[data-kn-action=find]');
    trigger?.setAttribute('aria-expanded',String(!this.dom.hidden));trigger?.setAttribute('aria-controls',this.dom.id);
  }
  query(replace='') {
    const enabled=name=>this.dom.querySelector(`[name=${name}]`).getAttribute('aria-pressed')==='true';
    return new SearchQuery({search:this.input.value,replace,caseSensitive:enabled('caseSensitive'),wholeWord:enabled('wholeWord'),regexp:enabled('regexp'),literal:true});
  }
  renderedRoot() {
    return this.owner.mode==='preview'?this.owner.readHost:null;
  }
  open(query) {
    this.dom.hidden=false;
    this.attach();
    const root=this.renderedRoot(),selection=window.getSelection();
    const selected=query??(root?(root.contains(selection?.anchorNode)&&root.contains(selection?.focusNode)?selection.toString():'')
      : this.owner.view.state.sliceDoc(this.owner.view.state.selection.main.from,this.owner.view.state.selection.main.to));
    if(selected&&!selected.includes('\n')&&selected.length<=200)this.input.value=selected;
    this.apply(false);this.input.focus({preventScroll:true});this.input.select();
  }
  apply(navigate=true) {
    this.active=true;
    const query=this.query();
    if(!this.renderedRoot())this.syncQuery(query);
    this.update();
    if(navigate)this.move(1,true);
  }
  syncQuery(query=this.active&&!this.renderedRoot()?this.query():new SearchQuery({search:''})){
    const view=this.owner.view;
    if(!query.eq(view.state.field(sourceFind).query||{}))view.dispatch({effects:setSearchQuery.of(query)});
  }
  update(force=false) {
    const query=this.query(),view=this.owner.view,rendered=this.renderedRoot();
    if(!query.valid||!this.active){
      this.matches=[];this.index=-1;this.cachedReading=null;this.clearHighlights();
    }else if(rendered){
      const sameQuery=this.cachedReading?.query.eq(query);
      if(force||!sameQuery||this.cachedReading.firstChild!==rendered.firstChild){
        this.matches=renderedMatches(rendered,query);
        this.index=Math.min(sameQuery?Math.max(this.index,0):0,this.matches.length-1);
        this.cachedReading={query,firstChild:rendered.firstChild};
        this.highlightReading();
      }
    }else{
      this.cachedReading=null;
      this.matches=view.state.field(sourceFind).matches;
      this.index=matchIndex(this.matches,view.state.selection.main);
      if(this.owner.mode==='edit'&&this.matches.length)this.highlightWidgets(query);
      else this.clearHighlights();
    }
    const invalid=Boolean(this.input.value&&!query.valid);
    this.input.setAttribute('aria-invalid',String(invalid));
    this.count.textContent=invalid?'无效正则':!this.input.value?'':!this.matches.length?'无结果':`${this.index<0?0:this.index+1}/${this.matches.length}`;
    this.count.title=invalid?'请检查正则表达式':this.matches.length?`共 ${this.matches.length} 处匹配`:'没有匹配结果';
    this.dom.dataset.empty=String(Boolean(this.input.value&&!this.matches.length));
    for(const name of ['previous','next','replaceNext','replaceAll'])this.dom.querySelector(`[name=${name}]`).disabled=!this.matches.length||invalid;
    this.dom.querySelector('[name=toggleReplace]').title=rendered?'展开替换（切换到源码）':this.dom.querySelector('.kn-replace-row').hidden?'展开替换':'收起替换';
  }
  move(direction,includeCurrent=false) {
    if(!this.matches.length)return false;
    if(this.renderedRoot()) {
      this.index=includeCurrent?0:this.wrap(this.index+direction);
      this.highlightReading();this.update();this.reveal();
    }else {
      const {from,to}=this.owner.view.state.selection.main;
      const next=includeCurrent?firstMatch(this.matches,m=>m.from>=from)
        :this.index>=0?this.index+direction
        :direction>0?firstMatch(this.matches,m=>m.from>=to):firstMatch(this.matches,m=>m.to>from)-1;
      this.selectSource(this.matches[this.wrap(next)]);
    }
    return true;
  }
  step(direction){
    if(this.active)this.move(direction);
    else this.open();
    return true;
  }
  wrap(index){return (index+this.matches.length)%this.matches.length;}

  selectSource(match){
    const view=this.owner.view;
    view.dispatch({
      selection:{anchor:match.from,head:match.to},
      effects:EditorView.scrollIntoView(EditorSelection.cursor(match.from,1),{y:'center'}),
      userEvent:'select.search'
    });
    this.reveal();
  }

  reveal(){
    cancelAnimationFrame(this.revealFrame);
    this.revealFrame=requestAnimationFrame(()=>{
      const match=this.matches[this.index],owner=this.owner;
      if(!this.active||!match||!owner.root.isConnected)return;
      const pane=owner.root.closest('.knowledge-pane'),body=owner.root.closest('.knowledge-body');
      const tools=pane?.querySelector('.knowledge-note-actions');
      const range=match.range||this.widgetRanges?.get(match);
      if(range){
        const rect=[...range.getClientRects()].find(rect=>rect.width&&rect.height);
        revealRect(rect,range.startContainer.parentElement,body,tools);
      }else if(!this.renderedRoot()){
        const {view}=owner;
        const start=view.coordsAtPos(match.from,1),end=view.coordsAtPos(match.to,-1);
        if(start&&end&&Math.abs(start.top-end.top)<start.bottom-start.top){
          revealRect({...start,left:Math.min(start.left,end.left),right:Math.max(start.right,end.right)},view.contentDOM,body,tools);
        }else revealRect(start,view.contentDOM,body,tools);
      }
    });
  }

  highlightWidgets(query){
    this.widgetRanges=new Map();
    const owner=this.owner;
    const project=(element,from,to)=>{
      const matches=[];
      for(let i=firstMatch(this.matches,m=>m.from>=from);i<this.matches.length&&this.matches[i].from<to;i++){
        const match=this.matches[i];
        if(match.from<match.to&&match.to<=to)matches.push(match);
      }
      if(!matches.length)return;
      // Pair matches within the same source span, never across widget rows or
      // cells. Skip the projection if markup contributed a source-only match.
      const visible=renderedMatches(element,query);
      if(visible.length===matches.length)matches.forEach((match,i)=>this.widgetRanges.set(match,visible[i].range));
    };
    for(const widget of owner.editHost.querySelectorAll('.kn-live-widget')){
      const from=Number(widget.dataset.sourcePos),to=Number(widget.dataset.sourceTo);
      const first=firstMatch(this.matches,m=>m.from>=from);
      if(first===this.matches.length||this.matches[first].from>=to)continue;
      if(widget.classList.contains('kn-table-widget')){
        // GFM tables have one source line per rendered row, plus the delimiter
        // after the header. Only resolve cells in rows that contain a hit.
        const doc=owner.view.state.doc,header=doc.lineAt(from).number;
        const lines=new Set();
        for(let i=first;i<this.matches.length&&this.matches[i].from<to;i++)lines.add(doc.lineAt(this.matches[i].from).number-header);
        const table=widget.querySelector('table');
        for(const line of lines)for(const cell of (line===1?[]:table.rows[line===0?0:line-1]?.cells||[])){
          const row=cell.parentElement;
          const source=owner.tableCellRange(widget,row.rowIndex,cell.cellIndex);
          if(source)project(cell,source.from,source.to);
        }
      }else project(widget,from,to);
    }
    const current=this.widgetRanges.get(this.matches[this.index]);
    this.setHighlights(this.widgetRanges.values(),current?[current]:[]);
  }
  replace(all) {
    if(!this.matches.length||this.composing)return;
    // Replacements operate on Markdown and its single undo history. Reading
    // remains read-only until the user explicitly requests a replacement.
    if(this.renderedRoot())this.owner.options.onEditForSearch?.();
    if(this.renderedRoot())return;
    this.apply(false);
    const view=this.owner.view,state=view.state,query=this.query(this.replacement.value);
    if(state.readOnly||!this.matches.length)return;
    const engine=query.create();
    // A pipe in a replacement inside a table cell would split the cell and
    // silently drop the neighbouring value, so escape it for table matches.
    const change=match=>{
      let insert=engine.getReplacement(match);
      if(insert.includes('|')){
        let node=syntaxTree(state).resolveInner(match.from,1);
        for(;node;node=node.parent)if(node.name==='Table'){
          insert=insert.replace(/(?<!\\)\|/g,'\\|');break;
        }
      }
      return {from:match.from,to:match.to,insert};
    };
    if(all){
      const changes=this.matches.filter(m=>m.precise).map(change);
      if(changes.length)view.dispatch({changes,userEvent:'input.replace.all'});
      return;
    }
    const current=this.matches[this.index],selection=state.selection.main;
    const start=current?this.index:firstMatch(this.matches,m=>m.from>=selection.from);
    const match=this.preciseFrom(start);
    if(!match)return;
    if(match!==current){this.selectSource(match);return;}
    const changes=state.changes(change(match)),next=this.preciseFrom(start+1,this.matches.length-1);
    const target=next?EditorSelection.range(next.from,next.to).map(changes):null;
    view.dispatch({changes,selection:target?EditorSelection.create([target]):undefined,
      effects:target?EditorView.scrollIntoView(EditorSelection.cursor(target.from,1),{y:'center'}):[],
      userEvent:'input.replace'});
    if(target)this.reveal();
  }
  preciseFrom(start,limit=this.matches.length){
    for(let i=0;i<limit;i++){
      const match=this.matches[this.wrap(start+i)];
      if(match.precise)return match;
    }
    return null;
  }
  highlightReading() {
    this.setHighlights(this.matches.map(m=>m.range),this.matches[this.index]?[this.matches[this.index].range]:[]);
  }
  setHighlights(ranges,active=[]) {
    if(!window.Highlight)return;
    const ordinary=new Highlight(),current=new Highlight();
    for(const range of ranges)ordinary.add(range);
    for(const range of active)current.add(range);
    current.priority=1;
    CSS.highlights.set(this.highlightKey,ordinary);
    CSS.highlights.set(this.highlightKey+'-active',current);
    if(!this.style) {this.style=document.createElement('style');this.style.textContent=`::highlight(${this.highlightKey}){background:var(--kn-find-match);color:var(--text)}::highlight(${this.highlightKey}-active){background:var(--kn-find-current);color:var(--text)}`;document.head.append(this.style);}
  }
  clearHighlights(){this.widgetRanges=null;CSS.highlights?.delete(this.highlightKey);CSS.highlights?.delete(this.highlightKey+'-active');}
  clear() {
    this.active=false;this.dom.hidden=true;this.attach();this.input.value='';this.replacement.value='';this.composing=false;
    this.dom.querySelector('.kn-replace-row').hidden=true;const toggle=this.dom.querySelector('[name=toggleReplace]');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','展开替换');toggle.title='展开替换';
    cancelAnimationFrame(this.revealFrame);this.syncQuery();this.update();
    const rendered=this.renderedRoot();
    if(rendered)rendered.focus({preventScroll:true});else this.owner.view.focus();
  }
  destroy(){cancelAnimationFrame(this.revealFrame);this.clearHighlights();this.style?.remove();this.dom.remove();}
}

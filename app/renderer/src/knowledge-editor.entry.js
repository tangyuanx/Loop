import {EditorState,StateField,StateEffect,Compartment,Prec,Transaction} from '@codemirror/state';
import {EditorView,keymap,Decoration,WidgetType,ViewPlugin,drawSelection,highlightActiveLine,rectangularSelection,crosshairCursor,lineNumbers} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,indentWithTab,indentMore,indentLess,undo,redo} from '@codemirror/commands';
import {markdown,markdownLanguage,insertNewlineContinueMarkupCommand,deleteMarkupBackward} from '@codemirror/lang-markdown';
import {yamlFrontmatter} from '@codemirror/lang-yaml';
import {languages} from '@codemirror/language-data';
import {syntaxTree,syntaxHighlighting,HighlightStyle,foldGutter,foldKeymap,indentUnit,bracketMatching,foldService} from '@codemirror/language';
import {closeBrackets,closeBracketsKeymap,autocompletion,completionKeymap} from '@codemirror/autocomplete';
import {searchKeymap,highlightSelectionMatches,openSearchPanel,search} from '@codemirror/search';
import {tags} from '@lezer/highlight';
import {obsidianComments} from './knowledge-syntax.js';
import {createRenderer,safeURL,escape} from './knowledge-renderer.js';
const core=window.LoopKnowledgeCore;
const viewportEffect=StateEffect.define(),refreshEffect=StateEffect.define();
const instances=new WeakMap();
const loopHighlight=HighlightStyle.define([
  {tag:tags.heading,color:'var(--text)',fontWeight:'600'},
  {tag:tags.strong,fontWeight:'600'},{tag:tags.emphasis,fontStyle:'italic'},
  {tag:tags.strikethrough,textDecoration:'line-through'},
  {tag:tags.link,color:'var(--green)',textDecoration:'underline'},
  {tag:tags.url,color:'var(--secondary)'},{tag:tags.meta,color:'var(--secondary)'},
  {tag:tags.comment,color:'var(--kn-code-comment)'},
  {tag:tags.keyword,color:'var(--kn-code-keyword)'},
  {tag:tags.string,color:'var(--kn-code-string)'},
  {tag:[tags.number,tags.bool,tags.null],color:'var(--kn-code-number)'},
  {tag:[tags.typeName,tags.className,tags.function(tags.variableName)],color:'var(--kn-code-name)'},
]);


class RenderWidget extends WidgetType {
  constructor(html,owner,from,kind='block') { super(); Object.assign(this,{html,owner,from,kind}); }
  eq(other) { return this.html===other.html && this.from===other.from && this.kind===other.kind; }
  toDOM(view) {
    const el=document.createElement(this.kind==='block'?'div':'span');
    el.className='kn-live-widget kn-rendered'; el.dataset.sourcePos=String(this.from); el.innerHTML=this.html;
    el.addEventListener('mousedown',event=>{
      if(event.target.closest('button,a,input')) return;
      event.preventDefault(); let pos=Number(el.dataset.sourcePos);
      const cell=event.target.closest('td,th');
      if(cell) {
        const table=core.tableAt(view.state.doc.toString(),pos);
        if(table){const row=cell.parentElement.rowIndex,sourceRow=row===0?0:row+1;this.owner.tableColumn=cell.cellIndex;pos=table.from+view.state.doc.sliceString(table.from,table.to).split('\n').slice(0,sourceRow).reduce((sum,line)=>sum+line.length+1,0)+2;}
      }
      view.dispatch({selection:{anchor:pos},scrollIntoView:false}); view.focus();
    });
    el.addEventListener('click',event=>this.owner.handleRenderedClick(event,this.from));
    this.owner.renderer.enhance(el,()=>view.requestMeasure());
    return el;
  }
  ignoreEvent(event) { return event.type !== 'mousedown'; }
}
class TaskWidget extends WidgetType {
  constructor(checked,pos) { super(); this.checked=checked; this.pos=pos; }
  eq(other) {return this.checked===other.checked&&this.pos===other.pos;}
  toDOM(view) {
    const box=document.createElement('input'); box.type='checkbox'; box.checked=this.checked; box.className='kn-task-box';box.setAttribute('aria-label','切换任务完成状态');
    box.addEventListener('mousedown',event=>event.preventDefault());
    box.addEventListener('click',event=>{event.stopPropagation();view.dispatch({changes:{from:this.pos,to:this.pos+1,insert:this.checked?' ':'x'},userEvent:'input'});});
    return box;
  }
  ignoreEvent(){return true;}
}
function selected(state,from,to) {return state.selection.ranges.some(r=>r.from<=to && r.to>=from);}

class KnowledgeEditor {
  constructor(options) {
    this.options=options; this.root=options.root; this.mode=options.mode||'edit';this.destroyed=false;this.uploads=new Map();this.nextUpload=0;
    this.range={from:0,to:8000};this.renderCache=new Map();this.lineConfig=new Compartment();
    this.renderer=createRenderer(options); this.root.replaceChildren();this.root.classList.add('kn-editor-host');
    this.editHost=document.createElement('div');this.editHost.className='kn-edit-surface';this.root.append(this.editHost);
    this.readHost=document.createElement('article');this.readHost.className='kn-reading kn-rendered';this.readHost.tabIndex=0;this.readHost.setAttribute('aria-label','阅读笔记');this.root.append(this.readHost);
    this.statusHost=document.createElement('div');this.statusHost.className='kn-upload-status';this.statusHost.setAttribute('role','status');this.root.append(this.statusHost);
    this.readHost.addEventListener('click',event=>this.handleRenderedClick(event,0));
    this.decorations=StateField.define({create:state=>this.buildDecorations(state),update:(decos,tr)=>{
      for(const effect of tr.effects) if(effect.is(viewportEffect)) this.range=effect.value;
      if(tr.docChanged||tr.selection||tr.effects.some(e=>e.is(viewportEffect)||e.is(refreshEffect))) return this.buildDecorations(tr.state);
      return decos.map(tr.changes);
    },provide:field=>EditorView.decorations.from(field)});
    this.view=new EditorView({parent:this.editHost,state:EditorState.create({doc:options.sourceMarkdown ?? options.markdown ?? '',extensions:[
      history(),drawSelection(),rectangularSelection(),crosshairCursor(),EditorView.lineWrapping,
      yamlFrontmatter({content:markdown({base:markdownLanguage,codeLanguages:languages,addKeymap:false,completeHTMLTags:false,extensions:[obsidianComments]})}),
      syntaxHighlighting(loopHighlight),indentUnit.of('    '),bracketMatching(),closeBrackets(),
      markdownLanguage.data.of({closeBrackets:{brackets:['(','[','{',"'",'"','`','*','~']}}),
      foldGutter(),foldService.of((state,start,end)=>{
        const line=state.doc.lineAt(start); if(!/^\s*(?:[-+*]|\d+[.)])\s/.test(line.text)) return null;
        const indent=line.text.match(/^\s*/)[0].length; let last=line.to;
        for(let n=line.number+1;n<=state.doc.lines;n++){const next=state.doc.line(n);if(next.text.trim() && next.text.match(/^\s*/)[0].length<=indent)break;last=next.to;}
        return last>end?{from:end,to:last}:null;
      }),
      search({top:true,caseSensitive:false}),highlightSelectionMatches(),
      autocompletion({override:[context=>this.complete(context)]}),
      Prec.high(keymap.of([
        {key:'Mod-b',run:()=>this.format('bold')},{key:'Mod-i',run:()=>this.format('italic')},
        {key:'Mod-k',run:()=>this.format('link','https://')},{key:'Mod-e',run:()=>{options.onToggleMode?.();return true;}},
        {key:'Mod-s',run:()=>{options.onSave?.();return true;}},
        {key:'Enter',run:insertNewlineContinueMarkupCommand({nonTightLists:false})},
        {key:'Backspace',run:deleteMarkupBackward},
        {key:'Tab',run:indentMore},{key:'Shift-Tab',run:indentLess},
      ])),keymap.of([...closeBracketsKeymap,...completionKeymap,...historyKeymap,...searchKeymap,...foldKeymap,...defaultKeymap,indentWithTab]),
      this.decorations,this.lineConfig.of(this.mode==='source'?[lineNumbers(),highlightActiveLine()]:[]),
      EditorView.contentAttributes.of({'aria-label':'Markdown 内容',spellcheck:'false'}),
      EditorView.updateListener.of(update=>this.onUpdate(update)),
      EditorView.domEventHandlers({paste:(event)=>this.paste(event),drop:(event,view)=>this.drop(event,view),dragover:event=>{
        if([...event.dataTransfer?.items||[]].some(i=>i.type.startsWith('image/'))) {event.preventDefault();return true;} return false;
      },mousedown:(event,view)=>{
        if((event.ctrlKey||event.metaKey)&&event.button===0) {
          const pos=view.posAtCoords({x:event.clientX,y:event.clientY});
          const link=core.links(view.state.doc.toString()).find(l=>pos>=l.from&&pos<=l.to);
          if(link){options.onOpenLink?.(link);event.preventDefault();return true;}
          let node=pos==null?null:syntaxTree(view.state).resolveInner(pos,-1);
          while(node && node.name!=='Link')node=node.parent;
          if(node){const raw=view.state.doc.sliceString(node.from,node.to),match=/\]\(([^)]+)\)/.exec(raw);if(match){const url=match[1].replace(/^<|>$/g,'');if(/^(https?:|mailto:)/i.test(url))options.onExternalLink?.(url);else options.onRelativeLink?.(url);event.preventDefault();return true;}}
        }
        return false;
      }}),
      ViewPlugin.fromClass(class {
        constructor(view){this.frame=0;this.queue(view);}
        queue(view){cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>{
          if(!view.dom.isConnected)return;const from=Math.max(0,view.viewport.from-2000),to=Math.min(view.state.doc.length,view.viewport.to+2000);
          view.dispatch({effects:viewportEffect.of({from,to})});
        });}
        update(update){if(update.viewportChanged||update.geometryChanged)this.queue(update.view);}
        destroy(){cancelAnimationFrame(this.frame);}
      }),
    ]})});
    this.setMode(this.mode);instances.set(options.root,this);
  }
  buildDecorations(state) {
    if(this.mode!=='edit')return Decoration.none;
    const ranges=[]; const add=(from,to,deco)=>{if(to>=from)ranges.push(deco.range(from,to));};
    const {from,to}=this.range;
    const source=()=>state.doc.toString();
    const widget=(node,inline=false)=>{
      const text=state.doc.sliceString(node.from,node.to),key=node.name+':'+text;
      let html=this.renderCache.get(key);if(!html){html=this.renderer.render(text,{noteId:this.options.noteId,stack:[this.options.noteId]});if(this.renderCache.size>160)this.renderCache.clear();this.renderCache.set(key,html);}
      add(node.from,node.to,Decoration.replace({widget:new RenderWidget(html,this,node.from,inline?'inline':'block'),block:!inline,inclusive:false}));
    };
    syntaxTree(state).iterate({from,to,enter:node=>{
      if(node.to<from||node.from>to)return false;
      const active=selected(state,node.from,node.to);
      if(!active && (node.name==='ObsidianComment'||node.name==='ObsidianCommentBlock'||(node.name==='HTMLBlock'&&state.doc.sliceString(node.from,node.from+4)==='<!--'))) {
        add(node.from,node.to,Decoration.replace({block:node.name!=='ObsidianComment',inclusive:false}));return false;
      }

      if(['FencedCode','Table','HorizontalRule','Frontmatter'].includes(node.name) && !active){widget(node);return false;}
      if(node.name==='Blockquote' && /^>\s*\[!/.test(state.doc.sliceString(node.from,Math.min(node.to,node.from+80))) && !active){widget(node);return false;}
      if(['Image'].includes(node.name) && !active){widget(node,true);return false;}
      if(/^(?:ATXHeading|SetextHeading)\d$/.test(node.name)) {
        const line=state.doc.lineAt(node.from);add(line.from,line.from,Decoration.line({class:'kn-heading kn-h'+node.name.slice(-1)}));
      }
      if(node.name==='StrongEmphasis')add(node.from,node.to,Decoration.mark({class:'kn-strong'}));
      if(node.name==='Emphasis')add(node.from,node.to,Decoration.mark({class:'kn-emphasis'}));
      if(node.name==='Strikethrough')add(node.from,node.to,Decoration.mark({class:'kn-strike'}));
      if(node.name==='InlineCode')add(node.from,node.to,Decoration.mark({class:'kn-inline-code'}));
      if(node.name==='Blockquote'){for(let n=state.doc.lineAt(node.from).number;n<=state.doc.lineAt(node.to).number;n++){const l=state.doc.line(n);add(l.from,l.from,Decoration.line({class:'kn-quote'}));}}
      if(/^(?:HeaderMark|EmphasisMark|CodeMark|StrikethroughMark|QuoteMark)$/.test(node.name)) {
        const parent=node.node.parent;
        if(parent&&!selected(state,parent.from,parent.to))add(node.from,node.to,Decoration.replace({inclusive:false}));
      }
      if(node.name==='Link' && !active) {
        const children=[];let child=node.node.firstChild;while(child){children.push(child);child=child.nextSibling;}
        const markers=children.filter(c=>c.name==='LinkMark'||c.name==='URL');
        for(const c of markers)add(c.from,c.to,Decoration.replace({inclusive:false}));
        add(node.from,node.to,Decoration.mark({class:'kn-external-link'}));
      }
      if(node.name==='TaskMarker'&&!active){const value=state.doc.sliceString(node.from,node.to);add(node.from,node.to,Decoration.replace({widget:new TaskWidget(/[xX]/.test(value),node.from+1),inclusive:false}));return false;}
    }});
    // Only scan the viewport's leaf text nodes. Code, escapes and comments are
    // excluded by the parser and the shared lexer before wiki/math decoration.
    syntaxTree(state).iterate({from,to,enter:node=>{
      if(/Code|HTML|Comment/.test(node.name))return false;
      if(!['Paragraph','ATXHeading1','ATXHeading2','ATXHeading3','ATXHeading4','ATXHeading5','ATXHeading6'].includes(node.name))return;
      if(node.node.parent?.name==='TableCell')return false;
      const text=state.doc.sliceString(node.from,node.to);
      for(const link of core.links(text)) {
        const a=node.from+link.from,b=node.from+link.to;
        if(selected(state,a,b))continue;
        const html=this.renderer.render(link.raw,{noteId:this.options.noteId,stack:[this.options.noteId]});
        // Avoid a paragraph wrapper inside an inline widget.
        add(a,b,Decoration.replace({widget:new RenderWidget(html.replace(/^<p>|<\/p>\n?$/g,''),this,a,'inline'),inclusive:false}));
      }
      const masks=core.excludedRanges(text);
      const pattern=/==([^=\n]+)==|(?<!\\)\$\$([\s\S]+?)\$\$|(?<![\\$])\$([^$\n]+)\$(?!\$)/g;let m;
      while((m=pattern.exec(text))){
        const a=node.from+m.index,b=a+m[0].length;
        if(masks.some(([x,y])=>m.index<y&&m.index+m[0].length>x))continue;
        if(selected(state,a,b))continue;
        if(m[1]){add(a,b,Decoration.mark({class:'kn-highlight'}));add(a,a+2,Decoration.replace({}));add(b-2,b,Decoration.replace({}));}
        else add(a,b,Decoration.replace({widget:new RenderWidget(this.renderer.render(m[0],{noteId:this.options.noteId}).replace(/^<p>|<\/p>\n?$/g,''),this,a,'inline'),inclusive:false}));
      }
      return false;
    }});
    // A widget can cover markers discovered elsewhere in the tree. Keep only
    // outermost replacements to keep CodeMirror's layout and selection valid.
    const replacements=ranges.filter(r=>r.value.spec.widget||r.value.spec.block).sort((a,b)=>a.from-b.from||b.to-a.to);
    const outer=[];for(const r of replacements)if(!outer.some(o=>r.from>=o.from&&r.from<o.to&&r.to<=o.to))outer.push(r);
    return Decoration.set(ranges.filter(r=>!replacements.includes(r)||outer.includes(r)).filter(r=>outer.includes(r)||!outer.some(o=>r.from>=o.from&&r.from<o.to&&r.to<=o.to)),true);
  }
  onUpdate(update) {
    if(update.docChanged){
      // Pending upload anchors are mapped through every transaction, including undo.
      for(const upload of this.uploads.values())upload.pos=update.changes.mapPos(upload.pos,1);
      this.options.onChange?.(update.state.doc.toString());
      if(this.mode==='preview')this.renderReading();
    }
    if(update.selectionSet)this.options.onSelectionChange?.();
  }
  complete(context) {
    const match=context.matchBefore(/\[\[[^\]\n]*$/);if(!match)return null;
    const state=context.state;
    const node=syntaxTree(state).resolveInner(match.from,-1);
    for(let n=node;n;n=n.parent)if(/Code|Comment|HTML/.test(n.name))return null;
    const prefix=state.doc.sliceString(Math.max(0,match.from-2000),context.pos);
    if(core.excludedRanges(prefix).some(([a,b])=>match.from-Math.max(0,match.from-2000)>=a && context.pos-Math.max(0,match.from-2000)<=b))return null;
    const query=match.text.slice(2),hash=query.indexOf('#');
    if(hash>=0){
      const found=core.resolve(query.slice(0,hash),this.options.getNotes(),this.options.getCurrentNote());
      if(found.status!=='resolved')return null;
      return {from:match.from+2+hash+1,options:core.headings(this.options.getContent(found.note)).map(h=>({label:h.text,type:'text',apply:(view,_c,from,to)=>{
        const rest=view.state.doc.sliceString(to,to+2)==']]'?to+2:to;view.dispatch({changes:{from,to:rest,insert:h.text+']]'},selection:{anchor:from+h.text.length+2}});
      }}))};
    }
    return {from:match.from+2,filter:true,options:this.options.getNotes().map(note=>({label:core.noteTitle(note),displayLabel:core.noteTitle(note),detail:this.options.noteDetail?.(note)||core.noteId(note).slice(-8),type:'text',apply:(view,_c,_from,to)=>{
      const insert=core.stableLink(note),end=view.state.doc.sliceString(to,to+2)==']]'?to+2:to;
      view.dispatch({changes:{from:match.from,to:end,insert},selection:{anchor:match.from+insert.length},userEvent:'input.complete'});
    }}))};
  }
  setMode(mode) {
    if(!['edit','source','preview'].includes(mode))mode='edit';
    if(this.mode===mode && this.modeInitialized)return;
    this.modeInitialized=true;
    const prior=this.mode;this.mode=mode;this.root.dataset.mode=mode;
    this.editHost.hidden=mode==='preview';this.readHost.hidden=mode!=='preview';
    if(mode==='preview'){
      const pos=this.view?.state.selection.main.head||0;this.renderReading();
      requestAnimationFrame(()=>{
        const anchors=[...this.readHost.querySelectorAll('[data-source-line]')];
        const line=this.view.state.doc.lineAt(pos).number-1;
        anchors.filter(el=>Number(el.dataset.sourceLine)<=line).at(-1)?.scrollIntoView({block:'nearest'});
      });
    }
    if(this.view){
      this.view.dispatch({effects:[refreshEffect.of(null),this.lineConfig.reconfigure(mode==='source'?[lineNumbers(),highlightActiveLine()]:[])]});
      if(prior==='preview'&&mode!=='preview'){this.view.requestMeasure();this.view.focus();this.view.dispatch({effects:EditorView.scrollIntoView(this.view.state.selection.main.head,{y:'nearest'})});}
    }
  }
  renderReading() {
    const scroll=this.readHost.scrollTop;
    this.readHost.innerHTML=this.renderer.render(this.getMarkdown(),{noteId:this.options.noteId,stack:[this.options.noteId]});
    this.readHost.scrollTop=scroll;this.renderer.enhance(this.readHost);
  }
  handleRenderedClick(event,base) {
    const target=event.target;
    if(target.closest('.kn-code-copy')){
      event.preventDefault();event.stopPropagation();const button=target.closest('button'),code=button.parentElement.querySelector('pre code')?.textContent||'';
      navigator.clipboard.writeText(code).then(()=>{button.textContent='已复制';}).catch(()=>{button.textContent='复制失败';});return;
    }
    const callout=target.closest('.kn-callout-title');if(callout){event.preventDefault();const block=callout.closest('.kn-callout');block.classList.toggle('is-collapsed');callout.setAttribute('aria-expanded',String(!block.classList.contains('is-collapsed')));return;}
    const box=target.closest('input[data-task-pos]');
    if(box){
      if(box.closest('.kn-embed-body')){event.preventDefault();return;}
      const pos=base+Number(box.dataset.taskPos);const old=this.view.state.doc.sliceString(pos,pos+1);
      if(/[ xX]/.test(old))this.view.dispatch({changes:{from:pos,to:pos+1,insert:old===' '?'x':' '},userEvent:'input'});return;
    }
    const wiki=target.closest('[data-note-target]');if(wiki){event.preventDefault();event.stopPropagation();this.options.onOpenLink?.({target:wiki.dataset.noteTarget,anchor:wiki.dataset.noteAnchor});return;}
    const link=target.closest('a');
    if(link){event.preventDefault();event.stopPropagation();
      const url=link.getAttribute('href')||'';
      if(link.dataset.relativeNote){this.options.onRelativeLink?.(link.dataset.relativeNote);return;}
      if(url.startsWith('#')){
        let anchor;try{anchor=decodeURIComponent(url.slice(1));}catch{anchor=url.slice(1);}
        const el=[...this.readHost.querySelectorAll('[id]')].find(el=>el.id===anchor);if(el){el.scrollIntoView({block:'nearest'});return;}
        this.locateAnchor(anchor);return;
      }
      if(safeURL(url))this.options.onExternalLink?.(url);
    }
  }
  locateAnchor(anchor) {
    const doc=this.getMarkdown();const target=anchor.startsWith('^')?doc.indexOf(anchor):core.headings(doc).find(h=>h.text===anchor)?.offset;
    if(typeof target==='number'&&target>=0)this.locate(target);
  }
  locate(pos) {
    pos=Math.max(0,Math.min(this.view.state.doc.length,pos));
    this.view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'start'}),scrollIntoView:true});
    if(this.mode==='preview'){
      const hs=core.headings(this.getMarkdown()),index=hs.findIndex(h=>h.offset===pos);
      this.readHost.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({block:'start'});
    }else this.view.focus();
  }
  format(action,value) {
    if(this.mode==='preview')return false;
    const view=this.view,{from,to}=view.state.selection.main,doc=view.state.doc,text=doc.sliceString(from,to);
    if(action==='undo')return undo(view);if(action==='redo')return redo(view);
    const wraps={bold:'**',italic:'*',strike:'~~',inline:'`',highlight:'=='};
    if(wraps[action]){
      const token=wraps[action];let a=from,b=to,insert;
      if(text.startsWith(token)&&text.endsWith(token)&&text.length>=2*token.length){insert=text.slice(token.length,-token.length);}
      else if(from>=token.length&&doc.sliceString(from-token.length,from)===token&&doc.sliceString(to,to+token.length)===token){a-=token.length;b+=token.length;insert=text;}
      else {insert=token+text+token;view.dispatch({changes:{from:a,to:b,insert},selection:{anchor:a+token.length,head:a+token.length+text.length},userEvent:'input.format'});view.focus();return true;}
      view.dispatch({changes:{from:a,to:b,insert},selection:{anchor:a,head:a+insert.length},userEvent:'input.format'});view.focus();return true;
    }
    if(['heading','bullet','ordered','task','quote'].includes(action)){
      const first=doc.lineAt(from),last=doc.lineAt(to);const changes=[];
      for(let n=first.number;n<=last.number;n++){
        const line=doc.line(n);const clean=line.text.replace(/^(\s*)(?:#{1,6}\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/,'$1');
        const indent=clean.match(/^\s*/)[0],body=clean.slice(indent.length);
        const prefix=action==='heading'?'#'.repeat(Math.max(0,Math.min(6,Number(value)||0)))+(Number(value)?' ':''):action==='ordered'?`${n-first.number+1}. `:action==='task'?'- [ ] ':action==='quote'?'> ':'- ';
        changes.push({from:line.from,to:line.to,insert:indent+prefix+body});
      }
      view.dispatch({changes,userEvent:'input.format'});view.focus();return true;
    }
    const blocks={code:'```text\n'+text+'\n```',table:'| 项目 | 内容 |\n| --- | --- |\n|  |  |',rule:'---',image:value||'![图片](https://)',link:`[${text||'链接'}](${safeURL(value)||'https://'})`};
    if(!(action in blocks))return false;
    const insert=action==='link'||action==='image'?blocks[action]:'\n\n'+blocks[action]+'\n\n';
    view.dispatch({changes:{from,to,insert},selection:{anchor:from+insert.length},userEvent:'input.format'});view.focus();return true;
  }
  insertText(text) {this.view.dispatch(this.view.state.replaceSelection(text));this.view.focus();return true;}
  getMarkdown(){return this.view.state.doc.toString();}
  getSelection(){const r=this.view.state.selection.main;return {start:r.anchor,end:r.head};}
  restoreSelection(r){this.view.dispatch({selection:{anchor:r.start,head:r.end}});this.view.focus();}
  getFormatState(){const node=syntaxTree(this.view.state).resolveInner(this.view.state.selection.main.head,-1);const names=[];for(let n=node;n;n=n.parent)names.push(n.name);return {bold:names.includes('StrongEmphasis'),italic:names.includes('Emphasis'),strike:names.includes('Strikethrough'),inline:names.includes('InlineCode'),heading:names.find(n=>/^ATXHeading\d/.test(n))?.slice(-1)||'0',undo:true,redo:true};}
  openSearch(){if(this.mode==='preview')this.options.onEditForSearch?.();openSearchPanel(this.view);this.view.focus();}
  table(operation,index,value){for(let n=syntaxTree(this.view.state).resolveInner(this.view.state.selection.main.head,-1);n;n=n.parent)if(n.name==='FencedCode'||n.name==='IndentedCode')return false;const change=core.editTable(this.getMarkdown(),this.view.state.selection.main.head,operation,index,value);if(!change)return false;this.view.dispatch({changes:change,userEvent:'input.table'});this.view.focus();return true;}
  async upload(file,pos=this.view.state.selection.main.head) {
    const upload={id:++this.nextUpload,file,pos,status:'正在上传',retry:null};this.uploads.set(upload.id,upload);this.uploadStatus();
    const perform=async()=>{
      upload.status='正在上传';this.uploadStatus();
      try {
        if(file.size>20*1024*1024)throw new Error('图片不能超过 20 MB');
        if(!/^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(file.type))throw new Error('不支持的图片格式');
        const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('读取图片失败'));reader.readAsDataURL(file);});
        const snippet=await this.options.uploadImage(dataUrl,file.name);
        if(this.destroyed)return;
        if(!snippet)throw new Error('图片未能持久化');
        const at=Math.min(upload.pos,this.view.state.doc.length);
        this.view.dispatch({changes:{from:at,insert:'\n'+snippet+'\n'},userEvent:'input.image'});
        this.uploads.delete(upload.id);
      }catch(error){upload.status=error.message||'上传失败';upload.retry=perform;}
      this.uploadStatus();
    };await perform();
  }
  uploadStatus(){
    this.statusHost.replaceChildren();for(const item of this.uploads.values()){
      const row=document.createElement('div');row.textContent=item.file.name+' · '+item.status;
      if(item.retry){const retry=document.createElement('button');retry.type='button';retry.textContent='重试';retry.onclick=item.retry;row.append(retry);const cancel=document.createElement('button');cancel.textContent='取消';cancel.onclick=()=>{this.uploads.delete(item.id);this.uploadStatus();};row.append(cancel);}
      this.statusHost.append(row);
    }
  }
  paste(event){const files=[...event.clipboardData?.files||[]].filter(f=>f.type.startsWith('image/'));if(!files.length)return false;event.preventDefault();const pos=this.view.state.selection.main.head;files.forEach(file=>void this.upload(file,pos));return true;}
  drop(event,view){const files=[...event.dataTransfer?.files||[]].filter(f=>f.type.startsWith('image/'));if(!files.length)return false;event.preventDefault();const pos=view.posAtCoords({x:event.clientX,y:event.clientY})??view.state.selection.main.head;files.forEach(file=>void this.upload(file,pos));return true;}
  // Saving migrates only exact managed image destinations, as transactions.
  // Selection, history and pending upload anchors are mapped by CodeMirror.
  acceptSavedAssetReferences(assets){
    const doc=this.getMarkdown(),changes=[];
    for(const asset of assets||[]){if(!asset.source||!asset.relativePath)continue;for(const ref of core.imageReferences(doc)){if(ref.url===asset.source)changes.push({from:ref.from,to:ref.to,insert:asset.relativePath});}}
    if(changes.length)this.view.dispatch({changes:changes.sort((a,b)=>a.from-b.from),annotations:Transaction.addToHistory.of(false),userEvent:'input.assets'});
  }
  refresh(){this.renderCache.clear();if(this.mode==='preview')this.renderReading();this.view.dispatch({effects:refreshEffect.of(null)});this.view.requestMeasure();}
  destroy(){this.destroyed=true;this.view.destroy();instances.delete(this.root);return Promise.resolve();}
}
window.LoopKnowledgeEditor={create:async options=>new KnowledgeEditor(options),createRenderer,safeURL,instances};

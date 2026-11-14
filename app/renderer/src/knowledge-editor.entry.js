import {EditorState,EditorSelection,StateField,StateEffect,Compartment,Prec,Transaction,MapMode} from '@codemirror/state';
import {EditorView,keymap,Decoration,WidgetType,ViewPlugin,drawSelection,highlightActiveLine,rectangularSelection,crosshairCursor,lineNumbers,placeholder} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,indentWithTab,indentMore,indentLess,undo,redo,invertedEffects,isolateHistory} from '@codemirror/commands';
import {markdown,markdownLanguage,insertNewlineContinueMarkupCommand,deleteMarkupBackward} from '@codemirror/lang-markdown';
import {yamlFrontmatter} from '@codemirror/lang-yaml';
import {languages} from '@codemirror/language-data';
import {syntaxTree,syntaxHighlighting,HighlightStyle,indentUnit,bracketMatching,forceParsing} from '@codemirror/language';
import {closeBrackets,closeBracketsKeymap,autocompletion,completionKeymap} from '@codemirror/autocomplete';
import {searchKeymap,highlightSelectionMatches} from '@codemirror/search';
import {KnowledgeFind,knowledgeFindMarks} from './knowledge-search.js';
import {installTableControls} from './knowledge-table-controls.js';
import {tags} from '@lezer/highlight';
import {obsidianComments} from './knowledge-syntax.js';
import {createRenderer,safeURL,escape,imageLayout} from './knowledge-renderer.js';
import {documentFormat,spacingAt,typedSpacing} from './knowledge-format.js';
const core=window.LoopKnowledgeCore;
const viewportEffect=StateEffect.define(),refreshEffect=StateEffect.define(),tableWidthsEffect=StateEffect.define();
const instances=new WeakMap();
function mapLineEndings(format,changes) {
  const breaks=new Map();
  for(const [pos,ending] of format.breaks) {
    const next=changes.mapPos(pos,1,MapMode.TrackAfter);
    if(next!==null)breaks.set(next,ending);
  }
  // Only exceptional separators are stored. Newly inserted breaks inherit the
  // preferred format, so ordinary long notes do not retain a map per line.
  return {breaks,preferred:format.preferred};
}
const restoreLineEndings=StateEffect.define({map:mapLineEndings});
const loopHighlight=HighlightStyle.define([
  {tag:tags.heading,color:'var(--text)',fontWeight:'600'},
  {tag:tags.strong,class:'kn-strong'},{tag:tags.emphasis,class:'kn-emphasis'},
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
  constructor(html,owner,from,kind='block',to=from,nodeName='') { super(); Object.assign(this,{html,owner,from,kind,nodeName,to}); }
  eq(other) { return this.html===other.html && this.from===other.from && this.kind===other.kind && this.nodeName===other.nodeName; }
  toDOM(view) {
    const el=document.createElement(this.kind==='block'?'div':'span');
    el.className='kn-live-widget kn-rendered'+(this.kind==='block'?' kn-block-widget':'');
    el.dataset.sourcePos=String(this.from);el.dataset.sourceTo=String(this.to);el.innerHTML=this.html;
    this.owner.decorateImages(el);
    el.addEventListener('mousedown',event=>{
      // An image inside a callout or embedded note must not unfold the entire
      // containing block and move the caret into unrelated reference syntax.
      if(event.target.closest('img')){event.preventDefault();event.stopPropagation();view.focus();return;}
      if(event.target.closest('button,a,input,textarea')) return;
      event.preventDefault(); let pos=Number(el.dataset.sourcePos);
      // A rendered code block is replaced by a single widget, so the caret must
      // be mapped back to the code line and column the user actually clicked.
      // Otherwise mousedown unfolds the fence at its first character and the
      // next keystroke rewrites the opening fence.
      if(this.kind==='block'&&this.nodeName==='FencedCode'){
        const mapped=this.owner.codePositionAt(this.from,event);
        if(mapped!==null) pos=mapped;
      }
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
  ignoreEvent(event) { return event.type !== 'mousedown' || Boolean(event.target.closest?.('img')); }
}
// Images remain visual objects when selected. Revealing their Markdown during
// mousedown changed the layout before CodeMirror placed its native selection.
class ImageWidget extends RenderWidget {
  constructor(html,owner,from,kind,to) {super(html,owner,from,kind);this.to=to;}
  eq(other) {return other instanceof ImageWidget && super.eq(other) && this.to===other.to;}
  toDOM(view) {
    const el=document.createElement('span');el.className='kn-live-widget kn-rendered kn-image-widget';
    el.dataset.sourcePos=String(this.from);el.dataset.sourceTo=String(this.to);el.innerHTML=this.html;
    // Markdown rendering adds a paragraph even for one inline image. A block
    // paragraph inside this inline replacement leaves CodeMirror's cursor
    // buffer on a separate line above the image despite a correct source offset.
    const paragraph=el.firstElementChild;
    if(el.childElementCount===1 && paragraph?.tagName==='P')el.replaceChildren(...paragraph.childNodes);
    this.owner.decorateImages(el);
    el.addEventListener('mousedown',event=>{
      if(event.button!==0||event.target.closest('a,button,input'))return;
      event.preventDefault();event.stopPropagation();
      if(event.target.closest('.kn-embed-body'))return;
      view.dispatch({selection:EditorSelection.create([EditorSelection.cursor(this.to,-1)]),scrollIntoView:false});view.focus();
    });
    el.addEventListener('click',event=>this.owner.handleRenderedClick(event,this.from));
    return el;
  }
  coordsAt(dom,pos) {
    if(pos<=0||!dom.querySelector('.kn-image-layout'))return null;
    const image=dom.querySelector('img');
    if(!image?.getClientRects().length)return null;
    const bounds=image.getBoundingClientRect();
    const height=parseFloat(getComputedStyle(dom).lineHeight)||20;
    return {left:bounds.right,right:bounds.right,top:bounds.bottom-height,bottom:bounds.bottom};
  }
  ignoreEvent(){return true;}
}
// Tables keep their rendered geometry while a single cell is edited. Switching
// the entire block to source on mousedown moved later rows away from the click.
class TableWidget extends RenderWidget {
  toDOM(view) {
    const el=document.createElement('div');el.className='kn-live-widget kn-rendered kn-table-widget';
    el.dataset.sourcePos=String(this.from);el.dataset.sourceTo=String(this.to);el.innerHTML=this.html;
    this.owner.decorateImages(el);
    installTableControls(this.owner,el);
    requestAnimationFrame(()=>{if(el.isConnected)this.owner.applyTableWidths(el,this.from);});
    // The widget itself is the keyboard entry point for existing cells: Tab
    // reaches it, Enter/ArrowDown opens the first body cell, and nothing has to
    // add or restructure a row first.
    el.tabIndex=0;el.setAttribute('role','group');
    const table=el.querySelector('table');
    el.setAttribute('aria-label',`表格 ${Math.max(0,(table?.rows.length||1)-1)} 行 ${table?.rows[0]?.cells.length||0} 列，回车编辑`);
    el.addEventListener('keydown',event=>{
      if(event.isComposing||event.keyCode===229)return;
      // Keys typed in the cell field (notably the space key) belong to the field.
      if(event.target!==el&&event.target.closest?.('.kn-table-cell-editor'))return;
      if(!['Enter',' ','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key))return;
      const body=el.querySelector('table tbody td')||el.querySelector('table th');
      if(!body)return;
      event.preventDefault();event.stopPropagation();
      this.owner.editTableCell(el,body,true);
    });
    el.addEventListener('mousedown',event=>{
      if(event.button!==0||event.target.closest('button,a,input,textarea'))return;
      if(event.target.closest('img')){event.preventDefault();event.stopPropagation();view.focus();return;}
      const cell=event.target.closest('td,th');
      if(!cell||cell.closest('table')!==el.querySelector('table'))return;
      event.preventDefault();event.stopPropagation();
      this.owner.editTableCell(el,cell,false,this.owner.cellCaretAt(cell,event));
    });
    el.addEventListener('click',event=>this.owner.handleRenderedClick(event,this.from));return el;
  }
  updateDOM(el) {
    // Never reuse another table's focused field when several tables redraw.
    if(Number(el.dataset.sourcePos)!==this.from)return false;
    const next=document.createElement('div');next.innerHTML=this.html;
    const oldTable=el.querySelector('table'),newTable=next.querySelector('table');if(!oldTable||!newTable)return false;
    const oldRows=[...oldTable.rows],rows=[...newTable.rows];
    if(rows.length!==oldRows.length||rows.some((row,i)=>row.cells.length!==oldRows[i].cells.length))return false;
    el.dataset.sourcePos=String(this.from);el.dataset.sourceTo=String(this.to);
    for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].cells.length;c++){
      const cell=oldRows[r].cells[c],fresh=rows[r].cells[c],active=this.owner.activeTableCell;
      if(active?.cell===cell){
        // Keep the transparent editor as the only painted text. The hidden
        // content sizes the row, while the rendered version returns on blur.
        active.renderedHTML=fresh.innerHTML;
        active.content.textContent=active.input.value||'\u200b';
      }else cell.innerHTML=fresh.innerHTML;
      cell.style.textAlign=fresh.style.textAlign;
    }
    this.owner.decorateImages(el);this.owner.applyTableWidths(el,this.from);el.tableControls?.refresh();return true;
  }
  destroy(el){el.tableControls?.destroy();if(this.owner.activeTableCell?.widget===el)this.owner.finishTableCell();}
  ignoreEvent(){return true;}
}
class TaskWidget extends WidgetType {
  constructor(checked,pos,label='') { super(); this.checked=checked; this.pos=pos; this.label=label; }
  eq(other) {return this.checked===other.checked&&this.pos===other.pos&&this.label===other.label;}
  toDOM(view) {
    const box=document.createElement('input'); box.type='checkbox'; box.checked=this.checked; box.className='kn-task-box';
    box.setAttribute('aria-label',this.label?`切换任务：${this.label}`:'切换任务完成状态');
    box.addEventListener('mousedown',event=>event.preventDefault());
    box.addEventListener('click',event=>{event.stopPropagation();view.dispatch({changes:{from:this.pos,to:this.pos+1,insert:this.checked?' ':'x'},userEvent:'input'});});
    return box;
  }
  ignoreEvent(){return true;}
}
class BulletWidget extends WidgetType {
  toDOM() {
    const marker=document.createElement('span');marker.className='kn-list-bullet';
    marker.textContent='•';marker.setAttribute('aria-hidden','true');return marker;
  }
  ignoreEvent(){return false;}
}
function selected(state,from,to) {return state.selection.ranges.some(r=>r.from<=to && r.to>=from);}
// CodeMirror's keymap claims Home/End on the editor DOM before a key pressed in
// the cell textarea can reach the field. Handle those two keys for the cell
// field at the document capture phase so a click mid-cell still allows
// Home/End navigation.
document.addEventListener('keydown',event=>{
  const input=event.target;
  if(!(input instanceof HTMLTextAreaElement)||!input.classList.contains('kn-table-cell-editor'))return;
  if(event.isComposing||event.keyCode===229||(event.key!=='Home'&&event.key!=='End'))return;
  event.preventDefault();event.stopPropagation();
  const at=event.key==='Home'?0:input.value.length;
  try{input.setSelectionRange(at,at);}catch{}
},true);
// A code span must be wrapped in a fence longer than any backtick run inside it.
function inlineFence(text) {
  const runs=(String(text).match(/`+/g)||[]).map(run=>run.length);
  return '`'.repeat(Math.max(1,...runs.map(n=>n+1)));
}

class KnowledgeEditor {
  constructor(options) {
    const source=core.sourceFormat(options.sourceMarkdown ?? options.markdown ?? '');
    this.lineEndings=StateField.define({create:()=>source,update:(format,tr)=>{
      if(tr.docChanged)format=mapLineEndings(format,tr.changes);
      for(const effect of tr.effects)if(effect.is(restoreLineEndings))format=effect.value;
      return format;
    }});
    this.tableWidths=StateField.define({create:()=>options.tableColumnWidths||[],update:(value,tr)=>{for(const effect of tr.effects)if(effect.is(tableWidthsEffect))value=effect.value;return value;}});
    this.options=options; this.root=options.root; this.mode=options.mode||'edit';this.destroyed=false;this.uploads=new Map();this.nextUpload=0;
    this.range={from:0,to:8000};this.renderCache=new Map();this.lineConfig=new Compartment();
    this.renderer=createRenderer(options); this.root.replaceChildren();this.root.classList.add('kn-editor-host');
    this.editHost=document.createElement('div');this.editHost.className='kn-edit-surface';this.root.append(this.editHost);
    this.readHost=document.createElement('article');this.readHost.className='kn-reading kn-rendered';this.readHost.tabIndex=0;this.readHost.setAttribute('aria-label','阅读笔记');this.root.append(this.readHost);
    this.statusHost=document.createElement('div');this.statusHost.className='kn-upload-status';this.statusHost.setAttribute('role','status');this.root.append(this.statusHost);
    this.readHost.addEventListener('click',event=>this.handleRenderedClick(event,0));
    this.readHost.addEventListener('toggle',()=>this.find?.update(true),true);
    this.decorations=StateField.define({create:state=>this.buildDecorations(state),update:(decos,tr)=>{
      for(const effect of tr.effects) if(effect.is(viewportEffect)) this.range=effect.value;
      if(tr.docChanged||tr.selection||tr.effects.some(e=>e.is(viewportEffect)||e.is(refreshEffect))) return this.buildDecorations(tr.state);
      return decos.map(tr.changes);
    },provide:field=>EditorView.decorations.from(field)});
    this.view=new EditorView({parent:this.editHost,state:EditorState.create({doc:source.text,extensions:[
      this.tableWidths,invertedEffects.of(tr=>tr.effects.some(e=>e.is(tableWidthsEffect))?[tableWidthsEffect.of(tr.startState.field(this.tableWidths))]:[]),
      this.lineEndings,invertedEffects.of(tr=>tr.docChanged||tr.effects.some(e=>e.is(restoreLineEndings))?[restoreLineEndings.of(tr.startState.field(this.lineEndings))]:[]),
      history(),drawSelection(),rectangularSelection(),crosshairCursor(),EditorView.lineWrapping,
      EditorState.transactionFilter.of(tr=>{
        if(!options.autoSpacing?.() || this.mode==='preview' || !tr.docChanged || !tr.isUserEvent('input.type') || tr.isUserEvent('input.type.compose'))return tr;
        const changes=typedSpacing(tr);
        return changes.length?[tr,{changes,sequential:true}]:tr;
      }),
      placeholder('开始记录，支持 Markdown…'),
      EditorState.phrases.of({'Find':'查找','Replace':'替换','next':'下一个','previous':'上一个','all':'全选匹配',
        'match case':'区分大小写','regexp':'正则表达式','by word':'全词匹配','replace':'替换','replace all':'全部替换','close':'关闭',
        'Fold line':'折叠此节','Unfold line':'展开此节','to':'至','folded code':'已折叠内容'}),
      yamlFrontmatter({content:markdown({base:markdownLanguage,codeLanguages:languages,addKeymap:false,completeHTMLTags:false,extensions:[obsidianComments]})}),
      syntaxHighlighting(loopHighlight),indentUnit.of('    '),bracketMatching(),closeBrackets(),
      markdownLanguage.data.of({closeBrackets:{brackets:['(','[','{',"'",'"','`','*','~']}}),
      knowledgeFindMarks,highlightSelectionMatches(),
      // Wiki completion is explicitly requested by [[; Enter should accept a
      // visible candidate even when it arrives less than 75ms before the key.
      autocompletion({override:[context=>this.complete(context)],interactionDelay:0}),
      Prec.high(keymap.of([
        {key:'Mod-s',run:()=>{options.onSave?.();return true;}},
        {key:'Mod-f',run:()=>{this.openSearch();return true;}},
        ...['F3','Mod-g'].map(key=>({key,run:()=>this.find.step(1),shift:()=>this.find.step(-1),preventDefault:true})),
        {key:'Escape',run:()=>{if(!this.find?.active)return false;this.find.clear();return true;}},
        {key:'Enter',run:insertNewlineContinueMarkupCommand({nonTightLists:false})},
        {key:'Backspace',run:deleteMarkupBackward},
        {key:'Tab',run:indentMore},{key:'Shift-Tab',run:indentLess},
      ])),keymap.of([...closeBracketsKeymap,...completionKeymap,...historyKeymap,...searchKeymap.filter(binding=>!['Mod-f','F3','Mod-g','Escape'].includes(binding.key)),...defaultKeymap,indentWithTab]),
      this.decorations,
      // Skip hidden image syntax for keyboard navigation and deletion. Source
      // mode has no image decorations and remains fully editable as Markdown.
      EditorView.atomicRanges.of(view=>view.state.field(this.decorations).update({filter:(_from,_to,value)=>value.spec.widget instanceof ImageWidget})),
      this.lineConfig.of(this.mode==='source'?[lineNumbers(),highlightActiveLine()]:[]),
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
    this.find=new KnowledgeFind(this);this.setMode(this.mode);instances.set(options.root,this);
    this.events=new AbortController();const signal=this.events.signal;
    this.view.contentDOM.addEventListener('compositionend',()=>{
      // CodeMirror flushes the final composition mutation in a microtask.
      requestAnimationFrame(()=>{
        if(this.destroyed || this.view.composing)return;
        const ranges=this.compositionRanges;
        this.compositionRanges=null;
        if(!options.autoSpacing?.() || this.mode==='preview')return;
        const changes=spacingAt(this.view.state,ranges?[ranges]:[]);
        if(changes.length)this.view.dispatch({changes,userEvent:'input.type'});
      });
    },{signal});
    this.root.addEventListener('mousedown',event=>{
      this.pointerLink=event.target.closest('a,[data-note-target],.kn-external-link');
      if(event.target.closest('.kn-image-resize'))return;
      this.selectedImage?.removeAttribute('data-kn-selected');
      this.selectedImage=event.target.closest('img');
      this.selectedImage?.setAttribute('data-kn-selected','true');
      if(event.button===0&&event.target.closest('.kn-external-link')){event.preventDefault();event.stopPropagation();}
    },{capture:true,signal});
    this.root.addEventListener('click',event=>{if(event.target.closest('.kn-external-link'))this.handleRenderedClick(event,0);},{signal});
    this.root.addEventListener('keydown',event=>{
      if(event.isComposing||event.keyCode===229||this.view.composing)return;
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'&&this.selectedImage?.isConnected){event.preventDefault();event.stopImmediatePropagation();void this.copyImage(this.selectedImage);return;}
      if(!['Control','Meta','Shift','Alt'].includes(event.key)){this.selectedImage?.removeAttribute('data-kn-selected');this.selectedImage=null;}
      if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!event.target.closest('.kn-table-cell-editor')){event.preventDefault();event.stopImmediatePropagation();this.openLinkAt();}
    },{capture:true,signal});
    this.root.addEventListener('contextmenu',event=>{
      const image=event.target.closest('img');
      if(image){event.preventDefault();event.stopPropagation();const context=this.imageContext(image);this.options.onImageMenu?.(image,{x:event.clientX,y:event.clientY},()=>this.copyImage(image),context?{...context.layout,set:patch=>this.setImageLayout(image,patch)}:null);return;}
      const link=event.target.closest('a,.kn-external-link');if(!link)return;
      const href=link.classList.contains('kn-external-link')?this.linkAt(Number(link.dataset.knLinkFrom)+1)?.url:link.dataset.relativeNote||link.getAttribute('href');
      if(!href||href.startsWith('#'))return;
      event.preventDefault();event.stopPropagation();this.options.onResourceMenu?.(href,link,{x:event.clientX,y:event.clientY});
    },{signal});
  }
  decorateImages(widget) {
    for(const image of widget.querySelectorAll('img')){
      // Embedded notes are references to another document; edit their source.
      if(image.closest('.kn-embed-body')||image.parentElement.classList.contains('kn-image-object'))continue;
      const object=document.createElement('span');object.className='kn-image-object';image.before(object);object.append(image);
      const placeHandle=()=>object.classList.toggle('kn-image-small',image.naturalWidth<40||image.naturalHeight<24);
      image.addEventListener('load',placeHandle);if(image.complete)placeHandle();
      const resize=document.createElement('button');resize.type='button';resize.className='kn-image-resize';
      resize.setAttribute('aria-label','调整图片大小');resize.title='拖动调整大小，方向键微调';object.append(resize);
      resize.addEventListener('pointerdown',event=>this.resizeImage(event,image));
      resize.addEventListener('keydown',event=>{
        if(event.isComposing||!['ArrowLeft','ArrowRight'].includes(event.key))return;
        event.preventDefault();event.stopImmediatePropagation();
        this.setImageLayout(image,{width:Math.round(image.getBoundingClientRect().width)+(event.key==='ArrowRight'?10:-10)});
      });
    }
  }
  imageReferenceEnv(state=this.view.state) {
    if(this.imageReferenceDoc!==state.doc){
      const env={};this.renderer.parse(state.doc.toString(),env);
      this.imageReferenceDoc=state.doc;this.imageReferences=env.references;
    }
    return {references:this.imageReferences};
  }
  imageContext(image) {
    const widget=image?.closest('.kn-live-widget');
    if(!widget||image.closest('.kn-embed-body')||!this.root.contains(widget)||this.mode!=='edit')return null;
    const from=Number(widget.dataset.sourcePos),to=Number(widget.dataset.sourceTo);
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return null;
    forceParsing(this.view,Math.min(this.view.state.doc.length,to+1));
    const nodes=[];syntaxTree(this.view.state).iterate({from,to,enter:n=>{if(n.name==='Image'){nodes.push(n.node);return false;}}});
    // A missing image still occupies its own source position. Never write to
    // another image when an unsupported construct prevents an exact match.
    const images=[...widget.querySelectorAll('img,.kn-image-missing')].filter(item=>!item.closest('.kn-embed-body'));
    if(images.length!==nodes.length)return null;
    const node=nodes[images.indexOf(image)];if(!node)return null;
    const raw=this.view.state.doc.sliceString(node.from,node.to);
    const token=this.renderer.parse(raw,node.getChild('URL')?{}:this.imageReferenceEnv()).flatMap(block=>block.children||[]).find(item=>item.type==='image');
    return token?{node,token,layout:imageLayout(token.attrGet('title'))}:null;
  }
  setImageLayout(image,patch) {
    const context=this.imageContext(image);if(!context)return false;
    const layout={...context.layout,...patch};
    if(Object.hasOwn(patch,'width')){
      if(!Number.isFinite(patch.width)||patch.width<=0)return false;
      layout.width=Math.round(Math.max(32,Math.min(12000,patch.width)));
    }
    if(!['left','center','right'].includes(layout.align))return false;
    const marker=`[loop-image ${layout.width?'width='+layout.width+' ':''}align=${layout.align}]`;
    // Escape entities before writing a Markdown title so a literal entity or
    // table delimiter survives the next parse without changing the caption.
    const title=(layout.title?layout.title+' '+marker:marker)
      .replace(/&/g,'&amp;').replace(/\|/g,'&#124;').replace(/\n/g,'&#10;').replace(/[\\"]/g,'\\$&');
    const oldTitle=context.node.getChild('LinkTitle');
    let change;
    if(!context.node.getChild('URL')){
      const closing=context.node.getChildren('LinkMark').find(mark=>this.view.state.doc.sliceString(mark.from,mark.to)===']');
      if(!closing)return false;
      const alt=this.view.state.doc.sliceString(context.node.from+2,closing.from),url=context.token.attrGet('src').replace(/>/g,'%3E');
      change={from:context.node.from,to:context.node.to,insert:`![${alt}](<${url}> "${title}")`};
    }else change=oldTitle?{from:oldTitle.from,to:oldTitle.to,insert:`"${title}"`}:{from:context.node.to-1,insert:` "${title}"`};
    this.view.dispatch({changes:change,annotations:isolateHistory.of('full'),userEvent:'input.image-layout'});
    this.view.requestMeasure();return true;
  }
  resizeImage(event,image) {
    const context=this.imageContext(image);if(!context||event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    this.imageGesture?.();
    const doc=this.view.state.doc,box=image.getBoundingClientRect(),startX=event.clientX,startY=event.clientY;
    const ratio=image.naturalWidth/image.naturalHeight||box.width/box.height||1;
    const maximum=Math.min(image.closest('td,th,.kn-callout-body,.cm-line')?.clientWidth||this.view.contentDOM.clientWidth,this.view.contentDOM.clientWidth);
    const oldWidth=image.style.width;let width=box.width;
    const controller=new AbortController(),signal=controller.signal;
    let finished=false;
    const finish=cancel=>{
      if(finished)return;finished=true;
      controller.abort();this.events.signal.removeEventListener('abort',abort);this.imageGesture=null;
      image.style.width=oldWidth;
      if(!cancel&&!this.destroyed&&image.isConnected&&this.view.state.doc===doc&&width!==box.width)this.setImageLayout(image,{width});
      if(!this.destroyed)this.view.requestMeasure();
    };
    const abort=()=>finish(true);this.imageGesture=abort;this.events.signal.addEventListener('abort',abort,{once:true});
    window.addEventListener('pointermove',move=>{
      if(move.pointerId!==event.pointerId)return;
      move.preventDefault();
      const horizontal=move.clientX-startX,vertical=(move.clientY-startY)*ratio;
      const delta=Math.abs(horizontal)>=Math.abs(vertical)?horizontal:vertical;
      width=Math.round(Math.min(maximum,Math.max(32,box.width+delta)));
      image.style.width=width+'px';this.view.requestMeasure();
    },{signal,passive:false});
    window.addEventListener('pointerup',up=>{if(up.pointerId===event.pointerId)finish(false);},{signal});
    window.addEventListener('pointercancel',cancel=>{if(cancel.pointerId===event.pointerId)abort();},{signal});window.addEventListener('blur',abort,{signal});
    document.addEventListener('keydown',key=>{if(key.key==='Escape'){key.preventDefault();key.stopImmediatePropagation();abort();}},{signal,capture:true});
  }
  async copyImage(image) {
    try{
      let source=image.currentSrc||image.src;
      if(!/^(?:data:image\/(?:png|jpeg|gif|webp|avif|bmp);|https?:\/\/)/i.test(source)){
        await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        canvas.getContext('2d').drawImage(image,0,0);source=canvas.toDataURL('image/png');
      }
      const result=await window.personalTaskTrack?.clipboard?.copyImage(source);
      if(result?.code==='RASTERIZE_SVG'){
        const source=safeURL(result.source,true);if(!source)throw new Error('这张图片无法安全转换');
        const raster=new Image();raster.src=source;await raster.decode();return this.copyImage(raster);
      }
      if(!result?.success)throw new Error(result?.message||'当前环境无法复制图片');
      this.statusHost.textContent='';
      this.options.onFeedback?.('已复制图片');return true;
    }catch(error){this.statusHost.textContent=error.message;return false;}
  }
  linkAt(pos) {
    forceParsing(this.view,Math.min(this.view.state.doc.length,pos+100));
    const source=this.getEditorText(),wiki=core.links(source).find(link=>pos>link.from&&pos<link.to);
    if(wiki)return {wiki};
    let node=syntaxTree(this.view.state).resolveInner(pos,-1);
    while(node&&node.name!=='Link'&&node.name!=='Autolink')node=node.parent;
    if(!node||pos<=node.from||pos>=node.to)return null;
    const raw=source.slice(node.from,node.to),match=/\]\(\s*(<[^>]*>|[^\s]+?)(?:\s+["'][\s\S]*["'])?\s*\)$/.exec(raw);
    const url=(match?.[1]||(/^<.*>$/.test(raw)?raw.slice(1,-1):'')).replace(/^<|>$/g,'');
    return url?{url}:null;
  }
  openLinkAt(pos=this.view.state.selection.main.empty?this.view.state.selection.main.head:this.view.state.selection.main.from+1) {
    const link=this.linkAt(pos);if(!link)return false;
    if(link.wiki){this.options.onOpenLink?.(link.wiki);return true;}
    const {url}=link;
    if(url.startsWith('#')){try{this.locateAnchor(decodeURIComponent(url.slice(1)));}catch{this.locateAnchor(url.slice(1));}}
    else if(/^(https?:|mailto:)/i.test(url))this.options.onExternalLink?.(url);
    else this.options.onRelativeLink?.(url);
    return true;
  }
  buildDecorations(state) {
    if(this.mode!=='edit')return Decoration.none;
    const ranges=[]; let blockEnd=0;
    const add=(from,to,deco)=>{if(to>=from)ranges.push(deco.range(from,to));};
    const addBlock=(from,to,deco)=>{if(to>blockEnd)blockEnd=to;add(from,to,deco);};
    const {from,to}=this.range;
    const source=()=>state.doc.toString();
    const widget=(node,inline=false)=>{
      const text=state.doc.sliceString(node.from,node.to),reference=/!\[[^\]\n]*\](?!\()/.test(text)?this.imageReferenceEnv(state):{};
      const key=node.name+':'+text+(reference.references?JSON.stringify(reference.references):'');
      let html=this.renderCache.get(key);if(!html){html=this.renderer.render(text,{noteId:this.options.noteId,stack:[this.options.noteId],...reference});if(this.renderCache.size>160)this.renderCache.clear();this.renderCache.set(key,html);}
      const Type=node.name==='Image'?ImageWidget:node.name==='Table'?TableWidget:RenderWidget;
      // A block replacement must consume the line breaks that enclose it.
      // Otherwise CodeMirror keeps an empty line box for the first and the last
      // line of the block: the note gains a blank line above and below every
      // rendered block, and the height map drifts one line behind the DOM, so
      // clicks below the block land on the next line. Inline widgets stay inside
      // their own line box and must never eat a line break.
      const line=state.doc.lineAt(node.from);
      // Two replacements must never share the boundary newline: overlapping
      // ranges make the decoration order ambiguous.
      const start=inline||line.number<=1||state.doc.line(line.number-1).to<blockEnd?node.from:state.doc.line(line.number-1).to;
      const end=inline?node.to:Math.min(state.doc.length,node.to+(state.doc.sliceString(node.to,node.to+1)==='\n'?1:0));
      const deco=Decoration.replace({widget:new Type(html,this,node.from,inline?'inline':'block',node.to,node.name),block:!inline,inclusive:false});
      if(inline)add(start,end,deco);else addBlock(start,end,deco);
    };
    syntaxTree(state).iterate({from,to,enter:node=>{
      if(node.to<from||node.from>to)return false;
      const active=selected(state,node.from,node.to);
      if(!active && (node.name==='ObsidianComment'||node.name==='ObsidianCommentBlock'||(node.name==='HTMLBlock'&&state.doc.sliceString(node.from,node.from+4)==='<!--'))) {
        add(node.from,node.to,Decoration.replace({block:node.name!=='ObsidianComment',inclusive:false}));return false;
      }

      if(node.name==='Table'){widget(node);return false;}
      if(['FencedCode','HorizontalRule','Frontmatter'].includes(node.name) && !active){widget(node);return false;}
      if(node.name==='Blockquote' && /^>\s*\[!/.test(state.doc.sliceString(node.from,Math.min(node.to,node.from+80))) && !active){widget(node);return false;}
      if(node.name==='Image'){widget(node,true);return false;}
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
        if(parent&&!selected(state,parent.from,parent.to)){
          const space=node.name==='HeaderMark'&&parent.name.startsWith('ATXHeading')
            ?state.doc.sliceString(node.to,Math.min(parent.to,node.to+32)).match(/^[ \t]+/)?.[0].length||0:0;
          add(node.from,node.to+space,Decoration.replace({inclusive:false}));
        }
      }
      if(node.name==='Link' && !active) {
        const children=[];let child=node.node.firstChild;while(child){children.push(child);child=child.nextSibling;}
        const markers=children.filter(c=>c.name==='LinkMark'||c.name==='URL');
        for(const c of markers)add(c.from,c.to,Decoration.replace({inclusive:false}));
        add(node.from,node.to,Decoration.mark({class:'kn-external-link',attributes:{'data-kn-link-from':String(node.from)}}));
      }
      if(node.name==='TaskMarker'&&!active){
        const value=state.doc.sliceString(node.from,node.to);
        const label=state.doc.lineAt(node.from).text.replace(/^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s*/,'').trim().slice(0,120);
        add(node.from,node.to,Decoration.replace({widget:new TaskWidget(/[xX]/.test(value),node.from+1,label),inclusive:false}));return false;}
      if(node.name==='ListMark'&&!active && /^[-+*]$/.test(state.doc.sliceString(node.from,node.to))) {
        const task=/^\s+\[[ xX]\]/.test(state.doc.sliceString(node.to,Math.min(node.to+5,state.doc.length)));
        add(node.from,node.to,Decoration.replace(task?{inclusive:false}:{widget:new BulletWidget(),inclusive:false}));
      }
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
    if(update.transactions.some(tr=>tr.effects.some(effect=>effect.is(tableWidthsEffect)))){
      this.options.tableColumnWidths=update.state.field(this.tableWidths);this.options.onTableColumnWidthsChange?.(this.options.tableColumnWidths);
      for(const widget of this.root.querySelectorAll('.kn-table-widget'))this.applyTableWidths(widget,Number(widget.dataset.sourcePos));
      if(this.mode==='preview')this.renderReading();
    }
    if(update.docChanged){
      for(const tr of update.transactions){
        if(!tr.docChanged)continue;
        if(tr.isUserEvent('input.type.compose')&&this.options.autoSpacing?.()){
          const prior=tr.isUserEvent('input.type.compose.start')?null:this.compositionRanges;
          let start=prior?tr.changes.mapPos(prior.from,-1):Infinity;
          let end=prior?tr.changes.mapPos(prior.to,1):-1;
          tr.changes.iterChangedRanges((_a,_b,from,to)=>{if(to>from){start=Math.min(start,from);end=Math.max(end,to);}});
          this.compositionRanges=end>=start?{from:start,to:end}:null;
        }else this.compositionRanges=null;
      }
      const cell=this.activeTableCell;
      if(cell&&!cell.writing&&!cell.composing){
        const range=this.tableCellRange(cell.widget,cell.row,cell.column);
        if(range){Object.assign(cell,range);cell.input.value=update.state.doc.sliceString(range.from,range.to).replace(/<br\s*\/?>/gi,'\n');cell.content.textContent=cell.input.value||'\u200b';}
      }
      // Pending upload anchors are mapped through every transaction, including undo.
      for(const upload of this.uploads.values())upload.pos=update.changes.mapPos(upload.pos,1);
      this.options.onChange?.(this.getMarkdown());
      if(this.mode==='preview')this.renderReading();
    }
    if(update.selectionSet)this.options.onSelectionChange?.();
    if(update.docChanged||update.selectionSet||update.viewportChanged||update.transactions.some(tr=>tr.effects.length))this.find?.update();
  }
  // Map a click inside a rendered fenced code block to its source line/column.
  codePositionAt(from,event) {
    const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
    if(!range||!this.view.state.doc.toString())return null;
    const node=range.startContainer;
    const pre=node.nodeType===3?node.parentElement?.closest('pre'):node.closest?.('pre');
    if(!pre)return null;
    const walker=document.createTreeWalker(pre,NodeFilter.SHOW_TEXT);
    let offset=0,current;
    while((current=walker.nextNode())){if(current===node){offset+=range.startOffset;break;}offset+=current.textContent.length;}
    const before=(pre.textContent||'').slice(0,offset);
    const lineIndex=(before.match(/\n/g)||[]).length;
    const column=offset-(before.lastIndexOf('\n')+1);
    const doc=this.view.state.doc,first=doc.lineAt(from),target=doc.line(Math.min(doc.lines,first.number+1+lineIndex));
    if(target.number<=first.number)return from;
    return Math.min(target.to,target.from+Math.max(0,column));
  }
  // Character offset of a click inside a rendered table cell.
  cellCaretAt(cell,event) {
    const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
    if(!range||!cell.contains(range.startContainer))return null;
    const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);
    let offset=0,current;
    while((current=walker.nextNode())){if(current===range.startContainer)return offset+range.startOffset;offset+=current.textContent.length;}
    return null;
  }
  tableCellRange(widget,rowIndex,column) {
    const state=this.view.state;
    let node=syntaxTree(state).resolveInner(Number(widget.dataset.sourcePos),1);
    while(node&&node.name!=='Table')node=node.parent;
    const rows=node?[...node.getChildren('TableHeader'),...node.getChildren('TableRow')]:[];
    const row=rows[rowIndex];if(!row)return null;
    const pipes=row.getChildren('TableDelimiter').filter(n=>state.doc.sliceString(n.from,n.to)==='|');
    const ranges=[];let start=row.from;
    for(const pipe of pipes){
      if(pipe===pipes[0]&&!state.doc.sliceString(start,pipe.from).trim()){start=pipe.to;continue;}
      ranges.push({from:start,to:pipe.from});start=pipe.to;
    }
    const trailing=pipes.length&&!state.doc.sliceString(start,row.to).trim();
    if(!trailing)ranges.push({from:start,to:row.to});
    const range=ranges[column];
    if(!range){
      // Markdown permits short body rows; materialize only the missing cells.
      return {from:row.to,to:row.to,prefix:(trailing?' ':' | ')+(' | '.repeat(Math.max(0,column-ranges.length))),suffix:trailing?' |':''};
    }
    const raw=state.doc.sliceString(range.from,range.to),leading=raw.match(/^[ \t]*/)[0].length;
    // An empty cell keeps no inner text to replace, so writing at the trimmed
    // offset would produce "| 值|" and erode the padding of every new row or
    // column. Swap the cell's padding for canonical "| 值 |" instead.
    if(!raw.trim())return {from:range.from,to:range.to,prefix:' ',suffix:' '};
    return {from:range.from+leading,to:range.from+Math.max(leading,raw.trimEnd().length),prefix:'',suffix:''};
  }
  finishTableCell() {
    const active=this.activeTableCell;if(!active)return;
    this.activeTableCell=null;active.cell.classList.remove('kn-cell-editing');active.input.remove();
    active.content.innerHTML=active.renderedHTML;active.content.replaceWith(...active.content.childNodes);
    // A blurred table field restores rendered nodes without a transaction.
    queueMicrotask(()=>{if(!this.destroyed&&this.find?.active)this.find.update();});
  }
  editTableCell(widget,cell,reveal=false,caret=null) {
    if(this.activeTableCell?.cell===cell)return;
    this.finishTableCell();
    const row=cell.parentElement.rowIndex,column=cell.cellIndex,range=this.tableCellRange(widget,row,column);
    if(!range)return;
    this.tableColumn=column;
    this.view.dispatch({selection:{anchor:range.from},scrollIntoView:false});
    const input=document.createElement('textarea');input.rows=1;input.className='kn-table-cell-editor';
    input.setAttribute('aria-label',`${row===0?'表头':'第'+row+'行'}，第${column+1}列`);
    input.spellcheck=false;
    // An empty cell's range covers its padding; show it as an empty field so the
    // first keystroke is not appended to invisible spaces.
    input.value=this.view.state.doc.sliceString(range.from,range.to).replace(/<br\s*\/?>/gi,'\n').trim();
    const content=document.createElement('span');content.className='kn-table-cell-content';content.setAttribute('aria-hidden','true');content.textContent=input.value||'\u200b';
    const active={widget,cell,input,content,renderedHTML:cell.innerHTML,row,column,...range,composing:false,writing:false};this.activeTableCell=active;
    cell.classList.add('kn-cell-editing');cell.replaceChildren(content,input);
    const commit=(formatting=false,autoSpacing=false)=>{
      if(active.composing||this.activeTableCell!==active)return;
      const raw=input.value.replace(/\r\n?/g,'\n'),caret=input.selectionStart??raw.length;let value='',before=0;
      for(let i=0;i<raw.length;i++){const part=raw[i]==='\n'?'<br>':raw[i]==='|'&&!core.escaped(raw,i)?'\\|':raw[i];value+=part;if(i<caret)before+=part.length;}
      const from=active.from,to=active.to;
      const valueFrom=from+active.prefix.length;
      if(autoSpacing&&this.options.autoSpacing?.()){
        const previous=this.view.state.sliceDoc(from,to);
        const next=active.prefix+value+active.suffix;
        let start=0,end=0;
        while(start<Math.min(previous.length,next.length)&&previous[start]===next[start])start++;
        while(end<Math.min(previous.length,next.length)-start&&previous.at(-1-end)===next.at(-1-end))end++;
        if(start<next.length-end){
          const candidate=this.view.state.update({changes:{from,to,insert:next}}).state;
          const spaces=spacingAt(candidate,[{from:from+start,to:from+next.length-end}]);
          for(const change of spaces.reverse()){
            const at=change.from-valueFrom;
            if(at<=0||at>=value.length)continue;
            value=value.slice(0,at)+' '+value.slice(at);
            if(at<=before)before++;
          }
        }
      }
      const insert=active.prefix+value+active.suffix;
      input.value=value.replace(/<br\s*\/?>/gi,'\n');const displayCaret=value.slice(0,before).replace(/<br\s*\/?>/gi,'\n').length;input.setSelectionRange(displayCaret,displayCaret);
      content.textContent=(input.value||'\u200b')+(input.value.endsWith('\n')?'\u200b':'');
      if(this.view.state.doc.sliceString(from,to)===insert)return;
      active.from=from+active.prefix.length;active.to=active.from+value.length;active.prefix='';active.suffix='';active.writing=true;
      try{this.view.dispatch({changes:{from,to,insert},selection:{anchor:active.from+before},annotations:formatting?isolateHistory.of('full'):[],userEvent:formatting?'input.format':'input.table-cell'});}
      finally{
        active.writing=false;
        // CodeMirror may move a reused widget DOM when its source length changes.
        // Native inputs blur on that move even though the cell is still active.
        if(this.activeTableCell===active&&input.isConnected){input.focus({preventScroll:true});input.setSelectionRange(displayCaret,displayCaret);}
      }
    };
    active.commit=commit;
    input.addEventListener('paste',event=>{
      const text=event.clipboardData?.getData('text/plain')||'';
      if(!/[\t\r\n]/.test(text))return;
      // Grid paste is only for tab-delimited rectangles. Plain multi-line text
      // inside a cell is cell content (newlines become <br>), and any selection
      // means "replace this text" — never fill the neighbouring cells silently.
      const replacing=(input.selectionStart??0)!==(input.selectionEnd??0);
      if(replacing||!text.includes('\t'))return;
      const change=core.pasteTable(this.getEditorText(),active.from,active.column,text);
      if(!change)return;
      event.preventDefault();event.stopPropagation();
      this.finishTableCell();
      this.view.dispatch({changes:change,userEvent:'input.table-paste'});
      requestAnimationFrame(()=>{
        if(this.destroyed)return;
        const next=[...this.root.querySelectorAll('.kn-table-widget')].find(el=>Number(el.dataset.sourcePos)===change.from);
        const target=next?.querySelector('table')?.rows[row]?.cells[column];
        if(target)this.editTableCell(next,target,true);else this.view.focus();
      });
    });
    input.addEventListener('input',event=>{content.textContent=input.value||'\u200b';commit(false,event.inputType==='insertText');});
    input.addEventListener('compositionstart',()=>{active.composing=true;});
    input.addEventListener('compositionend',()=>{active.composing=false;commit(false,true);});
    input.addEventListener('blur',()=>{
      // CodeMirror can temporarily blur a reused widget while applying undo.
      // Wait until that transaction has reconciled the value before committing.
      queueMicrotask(()=>{if(this.activeTableCell===active&&!active.writing&&!active.reconciling&&document.activeElement!==input){if(!active.composing)commit();this.finishTableCell();}});
    });
    input.addEventListener('keydown',event=>{
      if(event.isComposing||active.composing||event.keyCode===229)return;
      if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();event.stopPropagation();commit();const prefix=input.value.slice(0,input.selectionStart||0).replace(/\n/g,'<br>').replace(/(?<!\\)\|/g,'\\|');this.openLinkAt(active.from+prefix.length);return;}
      if(event.shiftKey&&event.key==='Enter'){event.preventDefault();event.stopPropagation();input.setRangeText('\n',input.selectionStart,input.selectionEnd,'end');commit();return;}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){
        event.preventDefault();event.stopPropagation();commit();this.options.onSave?.();return;
      }
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){
        event.preventDefault();event.stopPropagation();this.openSearch();return;
      }
      if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){
        event.preventDefault();event.stopPropagation();
        active.reconciling=true;
        try{(event.key.toLowerCase()==='y'||event.shiftKey?redo:undo)(this.view);}
        finally{active.reconciling=false;if(this.activeTableCell===active&&input.isConnected)input.focus({preventScroll:true});}
        return;
      }
      if(!['Tab','Enter','Escape'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();commit();
      if(event.key==='Enter'){void this.finishTableInput(active);return;}
      const table=widget.querySelector('table'),cells=[...table.querySelectorAll('th,td')];
      const next=event.key==='Tab'?cells[cells.indexOf(cell)+(event.shiftKey?-1:1)]:event.key==='Enter'?table.rows[row+(event.shiftKey?-1:1)]?.cells[column]:null;
      if(next){this.editTableCell(widget,next,true);return;}
      if(event.key==='Tab'&&!event.shiftKey){this.table('row-add',0);return;}
      const block=core.tableAt(this.getEditorText(),active.from);
      this.finishTableCell();this.view.dispatch({selection:{anchor:Math.min(this.view.state.doc.length,(event.shiftKey?block?.from-1:block?.to+1)||0)},scrollIntoView:false});this.view.focus();
    });
    input.focus({preventScroll:true});
    const at=caret===null?input.value.length:Math.max(0,Math.min(input.value.length,caret));
    input.setSelectionRange(at,at);
    if(reveal)cell.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  async finishTableInput(active) {
    if(active.finishing)return;
    active.finishing=true;const value=active.input.value;
    try{
      const saved=await this.options.onFinishInput?.();
      if(saved===false)throw new Error('本地保存失败，请重试');
      if(this.destroyed||this.activeTableCell!==active||active.input.value!==value)return;
      this.finishTableCell();active.widget.focus({preventScroll:true});
    }catch(error){this.statusHost.textContent=error.message;active.input.focus({preventScroll:true});}
    finally{active.finishing=false;}
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
    this.find?.attach();
    if(!['edit','source','preview'].includes(mode))mode='edit';
    if(this.mode===mode && this.modeInitialized)return;
    this.modeInitialized=true;
    const prior=this.mode;this.mode=mode;this.root.dataset.mode=mode;
    this.editHost.hidden=mode==='preview';this.readHost.hidden=mode!=='preview';
    if(mode==='preview'){
      const doc=this.view?.state.doc,pos=this.view?.state.selection.main.head||0;this.renderReading();
      requestAnimationFrame(()=>{
        // A file reload or a quick mode switch can replace this document before
        // the frame runs. Its old offset must not be resolved in the new text.
        if(this.destroyed||this.mode!=='preview'||this.view?.state.doc!==doc||this.find?.matches.length)return;
        const anchors=[...this.readHost.querySelectorAll('[data-source-line]')];
        const line=this.view.state.doc.lineAt(pos).number-1;
        anchors.filter(el=>Number(el.dataset.sourceLine)<=line).at(-1)?.scrollIntoView({block:'nearest'});
      });
    }
    if(this.view){
      this.view.dispatch({effects:[refreshEffect.of(null),this.lineConfig.reconfigure(mode==='source'?[lineNumbers(),highlightActiveLine()]:[])]});
      if(prior==='preview'&&mode!=='preview'){
        this.view.requestMeasure();
        if(!this.find?.dom.contains(document.activeElement))this.view.focus();
        this.view.dispatch({effects:EditorView.scrollIntoView(this.view.state.selection.main.head,{y:'nearest'})});
      }
    }
    this.find?.syncQuery();
    this.find?.update();
    if(mode==='preview'&&this.find?.matches.length)this.find.reveal();
  }
  renderReading() {
    const scroll=this.readHost.scrollTop;
    this.readHost.innerHTML=this.renderer.render(this.getEditorText(),{noteId:this.options.noteId,stack:[this.options.noteId]});
    this.readHost.querySelectorAll('table').forEach((table,index)=>this.applyTableWidths(table,0,index));
    this.readHost.scrollTop=scroll;Promise.resolve(this.renderer.enhance(this.readHost)).then(()=>{if(!this.destroyed)this.find?.update(true);});this.find?.update();
  }
  handleRenderedClick(event,base) {
    const target=event.target;
    if(target.closest('.kn-code-copy')){
      event.preventDefault();event.stopPropagation();const button=target.closest('button');
      // The rendered fence includes one structural newline before its closing
      // marker. Keep intentional blank lines, without copying that terminator.
      const code=(button.parentElement.querySelector('pre code')?.textContent||'').replace(/\n$/,'');
      navigator.clipboard.writeText(code).then(()=>{button.textContent='已复制';}).catch(()=>{button.textContent='复制失败';});return;
    }
    const box=target.closest('input[data-task-pos]');
    if(box){
      if(box.closest('.kn-embed-body')){event.preventDefault();return;}
      const pos=base+Number(box.dataset.taskPos);const old=this.view.state.doc.sliceString(pos,pos+1);
      if(/[ xX]/.test(old))this.view.dispatch({changes:{from:pos,to:pos+1,insert:old===' '?'x':' '},userEvent:'input'});return;
    }
    const hit=target.closest('a,[data-note-target],.kn-external-link');
    if(hit){event.preventDefault();event.stopPropagation();}
    if(hit&&event.detail>0){
      // Editing may replace a cell between pointer down and click. The new
      // link under the pointer must not inherit a click on ordinary cell text.
      if(this.pointerLink!==hit)return;
      const range=document.createRange();range.selectNodeContents(hit);
      if(![...range.getClientRects()].some(r=>event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom))return;
    }
    if(hit?.classList.contains('kn-external-link')){this.openLinkAt(Number(hit.dataset.knLinkFrom)+1);return;}
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
    // Same rules as embeds: block ids inside code/comments are not anchors, and
    // heading matching ignores case and Unicode form on both sides.
    const target=core.anchorOffset(this.getEditorText(),anchor);
    if(typeof target==='number'&&target>=0)this.locate(target);
  }
  locate(pos) {
    pos=Math.max(0,Math.min(this.view.state.doc.length,pos));
    this.view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'start'}),scrollIntoView:true});
    if(this.mode==='preview'){
      const hs=core.headings(this.getEditorText()),index=hs.findIndex(h=>h.offset===pos);
      this.readHost.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({block:'start'});
    }else this.view.focus();
  }
  formatDocument(rules) {
    if(this.view.composing || this.activeTableCell?.composing)return null;
    const result=documentFormat(this.view.state,rules);
    if(!result?.changes.length)return result;
    this.finishTableCell();
    this.view.dispatch({changes:result.changes,annotations:isolateHistory.of('full'),userEvent:'input.format'});
    return result;
  }
  selectedLink() {
    const view=this.view,{from,to}=view.state.selection.main;
    if(this.activeTableCell || view.state.doc.lineAt(from).number!==view.state.doc.lineAt(to).number)return null;
    forceParsing(view,to);
    let link=syntaxTree(view.state).resolveInner(from,1);
    while(link&&link.name!=='Link')link=link.parent;
    if(!link||link.to<to||!link.getChild('URL'))return null;
    const marks=link.getChildren('LinkMark');
    if(marks.length<4||marks[0].from!==link.from||view.state.sliceDoc(marks[1].from,marks[1].to)!==']')return null;
    const labelFrom=marks[0].to,labelTo=marks[1].from;
    if(from===to && (from<labelFrom || from>labelTo))return null;
    return {from:link.from,to:link.to,labelFrom,label:view.state.sliceDoc(labelFrom,labelTo)};
  }
  canLinkSelection() {
    const {from,to}=this.view.state.selection.main,doc=this.view.state.doc;
    return !this.activeTableCell&&doc.lineAt(from).number===doc.lineAt(to).number;
  }
  format(action,value) {
    if(this.mode==='preview')return false;
    const view=this.view,{from,to}=view.state.selection.main,doc=view.state.doc,text=doc.sliceString(from,to);
    if(action==='undo'||action==='redo'){const applied=(action==='undo'?undo:redo)(view);view.focus();return applied;}
    if(action==='unlink'){
      const link=this.selectedLink();if(!link)return false;
      const map=pos=>link.from+Math.max(0,Math.min(pos-link.labelFrom,link.label.length));
      const {anchor,head}=view.state.selection.main;
      view.dispatch({changes:{from:link.from,to:link.to,insert:link.label},selection:{anchor:map(anchor),head:map(head)},annotations:isolateHistory.of('full'),userEvent:'input.format'});
      view.focus();return true;
    }
    const wraps={bold:'**',italic:'*',strike:'~~',inline:'`',highlight:'=='};
    // A focused table cell owns its own selection: format the textarea text and
    // commit it, instead of wrapping the (collapsed) CodeMirror selection at the
    // cell's first character.
    const activeCell=this.activeTableCell;
    if(activeCell&&activeCell.commit&&wraps[action]){
      const input=activeCell.input,start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
      const chosen=input.value.slice(start,end),token=action==='inline'?inlineFence(chosen):wraps[action],direction=input.selectionDirection;
      const inner=action==='inline'&&/^`|`$/.test(chosen)?' '+chosen+' ':chosen;
      const wrapped=chosen.length>=2*token.length&&chosen.startsWith(token)&&chosen.endsWith(token);
      const surrounding=start>=token.length&&input.value.slice(start-token.length,start)===token&&input.value.slice(end,end+token.length)===token;
      let from=start,to=end,next,selectionStart,selectionEnd;
      if(wrapped){next=chosen.slice(token.length,-token.length);selectionStart=from;selectionEnd=from+next.length;}
      else if(surrounding){from-=token.length;to+=token.length;next=chosen;selectionStart=from;selectionEnd=from+next.length;}
      else {next=token+inner+token;selectionStart=from+token.length;selectionEnd=selectionStart+inner.length;}
      input.setRangeText(next,from,to,'preserve');
      input.setSelectionRange(selectionStart,selectionEnd,direction);
      activeCell.commit(true);input.focus({preventScroll:true});
      // Committing maps the caret into Markdown and collapses the native field.
      // Keep the user's text selected so the same command can remove its marks.
      input.setSelectionRange(selectionStart,selectionEnd,direction);
      return true;
    }
    if(wraps[action]){
      const token=wraps[action],changes=[],ranges=[];
      const first=doc.lineAt(from),last=doc.lineAt(to>from?to-1:to);
      if(action==='inline'&&first.number!==last.number)return false;
      forceParsing(view,last.to);
      const type={bold:'StrongEmphasis',italic:'Emphasis',strike:'Strikethrough',inline:'InlineCode'}[action];
      const marker=action==='inline'?'CodeMark':action==='strike'?'StrikethroughMark':'EmphasisMark';
      let delta=0;
      for(let n=first.number;n<=last.number;n++){
        const line=doc.line(n);
        // Inline formatting leaves Markdown block markers outside emphasis.
        const prefix=line.text.match(/^[ \t]*(?:>[ \t]*)*(?:#{1,6}[ \t]+|(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/)[0];
        let a=Math.max(from,line.from+prefix.length),b=Math.min(to,line.to);
        if(from===to)a=b=from;
        if(a>b || (a===b&&from!==to))continue;
        const text=doc.sliceString(a,b);
        let enclosing=syntaxTree(view.state).resolveInner(a,1);
        while(enclosing&&enclosing.name!==type)enclosing=enclosing.parent;
        const markers=enclosing?.getChildren(marker);
        // A longer fence is required when the selection itself contains backticks,
        // otherwise the first inner backtick closes the span early.
        const fence=action==='inline'?inlineFence(text):token;
        const inner=action==='inline'&&/^`|`$/.test(text)?' '+text+' ':text;
        let insert,offset=0,length;
        if(markers?.length===2&&a===markers[0].to&&b===markers[1].from){a=enclosing.from;b=enclosing.to;insert=text;length=text.length;}
        else if(text.startsWith(fence)&&text.endsWith(fence)&&text.length>=2*fence.length){insert=text.slice(fence.length,-fence.length);length=insert.length;}
        else if(action==='highlight'&&a>=fence.length&&doc.sliceString(a-fence.length,a)===fence&&doc.sliceString(b,b+fence.length)===fence){a-=fence.length;b+=fence.length;insert=text;length=text.length;}
        else {insert=fence+inner+fence;offset=fence.length;length=inner.length;}
        ranges.push({from:a+delta+offset,to:a+delta+offset+length});
        changes.push({from:a,to:b,insert});
        delta+=insert.length-(b-a);
      }
      if(!changes.length)return false;
      const backward=view.state.selection.main.anchor>view.state.selection.main.head;
      const start=ranges[0].from,end=ranges.at(-1).to;
      view.dispatch({changes,selection:{anchor:backward?end:start,head:backward?start:end},annotations:isolateHistory.of('full'),userEvent:'input.format'});view.focus();return true;
    }
    if(['heading','bullet','ordered','task','quote'].includes(action)){
      const first=doc.lineAt(from);let last=doc.lineAt(to>from?to-1:to);
      while(last.number>first.number&&!last.text.trim())last=doc.line(last.number-1);
      const changes=[];
      for(let n=first.number;n<=last.number;n++){
        const line=doc.line(n);const clean=line.text.replace(/^(\s*)(?:#{1,6}\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/,'$1');
        const indent=clean.match(/^\s*/)[0],body=clean.slice(indent.length);
        // Re-applying a format must not clear state the user already has: an
        // existing task item keeps its checked mark.
        const existing=action==='task'?/^\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s+/.exec(line.text):null;
        const prefix=action==='heading'?'#'.repeat(Math.max(0,Math.min(6,Number(value)||0)))+(Number(value)?' ':''):action==='ordered'?`${n-first.number+1}. `:action==='task'?(existing?`- [${existing[1]}] `:'- [ ] '):action==='quote'?'> ':'- ';
        changes.push({from:line.from,to:line.to,insert:indent+prefix+body});
      }
      view.dispatch({changes,annotations:isolateHistory.of('full'),userEvent:'input.format'});view.focus();return true;
    }
    if(action==='link'&&!this.canLinkSelection())return false;
    const blocks={
      code:'```text\n'+text+'\n```',
      diagram:'```mermaid\nflowchart LR\n  A[开始] --> B[处理]\n  B --> C[完成]\n```',
      table:'| 项目 | 内容 |\n| --- | --- |\n|  |  |',
      rule:'---',image:value||'![图片](https://)',
      // Link labels may not contain raw brackets; escaping keeps the label the
      // user selected instead of ending the link early.
      link:`[${String(text||'链接').replace(/[\\\[\]]/g,'\\$&')}](${safeURL(value)||'https://'})`
    };
    if(!(action in blocks))return false;
    const insert=action==='link'||action==='image'?blocks[action]:'\n\n'+blocks[action]+'\n\n';
    const anchor=action==='code'?from+2+'```text\n'.length:action==='table'?from+2+blocks.table.lastIndexOf('|  |  |')+2:from+insert.length;
    const labelEnd=action==='link'?from+insert.lastIndexOf(']('):0;
    const backward=view.state.selection.main.anchor>view.state.selection.main.head;
    view.dispatch({changes:{from,to,insert},selection:action==='link'&&text?{anchor:backward?labelEnd:from+1,head:backward?from+1:labelEnd}:{anchor},annotations:isolateHistory.of('full'),userEvent:'input.format'});view.focus();
    if(action==='table'&&this.mode==='edit'){
      // A prior code block can leave incremental parsing behind this edit.
      // Materialize the new table before choosing its first editable cell.
      forceParsing(view,from+insert.length,100);
      view.dispatch({effects:refreshEffect.of(null)});
      const expected=view.state.doc;let attempts=0;
      const enterCell=()=>{
        if(this.destroyed||this.mode!=='edit'||view.state.doc!==expected||view.state.selection.main.head!==anchor)return;
        const widget=[...this.root.querySelectorAll('.kn-table-widget')].find(el=>Number(el.dataset.sourcePos)===from+2);
        const cell=widget?.querySelector('tbody td');
        if(cell)this.editTableCell(widget,cell,true);
        // CM materializes replacement widgets in its following layout pass.
        else if(++attempts<8){view.requestMeasure();requestAnimationFrame(enterCell);}
      };
      requestAnimationFrame(enterCell);
    }
    return true;
  }
  // Remove inline markers inside a selection, including several independent
  // spans, while keeping the surrounding literal text. Outer wrappers around the
  // whole selection are removed as well, matching "clear format" expectations.
  clearInlineFormat() {
    if(this.mode==='preview')return false;
    const view=this.view,{from,to}=view.state.selection.main;
    if(from===to)return false;
    const original=view.state.doc.sliceString(from,to);
    let text=original;
    for(let pass=0;pass<4;pass++){
      const next=text
        .replace(/(`+)([^`]+?)\1/g,'$2')
        .replace(/\*\*([^*\n]+?)\*\*/g,'$1')
        .replace(/__([^_\n]+?)__/g,'$1')
        .replace(/~~([^~\n]+?)~~/g,'$1')
        .replace(/==([^=\n]+?)==/g,'$1')
        .replace(/\*([^*\n]+?)\*/g,'$1')
        .replace(/(^|[^\w_])_([^_\n]+?)_(?=[^\w_]|$)/g,'$1$2');
      if(next===text)break;
      text=next;
    }
    if(text===original)return false;
    view.dispatch({changes:{from,to,insert:text},selection:{anchor:from,head:from+text.length},userEvent:'input.format'});
    view.focus();return true;
  }
  insertText(text) {this.view.dispatch(this.view.state.replaceSelection(text));this.view.focus();return true;}
  getEditorText(){return this.view.state.doc.toString();}
  getMarkdown(){return core.serializeSource(this.getEditorText(),this.view.state.field(this.lineEndings));}
  getSelection(){const r=this.view.state.selection.main;return {start:r.anchor,end:r.head};}
  captureNavigationState(){
    return {doc:this.view.state.doc,selection:this.view.state.selection,scroll:this.view.scrollSnapshot(),
      top:this.view.scrollDOM.scrollTop,left:this.view.scrollDOM.scrollLeft,readingTop:this.readHost.scrollTop};
  }
  restoreNavigationState(saved){
    if(!saved||this.destroyed)return;
    if(this.view.state.doc===saved.doc)this.view.dispatch({selection:saved.selection,effects:saved.scroll});
    else {
      const length=this.view.state.doc.length,range=saved.selection.main;
      this.view.dispatch({selection:{anchor:Math.min(length,range.anchor),head:Math.min(length,range.head)}});
      this.view.scrollDOM.scrollTop=saved.top;this.view.scrollDOM.scrollLeft=saved.left;
    }
    this.readHost.scrollTop=saved.readingTop;
  }
  restoreSelection(r){this.view.dispatch({selection:{anchor:r.start,head:r.end}});this.view.focus();}
  getFormatState(){const node=syntaxTree(this.view.state).resolveInner(this.view.state.selection.main.head,-1);const names=[];for(let n=node;n;n=n.parent)names.push(n.name);return {bold:names.includes('StrongEmphasis'),italic:names.includes('Emphasis'),strike:names.includes('Strikethrough'),inline:names.includes('InlineCode'),heading:names.find(n=>/^ATXHeading\d/.test(n))?.slice(-1)||'0',undo:true,redo:true};}
  openSearch(query){this.find.open(query);}
  tableIndex(pos) {
    let index=-1;syntaxTree(this.view.state).iterate({enter:node=>{if(node.name==='Table'&&node.from<=pos)index++;}});return index;
  }
  applyTableWidths(widget,pos,index=this.tableIndex(pos)) {
    const table=widget.matches('table')?widget:widget.querySelector('table');if(!table||!this.view)return;
    const widths=this.options.tableColumnWidths?.[index],cells=[...(table.rows[0]?.cells||[])];
    const custom=widths?.length===cells.length;
    table.style.width=custom?widths.reduce((a,b)=>a+b,0)+'px':'';
    table.style.tableLayout=custom?'fixed':'';
    for(const row of table.rows)for(let c=0;c<row.cells.length;c++)row.cells[c].style.width=custom?widths[c]+'px':'';
  }
  resizeTableColumn(column,width,widget=null) {
    // Resize the table the gesture actually belongs to, not the table of the
    // current selection: dragging a second table while a first one is being
    // edited must not commit to the first table.
    const block=core.tableAt(this.getEditorText(),widget?Number(widget.dataset.sourcePos):this.view.state.selection.main.head);
    width=Math.round(Number(width));
    if(!block||!Number.isFinite(width)||width<80||width>1600||column<0||column>=block.rows[0].length)return false;
    const index=this.tableIndex(block.from),tables=(this.options.tableColumnWidths||[]).map(row=>row.slice());
    while(tables.length<=index)tables.push([]);
    const target=widget||this.root.querySelector(`.kn-table-widget[data-source-pos="${block.from}"]`);
    const table=target?.matches('table')?target:target?.querySelector('table');
    const measured=Array.from(table?.rows[0]?.cells||[],cell=>Math.round(cell.getBoundingClientRect().width));
    tables[index]=Array.from({length:block.rows[0].length},(_,c)=>tables[index][c]||measured[c]||120);tables[index][column]=width;
    this.view.dispatch({annotations:isolateHistory.of('full'),effects:tableWidthsEffect.of(tables),userEvent:'input.table-width'});
    return true;
  }
  // Width available to a table inside the note viewport, independent of the
  // page padding: fitting to the page's clientWidth left wide tables wider than
  // the visible area and scrolled the whole document horizontally.
  tableViewportWidth(widget=null) {
    const host=this.mode==='preview'?this.readHost:this.view.contentDOM;
    const measured=widget?.querySelector('.kn-table-stage')?.clientWidth||host?.clientWidth||0;
    return Math.max(240,Math.floor(measured||640));
  }
  fitTableWidth(width,widget=null) {
    const block=core.tableAt(this.getEditorText(),widget?Number(widget.dataset.sourcePos):this.view.state.selection.main.head);if(!block)return false;
    const tables=this.view.state.field(this.tableWidths).map(row=>row.slice()),idx=this.tableIndex(block.from);while(tables.length<=idx)tables.push([]);
    const columns=block.rows[0].length;
    const available=Math.floor(Number(width)||this.tableViewportWidth(widget));
    tables[idx]=width||widget?Array(columns).fill(Math.max(80,Math.min(1600,Math.floor(available/columns)))):[];
    this.view.dispatch({annotations:isolateHistory.of('full'),effects:tableWidthsEffect.of(tables),userEvent:'input.table-width'});return true;
  }
  table(operation,index=0,value){
    if(this.mode==='preview')return false;
    const pos=this.activeTableCell?.from??this.view.state.selection.main.head;
    for(let n=syntaxTree(this.view.state).resolveInner(pos,-1);n;n=n.parent)if(n.name==='FencedCode'||n.name==='IndentedCode')return false;
    const block=core.tableAt(this.getEditorText(),pos),change=core.editTable(this.getEditorText(),pos,operation,index,value);if(!change)return false;
    index=Math.max(0,Math.min(block.rows[0].length-1,index));
    const active=this.activeTableCell,row=active?.row??Math.max(0,(block.row===0?0:block.row-1));
    let targetRow=row,targetColumn=index;
    if(operation==='row-add')targetRow=Math.max(1,row+1);
    if(operation==='row-before')targetRow=Math.max(1,row);
    if(operation==='row-delete')targetRow=Math.max(0,row-1);
    if(operation==='column-add')targetColumn=index+1;
    if(operation==='column-delete')targetColumn=Math.max(0,index-1);
    const tables=this.view.state.field(this.tableWidths).map(row=>row.slice()),tableIndex=this.tableIndex(block.from);
    const widths=tables[tableIndex];let changedWidths=false;
    if(operation==='delete'){tables.splice(tableIndex,1);changedWidths=true;}
    else if(widths?.length){
      if(operation==='column-add'||operation==='column-before'){widths.splice(index+(operation==='column-add'?1:0),0,120);changedWidths=true;}
      if(operation==='column-duplicate'){widths.splice(index+1,0,widths[index]);changedWidths=true;}
      if(operation==='column-delete'){widths.splice(index,1);changedWidths=true;}
      if(operation==='column-move'){widths.splice(Number(value),0,widths.splice(index,1)[0]);changedWidths=true;}
    }
    if(operation==='row-duplicate')targetRow=row+1;
    if(operation==='row-move')targetRow=Number(value)-1;
    if(operation==='column-move')targetColumn=Number(value);
    if(operation==='column-duplicate')targetColumn=index+1;
    this.finishTableCell();
    this.view.dispatch({changes:change,selection:{anchor:change.from},annotations:isolateHistory.of('full'),effects:changedWidths?[tableWidthsEffect.of(tables)]:[],userEvent:'input.table'});
    if(this.mode==='edit'&&operation!=='delete')requestAnimationFrame(()=>{
      if(this.destroyed)return;
      const widget=[...this.root.querySelectorAll('.kn-table-widget')].find(el=>Number(el.dataset.sourcePos)===change.from);
      const cell=widget?.querySelector('table')?.rows[targetRow]?.cells[targetColumn];
      if(cell)this.editTableCell(widget,cell,true);else this.view.focus();
    });else this.view.focus();
    return true;
  }
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
    const doc=this.getEditorText(),changes=[];
    const managed=new Map((assets||[]).filter(asset=>asset.managed).map(asset=>[asset.source,asset.relativePath]));
    if(managed.size){for(const ref of window.LoopShareMarkdown.scan(doc)){const destination=managed.get(ref.destination);if(destination&&Number.isInteger(ref.destinationFrom))changes.push({from:ref.destinationFrom,to:ref.destinationTo,insert:destination});}}
    for(const asset of assets||[]){if(asset.managed||!asset.source||!asset.relativePath)continue;for(const ref of core.imageReferences(doc)){if(ref.url===asset.source)changes.push({from:ref.from,to:ref.to,insert:asset.relativePath});}}
    if(changes.length)this.view.dispatch({changes:changes.sort((a,b)=>a.from-b.from),annotations:Transaction.addToHistory.of(false),userEvent:'input.assets'});
  }
  refresh(){this.renderCache.clear();if(this.mode==='preview')this.renderReading();this.view.dispatch({effects:refreshEffect.of(null)});this.view.requestMeasure();}
  destroy(){this.destroyed=true;this.events?.abort();this.find?.destroy();this.view.destroy();instances.delete(this.root);return Promise.resolve();}
}
window.LoopKnowledgeEditor={create:async options=>new KnowledgeEditor(options),createRenderer,safeURL,instances};

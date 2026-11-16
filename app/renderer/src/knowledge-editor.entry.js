import {EditorState,EditorSelection,StateField,StateEffect,Compartment,Prec,Transaction,MapMode} from '@codemirror/state';
import {EditorView,keymap,Decoration,WidgetType,drawSelection,highlightActiveLine,rectangularSelection,crosshairCursor,lineNumbers,placeholder} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,indentWithTab,indentMore,indentLess,undo,redo,invertedEffects,isolateHistory} from '@codemirror/commands';
import {markdown,markdownLanguage,insertNewlineContinueMarkupCommand,deleteMarkupBackward} from '@codemirror/lang-markdown';
import {yamlFrontmatter} from '@codemirror/lang-yaml';
import {languages} from '@codemirror/language-data';
import {syntaxTree,ensureSyntaxTree,syntaxHighlighting,HighlightStyle,indentUnit,bracketMatching,forceParsing} from '@codemirror/language';
import {closeBrackets,closeBracketsKeymap,autocompletion,completionKeymap} from '@codemirror/autocomplete';
import {searchKeymap,highlightSelectionMatches} from '@codemirror/search';
import {KnowledgeFind,knowledgeFindMarks} from './knowledge-search.js';
import {installTableControls} from './knowledge-table-controls.js';
import {applyTableRowHeights,preferredColumnWidth} from './knowledge-table-sizing.js';
import {tableGeometry,measureTableColumns,applyTableColumnWidths,cellBounds,mergeBounds,splitSpan,editSpan} from './knowledge-span-grid.js';
import {spanCellToPipe} from './knowledge-span-content.js';
import {decodeTableCell,encodeTableCell} from './knowledge-table-content.js';
import {clipboardTable,copyTableGrid} from './knowledge-table-clipboard.js';
import {VisualTableCell} from './knowledge-table-visual.js';
import {tags} from '@lezer/highlight';
import {obsidianComments} from './knowledge-syntax.js';
import {createRenderer,safeURL,escape,imageLayout} from './knowledge-renderer.js';
import {documentFormat,spacingAt,typedSpacing} from './knowledge-format.js';
const core=window.LoopKnowledgeCore;
const refreshEffect=StateEffect.define(),tableWidthsEffect=StateEffect.define(),tableHeightsEffect=StateEffect.define(),expandBlockEffect=StateEffect.define(),clearExpandedEffect=StateEffect.define();
const instances=new WeakMap();
const cellMarkdown=markdown({base:markdownLanguage,addKeymap:false,completeHTMLTags:false});
function trimTableWidths(widths){
  while(widths.length&&!widths.at(-1).length)widths.pop();
  return widths;
}
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
      }else if(this.kind==='block'&&this.nodeName==='Blockquote'){
        const mapped=this.owner.calloutPositionAt(this.from,event);
        if(mapped!==null) pos=mapped;
      }
      view.dispatch({selection:{anchor:pos},scrollIntoView:false}); view.focus();
      this.owner.showBlockCaret(el,event);
    });
    if(this.kind==='block'&&this.nodeName!=='Table'){
      el.title='双击编辑源码';
      el.tabIndex=0;
      const expand=event=>{
        if(event.type==='keydown'&&event.key!=='Enter'&&event.key!=='F2')return;
        event.preventDefault();event.stopPropagation();
        let pos=this.from;
        if(this.nodeName==='FencedCode'){const mapped=this.owner.codePositionAt(this.from,event);if(mapped!==null)pos=mapped;}
        this.owner.expandBlock(this.from,pos);
      };
      el.addEventListener('dblclick',expand);
      el.addEventListener('keydown',expand);
    }
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
  constructor(owner,table,source,reference){
    super('',owner,table.from,'block',table.to,'Table');
    this.context=table.prefix?.includes('>')?'quote':table.prefix?'indent':'';
    this.source=source;
    this.reference=reference;
    this.references=JSON.stringify(reference.references||null);
    this.revision=owner.renderRevision;
  }
  eq(other){
    if(this.from!==other.from||this.to!==other.to||this.context!==other.context||
      this.source!==other.source||this.references!==other.references)return false;
    if(this.revision===other.revision)return true;
    // A save can refresh asset references without changing the rendered table.
    // Preserve its focused editor when the resulting markup is identical.
    const [previous,next]=this.revision<other.revision?[this,other]:[other,this];
    return Boolean(previous.html)&&previous.html===next.renderTable();
  }
  renderTable(){return this.html||=this.owner.renderWidgetHTML('Table',this.source,this.reference);}
  toDOM(view) {
    const el=document.createElement('div');el.className='kn-live-widget kn-rendered kn-table-widget';
    el.dataset.sourcePos=String(this.from);el.dataset.sourceTo=String(this.to);el.innerHTML=this.renderTable();
    const table=el.querySelector('table');
    if(!table?.rows.length){this.html=el.innerHTML;return super.toDOM(view);}
    el.dataset.tableContext=this.context;
    this.owner.applyTableWidths(table,this.from,undefined,view.state);
    this.owner.decorateImages(el);
    installTableControls(this.owner,el);
    this.owner.queueTableHeaders();
    // The widget itself is the keyboard entry point for existing cells: Tab
    // reaches it, Enter/ArrowDown opens the first body cell, and nothing has to
    // add or restructure a row first.
    el.tabIndex=0;el.setAttribute('role','group');
    const geometry=tableGeometry(table);
    el.setAttribute('aria-label',`表格 ${table.rows.length-1} 行 ${geometry.columns} 列，回车编辑，拖动或 Shift 加方向键选择单元格`);
    const cellAt=target=>{
      const cell=target?.closest('td,th');
      return cell?.closest('table')===table?cell:null;
    };
    let suppressClick=false;
    el.addEventListener('pointerdown',event=>{
      el.stopTableSelection?.();
      suppressClick=false;
      if(event.pointerType!=='mouse'||event.button!==0||event.shiftKey||event.target.closest('button,a,img'))return;
      const first=cellAt(event.target),anchor=geometry.positions.get(first);
      if(!anchor)return;
      const drag=new AbortController(),{pointerId}=event;
      let head=anchor;
      const stop=()=>{
        drag.abort();delete el.dataset.tableSelecting;delete el.stopTableSelection;
      };
      el.stopTableSelection=stop;
      window.addEventListener('pointermove',move=>{
        if(move.pointerId!==pointerId)return;
        if(!el.isConnected||!(move.buttons&1)){stop();return;}
        const next=geometry.positions.get(cellAt(document.elementFromPoint(move.clientX,move.clientY)));
        if(!next||next===head)return;
        if(!suppressClick){
          if(Math.hypot(move.clientX-event.clientX,move.clientY-event.clientY)<5||!this.owner.settleTableCell())return;
          suppressClick=true;el.dataset.tableSelecting='true';
          el.focus({preventScroll:true});window.getSelection()?.removeAllRanges();
        }
        move.preventDefault();
        head=next;this.owner.selectTableRange(el,anchor,head);
      },{capture:true,signal:drag.signal});
      for(const type of ['pointerup','pointercancel'])window.addEventListener(type,end=>{if(end.pointerId===pointerId)stop();},{capture:true,signal:drag.signal});
      window.addEventListener('blur',stop,{once:true,signal:drag.signal});
    });
    el.addEventListener('keydown',event=>{
      if(event.isComposing||event.keyCode===229)return;
      // Cell typing and native button activation belong to their own controls.
      if(event.target!==el&&event.target.closest?.('button,.kn-table-cell-editor'))return;
      if(event.key==='Escape'&&el.cellRange){event.preventDefault();this.owner.clearTableRange(el);return;}
      const direction={ArrowDown:[1,0],ArrowUp:[-1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[event.key];
      if(event.shiftKey&&direction){
        const anchor=el.cellAnchor||{row:table.rows.length>1?1:0,col:0};
        const head=el.cellRange?.head||anchor;
        const target=geometry.slots[head.row][head.col],position=geometry.positions.get(target);
        const next={row:Math.max(0,Math.min(table.rows.length-1,(direction[0]>0?position.row+target.rowSpan-1:head.row)+direction[0])),
          col:Math.max(0,Math.min(geometry.columns-1,(direction[1]>0?position.col+target.colSpan-1:head.col)+direction[1]))};
        event.preventDefault();event.stopPropagation();this.owner.selectTableRange(el,anchor,next);return;
      }
      if(!direction&&!['Enter',' '].includes(event.key))return;
      if(el.cellRange&&(event.key==='Enter'||event.key===' ')){
        event.preventDefault();el.querySelector('[data-table-action="tools"]')?.click();return;
      }
      const body=el.querySelector('table tbody td')||el.querySelector('table th');
      if(!body)return;
      event.preventDefault();event.stopPropagation();
      this.owner.editTableCell(el,body,true);
    });
    el.addEventListener('mousedown',event=>{
      if(event.button!==0||event.target.closest('button,a,input,textarea,.kn-table-cell-visual'))return;
      if(event.target.closest('img')){event.preventDefault();event.stopPropagation();view.focus();return;}
      const cell=cellAt(event.target);if(!cell)return;
      event.preventDefault();event.stopPropagation();
      const position=geometry.positions.get(cell);
      if(event.shiftKey&&!this.owner.activeTableCell?.composing){
        if(!this.owner.settleTableCell())return;
        this.owner.selectTableRange(el,el.cellAnchor||position,position);
        el.focus({preventScroll:true});return;
      }
      this.owner.clearTableRange(el);
      this.owner.editTableCell(el,cell,false,this.owner.cellCaretAt(el,cell,event),{left:event.clientX,top:event.clientY});
    });
    el.addEventListener('copy',event=>{
      if(!el.cellRange||!event.clipboardData||this.owner.activeTableCell?.widget===el)return;
      const {top,left,bottom,right}=el.cellRange.bounds,rows=[];
      for(let row=top;row<=bottom;row++){
        const columns=[];
        for(let col=left;col<=right;col++){
          const cell=geometry.slots[row]?.[col],position=geometry.positions.get(cell);
          columns.push(position?.row===row&&position.col===col?cell.innerText.replace(/[\t\r\n]+/g,' '):'');
        }
        rows.push(columns);
      }
      event.preventDefault();copyTableGrid(event.clipboardData,rows);
    });
    el.addEventListener('click',event=>{
      if(suppressClick&&event.detail){event.preventDefault();event.stopPropagation();suppressClick=false;return;}
      this.owner.handleRenderedClick(event,this.from);
    });return el;
  }
  updateDOM(el,view) {
    // Never reuse another table's focused field when several tables redraw.
    if(Number(el.dataset.sourcePos)!==this.from)return false;
    if(el.dataset.tableContext!==this.context)return false;
    const next=document.createElement('div');next.innerHTML=this.renderTable();
    const oldTable=el.querySelector('table'),newTable=next.querySelector('table');if(!oldTable||!newTable)return false;
    const oldRows=[...oldTable.rows],rows=[...newTable.rows];
    if(rows.length!==oldRows.length||rows.some((row,i)=>row.cells.length!==oldRows[i].cells.length))return false;
    if(oldTable.hasAttribute('data-loop-table')!==newTable.hasAttribute('data-loop-table')||
      rows.some((row,r)=>[...row.cells].some((cell,c)=>cell.colSpan!==oldRows[r].cells[c].colSpan||cell.rowSpan!==oldRows[r].cells[c].rowSpan)))return false;
    el.dataset.sourcePos=String(this.from);el.dataset.sourceTo=String(this.to);
    for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].cells.length;c++){
      const cell=oldRows[r].cells[c],fresh=rows[r].cells[c],active=this.owner.activeTableCell;
      if(active?.cell===cell){
        // Keep the transparent editor as the only painted text. The hidden
        // content sizes the row, while the rendered version returns on blur.
        active.renderedHTML=fresh.innerHTML;
        active.renderedNodes=null;
        active.content.textContent=active.input.value||'\u200b';
      }else cell.innerHTML=fresh.innerHTML;
      cell.style.textAlign=fresh.style.textAlign;
    }
    this.owner.decorateImages(el);this.owner.applyTableWidths(el,this.from,undefined,view.state);el.tableControls?.refresh();this.owner.queueTableHeaders();return true;
  }
  destroy(el){el.stopTableSelection?.();el.tableControls?.destroy();if(this.owner.activeTableCell?.widget===el)this.owner.finishTableCell();}
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

const cellListMarker=/^( *)([-+*]|\d{1,9}[.)])(?:[ \t]+|$)/;
function moveCellListItem({state,dispatch},outdent) {
  const selection=state.selection.main;
  const {doc}=state,line=doc.lineAt(selection.from);
  const at=line.from+line.text.match(/^\s*/)[0].length;
  let item=syntaxTree(state).resolveInner(at,1);
  while(item&&item.name!=='ListItem')item=item.parent;
  if(!item)return false;
  const marker=cellListMarker.exec(doc.lineAt(item.from).text);
  if(!marker)return false;
  let relative=outdent?item.parent?.parent:item.prevSibling;
  if(!outdent&&!relative)relative=item.parent?.prevSibling?.lastChild;
  if(relative?.name!=='ListItem')return false;
  const relativeMarker=cellListMarker.exec(doc.lineAt(relative.from).text);
  if(!relativeMarker)return false;
  const indent=marker[1].length;
  const newIndent=outdent?relativeMarker[1].length:relativeMarker[0].length;
  const delta=newIndent-indent;
  if(outdent?delta>=0:delta<=0)return false;
  let lastItem=item;
  while(lastItem.nextSibling?.name==='ListItem'&&lastItem.nextSibling.from<selection.to)lastItem=lastItem.nextSibling;
  const changes=[];
  const firstLine=doc.lineAt(item.from).number,lastLine=doc.lineAt(lastItem.to).number;
  for(let number=firstLine;number<=lastLine;number++){
    const current=doc.line(number);
    if(!current.text.trim())continue;
    if(delta>0){
      // A nested ordered list starting above one needs a blank line before it.
      const gap=number===firstLine&&/^(?!1[.)])\d/.test(marker[2])&&doc.line(number-1).text.trim()?'\n':'';
      changes.push({from:current.from,insert:gap+' '.repeat(delta)});
    }else changes.push({from:current.from,to:current.from+Math.min(-delta,current.text.match(/^ */)[0].length),insert:''});
  }
  if(!changes.length)return false;
  dispatch(state.update({changes}));
  return true;
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
    this.tableHeights=StateField.define({create:()=>options.tableRowHeights||[],update:(value,tr)=>{for(const effect of tr.effects)if(effect.is(tableHeightsEffect))value=effect.value;return value;}});
    // A plain click on a rendered block must not replace it with raw Markdown:
    // that changes the block height and moves the note under the pointer. Blocks
    // expand only when the user explicitly edits them (double-click, Enter, the
    // first key/input) or when a caller asks for it.
    this.expandedBlocks=StateField.define({
      create:()=>new Set(),
      update:(set,tr)=>{
        let next=null;
        for(const pos of set){
          const mapped=tr.changes.mapPos(pos,-1);
          if(mapped===null)continue;
          if(mapped!==pos){if(!next)next=new Set(set);next.delete(pos);next.add(mapped);}
        }
        for(const effect of tr.effects){
          if(effect.is(clearExpandedEffect))return new Set();
          if(effect.is(expandBlockEffect)){if(!next)next=new Set(set);next.add(effect.value);}
        }
        return next||set;
      }
    });
    this.blockCaret=null;
    this.options=options; this.root=options.root; this.mode=options.mode||'edit';this.destroyed=false;this.uploads=new Map();this.nextUpload=0;
    this.renderCache=new Map();this.renderRevision=0;
    this.tableLocations=new WeakMap();this.tableWidgets=new WeakMap();this.lineConfig=new Compartment();
    this.renderer=createRenderer(options); this.root.replaceChildren();this.root.classList.add('kn-editor-host');
    this.editHost=document.createElement('div');this.editHost.className='kn-edit-surface';this.root.append(this.editHost);
    this.readHost=document.createElement('article');this.readHost.className='kn-reading kn-rendered';this.readHost.tabIndex=0;this.readHost.setAttribute('aria-label','阅读笔记');this.root.append(this.readHost);
    this.statusHost=document.createElement('div');this.statusHost.className='kn-upload-status';this.statusHost.setAttribute('role','status');this.root.append(this.statusHost);
    this.readHost.addEventListener('click',event=>this.handleRenderedClick(event,0));
    this.readHost.addEventListener('toggle',()=>this.find?.update(true),true);
    this.decorations=StateField.define({create:state=>this.buildDecorations(state),update:(decos,tr)=>{
      if(tr.docChanged||tr.selection||syntaxTree(tr.startState)!==syntaxTree(tr.state)||tr.effects.some(e=>e.is(refreshEffect)||e.is(expandBlockEffect)||e.is(clearExpandedEffect))) return this.buildDecorations(tr.state);
      return decos.map(tr.changes);
    },provide:field=>EditorView.decorations.from(field)});
    this.view=new EditorView({parent:this.editHost,state:EditorState.create({doc:source.text,extensions:[
      this.tableWidths,invertedEffects.of(tr=>tr.effects.some(e=>e.is(tableWidthsEffect))?[tableWidthsEffect.of(tr.startState.field(this.tableWidths))]:[]),
      this.tableHeights,invertedEffects.of(tr=>tr.effects.some(e=>e.is(tableHeightsEffect))?[tableHeightsEffect.of(tr.startState.field(this.tableHeights))]:[]),
      this.expandedBlocks,
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
    ]})});
    this.find=new KnowledgeFind(this);this.setMode(this.mode);instances.set(options.root,this);
    this.events=new AbortController();const signal=this.events.signal;
    this.tableScrollHost=this.root.closest('.knowledge-body')||this.view.scrollDOM;
    this.tableScrollHost.addEventListener('scroll',()=>this.queueTableHeaders(),{passive:true,signal});
    this.queueTableHeaders();
    document.addEventListener('pointerdown',event=>{
      const active=this.activeTableCell;
      if(active&&document.activeElement!==this.tableField(active)&&!active.cell.contains(event.target)&&!event.target.closest('#overlay')){
        this.finishTableCell();
      }
    },{capture:true,signal});
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
    // The first key or IME input after clicking a rendered block is an explicit
    // request to edit it. Expand before the input is applied so the caret and
    // the typed text land on the real source line.
    this.root.addEventListener('keydown',event=>{
      if(!this.blockCaret||event.isComposing||event.keyCode===229)return;
      if(['Shift','Control','Meta','Alt','CapsLock'].includes(event.key))return;
      this.expandBlockAt(this.view.state.selection.main.head);
    },{capture:true,signal});
    this.root.addEventListener('beforeinput',()=>{
      if(this.blockCaret)this.expandBlockAt(this.view.state.selection.main.head);
    },{capture:true,signal});
    this.root.addEventListener('compositionstart',()=>{
      if(this.blockCaret)this.expandBlockAt(this.view.state.selection.main.head);
    },{capture:true,signal});
    document.addEventListener('pointerdown',event=>{
      if(this.blockCaret&&!this.blockCaret.widget.contains(event.target))this.clearBlockCaret();
    },{capture:true,signal});
    this.root.addEventListener('contextmenu',event=>{
      const image=event.target.closest('img');
      if(image){
        event.preventDefault();event.stopPropagation();
        const context=this.imageContext(image);
        const layout=context?{...context.layout,set:patch=>this.setImageLayout(image,patch),
          remove:image.closest('.kn-table-widget')?()=>this.removeTableImage(image):null}:null;
        this.options.onImageMenu?.(image,{x:event.clientX,y:event.clientY},()=>this.copyImage(image),layout);
        return;
      }
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
    if(widget.querySelector('table[data-loop-table]')){
      const refs=core.imageReferences(this.getEditorText()).filter(ref=>ref.html&&ref.start>=from&&ref.end<=to);
      const images=[...widget.querySelectorAll('img:not(.ProseMirror-separator),.kn-image-missing')].filter(item=>!item.closest('.kn-embed-body'));
      const ref=refs[images.indexOf(image)];
      if(!ref||images.length!==refs.length)return null;
      const tag=this.view.state.doc.sliceString(ref.start,ref.end);
      const title=document.createElement('template');title.innerHTML=tag;
      return {node:{from:ref.start,to:ref.end},tag,layout:imageLayout(title.content.firstElementChild.getAttribute('title'))};
    }
    forceParsing(this.view,Math.min(this.view.state.doc.length,to+1));
    const nodes=[];syntaxTree(this.view.state).iterate({from,to,enter:n=>{if(n.name==='Image'){nodes.push(n.node);return false;}}});
    // A missing image still occupies its own source position. Never write to
    // another image when an unsupported construct prevents an exact match.
    const images=[...widget.querySelectorAll('img:not(.ProseMirror-separator),.kn-image-missing')].filter(item=>!item.closest('.kn-embed-body'));
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
    if(context.tag){
      const {from,to}=context.node;
      const title=core.escapeTableAttribute((layout.title?layout.title+' ':'')+marker);
      const tag=context.tag.replace(/\s(?:title|width)="[^"]*"/g,'').replace(/\s*\/?>$/,` title="${title}"${layout.width?' width="'+layout.width+'"':''}>`);
      this.view.dispatch({changes:{from,to,insert:tag},annotations:isolateHistory.of('full'),userEvent:'input.image-layout'});
      this.view.requestMeasure();return true;
    }
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
  removeTableImage(image) {
    const context=this.imageContext(image);
    if(!context)return false;
    const {from,to}=context.node;
    this.view.dispatch({changes:{from,to,insert:''},annotations:isolateHistory.of('full'),userEvent:'delete.image'});
    this.view.focus();return true;
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
    return this.linkInState(this.view.state,pos);
  }
  linkInState(state,pos) {
    const source=state.doc.toString(),wiki=core.links(source).find(link=>pos>link.from&&pos<link.to);
    if(wiki)return {wiki};
    let node=syntaxTree(state).resolveInner(pos,-1);
    while(node&&node.name!=='Link'&&node.name!=='Autolink')node=node.parent;
    if(!node||pos<=node.from||pos>=node.to)return null;
    const raw=source.slice(node.from,node.to),match=/\]\(\s*(<[^>]*>|[^\s]+?)(?:\s+["'][\s\S]*["'])?\s*\)$/.exec(raw);
    const url=(match?.[1]||(/^<.*>$/.test(raw)?raw.slice(1,-1):'')).replace(/^<|>$/g,'');
    return url?{url}:null;
  }
  openLinkAt(pos=this.view.state.selection.main.empty?this.view.state.selection.main.head:this.view.state.selection.main.from+1) {
    return this.openLink(this.linkAt(pos));
  }
  openLink(link) {
    if(!link)return false;
    if(link.wiki){this.options.onOpenLink?.(link.wiki);return true;}
    const {url}=link;
    if(url.startsWith('#')){try{this.locateAnchor(decodeURIComponent(url.slice(1)));}catch{this.locateAnchor(url.slice(1));}}
    else if(/^(https?:|mailto:)/i.test(url))this.options.onExternalLink?.(url);
    else this.options.onRelativeLink?.(url);
    return true;
  }
  tablesIn(doc) {
    let tables=this.tableLocations.get(doc);
    if(!tables){
      tables=this.renderer.tableLocations(doc.toString());
      this.tableLocations.set(doc,tables);
    }
    return tables;
  }
  tableAt(pos,doc=this.view.state.doc) {
    const table=this.tablesIn(doc).find(item=>item.from<=pos&&pos<=item.to);
    if(!table)return null;
    if(table.span)return core.spanTableAt(table,pos);
    const row=table.rows.findIndex(line=>line.to>=pos);
    return {...table,row,sourceLines:table.rows,rows:table.rows.map(line=>line.values)};
  }
  renderWidgetHTML(name,text,reference){
    const key=name+':'+text+(reference.references?JSON.stringify(reference.references):'');
    if(!this.renderCache.has(key)){
      if(this.renderCache.size>(this.renderCacheLimit||160))this.renderCache.clear();
      this.renderCache.set(key,this.renderer.render(text,{noteId:this.options.noteId,stack:[this.options.noteId],...reference}));
    }
    return this.renderCache.get(key);
  }
  blockExpanded(state,from) {
    return Boolean(state.field(this.expandedBlocks,false)?.has(from));
  }
  clearBlockCaret() {
    if(!this.blockCaret)return;
    this.blockCaret.element?.remove();
    this.blockCaret=null;
    this.root.classList.remove('kn-block-caret-active');
  }
  showBlockCaret(el,event) {
    this.clearBlockCaret();
    if(getComputedStyle(el).position==='static')el.style.position='relative';
    const rect=el.getBoundingClientRect(),height=parseFloat(getComputedStyle(el).lineHeight)||20;
    const caret=document.createElement('span');
    caret.className='kn-block-caret';
    caret.setAttribute('aria-hidden','true');
    caret.style.left=(event.clientX-rect.left)+'px';
    caret.style.top=Math.max(0,event.clientY-rect.top-height/2)+'px';
    caret.style.height=height+'px';
    el.append(caret);
    this.blockCaret={from:this.from,element:caret,widget:el};
    this.root.classList.add('kn-block-caret-active');
  }
  expandBlock(from,pos=from) {
    if(this.destroyed)return;
    this.clearBlockCaret();
    this.view.dispatch({selection:{anchor:Math.max(0,Math.min(this.view.state.doc.length,pos))},effects:expandBlockEffect.of(from),scrollIntoView:false});
    this.view.focus();
  }
  expandBlockAt(pos) {
    const state=this.view.state;
    let node=syntaxTree(state).resolveInner(pos,-1);
    while(node){
      const block=node.name==='FencedCode'||node.name==='HorizontalRule'||node.name==='Frontmatter'||
        (node.name==='Blockquote'&&/^>\s*\[!/.test(state.doc.sliceString(node.from,Math.min(node.to,node.from+80))));
      if(block){
        if(!this.blockExpanded(state,node.from))this.expandBlock(node.from,pos);
        return;
      }
      node=node.parent;
    }
  }
  buildDecorations(state) {
    if(this.mode!=='edit')return Decoration.none;
    const ranges=[],blocks=[];let blockEnd=0;
    const add=(from,to,deco)=>{if(to>=from)ranges.push(deco.range(from,to));};
    const addBlock=(from,to,deco)=>{if(to>blockEnd)blockEnd=to;add(from,to,deco);};
    const locations=this.tablesIn(state.doc);
    const tree=ensureSyntaxTree(state,state.doc.length,50)||syntaxTree(state);
    // The document-wide decorations must fit in the render cache; a fixed
    // 160-entry cap would rerender every block on each edit in a long note.
    this.renderCacheLimit=Math.max(160,state.doc.lines);
    let referenceEnv;
    const referenceFor=text=>/!\[[^\]\n]*\](?!\()/.test(text)?(referenceEnv??=this.imageReferenceEnv(state)):{};
    const widget=(node,inline=false)=>{
      const text=state.doc.sliceString(node.from,node.to);
      const html=this.renderWidgetHTML(node.name,text,referenceFor(text));
      const Type=node.name==='Image'?ImageWidget:RenderWidget;
      const body=new Type(html,this,node.from,inline?'inline':'block',node.to,node.name);
      // Lezer reuses its iteration cursor, so keep the offsets before it moves.
      if(!inline){blocks.push({from:node.from,to:node.to,lineFrom:node.lineFrom,body});return;}
      add(node.from,node.to,Decoration.replace({widget:body,inclusive:false}));
    };
    // CodeMirror keeps heights for block decorations outside its DOM viewport.
    // Dropping a table decoration during scroll substitutes wrapped Markdown
    // for that height and can move the viewport back across the same boundary.
    for(const table of locations){
      let body=this.tableWidgets.get(table);
      if(!body||body.revision!==this.renderRevision){
        const text=table.span?state.doc.sliceString(table.from,table.to):table.rows.map(row=>row.text).join('\n');
        body=new TableWidget(this,table,text,referenceFor(text));
        this.tableWidgets.set(table,body);
      }
      blocks.push({from:table.from,to:table.to,lineFrom:table.lineFrom,body});
    }
    // Height-affecting decorations belong to the document, not the viewport.
    // Replacing offscreen code/callouts/images with Markdown invalidates the
    // height map above the clicked cell, even when scrollIntoView is false.
    // CodeMirror still virtualizes their DOM and retains measured heights.
    const containingTable=node=>locations.some(table=>node.from>=table.lineFrom&&node.to<=table.to);
    tree.iterate({enter:node=>{
      if(containingTable(node))return false;
      const active=selected(state,node.from,node.to);
      if(!active && (node.name==='ObsidianComment'||node.name==='ObsidianCommentBlock'||(node.name==='HTMLBlock'&&state.doc.sliceString(node.from,node.from+4)==='<!--'))) {
        add(node.from,node.to,Decoration.replace({block:node.name!=='ObsidianComment',inclusive:false}));return false;
      }

      if(['FencedCode','HorizontalRule','Frontmatter'].includes(node.name) && !this.blockExpanded(state,node.from)){widget(node);return false;}
      if(node.name==='Blockquote' && /^>\s*\[!/.test(state.doc.sliceString(node.from,Math.min(node.to,node.from+80))) && !this.blockExpanded(state,node.from)){
        if(!locations.some(table=>node.from<table.from&&table.from<node.to)){widget(node);return false;}
        // Keep the callout label rendered while its table uses its own widget.
        const first=state.doc.lineAt(node.from);
        widget({name:node.name,from:node.from,to:first.to});
      }
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
    // Wiki embeds and math can change line heights too. Keep their decorations
    // stable offscreen, while excluding code, escapes, comments and tables.
    tree.iterate({enter:node=>{
      if(/Code|HTML|Comment/.test(node.name)||containingTable(node))return false;
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
    // Consume the surrounding newlines when available. A neighboring widget
    // may already own the preceding newline, so process blocks in source order.
    for(const block of blocks.sort((a,b)=>a.from-b.from)){
      const line=state.doc.lineAt(block.from);
      const start=line.number<=1||state.doc.line(line.number-1).to<blockEnd?block.lineFrom??block.from:state.doc.line(line.number-1).to;
      const end=block.to+(state.doc.sliceString(block.to,block.to+1)==='\n'?1:0);
      addBlock(start,end,Decoration.replace({widget:block.body,block:true,inclusive:false}));
    }
    // A widget can cover markers discovered elsewhere in the tree. Keep only
    // outermost replacements to keep CodeMirror's layout and selection valid.
    const replacements=ranges.filter(r=>r.value.spec.widget||r.value.spec.block).sort((a,b)=>a.from-b.from||b.to-a.to);
    const outer=[];for(const r of replacements)if(!outer.some(o=>r.from>=o.from&&r.from<o.to&&r.to<=o.to))outer.push(r);
    return Decoration.set(ranges.filter(r=>!replacements.includes(r)||outer.includes(r)).filter(r=>outer.includes(r)||!outer.some(o=>r.from>=o.from&&r.from<o.to&&r.to<=o.to)),true);
  }
  onUpdate(update) {
    if((update.docChanged||update.viewportChanged)&&this.blockCaret)this.clearBlockCaret();
    if(update.transactions.some(tr=>tr.effects.some(effect=>effect.is(tableWidthsEffect)))){
      this.options.tableColumnWidths=update.state.field(this.tableWidths);this.options.onTableColumnWidthsChange?.(this.options.tableColumnWidths);
      for(const widget of this.root.querySelectorAll('.kn-table-widget'))this.applyTableWidths(widget,Number(widget.dataset.sourcePos));
      if(this.mode==='preview')this.renderReading();
    }
    if(update.transactions.some(tr=>tr.effects.some(effect=>effect.is(tableHeightsEffect)))){
      this.options.tableRowHeights=update.state.field(this.tableHeights);this.options.onTableRowHeightsChange?.(this.options.tableRowHeights);
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
      if(cell?.original&&!cell.canceling){
        const {from,to}=cell.original;
        let replaced=false;
        if(!cell.writing)update.changes.iterChangedRanges((a,b)=>{if(a<to&&b>from&&(a<from||b>to))replaced=true;});
        cell.original=replaced?null:{...cell.original,from:update.changes.mapPos(from,-1),to:update.changes.mapPos(to,1)};
      }
      if(cell&&!cell.writing&&!cell.composing){
        const range=this.tableCellRange(cell.widget,cell.row,cell.column);
        if(range){
          Object.assign(cell,range);
          const {text,structured}=this.decodeCell(update.state.sliceDoc(range.from,range.to),range.span);
          const start=cell.input.selectionStart,end=cell.input.selectionEnd,direction=cell.input.selectionDirection;
          cell.input.value=cell.value=text;cell.structured=structured;
          cell.input.setSelectionRange(start,end,direction);
          cell.content.textContent=text||'\u200b';
          this.refreshTableInput(cell);
        }
      }
      // Pending upload anchors are mapped through every transaction, including undo.
      for(const upload of this.uploads.values()){
        upload.pos=update.changes.mapPos(upload.pos,1);
        if(upload.slot){
          upload.slot.from=update.changes.mapPos(upload.slot.from,-1);
          upload.slot.to=update.changes.mapPos(upload.slot.to,1);
        }
      }
      this.options.onChange?.(this.getMarkdown());
      if(this.mode==='preview')this.renderReading();
    }
    if(update.selectionSet)this.options.onSelectionChange?.();
    if(update.docChanged||update.selectionSet||update.viewportChanged||update.transactions.some(tr=>tr.effects.length))this.find?.update();
  }
  // Map a click inside a rendered callout title/body to the source line and
  // column. The rendered title drops the leading "> [!note] " and body lines
  // drop "> ", so mapping only the block start would put the first keystroke
  // before the blockquote marker.
  calloutPositionAt(from,event) {
    const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
    if(!range)return null;
    const node=range.startContainer,element=node.nodeType===3?node.parentElement:node;
    const callout=element?.closest?.('.kn-callout');
    if(!callout)return null;
    const title=callout.querySelector('.kn-callout-title');
    const unit=element.closest?.('.kn-callout-title,p,li')||element;
    const doc=this.view.state.doc,start=doc.lineAt(from);
    let lineOffset=0;
    if(!(unit===title||unit.closest?.('.kn-callout-title'))){
      const paragraphs=[...callout.querySelectorAll(':scope > p')];
      const index=paragraphs.findIndex(item=>item===unit||item.contains(unit));
      if(index>=0)lineOffset=index+1;
      else return null;
    }
    const line=doc.line(Math.min(doc.lines,start.number+lineOffset));
    const prefix=lineOffset===0
      ?(line.text.match(/^>\s*\[![^\]]*\][+-]?\s*/)||[''])[0].length
      :(line.text.match(/^>\s?/)||[''])[0].length;
    let column=0;
    if(node.nodeType===3){
      const walker=document.createTreeWalker(unit,NodeFilter.SHOW_TEXT);let current;
      while((current=walker.nextNode())){if(current===node){column+=range.startOffset;break;}column+=current.textContent.length;}
    }
    return Math.min(line.to,line.from+prefix+Math.max(0,column));
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
  cellCaretAt(widget,cell,event) {
    const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
    if(!range||!cell.contains(range.startContainer))return null;
    const {row,col}=this.tableCellPosition(widget,cell);
    const sourceRange=this.tableCellRange(widget,row,col);
    if(!sourceRange)return null;
    const text=this.decodeCell(this.view.state.sliceDoc(sourceRange.from,sourceRange.to),sourceRange.span).text;
    const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);
    let offset=0,current;
    while((current=walker.nextNode())){
      if(current.parentElement.closest('button'))continue;
      const at=text.indexOf(current.data,offset);
      if(current===range.startContainer)return (at>=0?at:offset)+range.startOffset;
      if(at>=0)offset=at+current.length;
    }
    return null;
  }
  tableCellAt(widget,row,column){
    const table=widget?.querySelector('table');
    return table?tableGeometry(table).slots[row]?.[column]:null;
  }
  tableCellPosition(widget,cell){
    return tableGeometry(widget.querySelector('table')).positions.get(cell);
  }
  clearTableRange(widget){
    widget.cellRange=null;
    for(const cell of widget.querySelectorAll('[data-table-range]'))delete cell.dataset.tableRange;
  }
  selectTableRange(widget,anchor,head){
    if(this.rangedTable&&this.rangedTable!==widget)this.clearTableRange(this.rangedTable);
    const geometry=tableGeometry(widget.querySelector('table')),bounds=cellBounds(anchor,head,geometry);
    if(!bounds)return;
    this.clearTableRange(widget);this.rangedTable=widget;
    widget.cellAnchor=anchor;widget.cellRange={head,bounds};
    for(let r=bounds.top;r<=bounds.bottom;r++)for(let c=bounds.left;c<=bounds.right;c++){
      const cell=geometry.slots[r]?.[c];
      if(cell)cell.dataset.tableRange='true';
    }
  }
  decodeCell(source,span){
    return decodeTableCell(span?spanCellToPipe(source)??'':source.trim());
  }
  storeSpanCell(pipe,state=this.view.state){
    return this.renderer.storeSpanCell(pipe,{noteId:this.options.noteId,...this.imageReferenceEnv(state)});
  }
  tableCellRange(widget,rowIndex,column) {
    const state=this.view.state;
    const table=this.tablesIn(state.doc).find(table=>table.from===Number(widget.dataset.sourcePos));if(!table)return null;
    if(table.span){
      const cell=table.cells.find(cell=>cell.row<=rowIndex&&rowIndex<cell.row+cell.rows&&cell.col<=column&&column<cell.col+cell.cols);
      return cell?{from:cell.from,to:cell.to,prefix:'',suffix:'',span:true}:null;
    }
    const row=table.rows[rowIndex?rowIndex+1:0];if(!row)return null;
    const {cells,trailing}=row,range=cells[column];
    if(!range){
      // Markdown permits short body rows; materialize only the missing cells.
      return {from:row.to,to:row.to,prefix:(trailing?' ':' | ')+(' | '.repeat(Math.max(0,column-cells.length))),suffix:trailing?' |':''};
    }
    const from=row.from+range.from,to=row.from+range.to;
    const raw=state.doc.sliceString(from,to),leading=raw.match(/^[ \t]*/)[0].length;
    // An empty cell keeps no inner text to replace, so writing at the trimmed
    // offset would produce "| 值|" and erode the padding of every new row or
    // column. Swap the cell's padding for canonical "| 值 |" instead.
    if(!raw.trim())return {from,to,prefix:' ',suffix:' '};
    return {from:from+leading,to:from+raw.trimEnd().length,prefix:'',suffix:''};
  }
  finishTableCell() {
    const active=this.activeTableCell;if(!active)return;
    this.activeTableCell=null;active.events.abort();active.visual?.destroy();
    active.cell.classList.remove('kn-cell-editing');active.input.remove();
    if(active.renderedNodes)active.content.replaceWith(...active.renderedNodes);
    else {active.content.innerHTML=active.renderedHTML;active.content.replaceWith(...active.content.childNodes);this.decorateImages(active.cell);}
    // A blurred table field restores rendered nodes without a transaction.
    queueMicrotask(()=>{if(!this.destroyed&&this.find?.active)this.find.update();});
  }
  settleTableCell(){
    const active=this.activeTableCell;
    if(!active)return true;
    if(active.composing||active.commit()===false)return false;
    this.finishTableCell();return true;
  }
  tableField(active){return active.visual?.dom||active.input;}
  syncTableSelection(active,selection=active.visual?.sourceSelection()){
    if(!selection)return;
    const {anchor,head}=selection;
    active.input.setSelectionRange(Math.min(anchor,head),Math.max(anchor,head),anchor>head?'backward':'forward');
  }
  setTableSelection(start,end=start,direction='none'){
    const active=this.activeTableCell;if(!active)return;
    active.input.setSelectionRange(start,end,direction);
    active.visual?.selectSource(direction==='backward'?end:start,direction==='backward'?start:end);
  }
  focusTableInput(active){
    const focused=this.tableField(active);
    if(!focused.isConnected)return;
    if(active.visual){
      if(!active.visual.writing){
        const {selectionStart:start,selectionEnd:end,selectionDirection}=active.input;
        active.visual.selectSource(selectionDirection==='backward'?end:start,selectionDirection==='backward'?start:end);
      }
      active.visual.focus();
    }else focused.focus({preventScroll:true});
  }
  refreshTableInput(active){
    if(active.visual?.writing)return;
    const {renderedHTML:html,input,cell}=active;
    if(active.visual && !active.visual.update(html,input.value,core)){
      active.visual.destroy();active.visual=null;
      input.className='kn-table-cell-editor';input.hidden=false;active.content.hidden=false;
      return;
    }
    if(!active.visual&&/<(?:br|li|ol|ul|pre|strong|em|s|code|a|img|mark|span)\b/.test(html)){
      const mount=document.createElement('div');
      const visual=VisualTableCell.create(mount,{
        html,text:input.value,core,label:input.getAttribute('aria-label'),
        onChange:(value,selection)=>{
          input.value=value;this.syncTableSelection(active,selection);active.commit(false,true);
          if(input.value!==value)queueMicrotask(()=>{
            if(this.activeTableCell===active&&active.visual){
              this.refreshTableInput(active);this.focusTableInput(active);
            }
          });
        },
        onSelection:selection=>this.syncTableSelection(active,selection),
      });
      if(!visual)return;
      const focused=document.activeElement===input;
      active.visual=visual;visual.updateMapping(input.value);visual.html=html;
      input.className='kn-table-cell-source';input.hidden=true;active.content.hidden=true;
      cell.append(mount);
      if(focused)this.focusTableInput(active);
    }
  }
  editTableCell(widget,cell,reveal=false,caret=null,point=null) {
    if(this.activeTableCell?.cell===cell)return;
    if(!this.settleTableCell())return;
    const {row,col:column}=this.tableCellPosition(widget,cell);
    const range=this.tableCellRange(widget,row,column);
    if(!range)return;
    if(this.rangedTable)this.clearTableRange(this.rangedTable);
    widget.cellAnchor={row,col:column};this.tableLocation={widget,row,column};
    this.tableColumn=column;
    this.view.dispatch({selection:{anchor:range.from},scrollIntoView:false});
    const input=document.createElement('textarea');input.rows=1;input.className='kn-table-cell-editor';
    input.setAttribute('aria-label',`${row===0?'表头':'第'+row+'行'}，第${column+1}列`);
    input.spellcheck=false;
    // An empty cell's range covers its padding; show it as an empty field so the
    // first keystroke is not appended to invisible spaces.
    const source=this.view.state.sliceDoc(range.from,range.to);
    const decoded=this.decodeCell(source,range.span);
    input.value=decoded.text;
    const content=document.createElement('span');content.className='kn-table-cell-content';content.setAttribute('aria-hidden','true');content.textContent=input.value||'\u200b';
    const active={widget,cell,input,content,renderedHTML:cell.innerHTML,renderedNodes:[...cell.childNodes],row,column,...range,events:new AbortController(),
      value:input.value,structured:decoded.structured,revision:0,original:{from:range.from,to:range.to,source},composing:false,writing:false};
    this.activeTableCell=active;
    cell.classList.add('kn-cell-editing');cell.replaceChildren(content,input);
    const commit=(formatting=false,autoSpacing=false)=>{
      if(active.composing||this.activeTableCell!==active)return false;
      if(input.value===active.value)return true;
      const raw=input.value.replace(/\r\n?/g,'\n');
      const caret=input.selectionStart??raw.length,head=input.selectionEnd??caret,direction=input.selectionDirection;
      const structured=active.structured||/^\s*(?:[-+*]|\d{1,9}[.)])(?:\s|$)/m.test(raw)||/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*\n\s*\1\s*$/m.test(raw);
      let value=encodeTableCell(raw,core.escaped,structured),display=raw,displayCaret=caret,displayHead=head;
      const from=active.from,to=active.to;
      const valueFrom=from+active.prefix.length;
      if(autoSpacing&&!structured&&!active.span&&this.options.autoSpacing?.()){
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
            const displayAt=decodeTableCell(value.slice(0,at)).text.length;
            display=display.slice(0,displayAt)+' '+display.slice(displayAt);
            if(displayAt<=displayCaret)displayCaret++;
            if(displayAt<=displayHead)displayHead++;
          }
        }
      }
      if(active.span){
        value=this.storeSpanCell(value);
        if(value===null){this.statusHost.textContent='当前内容无法安全写入合并表格，请调整内容后重试。';return false;}
      }
      const insert=active.prefix+value+active.suffix;
      input.value=active.value=display;active.structured=structured;
      input.setSelectionRange(displayCaret,displayHead,direction);
      content.textContent=(input.value||'\u200b')+(input.value.endsWith('\n')?'\u200b':'');
      if(this.view.state.doc.sliceString(from,to)===insert)return true;
      active.revision++;
      active.from=from+active.prefix.length;active.to=active.from+value.length;active.prefix='';active.suffix='';active.writing=true;
      try{this.view.dispatch({changes:{from,to,insert},selection:{anchor:active.from},annotations:formatting?isolateHistory.of('full'):[],userEvent:formatting?'input.format':'input.table-cell'});}
      finally{
        active.writing=false;
        // CodeMirror may move a reused widget DOM when its source length changes.
        // Native inputs blur on that move even though the cell is still active.
        if(this.activeTableCell===active&&input.isConnected){
          input.setSelectionRange(displayCaret,displayHead,direction);
          this.refreshTableInput(active);this.focusTableInput(active);
        }
      }
      return true;
    };
    active.commit=commit;
    const isFieldEvent=event=>this.activeTableCell===active&&this.tableField(active).contains(event.target);
    const listeners={capture:true,signal:active.events.signal};
    const pasteText=(event,text)=>{
      if(!active.visual)return;
      event.preventDefault();event.stopPropagation();
      if(text)this.insertText(text);
    };
    cell.addEventListener('paste',event=>{
      if(!isFieldEvent(event))return;
      const grid=clipboardTable(event.clipboardData);
      const images=this.imageFiles(event.clipboardData);
      if(images.length&&!grid){event.preventDefault();event.stopPropagation();void this.uploadFiles(images);return;}
      const text=event.clipboardData?.getData('text/plain')||grid?.map(row=>row.join('\t')).join('\n')||'';
      // Selected text and fenced code keep ordinary paste semantics.
      const replacing=(input.selectionStart??0)!==(input.selectionEnd??0);
      if(replacing||!grid){pasteText(event,text);return;}
      const state=this.tableInputState();
      for(let node=syntaxTree(state).resolveInner(state.selection.main.head,-1);node;node=node.parent)if(node.name==='FencedCode'){pasteText(event,text);return;}
      if(active.span){
        event.preventDefault();event.stopPropagation();
        if(!this.pasteSpanCells(active,grid))this.statusHost.textContent='粘贴范围会覆盖合并单元格或超出表格。';
        return;
      }
      const block=this.tableAt(active.from);
      const change=core.pasteTableRows(block,active.column,grid);
      if(!change){pasteText(event,text);return;}
      event.preventDefault();event.stopPropagation();
      const widths=this.view.state.field(this.tableWidths).map(widths=>widths.slice());
      const current=widths[this.tableIndex(block.from)];
      const size=active.column+grid.reduce((max,line)=>Math.max(max,line.length),0);
      const effects=[];
      if(current?.length===block.rows[0].length&&current.length<size){
        while(current.length<size)current.push(120);
        effects.push(tableWidthsEffect.of(widths));
      }
      this.replaceTable(block,change,row,column,effects);
    },listeners);
    cell.addEventListener('drop',event=>{
      if(!isFieldEvent(event))return;
      const images=this.imageFiles(event.dataTransfer);
      if(images.length){event.preventDefault();event.stopPropagation();void this.uploadFiles(images);}
      else pasteText(event,event.dataTransfer?.getData('text/plain')||'');
    },listeners);
    input.addEventListener('input',event=>{content.textContent=input.value||'\u200b';commit(false,event.inputType==='insertText');});
    cell.addEventListener('compositionstart',event=>{if(isFieldEvent(event))active.composing=true;},listeners);
    cell.addEventListener('compositionend',event=>{
      if(!isFieldEvent(event))return;
      queueMicrotask(()=>{active.composing=false;commit(false,true);});
    },listeners);
    cell.addEventListener('blur',event=>{
      if(!isFieldEvent(event))return;
      if(event.relatedTarget?.closest('#overlay :is(.wb-menu,.knowledge-dialog)'))return;
      // CodeMirror can temporarily blur a reused widget while applying undo.
      // Wait until that transaction has reconciled the value before committing.
      queueMicrotask(()=>{
        if(this.activeTableCell===active&&!active.writing&&!active.reconciling&&document.activeElement!==this.tableField(active)){
          if(active.composing)return;
          if(commit()===false){this.focusTableInput(active);return;}
          this.finishTableCell();
        }
      });
    },listeners);
    cell.addEventListener('click',event=>{
      if(active.visual?.dom.contains(event.target)&&event.target.closest('a')){event.preventDefault();event.stopPropagation();}
    },listeners);
    cell.addEventListener('keydown',event=>{
      if(!isFieldEvent(event))return;
      if(event.isComposing||active.composing||event.keyCode===229){
        if(['Enter','Escape','Tab'].includes(event.key))event.stopPropagation();
        return;
      }
      if(active.visual&&(event.key==='Home'||event.key==='End')&&!event.shiftKey){
        event.preventDefault();event.stopPropagation();this.setTableSelection(event.key==='Home'?0:input.value.length);return;
      }
      if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();event.stopPropagation();const state=this.tableInputState();this.openLink(this.linkInState(state,state.selection.main.head));return;}
      if(event.shiftKey&&event.key==='Enter'){
        event.preventDefault();event.stopPropagation();
        if(!this.tableInputCommand(insertNewlineContinueMarkupCommand({nonTightLists:false}),false)){
          input.setRangeText('\n',input.selectionStart,input.selectionEnd,'end');commit();
        }
        return;
      }
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){
        event.preventDefault();event.stopPropagation();if(commit())this.options.onSave?.();return;
      }
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){
        event.preventDefault();event.stopPropagation();this.openSearch();return;
      }
      if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){
        event.preventDefault();event.stopPropagation();
        active.reconciling=true;
        try{this.runHistory(event.key.toLowerCase()==='y'||event.shiftKey?redo:undo);}
        finally{active.reconciling=false;if(this.activeTableCell===active)this.focusTableInput(active);}
        return;
      }
      if(!['Tab','Enter','Escape'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      if(event.key==='Escape'){void this.cancelTableInput(active);return;}
      if(!commit())return;
      if(event.key==='Enter'){void this.finishTableInput(active);return;}
      const table=widget.querySelector('table'),cells=[...tableGeometry(table).positions.keys()];
      const next=cells[cells.indexOf(cell)+(event.shiftKey?-1:1)];
      if(next){this.editTableCell(widget,next,true);return;}
      if(event.key==='Tab'&&!event.shiftKey){this.table('row-add',0,undefined,table.rows.length-1);return;}
      const block=this.tableAt(active.from);
      this.finishTableCell();this.view.dispatch({selection:{anchor:Math.min(this.view.state.doc.length,(event.shiftKey?block?.from-1:block?.to+1)||0)},scrollIntoView:false});this.view.focus();
    },listeners);
    const at=caret===null?input.value.length:Math.max(0,Math.min(input.value.length,caret));
    input.setSelectionRange(at,at);
    this.refreshTableInput(active);this.focusTableInput(active);
    if(point&&active.visual?.selectPoint(point))this.syncTableSelection(active);
    if(reveal)cell.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  tableInputState() {
    const {input}=this.activeTableCell;
    const {selectionStart:start,selectionEnd:end,selectionDirection}=input;
    const selection=selectionDirection==='backward'?{anchor:end,head:start}:{anchor:start,head:end};
    return EditorState.create({doc:input.value,selection,extensions:[cellMarkdown,indentUnit.of('  ')]});
  }
  tableInputCommand(command,formatting=true) {
    const active=this.activeTableCell;
    if(!active||active.composing||active.finishing)return false;
    const state=this.tableInputState();
    return command({state,focus:()=>this.focusTableInput(active),dispatch:change=>{
      const transaction=change instanceof Transaction?change:state.update(change);
      const selection=transaction.state.selection.main;
      active.input.value=transaction.newDoc.toString();
      active.input.setSelectionRange(selection.from,selection.to,selection.anchor>selection.head?'backward':'forward');
      active.commit(formatting);
    }});
  }
  async cancelTableInput(active) {
    if(active.finishing||active.canceling)return;
    active.canceling=true;
    const original=active.original;
    if(original&&this.view.state.sliceDoc(original.from,original.to)!==original.source){
      this.view.dispatch({changes:{from:original.from,to:original.to,insert:original.source},
        annotations:[Transaction.addToHistory.of(false),isolateHistory.of('full')],userEvent:'input.table-cancel'});
    }
    for(const upload of this.uploads.values())if(upload.cell===active)this.uploads.delete(upload.id);
    this.uploadStatus();
    this.finishTableCell();active.widget.focus({preventScroll:true});
    if(original){
      try{
        const result=await this.options.onFinishInput?.();
        if(result===false||result?.success===false)throw new Error(result?.message||'取消后的内容尚未保存，请重试保存');
      }
      catch(error){if(!this.destroyed)this.statusHost.textContent=error.message;}
    }
  }
  async finishTableInput(active) {
    if(active.finishing)return;
    active.finishing=true;
    try{
      await active.imageQueue;
      if(this.destroyed||this.activeTableCell!==active)return;
      if([...this.uploads.values()].some(upload=>upload.cell===active))return;
      const revision=active.revision;
      const saved=await this.options.onFinishInput?.();
      if(saved===false||saved?.success===false)throw new Error(saved?.message||'本地保存失败，请重试');
      if(this.destroyed||this.activeTableCell!==active||active.revision!==revision)return;
      this.finishTableCell();active.widget.focus({preventScroll:true});
    }catch(error){this.statusHost.textContent=error.message;if(this.activeTableCell===active)this.focusTableInput(active);}
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
    this.clearBlockCaret();
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
      this.view.dispatch({effects:[clearExpandedEffect.of(null),refreshEffect.of(null),this.lineConfig.reconfigure(mode==='source'?[lineNumbers(),highlightActiveLine()]:[])]});
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
    const tables=[...this.readHost.querySelectorAll('table')].filter(table=>!table.closest('.kn-embed-body'));
    tables.forEach((table,index)=>this.applyTableWidths(table,0,index));
    this.readHost.scrollTop=scroll;Promise.resolve(this.renderer.enhance(this.readHost)).then(()=>{if(!this.destroyed)this.find?.update(true);});this.find?.update();
    this.queueTableHeaders();
  }
  queueTableHeaders(){
    if(!this.tableScrollHost||this.tableHeaderFrame||this.destroyed||this.mode==='source')return;
    this.tableHeaderFrame=requestAnimationFrame(()=>{
      this.tableHeaderFrame=0;
      if(!this.root.isConnected)return;
      const host=this.mode==='preview'?this.readHost:this.editHost;
      const viewport=this.tableScrollHost.getBoundingClientRect();
      const top=viewport.top+this.tableScrollHost.clientTop;
      const updates=[...host.querySelectorAll('table>thead')].map(header=>{
        const bounds=header.parentElement.getBoundingClientRect();
        const offset=bounds.bottom>top&&bounds.top<viewport.bottom
          ?Math.max(0,Math.min(top-bounds.top,bounds.height-header.offsetHeight)):0;
        return [header,offset];
      });
      for(const [header,offset] of updates){
        const translate=offset>0?`0px ${offset}px`:'';
        if(header.style.translate===translate)continue;
        header.toggleAttribute('data-table-pinned',offset>0);
        header.style.translate=translate;
      }
    });
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
  selectedLink(state=this.activeTableCell?this.tableInputState():this.view.state) {
    const {from,to}=state.selection.main;
    if(state.doc.lineAt(from).number!==state.doc.lineAt(to).number)return null;
    if(state===this.view.state){forceParsing(this.view,to);state=this.view.state;}
    let link=syntaxTree(state).resolveInner(from,1);
    while(link&&link.name!=='Link')link=link.parent;
    if(!link||link.to<to||!link.getChild('URL'))return null;
    const marks=link.getChildren('LinkMark');
    if(marks.length<4||marks[0].from!==link.from||state.sliceDoc(marks[1].from,marks[1].to)!==']')return null;
    const labelFrom=marks[0].to,labelTo=marks[1].from;
    if(from===to && (from<labelFrom || from>labelTo))return null;
    return {from:link.from,to:link.to,labelFrom,label:state.sliceDoc(labelFrom,labelTo)};
  }
  canLinkSelection(state=this.activeTableCell?this.tableInputState():this.view.state) {
    const {from,to}=state.selection.main,doc=state.doc;
    return doc.lineAt(from).number===doc.lineAt(to).number;
  }
  runHistory(command){
    if(!this.activeTableCell)return command(this.view);
    // A cell's source is inside one large block replacement. Scrolling that
    // selection targets the table's edge and also shifts the virtual viewport.
    // History bypasses transaction filters, so keep its effects/annotations and
    // remove only the scroll request at the command's dispatch boundary.
    return command({state:this.view.state,dispatch:tr=>this.view.dispatch({...tr,scrollIntoView:false,filter:false})});
  }
  format(action,value) {
    if(this.mode==='preview')return false;
    if(action==='undo'||action==='redo'){
      const active=this.activeTableCell;
      if(active?.composing)return false;
      if(active)active.reconciling=true;
      try{return this.runHistory(action==='undo'?undo:redo);}
      finally{if(active)active.reconciling=false;this.focusEditingSurface();}
    }
    if(this.activeTableCell){
      if(action==='indent'||action==='outdent')return this.tableInputCommand(view=>moveCellListItem(view,action==='outdent'));
      if(!(action==='heading'&&Number(value)===0)&&!['bold','italic','strike','inline','highlight','bullet','ordered','code','image','link','unlink'].includes(action))return false;
      return this.tableInputCommand(view=>this.applyFormat(view,action,value));
    }
    return this.applyFormat(this.view,action,value);
  }
  applyFormat(view,action,value) {
    const {from,to}=view.state.selection.main,doc=view.state.doc,text=doc.sliceString(from,to);
    const cell=view!==this.view;
    if(action==='unlink'){
      const link=this.selectedLink(view.state);if(!link)return false;
      const map=pos=>link.from+Math.max(0,Math.min(pos-link.labelFrom,link.label.length));
      const {anchor,head}=view.state.selection.main;
      view.dispatch({changes:{from:link.from,to:link.to,insert:link.label},selection:{anchor:map(anchor),head:map(head)},annotations:isolateHistory.of('full'),userEvent:'input.format'});
      view.focus();return true;
    }
    const wraps={bold:'**',italic:'*',strike:'~~',inline:'`',highlight:'=='};
    if(wraps[action]){
      const token=wraps[action],changes=[],ranges=[];
      const first=doc.lineAt(from),last=doc.lineAt(to>from?to-1:to);
      if(action==='inline'&&first.number!==last.number)return false;
      if(!cell)forceParsing(view,last.to);
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
    if(action==='link'&&!this.canLinkSelection(view.state))return false;
    const fence=action==='code'?'`'.repeat(Math.max(3,inlineFence(text).length)):'';
    const blocks={
      code:fence+'text\n'+text+'\n'+fence,
      diagram:'```mermaid\nflowchart LR\n  A[开始] --> B[处理]\n  B --> C[完成]\n```',
      table:'| 项目 | 内容 |\n| --- | --- |\n|  |  |',
      rule:'---',image:value||'![图片](https://)',
      // Link labels may not contain raw brackets; escaping keeps the label the
      // user selected instead of ending the link early.
      link:`[${String(text||'链接').replace(/[\\\[\]]/g,'\\$&')}](${safeURL(value)||'https://'})`
    };
    if(!(action in blocks))return false;
    const before=cell&&(from===0||doc.sliceString(from-1,from)==='\n')?'':'\n\n';
    const after=cell&&(to===doc.length||doc.sliceString(to,to+1)==='\n')?'':'\n\n';
    const insert=action==='link'||action==='image'?blocks[action]:before+blocks[action]+after;
    const anchor=action==='code'?from+before.length+fence.length+'text\n'.length:action==='table'?from+2+blocks.table.lastIndexOf('|  |  |')+2:from+insert.length;
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
    if(this.activeTableCell)return this.tableInputCommand(view=>this.clearInlineSelection(view));
    return this.clearInlineSelection(this.view);
  }
  clearInlineSelection(view) {
    const {from,to}=view.state.selection.main;
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
  insertText(text) {
    if(this.activeTableCell)return this.tableInputCommand(view=>{view.dispatch(view.state.replaceSelection(text));view.focus();return true;});
    this.view.dispatch(this.view.state.replaceSelection(text));this.view.focus();return true;
  }
  focusEditingSurface() {
    if(this.activeTableCell?.input.isConnected)this.focusTableInput(this.activeTableCell);
    else this.view.focus();
  }
  selectedText() {
    const state=this.activeTableCell?this.tableInputState():this.view.state;
    const {from,to}=state.selection.main;
    return state.sliceDoc(from,to);
  }
  selectEditingSurface() {
    if(this.activeTableCell){this.setTableSelection(0,this.activeTableCell.input.value.length);return;}
    this.view.dispatch({selection:{anchor:0,head:this.view.state.doc.length}});this.view.focus();
  }
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
  tableIndex(pos,state=this.view.state) {
    return this.tablesIn(state.doc).findIndex(table=>table.from===pos);
  }
  applyTableWidths(widget,pos,index,state=this.view?.state) {
    const table=widget.matches('table')?widget:widget.querySelector('table');if(!table||!state)return;
    const tableIndex=index??this.tableIndex(pos,state);
    applyTableColumnWidths(table,state.field(this.tableWidths)[tableIndex]);
    applyTableRowHeights(table,state.field(this.tableHeights)[tableIndex]);
    widget.tableControls?.refresh();
  }
  resizeTableRow(row,height,widget) {
    const block=this.tableAt(Number(widget?.dataset.sourcePos));
    const count=block?.span?block.height:block?.rows.length-1;
    height=Math.round(Number(height));
    if(!block||!Number.isInteger(row)||row<0||row>=count||!Number.isFinite(height)||height!==0&&(height<42||height>4096))return false;
    const index=this.tableIndex(block.from),tables=this.view.state.field(this.tableHeights).map(rows=>rows.slice());
    while(tables.length<=index)tables.push([]);
    tables[index]=Array.from({length:count},(_,r)=>tables[index][r]||0);tables[index][row]=height;
    while(tables.length&&!tables.at(-1).some(Boolean))tables.pop();
    if(JSON.stringify(tables)===JSON.stringify(this.view.state.field(this.tableHeights)))return true;
    this.view.dispatch({annotations:isolateHistory.of('full'),effects:tableHeightsEffect.of(tables),userEvent:'input.table-height'});
    return true;
  }
  fitTableColumn(column,widget) {
    const table=widget?.querySelector('table');
    if(!table)return false;
    const limit=Math.max(80,Math.min(480,Math.floor(this.tableViewportWidth(widget)*.75)));
    return this.resizeTableColumn(column,preferredColumnWidth(table,column,limit),widget);
  }
  resizeTableColumn(column,width,widget=null) {
    // Resize the table the gesture actually belongs to, not the table of the
    // current selection: dragging a second table while a first one is being
    // edited must not commit to the first table.
    const block=this.tableAt(widget?Number(widget.dataset.sourcePos):this.view.state.selection.main.head);
    width=Math.round(Number(width));
    if(!block||!Number.isFinite(width)||width<80||width>1600||column<0||column>=block.rows[0].length)return false;
    const index=this.tableIndex(block.from),tables=(this.options.tableColumnWidths||[]).map(row=>row.slice());
    while(tables.length<=index)tables.push([]);
    const target=widget||this.root.querySelector(`.kn-table-widget[data-source-pos="${block.from}"]`);
    const table=target?.matches('table')?target:target?.querySelector('table');
    const measured=table?measureTableColumns(table):[];
    tables[index]=Array.from({length:block.rows[0].length},(_,c)=>tables[index][c]||measured[c]||120);tables[index][column]=width;
    if(JSON.stringify(tables)===JSON.stringify(this.view.state.field(this.tableWidths)))return true;
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
    const block=this.tableAt(widget?Number(widget.dataset.sourcePos):this.view.state.selection.main.head);if(!block)return false;
    const tables=this.view.state.field(this.tableWidths).map(row=>row.slice()),idx=this.tableIndex(block.from);while(tables.length<=idx)tables.push([]);
    const columns=block.rows[0].length;
    const available=Math.floor(Number(width)||this.tableViewportWidth(widget));
    tables[idx]=width||widget?Array(columns).fill(Math.max(80,Math.min(1600,Math.floor(available/columns)))):[];
    this.view.dispatch({annotations:isolateHistory.of('full'),effects:tableWidthsEffect.of(trimTableWidths(tables)),userEvent:'input.table-width'});return true;
  }
  spanModel(block){
    if(block.span)return block;
    if(block.prefix||block.lineFrom!==block.from)return null;
    const [header,alignment,...body]=block.rows,rows=[header,...body],width=header.length;
    if(rows.some(row=>row.length>width)||!core.tableGrid(rows.length,width,[]))return null;
    const align=alignment.map(value=>/^:.*:$/.test(value)?'c':/:$/.test(value)?'r':'l'),cells=[];
    if(align.length!==width)return null;
    for(let row=0;row<rows.length;row++)for(let col=0;col<width;col++){
      const value=this.storeSpanCell(rows[row][col]||'');
      if(value===null)return null;
      cells.push({row,col,rows:1,cols:1,value});
    }
    return {...block,align,cells,height:rows.length,width};
  }
  preserveSpanColumnWidths(block,widget){
    const table=widget?.querySelector('table');
    if(!table)return [];
    const index=this.tableIndex(block.from),columns=block.rows[0].length;
    const widths=this.view.state.field(this.tableWidths);
    if(index<0||widths[index]?.length===columns)return [];
    const measured=measureTableColumns(table);
    if(measured.length!==columns||!measured.every(width=>Number.isFinite(width)&&width>0))return [];
    const next=widths.slice();
    while(next.length<=index)next.push([]);
    next[index]=measured.map(width=>Math.max(80,Math.min(1600,width)));
    return [tableWidthsEffect.of(next)];
  }
  replaceSpanTable(block,model,row,col,effects=[]){
    const hasSpan=model.cells.some(cell=>cell.rows>1||cell.cols>1);
    let insert=core.serializeSpanTable(model);
    if(insert===null)return false;
    if(!hasSpan){
      const grid=core.tableGrid(model.height,model.width,model.cells);
      const rows=grid.map(row=>row.map(cell=>spanCellToPipe(cell.value)));
      if(rows.every(row=>row.every(value=>value!==null))){
        rows.splice(1,0,model.align.map(value=>value==='c'?':---:':value==='r'?'---:':'---'));
        insert=rows.map(row=>'| '+row.join(' | ')+' |').join('\n');
      }
    }else if(this.view.state.doc.sliceString(block.to,block.to+2).match(/^\n[^\n]/))insert+='\n';
    this.replaceTable(block,{from:block.from,to:block.to,insert},row,col,effects);
    return true;
  }
  replaceTable(block,change,row,col,effects=[]){
    this.finishTableCell();
    this.tableLocation=null;
    if(this.rangedTable)this.clearTableRange(this.rangedTable);
    this.view.dispatch({changes:change,selection:{anchor:change.from},annotations:isolateHistory.of('full'),effects,userEvent:'input.table'});
    if(this.mode!=='edit'||!change.insert){this.view.focus();return;}
    requestAnimationFrame(()=>{
      if(this.destroyed)return;
      const widget=this.root.querySelector(`.kn-table-widget[data-source-pos="${block.from}"]`);
      const cell=this.tableCellAt(widget,row,col);
      if(cell)this.editTableCell(widget,cell,true);else this.view.focus();
    });
  }
  pasteSpanCells(active,paste){
    const block=this.tableAt(active.from);
    if(!block?.span)return false;
    const replacements=new Map();
    for(let row=0;row<paste.length;row++)for(let col=0;col<paste[row].length;col++){
      const cell=block.grid[active.row+row]?.[active.column+col];
      if(!cell||cell.rows>1||cell.cols>1)return false;
      const value=this.storeSpanCell(encodeTableCell(paste[row][col],core.escaped));
      if(value===null)return false;
      replacements.set(cell,value);
    }
    const cells=block.cells.map(cell=>replacements.has(cell)?{...cell,value:replacements.get(cell)}:cell);
    return this.replaceSpanTable(block,{...block,cells},active.row,active.column);
  }
  table(operation,index=0,value,logicalRow=null){
    if(this.mode==='preview')return false;
    const pos=this.activeTableCell?.from??this.view.state.selection.main.head;
    for(let n=syntaxTree(this.view.state).resolveInner(pos,-1);n;n=n.parent)if(n.name==='FencedCode'||n.name==='IndentedCode')return false;
    const location=this.tableLocation,widget=location?.widget?.isConnected?location.widget:null;
    const inWidget=widget&&pos>=Number(widget.dataset.sourcePos)&&pos<=Number(widget.dataset.sourceTo);
    const block=this.tableAt(inWidget?Number(widget.dataset.sourcePos):pos);if(!block)return false;
    index=Math.max(0,Math.min(block.rows[0].length-1,index));
    const active=this.activeTableCell;
    const row=logicalRow??active?.row??(inWidget?location.row:Math.max(0,block.row-1));
    if(operation==='merge-cells'||operation==='split-cell'){
      const bounds=widget?.cellRange?.bounds;
      if(operation==='merge-cells'&&!bounds)return false;
      const model=this.spanModel(block);
      if(!model){this.statusHost.textContent='当前表格包含无法无损转换的内容。';return true;}
      const next=operation==='merge-cells'?mergeBounds(model,bounds):block.span&&splitSpan(model,row,index);
      if(!next)return false;
      if(next.error){this.statusHost.textContent=next.error;widget?.focus({preventScroll:true});return true;}
      const effects=this.preserveSpanColumnWidths(block,widget);
      return this.replaceSpanTable(block,next,bounds?.top??row,bounds?.left??index,effects);
    }
    const change=block.span?(operation==='delete'?{from:block.from,to:block.to,insert:''}:null):core.editTableRows({...block,row:row?row+1:0},operation,index,value);
    if(!block.span&&!change)return false;
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
    const effects=changedWidths?[tableWidthsEffect.of(tables)]:[];
    const heights=this.view.state.field(this.tableHeights).map(rows=>rows.slice()),rowHeights=heights[tableIndex];
    if(operation==='delete'){
      heights.splice(tableIndex,1);effects.push(tableHeightsEffect.of(trimTableWidths(heights)));
    }else if(rowHeights?.length&&operation.startsWith('row-')){
      const count=block.span?block.height:block.rows.length-1;
      while(rowHeights.length<count)rowHeights.push(0);
      if(operation==='row-add'||operation==='row-before')rowHeights.splice(Math.max(1,row+(operation==='row-add'?1:0)),0,0);
      if(operation==='row-duplicate')rowHeights.splice(row+1,0,rowHeights[row]);
      if(operation==='row-delete')rowHeights.splice(row,1);
      if(operation==='row-move')rowHeights.splice(Number(value)-1,0,rowHeights.splice(row,1)[0]);
      effects.push(tableHeightsEffect.of(heights));
    }
    if(block.span&&operation!=='delete'){
      const stored=operation==='cell'?this.storeSpanCell(encodeTableCell(String(value),core.escaped,true)):value;
      if(operation==='cell'&&stored===null)return false;
      const next=editSpan(block,operation,row,index,stored,core.tableGrid);
      if(!next)return false;
      if(next.error){this.statusHost.textContent=next.error;widget?.focus({preventScroll:true});return true;}
      return this.replaceSpanTable(block,next,targetRow,targetColumn,effects);
    }
    this.replaceTable(block,change,targetRow,targetColumn,effects);
    return true;
  }
  imageFiles(data) {return [...data?.files||[]].filter(file=>file.type.startsWith('image/'));}
  uploadFiles(files,cell=this.activeTableCell){
    const upload=async()=>{
      for(const file of files){
        if(this.destroyed||cell&&this.activeTableCell!==cell)break;
        await this.upload(file,undefined,cell);
      }
    };
    if(!cell)return upload();
    cell.imageQueue=(cell.imageQueue||Promise.resolve()).then(upload);
    return cell.imageQueue;
  }
  insertTableUpload(upload,snippet) {
    const {cell,slot}=upload;
    const active=this.activeTableCell;
    if(active===cell&&cell.input.isConnected){
      if(cell.composing)return false;
      const input=cell.input;
      if(input.value===slot.value)input.setSelectionRange(slot.start,slot.end);
      input.setRangeText(snippet,input.selectionStart,input.selectionEnd,'end');
      return cell.commit(true);
    }
    const {state}=this.view;
    if(state.sliceDoc(slot.from,slot.to)!==slot.source)return false;
    const table=this.tableAt(slot.from,state.doc);
    if(!table||table.row===1||slot.to>table.to)return false;
    const value=slot.value.slice(0,slot.start)+snippet+slot.value.slice(slot.end);
    const pipe=encodeTableCell(value,core.escaped,slot.structured);
    const insert=slot.span?this.storeSpanCell(pipe):pipe;
    if(insert===null)return false;
    this.view.dispatch({changes:{from:slot.from,to:slot.to,insert:slot.prefix+insert+slot.suffix},
      annotations:isolateHistory.of('full'),userEvent:'input.image'});
    return true;
  }
  async upload(file,pos=this.view.state.selection.main.head,cell=this.activeTableCell) {
    const slot=cell?{from:cell.from,to:cell.to,prefix:cell.prefix,suffix:cell.suffix,span:cell.span,structured:cell.structured,
      source:this.view.state.sliceDoc(cell.from,cell.to),value:cell.input.value,start:cell.input.selectionStart,end:cell.input.selectionEnd}:null;
    const upload={id:++this.nextUpload,file,pos,cell,slot,status:'正在上传',retry:null};this.uploads.set(upload.id,upload);this.uploadStatus();
    let snippet;
    const perform=async()=>{
      upload.status='正在上传';upload.retry=null;this.uploadStatus();
      try {
        if(!snippet){
          if(file.size>20*1024*1024)throw new Error('图片不能超过 20 MB');
          if(!/^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(file.type))throw new Error('不支持的图片格式');
          const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('读取图片失败'));reader.readAsDataURL(file);});
          if(this.destroyed||!this.uploads.has(upload.id))return;
          snippet=await this.options.uploadImage(dataUrl,file.name);
        }
        if(this.destroyed||!this.uploads.has(upload.id))return;
        if(!snippet)throw new Error('图片未能持久化');
        if(cell){
          if(!this.insertTableUpload(upload,snippet))throw new Error('原单元格已变化或正在输入，无法在原位置插入图片');
        }else{
          const at=Math.min(upload.pos,this.view.state.doc.length);
          this.view.dispatch({changes:{from:at,insert:'\n'+snippet+'\n'},userEvent:'input.image'});
        }
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
  paste(event){
    const grid=this.mode==='edit'&&!this.view.composing?clipboardTable(event.clipboardData):null;
    const files=this.imageFiles(event.clipboardData);
    if(files.length&&!grid){event.preventDefault();void this.uploadFiles(files);return true;}
    if(!grid)return false;
    const {state}=this.view,{from,to}=state.selection.main;
    forceParsing(this.view,to);
    for(let node=syntaxTree(this.view.state).resolveInner(from,1);node;node=node.parent)if(/^(FencedCode|IndentedCode|Frontmatter)$/.test(node.name))return false;
    const columns=grid.reduce((max,row)=>Math.max(max,row.length),0);
    const rows=grid.map(row=>Array.from({length:columns},(_,column)=>encodeTableCell(row[column]??'',core.escaped)));
    rows.splice(1,0,Array(columns).fill('---'));
    const before=from&&state.doc.lineAt(from).from!==from?'\n\n':from&&state.doc.lineAt(from-1).text.trim()?'\n':'';
    const after=to===state.doc.length?'':state.doc.lineAt(to).to===to?'\n':'\n\n';
    const insert=before+core.serializePipeRows(rows)+after;
    const effects=[],widths=state.field(this.tableWidths).map(widths=>widths.slice()),tables=this.tablesIn(state.doc);
    const index=tables.filter(table=>table.from<from).length;
    if(index<widths.length){
      const removed=tables.filter(table=>table.from>=from&&table.to<=to).length;
      widths.splice(index,removed,[]);
      effects.push(tableWidthsEffect.of(trimTableWidths(widths)));
    }
    const heights=state.field(this.tableHeights).map(rows=>rows.slice());
    if(index<heights.length){
      const removed=tables.filter(table=>table.from>=from&&table.to<=to).length;
      heights.splice(index,removed,[]);effects.push(tableHeightsEffect.of(trimTableWidths(heights)));
    }
    event.preventDefault();
    this.view.dispatch({changes:{from,to,insert},selection:{anchor:from+insert.length},effects,annotations:isolateHistory.of('full'),userEvent:'input.paste',scrollIntoView:true});
    return true;
  }
  drop(event,view){const files=this.imageFiles(event.dataTransfer);if(!files.length)return false;event.preventDefault();const pos=view.posAtCoords({x:event.clientX,y:event.clientY})??view.state.selection.main.head;files.forEach(file=>void this.upload(file,pos,null));return true;}
  // Saving migrates only exact managed image destinations, as transactions.
  // Selection, history and pending upload anchors are mapped by CodeMirror.
  acceptSavedAssetReferences(assets){
    const doc=this.getEditorText(),changes=[];
    const managed=new Map((assets||[]).filter(asset=>asset.managed).map(asset=>[asset.source,asset.relativePath]));
    const active=this.activeTableCell,original=active?.original;
    if(original&&managed.size){
      if(active.span){
        const html=core.serializeSpanTable({align:['l'],height:1,cells:[{row:0,col:0,rows:1,cols:1,value:original.source}]});
        const updated=window.LoopShareMarkdown.updateDestinations(html,managed);
        original.source=core.parseSpanTable(updated)?.cells[0]?.value??original.source;
      }else original.source=window.LoopShareMarkdown.updateDestinations(original.source,managed);
    }
    if(managed.size){for(const ref of window.LoopShareMarkdown.scan(doc)){const destination=managed.get(ref.destination);if(destination&&Number.isInteger(ref.destinationFrom))changes.push({from:ref.destinationFrom,to:ref.destinationTo,insert:destination});}}
    for(const asset of assets||[]){
      if(!asset.source||!asset.relativePath)continue;
      for(const ref of core.imageReferences(doc)){
        if(ref.url===asset.source&&!asset.managed)changes.push({from:ref.from,to:ref.to,insert:ref.html?core.escapeTableAttribute(asset.relativePath):asset.relativePath});
      }
    }
    if(changes.length)this.view.dispatch({changes:changes.sort((a,b)=>a.from-b.from),annotations:Transaction.addToHistory.of(false),userEvent:'input.assets'});
  }
  refresh(){this.renderRevision++;this.renderCache.clear();if(this.mode==='preview')this.renderReading();this.view.dispatch({effects:refreshEffect.of(null)});this.view.requestMeasure();}
  destroy(){this.destroyed=true;cancelAnimationFrame(this.tableHeaderFrame);this.events?.abort();this.find?.destroy();this.view.destroy();instances.delete(this.root);return Promise.resolve();}
}
window.LoopKnowledgeEditor={create:async options=>new KnowledgeEditor(options),createRenderer,safeURL,instances};

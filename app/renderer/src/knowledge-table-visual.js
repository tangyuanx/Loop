import {DOMParser,Schema} from '@milkdown/kit/prose/model';
import {EditorState,Plugin,TextSelection} from '@milkdown/kit/prose/state';
import {Decoration,DecorationSet,EditorView} from '@milkdown/kit/prose/view';
import {keymap} from '@milkdown/kit/prose/keymap';
import {baseKeymap} from '@milkdown/kit/prose/commands';
import DiffMatchPatch from 'diff-match-patch';
import {highlightCode} from './knowledge-renderer.js';

const allowedTags=new Set('P BR OL UL LI PRE CODE SPAN STRONG B EM I S DEL A IMG MARK'.split(' '));
const isImage=el=>el.matches('img,.kn-image-missing');
const diff=new DiffMatchPatch();
const mark=(tags,output)=>({parseDOM:tags.map(tag=>({tag})),toDOM:()=>[output,0]});
const schema=new Schema({nodes:{
  doc:{content:'block+'},
  paragraph:{group:'block',content:'inline*',parseDOM:[{tag:'p'}],toDOM:()=>['p',0]},
  bullet_list:{group:'block',content:'list_item+',parseDOM:[{tag:'ul'}],toDOM:()=>['ul',0]},
  ordered_list:{group:'block',content:'list_item+',attrs:{start:{default:1}},
    parseDOM:[{tag:'ol',getAttrs:el=>({start:Number(el.getAttribute('start')||1)})}],
    toDOM:node=>['ol',node.attrs.start===1?{}:{start:node.attrs.start},0]},
  list_item:{content:'paragraph block*',parseDOM:[{tag:'li'}],toDOM:()=>['li',0]},
  code_block:{group:'block',content:'text*',code:true,marks:'',whitespace:'pre',attrs:{language:{default:''}},
    parseDOM:[{tag:'pre',preserveWhitespace:'full',contentElement:'code',getAttrs:el=>({language:el.querySelector('code')?.className.match(/\blanguage-([\w+.-]+)/)?.[1]||''})}],
    toDOM:node=>['pre',{class:'kn-table-code'},['code',{class:node.attrs.language?'language-'+node.attrs.language:''},0]]},
  text:{group:'inline'},
  hard_break:{group:'inline',inline:true,selectable:false,parseDOM:[{tag:'br'}],toDOM:()=>['br']},
  resource:{group:'inline',inline:true,atom:true,attrs:{source:{},html:{}},
    parseDOM:[{tag:'[data-kn-cell-resource]',getAttrs:el=>{
      const source=el.dataset.knCellResource;el.removeAttribute('data-kn-cell-resource');return {source,html:el.outerHTML};
    }}],
    toDOM:node=>{
      const template=document.createElement('template');template.innerHTML=node.attrs.html;
      const element=template.content.firstElementChild;
      element.setAttribute('contenteditable','false');
      return element;
    }},
},marks:{
  strong:mark(['strong','b'],'strong'),emphasis:mark(['em','i'],'em'),strike:mark(['s','del'],'s'),highlight:mark(['mark'],'mark'),
  code:{...mark(['code'],'code'),excludes:'_'},
  link:{inclusive:false,attrs:{href:{},title:{default:''},relative:{default:''}},
    parseDOM:[{tag:'a[href]:not([data-kn-cell-resource])',getAttrs:el=>({href:el.getAttribute('href'),title:el.getAttribute('title')||'',relative:el.dataset.relativeNote||''})}],
    toDOM:({attrs})=>['a',{href:attrs.href,rel:'noopener noreferrer',...(attrs.title?{title:attrs.title}:{}),...(attrs.relative?{'data-relative-note':attrs.relative}:{})},0]},
}});
const parser=DOMParser.fromSchema(schema);

function parseCell(html,text,core){
  const root=document.createElement('div');root.innerHTML=html;
  if([...root.querySelectorAll('*')].some(node=>!allowedTags.has(node.tagName)&&!node.matches('.kn-image-resize')))return null;
  for(const button of root.querySelectorAll('.kn-image-resize'))button.remove();
  const resources=[...root.querySelectorAll('img,.kn-image-missing,.kn-wiki')];
  const refs=[...core.imageReferences(text).map(ref=>({offset:ref.start,source:text.slice(ref.start,ref.end),image:true})),
    ...core.links(text).map(ref=>({offset:ref.from,source:ref.raw,image:false}))].sort((a,b)=>a.offset-b.offset);
  if(resources.length!==refs.length)return null;
  for(let index=0;index<refs.length;index++){
    const element=resources[index],ref=refs[index];
    if(isImage(element)!==ref.image)return null;
    const object=element.closest('.kn-image-layout')||element.closest('.kn-image-object')||element;
    if(object.classList.contains('kn-image-object')){object.replaceWith(element);element.dataset.knCellResource=ref.source;}
    else object.dataset.knCellResource=ref.source;
  }
  return parser.parse(root);
}

const markers={strong:'**',emphasis:'*',strike:'~~',highlight:'=='};
function codeFence(text,minimum){
  let length=minimum;
  for(const run of text.matchAll(/`+/g))length=Math.max(length,run[0].length+1);
  return '`'.repeat(length);
}
function linkDestination({href,title,relative}){
  const target=relative||href;
  const url=/[\s()<>]/.test(target)?'<'+target.replace(/>/g,'%3E')+'>':target;
  return url+(title?' "'+title.replace(/["\\]/g,'\\$&')+'"':'');
}

// Positions use the same Markdown text as the existing table commands. A
// marked span's brackets/delimiters have no caret position in the visual DOM.
function serializeCell(doc){
  const offsets=[];
  let text='';
  const remember=pos=>{offsets[pos]=text.length;};
  const literal=(value,pos,encode)=>{
    for(let index=0;index<value.length;index++){
      remember(pos+index);
      text+=encode(value[index]);
    }
    remember(pos+value.length);
  };
  const inline=(node,pos,indent)=>{
    let open=[];
    const close=length=>{
      for(let index=open.length-1;index>=length;index--)text+=open[index].close;
      open=open.slice(0,length);
    };
    node.forEach((child,offset)=>{
      const at=pos+1+offset;
      const compatible=child.marks.filter(mark=>mark.type.name!=='code');
      let common=0;
      while(common<open.length&&common<compatible.length&&open[common].mark.eq(compatible[common]))common++;
      close(common);
      for(const item of compatible.slice(common)){
        const marker=markers[item.type.name];
        text+=marker||'[';
        open.push({mark:item,close:marker||']('+linkDestination(item.attrs)+')'});
      }
      if(child.isText){
        if(child.marks.some(mark=>mark.type.name==='code')){
          const fence=codeFence(child.text,1),pad=/^`|`$|^\s[\s\S]*\s$/.test(child.text)?' ':'';
          text+=fence+pad;literal(child.text,at,char=>char);text+=pad+fence;
        }else literal(child.text,at,char=>/[\\`*_~[\]<>]/.test(char)?'\\'+char:char);
      }else{
        remember(at);text+=child.type.name==='hard_break'?'\n'+indent:child.attrs.source;
        remember(at+child.nodeSize);
      }
    });
    close(0);
    if(!node.childCount)remember(pos+1);
  };
  const block=(node,pos,indent,firstIndent=indent)=>{
    if(node.type.name==='code_block'){
      const fence=codeFence(node.textContent,3);
      text+=firstIndent+fence+node.attrs.language+'\n'+indent;
      literal(node.textContent,pos+1,char=>char==='\n'?char+indent:char);
      text+='\n'+indent+fence;
    }else if(node.type.name==='paragraph'){
      text+=firstIndent;inline(node,pos,indent);
    }else{
      const ordered=node.type.name==='ordered_list';
      node.forEach((item,offset,index)=>{
        if(index)text+='\n';
        const marker=ordered?`${node.attrs.start+index}. `:'- ';
        const nextIndent=indent+' '.repeat(marker.length);
        item.forEach((child,relative,part)=>{
          if(part){
            text+='\n';
            if(child.type.name==='paragraph'||child.type.name==='ordered_list'&&child.attrs.start!==1)text+='\n';
          }
          block(child,pos+offset+relative+2,nextIndent,part?nextIndent:indent+marker);
        });
      });
    }
  };
  let previous=null;
  doc.forEach((node,offset)=>{
    const beginsWithBreak=node.type.name==='paragraph'&&node.firstChild?.type.name==='hard_break';
    const endsWithBreak=previous?.type.name==='paragraph'&&previous.lastChild?.type.name==='hard_break';
    if(previous&&!beginsWithBreak&&!endsWithBreak)text+='\n';
    block(node,offset,'');previous=node;
  });
  return {text,offsets};
}

function codeDecorations(doc){
  const decorations=[];
  doc.descendants((node,pos)=>{
    if(node.type.name!=='code_block')return;
    const html=highlightCode(node.textContent,node.attrs.language);
    if(!html)return false;
    const template=document.createElement('template');template.innerHTML=html;
    let offset=pos+1;
    const paint=element=>{
      if(element.nodeType===Node.TEXT_NODE){offset+=element.length;return;}
      const start=offset;
      for(const child of element.childNodes)paint(child);
      if(element.className&&offset>start)decorations.push(Decoration.inline(start,offset,{class:element.className}));
    };
    for(const child of template.content.childNodes)paint(child);
    return false;
  });
  return DecorationSet.create(doc,decorations);
}
const highlightBlocks=new Plugin({
  state:{init:(_,state)=>codeDecorations(state.doc),apply:(tr,prev)=>tr.docChanged?codeDecorations(tr.doc):prev},
  props:{decorations(state){return this.getState(state);}},
});

export class VisualTableCell {
  static create(mount,options){
    const doc=parseCell(options.html,options.text,options.core);
    return doc?new VisualTableCell(mount,doc,options):null;
  }
  constructor(mount,doc,{label,onChange,onSelection}){
    this.view=new EditorView({mount},{
      state:EditorState.create({doc,plugins:[highlightBlocks,keymap(baseKeymap)]}),
      attributes:{class:'kn-table-cell-visual kn-table-cell-editor',role:'textbox','aria-multiline':'true','aria-label':label,spellcheck:'false'},
      dispatchTransaction:transaction=>{
        this.view.updateState(this.view.state.apply(transaction));
        if(transaction.docChanged){
          this.projection=serializeCell(this.view.state.doc);
          this.updateMapping(this.projection.text);
          this.writing=true;
          try{onChange(this.projection.text,this.sourceSelection());}finally{this.writing=false;}
        }else if(transaction.selectionSet)onSelection(this.sourceSelection());
      },
    });
    this.projection=serializeCell(doc);
  }
  get dom(){return this.view.dom;}
  updateMapping(source){
    this.source=source;
    this.mapping=diff.diff_main(this.projection.text,source,false);
    this.inverse=this.mapping.map(([kind,text])=>[-kind,text]);
  }
  sourceSelection(){
    const {anchor,head}=this.view.state.selection;
    const map=pos=>{
      const {offsets,text}=this.projection;
      while(pos>0&&offsets[pos]===undefined)pos--;
      return diff.diff_xIndex(this.mapping,offsets[pos]??text.length);
    };
    return {anchor:map(anchor),head:map(head)};
  }
  selectSource(anchor,head=anchor){
    const {doc,selection}=this.view.state;
    const map=offset=>{
      const target=diff.diff_xIndex(this.inverse,offset);
      const {offsets}=this.projection;
      let best=1,distance=Infinity;
      for(let pos=1;pos<offsets.length;pos++){
        if(offsets[pos]===undefined)continue;
        const gap=Math.abs(offsets[pos]-target);
        if(gap<distance){best=pos;distance=gap;}
        if(offsets[pos]>=target)break;
      }
      return doc.resolve(Math.min(best,doc.content.size));
    };
    const next=TextSelection.between(map(anchor),map(head));
    if(!selection.eq(next))this.view.updateState(this.view.state.apply(this.view.state.tr.setSelection(next)));
  }
  selectPoint(point){
    const result=this.view.posAtCoords(point);
    if(!result)return false;
    const pos=this.view.state.doc.resolve(result.pos);
    this.view.updateState(this.view.state.apply(this.view.state.tr.setSelection(TextSelection.near(pos))));
    return true;
  }
  update(html,source,core){
    if(this.writing)return true;
    if(source===this.source&&html===this.html)return true;
    const doc=parseCell(html,source,core);
    if(!doc)return false;
    if(!doc.eq(this.view.state.doc)){
      this.view.updateState(EditorState.create({doc,plugins:this.view.state.plugins}));
      this.projection=serializeCell(doc);
    }
    this.html=html;this.updateMapping(source);
    return true;
  }
  focus(){this.view.focus();}
  destroy(){this.view.destroy();this.dom.remove();}
}

import {encodeTableCell} from './knowledge-table-content.js';

const core=window.LoopKnowledgeCore;
const inlineMarks={strong:'**',b:'**',em:'*',i:'*',s:'~~',del:'~~',mark:'=='};
const known=new Set('a b br code del em i img li mark ol p pre s strong ul'.split(' '));
const attributes={
  a:new Set(['href','title','data-loop-wiki','class','data-href']),
  img:new Set(['src','alt','title','width']),
  code:new Set(['class']),
  ol:new Set(['start']),
};

function literal(value){
  return value.replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[char])
    .replace(/[\\`*_~=[\]]/g,'\\$&').replace(/\r?\n/g,'<br>');
}
function destination(element,name,caption=element.getAttribute('title')){
  const raw=element.getAttribute(name)||'';
  const url=raw.replace(/[<>\s\\]/g,char=>encodeURIComponent(char)).replace(/&/g,'&amp;');
  const title=caption?.replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[char]).replace(/["\\]/g,'\\$&').replace(/\n/g,'&#10;');
  return '<'+url+'>'+(title?' "'+title+'"':'');
}
export function spanCellToPipe(source){
  // Inspect the original tags before the inert HTML parser normalizes them.
  const tags=source.match(/<[^>]*>/g)||[];
  const stack=[];
  for(const value of tags){
    const opening=/^<([a-z]+)(?:\s+[\w-]+="[^"]*")*\s*(\/?)>$/i.exec(value);
    const closing=/^<\/([a-z]+)\s*>$/i.exec(value);
    if(closing?.[1].toLowerCase()===stack.at(-1)&&closing){stack.pop();continue;}
    if(!opening||!known.has(opening[1].toLowerCase()))return null;
    const tag=opening[1].toLowerCase();
    if(tag==='br'||tag==='img')continue;
    if(opening[2])return null;
    stack.push(tag);
  }
  if(stack.length)return null;
  const template=document.createElement('template');
  template.innerHTML=source;
  function convert(node){
    if(node.nodeType===Node.TEXT_NODE)return literal(node.nodeValue);
    if(node.nodeType!==Node.ELEMENT_NODE)throw new Error('unsupported table content');
    const tag=node.localName,attr=attributes[tag];
    if(!known.has(tag)||[...node.attributes].some(item=>!attr?.has(item.name)))throw new Error('unsupported table markup');
    if(tag==='img'){
      if(!node.getAttribute('src'))throw new Error('missing image');
      let caption=node.getAttribute('title')||'';
      if(node.hasAttribute('width')&&!/\[loop-image\b/.test(caption)){
        const width=Number(node.getAttribute('width'));
        if(Number.isSafeInteger(width)&&width>0)caption=(caption?caption+' ':'')+`[loop-image width=${width}]`;
      }
      return '!['+literal(node.getAttribute('alt')||'')+']('+destination(node,'src',caption)+')';
    }
    if(tag==='a'&&node.hasAttribute('data-loop-wiki')){
      const raw=decodeURIComponent(node.getAttribute('data-loop-wiki'));
      const match=/^(!?)\[\[([^\]\n]+)\]\]$/.exec(raw);
      if(!match)throw new Error('invalid note link');
      const target=core.parseTarget(match[2]);
      const label=node.textContent;
      return label===(target.label||target.target||target.anchor)?raw:
        `${match[1]}[[${match[2].split('|')[0]}|${label.replace(/[\[\]|\n]/g,' ')}]]`;
    }
    if(tag==='br')return '<br>';
    if(tag==='pre'){
      const code=node.firstElementChild;
      if(code?.localName!=='code'||node.children.length!==1||code.children.length||[...code.attributes].some(item=>item.name!=='class'))throw new Error('unsupported code block');
      const language=code.className.match(/^language-([\w+.-]{1,40})$/)?.[1]||'';
      const fence='`'.repeat(Math.max(3,...[...code.textContent.matchAll(/`+/g)].map(run=>run[0].length+1)));
      return encodeTableCell(fence+language+'\n'+code.textContent+'\n'+fence,core.escaped,true);
    }
    if(tag==='code'){
      if(node.children.length)throw new Error('unsupported inline code');
      const value=node.textContent,fence='`'.repeat(Math.max(1,...[...value.matchAll(/`+/g)].map(run=>run[0].length+1)));
      const pad=/^`|`$|^\s[\s\S]*\s$/.test(value)?' ':'';
      return fence+pad+value.replace(/\n/g,' ')+pad+fence;
    }
    const text=[...node.childNodes].map(convert).join('');
    if(tag==='a')return '['+text+']('+destination(node,'href')+')';
    if(inlineMarks[tag])return inlineMarks[tag]+text+inlineMarks[tag];
    if(tag==='p')return (node.previousSibling?'<br>':'')+text+(node.nextSibling?'<br>':'');
    const start=tag==='ol'&&node.getAttribute('start');
    if(start&&!/^\d{1,9}$/.test(start))throw new Error('invalid list start');
    return '<'+tag+(start?' start="'+start+'"':'')+'>'+text+'</'+tag+'>';
  }
  try{
    return [...template.content.childNodes].map(convert).join('')
      .replace(/\|/g,(char,offset,value)=>core.escaped(value,offset)?char:'\\|');
  }catch{return null;}
}

export function normalizeSpanCell(source){
  if(spanCellToPipe(source)===null)return null;
  return source.replace(/\n/g,'&#10;');
}

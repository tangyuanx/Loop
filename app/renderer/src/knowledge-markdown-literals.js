import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';

const markdown=new MarkdownIt({html:false,breaks:true}).use(mark);
function meaning(source) {
  const tokens=list=>list.map(token=>({type:token.type,tag:token.tag,attrs:token.attrs,hidden:token.hidden,
    content:token.type==='inline'?'':token.content,info:token.info,children:token.children?tokens(token.children):null}));
  return JSON.stringify(tokens(markdown.parse(source,{})));
}

// Remove only serializer-added escapes whose absence leaves the parsed
// Markdown unchanged. Code literals, real backslashes and meaningful syntax
// remain protected; this never runs against an opened document wholesale.
export function minimizeLiteralEscapes({text,offsets},positions) {
  if(!positions.length)return {text,offsets};
  const expected=meaning(text),removed=new Set();
  const without=extra=>{
    const skip=new Set([...removed,...extra]);
    let result='';for(let i=0;i<text.length;i++)if(!skip.has(i))result+=text[i];
    return result;
  };
  const simplify=items=>{
    if(!items.length)return;
    if(meaning(without(items))===expected){items.forEach(pos=>removed.add(pos));return;}
    if(items.length===1)return;
    const middle=items.length>>1;simplify(items.slice(0,middle));simplify(items.slice(middle));
  };
  simplify(positions);
  if(!removed.size)return {text,offsets};
  const sorted=[...removed].sort((a,b)=>a-b);
  const map=offset=>{
    if(offset===undefined)return offset;
    let low=0,high=sorted.length;
    while(low<high){const middle=(low+high)>>1;if(sorted[middle]<offset)low=middle+1;else high=middle;}
    return offset-low;
  };
  return {text:without([]),offsets:offsets.map(map)};
}

// Use the same row boundaries for Markdown rendering, editing and row commands.
// markdown-it supplies the active block indentation and quote/list offsets.
export function installTableMarkdown(md,core) {
  const line=(state,row)=>{
    const from=state.bMarks[row]+state.tShift[row],to=state.eMarks[row];
    return {from,to,text:state.src.slice(from,to)};
  };
  const undoPipeEscapes=value=>value.replace(/\\\|/g,(pair,index,source)=>core.escaped(source,index+1)?'|':pair);
  md.block.ruler.at('table',(state,start,end,silent)=>{
    const inBlock=row=>state.sCount[row]>=state.blkIndent&&state.sCount[row]-state.blkIndent<4;
    if(start+1>=end||!inBlock(start)||!inBlock(start+1))return false;
    const header=line(state,start),separator=line(state,start+1);
    if(!header.text.includes('|')||separator.text.trim().length<2||!/^[:|\- \t]+$/.test(separator.text)||/^-[ \t]/.test(separator.text))return false;
    const titles=core.tableRow(header.text),align=core.splitRow(separator.text);
    if(!titles.values.length||titles.values.length!==align.length||!align.every(core.tableAlign))return false;
    if(silent)return true;

    const previous=state.parentType;
    state.parentType='table';
    const terminators=md.block.ruler.getRules('blockquote');
    const alignments=align.map(value=>value.endsWith(':')?(value.startsWith(':')?'center':'right'):value.startsWith(':')?'left':'');
    const rows=[{...header,...titles},{...separator,values:align}];
    let next=start+2,missing=0;
    for(;next<end&&inBlock(next);next++){
      if(terminators.some(rule=>rule(state,next,end,true)))break;
      const source=line(state,next);
      if(!source.text.trim())break;
      const cells=core.tableRow(source.text);
      missing+=Math.max(0,align.length-cells.values.length);
      if(missing>65536)break;
      rows.push({...source,...cells});
    }
    state.parentType=previous;
    state.line=next;
    const table=state.push('table_open','table',1);
    table.map=[start,next];
    const startOfLine=position=>state.src.lastIndexOf('\n',position-1)+1;
    table.meta={from:header.from,to:rows.at(-1).to,rows,
      lineFrom:startOfLine(header.from),prefix:state.src.slice(startOfLine(separator.from),separator.from)};
    const emitRow=(record,index,kind)=>{
      state.push('tr_open','tr',1).map=[index,index+1];
      alignments.forEach((alignment,column)=>{
        const cell=state.push(kind+'_open',kind,1);
        if(kind==='th')cell.attrSet('scope','col');
        if(alignment)cell.attrSet('style','text-align:'+alignment);
        const inline=state.push('inline','',0);
        inline.content=undoPipeEscapes(record.values[column]??'');
        inline.children=[];
        state.push(kind+'_close',kind,-1);
      });
      state.push('tr_close','tr',-1);
    };
    if(!state.env?.tableLocationsOnly){
      state.push('thead_open','thead',1).map=[start,start+1];
      emitRow(rows[0],start,'th');
      state.push('thead_close','thead',-1);
      if(rows.length>2){
        state.push('tbody_open','tbody',1).map=[start+2,next];
        for(let row=2;row<rows.length;row++)emitRow(rows[row],start+row,'td');
        state.push('tbody_close','tbody',-1);
      }
    }
    state.push('table_close','table',-1);
    return true;
  },{alt:['paragraph','reference']});
}

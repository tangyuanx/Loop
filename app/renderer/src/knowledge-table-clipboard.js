import {escape} from './knowledge-renderer.js';

const cellLimit=50000;
const columnLimit=1000;

function htmlGrid(html) {
  // Template contents are inert. Only cell text is carried into the note.
  const template=document.createElement('template');
  template.innerHTML=html;
  const table=template.content.querySelector('table');
  if(!table?.rows.length||table.rows.length>cellLimit)return null;
  const rows=Array.from(table.rows,()=>[]);
  let width=0;
  for(const row of table.rows){
    let column=0;
    for(const cell of row.cells){
      const target=rows[row.rowIndex];
      while(target[column]!==undefined)column++;
      const end=column+cell.colSpan;
      if(end>columnLimit||end*rows.length>cellLimit)return null;
      for(const ignored of cell.querySelectorAll('script,style,table'))ignored.remove();
      for(const br of cell.querySelectorAll('br'))br.replaceWith('\n');
      const height=Math.min(cell.rowSpan||row.parentElement.rows.length-row.sectionRowIndex,rows.length-row.rowIndex);
      for(let y=row.rowIndex;y<row.rowIndex+height;y++)for(let x=column;x<end;x++)rows[y][x]='';
      target[column]=cell.textContent.trim();
      column=end;
    }
    width=Math.max(width,column);
  }
  return width?rows.map(row=>Array.from({length:width},(_,column)=>row[column]??'')):null;
}

function delimitedGrid(text,delimiter) {
  const rows=[[]];
  let row=rows[0],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch!=='"')field+=ch;
      else if(text[i+1]==='"'){field+='"';i++;}
      else{quoted=false;closed=true;}
    }else if(ch===delimiter||ch==='\n'){
      row.push(field);
      field='';closed=false;
      if(ch==='\n'){row=[];rows.push(row);}
      if(rows.length>cellLimit||row.length>=columnLimit)return null;
    }else if(closed)return null;
    else if(ch==='"'&&!field)quoted=true;
    else field+=ch;
  }
  if(quoted)return null;
  row.push(field);
  let width=0;
  for(const line of rows)width=Math.max(width,line.length);
  return width*rows.length<=cellLimit?rows:null;
}

export function clipboardTable(data) {
  const html=data?.getData('text/html');
  if(html&&html.length<=4_000_000){
    const grid=htmlGrid(html);
    if(grid)return grid;
  }
  const csv=data?.getData('text/csv');
  const plain=data?.getData('text/plain')||'';
  const input=(csv||plain).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/\n$/,'');
  if(!input||input.length>2_000_000)return null;
  if(!csv&&input.includes('\t')){
    const grid=delimitedGrid(input,'\t');
    return grid?.some(row=>row.length>1)?grid:null;
  }
  if(!input.includes(',')||!csv&&!input.includes('\n'))return null;
  const grid=delimitedGrid(input,',');
  // Plain text requires a consistent multi-line rectangle before treating the
  // commas as separators. An explicit CSV clipboard flavor is unambiguous.
  return grid?.[0].length>1&&(csv||grid.every(row=>row.length===grid[0].length))?grid:null;
}

export function copyTableGrid(data,rows) {
  data.setData('text/plain',rows.map(row=>row.join('\t')).join('\n'));
  data.setData('text/html','<table><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+escape(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table>');
}

const geometries=new WeakMap();

export function tableGeometry(table){
  if(geometries.has(table))return geometries.get(table);
  const slots=[],positions=new Map(),rows=[...table.rows];
  for(let row=0;row<rows.length;row++){
    slots[row]??=[];
    let col=0;
    for(const cell of rows[row].cells){
      while(slots[row][col])col++;
      positions.set(cell,{row,col});
      for(let r=row;r<row+cell.rowSpan;r++){
        slots[r]??=[];
        for(let c=col;c<col+cell.colSpan;c++)slots[r][c]=cell;
      }
      col+=cell.colSpan;
    }
  }
  const columns=slots[0]?.length||0;
  const colElements=Array.from({length:columns},()=>document.createElement('col'));
  if(colElements.length){
    const group=document.createElement('colgroup');group.append(...colElements);table.prepend(group);
  }
  const geometry={slots,positions,rows,columns,colElements};
  geometries.set(table,geometry);return geometry;
}

export function measureTableColumns(table){
  const {colElements}=tableGeometry(table);
  const origin=colElements[0]?.getBoundingClientRect().left;
  let edge=0;
  return colElements.map(column=>{
    const next=Math.round(column.getBoundingClientRect().right-origin);
    const width=next-edge;
    edge=next;
    return width;
  });
}

export function applyTableColumnWidths(table,widths){
  const {columns,colElements}=tableGeometry(table);
  const fixed=widths?.length===columns;
  table.style.width=fixed?widths.reduce((total,width)=>total+width,0)+'px':'';
  table.style.tableLayout=fixed?'fixed':'';
  colElements.forEach((column,index)=>column.style.width=fixed?widths[index]+'px':'');
}

export function cellBounds(anchor,head,geometry){
  const a=geometry.slots[anchor.row]?.[anchor.col],b=geometry.slots[head.row]?.[head.col];
  if(!a||!b)return null;
  const start=geometry.positions.get(a),end=geometry.positions.get(b);
  return {top:Math.min(start.row,end.row),left:Math.min(start.col,end.col),
    bottom:Math.max(start.row+a.rowSpan-1,end.row+b.rowSpan-1),right:Math.max(start.col+a.colSpan-1,end.col+b.colSpan-1)};
}

export function mergeBounds(model,{top,left,bottom,right}){
  if(top===0&&bottom>0)return {error:'请分别选择表头或正文的单元格。'};
  const selected=model.cells.filter(cell=>cell.row<=bottom&&cell.row+cell.rows>top&&cell.col<=right&&cell.col+cell.cols>left);
  if(selected.some(cell=>cell.row<top||cell.col<left||cell.row+cell.rows-1>bottom||cell.col+cell.cols-1>right))
    return {error:'选区包含部分已合并单元格，请选中整个合并区域。'};
  if(selected.length<2)return {error:'请选择至少两个相邻单元格。'};
  const values=selected.sort((a,b)=>a.row-b.row||a.col-b.col).map(cell=>cell.value).filter(Boolean);
  const content=values.map((value,index)=>{
    const previous=values[index-1];
    const needsBreak=index&&!/<\/(?:ul|ol|pre|p)>$/i.test(previous)&&!/^<(?:ul|ol|pre|p)\b/i.test(value);
    return (needsBreak?'<br>':'')+value;
  }).join('');
  const cells=model.cells.filter(cell=>!selected.includes(cell));
  cells.push({row:top,col:left,rows:bottom-top+1,cols:right-left+1,value:content});
  return {...model,cells};
}

export function splitSpan(model,row,col){
  const target=model.grid[row]?.[col];
  if(!target||target.rows===1&&target.cols===1)return null;
  const cells=model.cells.filter(cell=>cell!==target);
  for(let r=target.row;r<target.row+target.rows;r++)for(let c=target.col;c<target.col+target.cols;c++)
    cells.push({row:r,col:c,rows:1,cols:1,value:r===target.row&&c===target.col?target.value:''});
  return {...model,cells};
}

export function editSpan(model,operation,row,col,value,gridFor){
  const {height,width}=model,align=model.align.slice();
  let cells=model.cells.map(cell=>({...cell}));
  const result={...model,cells,align};
  if(operation==='align'){
    align[col]=({left:'l',center:'c',right:'r'})[value]||'l';
    return result;
  }
  if(operation==='cell'||operation==='cell-clear'){
    const target=model.grid[row]?.[col];
    if(!target)return null;
    cells[model.cells.indexOf(target)].value=operation==='cell'?value:'';
    return result;
  }
  const [axis,action]=operation.split('-');
  if(axis!=='row'&&axis!=='column')return null;
  const isRow=axis==='row',start=isRow?'row':'col',span=isRow?'rows':'cols',size=isRow?'height':'width';
  const index=isRow?row:col;
  if(index<0||index>=model[size])return null;
  const intersects=cell=>cell[start]<=index&&index<cell[start]+cell[span];
  if(action==='clear'||action==='duplicate'){
    if(cells.some(cell=>intersects(cell)&&cell[span]>1))return {error:'请先取消与当前行或列相交的合并。'};
    if(action==='clear'){
      for(const cell of cells.filter(intersects))cell.value='';
      return result;
    }
    if(isRow&&index===0)return null;
  }
  if(action==='move'){
    const target=Number(value)-(isRow?1:0);
    if(!Number.isInteger(target)||target<(isRow?1:0)||target>=model[size]||target===index||isRow&&index===0)return null;
    const map=Array.from({length:model[size]},(_,i)=>i);
    map.splice(target,0,map.splice(index,1)[0]);
    const positions=new Map(map.map((old,i)=>[old,i]));
    for(const cell of cells){
      const indexes=Array.from({length:cell[span]},(_,offset)=>positions.get(cell[start]+offset));
      const first=Math.min(...indexes);
      if(Math.max(...indexes)-first+1!==cell[span])return {error:'移动会打断合并区域，请先取消合并。'};
      cell[start]=first;
    }
    if(!isRow)align.splice(target,0,align.splice(index,1)[0]);
    return result;
  }
  if(action==='delete'){
    if(isRow&&index===0||!isRow&&width===1)return null;
    cells=cells.filter(cell=>!intersects(cell)||cell[span]>1);
    for(const cell of cells){
      if(intersects(cell))cell[span]--;
      else if(cell[start]>index)cell[start]--;
    }
    if(!isRow)align.splice(index,1);
    return {...result,cells,[size]:model[size]-1};
  }
  if(!['before','add','duplicate'].includes(action))return null;
  const at=Math.max(isRow?1:0,index+(action==='before'?0:1));
  result[size]++;
  for(const cell of cells){
    if(cell[start]>=at)cell[start]++;
    else if(cell[start]+cell[span]>at)cell[span]++;
  }
  if(!isRow)align.splice(at,0,action==='duplicate'?align[index]:'l');
  if(action==='duplicate')for(const cell of model.cells.filter(intersects))cells.push({...cell,[start]:at});
  const grid=gridFor(result.height,result.width,cells);
  if(!grid)return null;
  for(let r=0;r<result.height;r++)for(let c=0;c<result.width;c++){
    if(!grid[r][c])cells.push({row:r,col:c,rows:1,cols:1,value:''});
  }
  return result;
}

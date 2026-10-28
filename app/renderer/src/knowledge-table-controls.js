// Contextual controls for the production Markdown table widget. Every edit is
// delegated to the editor transaction/history; no second table model exists.
const icons={plus:'M8 2v12M2 8h12',more:'M3 8h.01M8 8h.01M13 8h.01',grip:'M5 3h.01M11 3h.01M5 8h.01M11 8h.01M5 13h.01M11 13h.01'};
function button(label,icon,className='') {
  const el=document.createElement('button');el.type='button';el.className=className;el.title=label;el.setAttribute('aria-label',label);
  el.innerHTML=`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${icons[icon]}"/></svg>`;
  el.addEventListener('mousedown',event=>event.preventDefault());return el;
}
export function tablePosition(owner,widget,row,column=0) {
  const cell=widget.querySelector('table')?.rows[row]?.cells[column];
  const range=cell&&owner.tableCellRange(widget,row,column);if(!range)return false;
  owner.finishTableCell();owner.tableColumn=column;
  owner.view.dispatch({selection:{anchor:range.from},scrollIntoView:false});return true;
}
export function installTableControls(owner,widget) {
  const table=widget.querySelector('table'),stage=document.createElement('div');stage.className='kn-table-stage';table.before(stage);stage.append(table);
  const controls=document.createElement('div');controls.className='kn-table-controls-layer';stage.append(controls);
  const main=button('表格操作','more','kn-table-menu-trigger');main.dataset.tableAction='tools';main.setAttribute('aria-haspopup','menu');controls.append(main);
  main.onclick=()=>{
    const active=owner.activeTableCell;
    if(active?.composing)return;
    const row=active?.widget===widget?active.row:0,column=active?.widget===widget?active.column:0;
    if(tablePosition(owner,widget,row,column))owner.options.onTableMenu?.({widget,row,column,scope:'table',trigger:main});
  };
  const addRow=button('添加行','plus','kn-table-edge kn-table-add-row'),addColumn=button('添加列','plus','kn-table-edge kn-table-add-column');
  addRow.dataset.tableAction='row-add';addColumn.dataset.tableAction='column-add';controls.append(addRow,addColumn);
  addRow.onclick=()=>{if(!owner.activeTableCell?.composing&&tablePosition(owner,widget,table.rows.length-1,0))owner.table('row-add',0);};
  addColumn.onclick=()=>{const column=table.rows[0].cells.length-1;if(!owner.activeTableCell?.composing&&tablePosition(owner,widget,0,column))owner.table('column-add',column);};
  const handles=[],resizers=[];let frame=0,gesture=null;
  const queue=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(layout);};
  function layout() {
    if(!widget.isConnected||owner.destroyed)return;
    const bounds=table.getBoundingClientRect(),base=stage.getBoundingClientRect();
    for(const item of handles){const rect=item.kind==='row'?table.rows[item.index].getBoundingClientRect():table.rows[0].cells[item.index].getBoundingClientRect();
      item.el.style.left=(item.kind==='row'?bounds.left-base.left-20:rect.left-base.left)+'px';
      item.el.style.top=(item.kind==='row'?rect.top-base.top:bounds.top-base.top-20)+'px';
      item.el.style.width=(item.kind==='row'?18:rect.width)+'px';item.el.style.height=(item.kind==='row'?rect.height:18)+'px';
    }
    for(const item of resizers){const rect=table.rows[0].cells[item.column].getBoundingClientRect();item.el.style.left=rect.right-base.left-4+'px';item.el.style.top=bounds.top-base.top+'px';item.el.style.height=bounds.height+'px';}
    addRow.style.top=bounds.bottom-base.top+2+'px';addRow.style.width=bounds.width+'px';
    addColumn.style.left=bounds.right-base.left+2+'px';addColumn.style.height=bounds.height+'px';
    main.title=main.getAttribute('aria-label')+` · ${table.rows.length-1} 行 ${table.rows[0].cells.length} 列`;
  }
  function finish(cancel=false) {
    const current=gesture;if(!current)return;gesture=null;current.abort.abort();widget.classList.remove('kn-table-dragging');
    controls.querySelectorAll('[data-drop-target]').forEach(el=>el.removeAttribute('data-drop-target'));
    if(current.kind==='resize') {
      if(cancel){owner.applyTableWidths(widget,Number(widget.dataset.sourcePos));return;}
      owner.resizeTableColumn(current.index,current.width);
    }else if(current.moved&&current.target!==current.index&&!cancel){
      if(tablePosition(owner,widget,current.kind==='row'?current.index:0,current.kind==='column'?current.index:0))
        owner.table(current.kind+'-move',current.kind==='column'?current.index:0,current.kind==='row'?current.target+1:current.target);
    }
    queue();
  }
  function start(event,kind,index) {
    if(event.button!==0||owner.activeTableCell?.composing)return;
    event.preventDefault();event.stopPropagation();
    const widths=[...table.rows[0].cells].map(cell=>Math.round(cell.getBoundingClientRect().width));
    gesture={kind,index,target:index,origin:[event.clientX,event.clientY],widths,width:widths[index],moved:false,abort:new AbortController()};
    const current=gesture,signal=current.abort.signal;
    window.addEventListener('pointermove',move=>{
      if(!widget.isConnected){finish(true);return;}
      if(Math.hypot(move.clientX-current.origin[0],move.clientY-current.origin[1])<5&&!current.moved)return;
      current.moved=true;widget.classList.add('kn-table-dragging');
      if(kind==='resize') {
        current.width=Math.max(80,Math.min(1600,Math.round(widths[index]+move.clientX-current.origin[0])));
        const next=widths.slice();next[index]=current.width;table.style.tableLayout='fixed';table.style.width=next.reduce((a,b)=>a+b,0)+'px';
        for(const row of table.rows)for(let c=0;c<row.cells.length;c++)row.cells[c].style.width=next[c]+'px';queue();return;
      }
      const axis=kind==='row'?'clientY':'clientX',items=kind==='row'?[...table.rows]:[...table.rows[0].cells];
      current.target=items.findIndex(cell=>{const r=cell.getBoundingClientRect();return move[axis]>=(kind==='row'?r.top:r.left)&&move[axis]<=(kind==='row'?r.bottom:r.right);});
      if(kind==='row'&&current.target===0)current.target=1;
      if(current.target<0)current.target=index;
      for(const item of handles)if(item.kind===kind){if(item.index===current.target)item.el.dataset.dropTarget='true';else item.el.removeAttribute('data-drop-target');}
    },{signal});
    window.addEventListener('pointerup',()=>finish(),{once:true,signal});
    window.addEventListener('pointercancel',()=>finish(true),{once:true,signal});
    window.addEventListener('blur',()=>finish(true),{once:true,signal});
    window.addEventListener('keydown',key=>{if(key.key==='Escape'){key.preventDefault();key.stopImmediatePropagation();finish(true);}},{capture:true,signal});
  }
  function handle(kind,index) {
    const label=kind==='row'?(index===0?'表头行':`第${index}行`):`第${index+1}列`;
    const el=button(`${label}操作${kind==='row'&&index===0?'':'（可拖动排序）'}`,'grip',`kn-table-handle kn-table-${kind}-handle`);el.dataset.tableHandle=kind;el.dataset.index=index;el.setAttribute('aria-haspopup','menu');
    el.addEventListener('pointerdown',event=>{if(kind==='row'&&index===0)return;start(event,kind,index);});
    el.onclick=event=>{if(event.detail&&el.dataset.dragged==='true'){delete el.dataset.dragged;return;}
      if(owner.activeTableCell?.composing)return;
      const row=kind==='row'?index:0,column=kind==='column'?index:0;
      if(tablePosition(owner,widget,row,column))owner.options.onTableMenu?.({widget,row,column,scope:kind,trigger:el});
    };
    // Native click follows pointerup. Mark it before the global listener runs.
    el.addEventListener('pointerup',()=>{if(gesture?.moved)el.dataset.dragged='true';});
    controls.append(el);handles.push({kind,index,el});
  }
  for(let row=0;row<table.rows.length;row++)handle('row',row);
  for(let column=0;column<table.rows[0].cells.length;column++){
    handle('column',column);const el=document.createElement('div');el.className='kn-table-resizer';el.dataset.column=column;el.title='拖动调整列宽';el.setAttribute('aria-hidden','true');
    el.addEventListener('pointerdown',event=>start(event,'resize',column));controls.append(el);resizers.push({el,column});
  }
  const observer=new ResizeObserver(queue);observer.observe(table);queue();
  widget.tableControls={refresh:queue,destroy(){finish(true);observer.disconnect();cancelAnimationFrame(frame);}};
}

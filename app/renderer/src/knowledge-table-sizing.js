import {tableGeometry} from './knowledge-span-grid.js';

// HTML table heights are minimums: content, including rowspan cells, remains
// fully visible after narrowing columns, typing, image loads or font changes.
export function applyTableRowHeights(table,heights) {
  // Legacy header heights stay in storage but never affect natural layout.
  [...table.rows].forEach((row,index)=>{
    const height=row.parentElement===table.tHead?0:heights?.[index];
    row.style.height=height?height+'px':'';
  });
}

export function preferredColumnWidth(table,index,limit) {
  const {slots,positions}=tableGeometry(table);
  const cells=[...new Set(slots.map(row=>row[index]))].filter(Boolean);
  const probe=document.createElement('div');probe.className='kn-rendered kn-table-size-probe';
  table.parentElement.append(probe);
  let width=80;
  try {
    for(const cell of cells) {
      const measuring=document.createElement('table'),row=measuring.insertRow(),copy=cell.cloneNode(true);
      measuring.style.cssText='display:table;width:max-content;max-width:none;table-layout:auto;margin:0';
      copy.removeAttribute('rowspan');copy.removeAttribute('colspan');copy.style.height='auto';
      copy.style.minWidth='0';copy.style.width='auto';copy.style.maxWidth='none';copy.style.whiteSpace='nowrap';
      copy.querySelectorAll('.kn-table-cell-editor,.kn-table-cell-content,button').forEach(node=>node.remove());
      // A live visual cell uses the same markup as its resting renderer.
      copy.querySelectorAll('[contenteditable]').forEach(node=>node.removeAttribute('contenteditable'));
      row.append(copy);probe.replaceChildren(measuring);
      const natural=Math.ceil(copy.getBoundingClientRect().width);
      const {col}=positions.get(cell);
      // A spanning cell shares its content requirement across its logical
      // columns. Other columns keep their current widths during this action.
      const cols=tableGeometry(table).colElements;
      const other=cols.slice(col,col+cell.colSpan).reduce((sum,column,c)=>sum+(col+c===index?0:column.getBoundingClientRect().width),0);
      width=Math.max(width,natural-other);
    }
  } finally {probe.remove();}
  return Math.max(80,Math.min(limit,Math.ceil(width)));
}

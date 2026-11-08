const assert=require('node:assert/strict');
module.exports=async({page,choose,mode,markdown})=>{
 console.log('Contextual table: row/column menus, reorder, drag width, cancellation, keyboard and undo.');
 await choose('c');await mode('edit');
 const source='# 简洁表格\n\n| 项目 | 状态 |\n| --- | ---: |\n| A | 1 |\n| B | 2 |\n| C | 3 |\n\n正文';
 await page.evaluate(source=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.fitTableWidth(0);e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:source},selection:{anchor:0}});e.view.dom.blur();},source);
 const widget=page.locator('.kn-table-widget'),table=widget.locator('table');
 const row=i=>widget.locator(`[data-table-handle="row"][data-index="${i}"]`),column=i=>widget.locator(`[data-table-handle="column"][data-index="${i}"]`);
 const menu=async(scope,index)=>{await (scope==='row'?row(index):scope==='column'?column(index):widget.locator('[data-table-action=tools]')).click();await page.locator('.kn-table-menu').waitFor();};
 const command=async name=>{await page.locator(`[data-table-command="${name}"]:not(:disabled)`).first().click();await page.waitForTimeout(60);};
 const undo=async()=>{await page.evaluate(()=>knowledgeCurrentEntry().format('undo'));await page.waitForTimeout(50);};
 await page.locator('.task-work-main > .tabs-bar').click({position:{x:20,y:10}});await page.mouse.move(700,100);assert.equal(await row(1).evaluate(el=>getComputedStyle(el).opacity),'0');await widget.hover();assert.equal(await row(1).evaluate(el=>getComputedStyle(el).opacity),'1');
 await menu('row',1);await command('row-duplicate');assert.equal(await widget.locator('tbody tr').count(),4);await undo();assert.equal(await markdown(),source);
 await menu('row',1);await command('row-move'); // first enabled match is "下移一行".
 assert.match(await markdown(),/\| B \| 2 \|\n\| A \| 1 \|/);await undo();
 await menu('column',0);await command('column-duplicate');assert.equal(await widget.locator('th').count(),3);await undo();
 await menu('column',1);await command('column-clear');assert.match(await markdown(),/\| A \|  \|/);await undo();
 await menu('column',0);await page.locator('[data-table-command=align][data-value=center]').click();await page.waitForTimeout(50);assert.equal(await widget.locator('th').first().evaluate(el=>el.style.textAlign),'center');await undo();
 // Real pointer gestures in the Electron window, including Escape cancellation.
 const first=await row(1).boundingBox(),last=await row(3).boundingBox();await page.mouse.move(first.x+8,first.y+first.height/2);await page.mouse.down();await page.mouse.move(last.x+8,last.y+last.height/2,{steps:15});await page.mouse.up();
 await page.waitForTimeout(100);assert.match(await markdown(),/\| B \| 2 \|\n\| C \| 3 \|\n\| A \| 1 \|/);await undo();
 const c0=await column(0).boundingBox(),c1=await column(1).boundingBox();await page.mouse.move(c0.x+c0.width/2,c0.y+8);await page.mouse.down();await page.mouse.move(c1.x+c1.width/2,c1.y+8,{steps:12});await page.mouse.up();await page.waitForTimeout(80);assert.match(await markdown(),/\| 状态 \| 项目 \|/);await undo();
 const originalWidths=await page.evaluate(()=>knowledgeCurrentEntry().options.tableColumnWidths||[]);
 const edge=widget.locator('.kn-table-resizer').first(),r=await edge.boundingBox(),width=await widget.locator('th').first().evaluate(el=>el.getBoundingClientRect().width);
 await page.mouse.move(r.x+4,r.y+10);await page.mouse.down();await page.mouse.move(r.x+84,r.y+10,{steps:12});await page.mouse.up();await page.waitForTimeout(80);assert.ok(await widget.locator('th').first().evaluate(el=>el.getBoundingClientRect().width)>=width+65);
 assert.equal(await markdown(),source,'width remains display metadata');await undo();assert.deepEqual(await page.evaluate(()=>knowledgeCurrentEntry().options.tableColumnWidths||[]),originalWidths);
 const before=await markdown(),cancel=await row(1).boundingBox(),cancelTo=await row(3).boundingBox();await page.mouse.move(cancel.x+8,cancel.y+8);await page.mouse.down();await page.mouse.move(cancelTo.x+8,cancelTo.y+8,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await markdown(),before);
 await widget.locator('tbody td').first().click();
 await page.locator('.kn-table-cell-editor').evaluate(field=>field.setSelectionRange(0,1,'backward'));
 await menu('table');await command('fit');const fit=await table.evaluate(el=>el.getBoundingClientRect().width);assert.ok(fit>300);
 const field=page.locator('.kn-table-cell-editor');
 const cellFocus=()=>field.evaluate(input=>({focused:input===document.activeElement,start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection}));
 assert.deepEqual(await cellFocus(),{focused:true,start:0,end:1,direction:'backward'},'fit retains the cell text selection');
 assert.equal(await markdown(),source,'fitting changes only display metadata');
 assert.equal(await widget.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'fit accounts for the table controls padding');
 assert.equal(await page.locator('.cm-cursor').evaluateAll(nodes=>nodes.some(node=>node.getBoundingClientRect().height>60)),false,'fit must not paint a table-height caret');
 const fittedEdge=await widget.locator('.kn-table-resizer').first().boundingBox();
 await page.mouse.move(fittedEdge.x+4,fittedEdge.y+10);await page.mouse.down();await page.mouse.move(fittedEdge.x-40,fittedEdge.y+10,{steps:12});await page.mouse.up();
 assert.deepEqual(await cellFocus(),{focused:true,start:0,end:1,direction:'backward'},'shrinking a column retains the cell text selection');
 await page.keyboard.insertText('定位输入');assert.match(await markdown(),/\| 定位输入 \| 1 \|/);
 await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');assert.equal(await markdown(),source);
 const customWidths=await page.evaluate(()=>knowledgeCurrentEntry().options.tableColumnWidths);
 await menu('table');await command('auto-width');assert.equal((await cellFocus()).focused,true);
 assert.deepEqual(await page.evaluate(()=>knowledgeCurrentEntry().options.tableColumnWidths[0]),[],'automatic width clears the custom widths');
 await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');
 assert.deepEqual(await page.evaluate(()=>knowledgeCurrentEntry().options.tableColumnWidths),customWidths,'undo restores the previous custom widths');
 await page.keyboard.press(process.platform==='darwin'?'Meta+Shift+z':'Control+Shift+z');
 assert.deepEqual(await page.evaluate(()=>knowledgeCurrentEntry().options.tableColumnWidths[0]),[]);
 const automaticWidths=await widget.locator('th').evaluateAll(cells=>cells.map(cell=>cell.getBoundingClientRect().width));
 await field.evaluate(input=>input.setSelectionRange(0,1,'backward'));
 await menu('table');await command('details');
 await page.getByLabel('列宽（px）',{exact:true}).fill('150');await page.getByRole('button',{name:'设置列宽',exact:true}).click();
 assert.deepEqual(await cellFocus(),{focused:true,start:0,end:1,direction:'backward'},'precise width retains the cell selection');
 assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().options.tableColumnWidths[0][0]),150);
 const preciseWidths=await widget.locator('th').evaluateAll(cells=>cells.map(cell=>cell.getBoundingClientRect().width));
 assert.ok(preciseWidths.slice(1).every((width,index)=>Math.abs(width-automaticWidths[index+1])<=1),'setting one width retains the other column widths');
 await page.evaluate(()=>{window.__tableClipboardWrite=navigator.clipboard.writeText;window.__tableCopied='';navigator.clipboard.writeText=async text=>{window.__tableCopied=text;};});
 try{
  await menu('table');await command('copy');
  assert.equal(await page.evaluate(()=>window.__tableCopied),source.slice(source.indexOf('| 项目'),source.indexOf('\n\n正文')));
  assert.deepEqual(await cellFocus(),{focused:true,start:0,end:1,direction:'backward'},'copy returns focus to the cell');
 }finally{await page.evaluate(()=>{navigator.clipboard.writeText=window.__tableClipboardWrite;});}
 assert.equal(await markdown(),source);
 // Cell formatting must keep the selected text, just like the main editor.
 // Repeating the action removes the same marks instead of appending empty ones.
 for(const action of ['bold','italic','strike','highlight','inline']){
  await widget.locator('tbody td').first().click();
  await field.evaluate(input=>input.setSelectionRange(0,1,'backward'));
  await page.evaluate(action=>knowledgeCurrentEntry().format(action),action);
  const formatted=await markdown();
  assert.equal(await field.evaluate(input=>input.value.slice(input.selectionStart,input.selectionEnd)),'A',action+' keeps the text selected');
  assert.equal((await cellFocus()).direction,'backward');
  await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');assert.equal(await markdown(),source,action+' undoes independently');
  await page.keyboard.press(process.platform==='darwin'?'Meta+Shift+z':'Control+Shift+z');assert.equal(await markdown(),formatted,action+' redoes');
  await field.evaluate(input=>input.setSelectionRange(knowledgeCurrentEntry().activeTableCell.input.value.indexOf('A'),knowledgeCurrentEntry().activeTableCell.input.value.indexOf('A')+1,'backward'));
  await page.evaluate(action=>knowledgeCurrentEntry().format(action),action);
  assert.equal(await markdown(),source,action+' toggles off');
  assert.deepEqual(await cellFocus(),{focused:true,start:0,end:1,direction:'backward'});
 }
 await widget.locator('tbody td').first().click();await page.keyboard.press(process.platform==='darwin'?'Meta+Enter':'Control+Enter');await page.waitForTimeout(60);assert.equal(await widget.locator('tbody tr').count(),4);await undo();
 await page.keyboard.press('Escape');await menu('column',0);await page.keyboard.press('Escape');await page.waitForTimeout(50);assert.equal(await column(0).evaluate(el=>el===document.activeElement),true);
 await widget.locator('tbody td').first().click();await page.keyboard.press('End');await page.keyboard.press('Shift+Enter');await page.keyboard.type('second line');assert.match(await page.locator('.kn-table-cell-editor').inputValue(),/\nsecond line/);assert.match(await markdown(),/A<br>second line/);await page.keyboard.press('Escape');assert.equal(await widget.locator('tbody td').first().locator('br').count(),1);
 const safety=await page.evaluate(()=>{const r=knowledgeCurrentEntry().renderer,root=document.createElement('div');root.innerHTML=r.render('正文 <br> 字面\n\n| A |\n| --- |\n| `code<br>` 与 \\<br> |\n\n<script>alert(1)</script>');return {breaks:root.querySelectorAll('td br').length,scripts:root.querySelectorAll('script').length,text:root.textContent};});assert.equal(safety.breaks,0);assert.equal(safety.scripts,0);assert.match(safety.text,/正文 <br> 字面/);
};

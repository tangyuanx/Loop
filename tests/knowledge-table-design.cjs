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
 await page.locator('.knowledge-header').click({position:{x:20,y:10}});await page.mouse.move(700,100);assert.equal(await row(1).evaluate(el=>getComputedStyle(el).opacity),'0');await widget.hover();assert.equal(await row(1).evaluate(el=>getComputedStyle(el).opacity),'1');
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
 await menu('table');await command('fit');const fit=await table.evaluate(el=>el.getBoundingClientRect().width);assert.ok(fit>300);await menu('table');await command('auto-width');
 await widget.locator('tbody td').first().click();await page.keyboard.press(process.platform==='darwin'?'Meta+Enter':'Control+Enter');await page.waitForTimeout(60);assert.equal(await widget.locator('tbody tr').count(),4);await undo();
 await page.keyboard.press('Escape');await menu('column',0);await page.keyboard.press('Escape');await page.waitForTimeout(50);assert.equal(await column(0).evaluate(el=>el===document.activeElement),true);
 await widget.locator('tbody td').first().click();await page.keyboard.press('End');await page.keyboard.press('Shift+Enter');await page.keyboard.type('second line');assert.match(await page.locator('.kn-table-cell-editor').inputValue(),/\nsecond line/);assert.match(await markdown(),/A<br>second line/);await page.keyboard.press('Escape');assert.equal(await widget.locator('tbody td').first().locator('br').count(),1);
 const safety=await page.evaluate(()=>{const r=knowledgeCurrentEntry().renderer,root=document.createElement('div');root.innerHTML=r.render('正文 <br> 字面\n\n| A |\n| --- |\n| `code<br>` 与 \\<br> |\n\n<script>alert(1)</script>');return {breaks:root.querySelectorAll('td br').length,scripts:root.querySelectorAll('script').length,text:root.textContent};});assert.equal(safety.breaks,0);assert.equal(safety.scripts,0);assert.match(safety.text,/正文 <br> 字面/);
};

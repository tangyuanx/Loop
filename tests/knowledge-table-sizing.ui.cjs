const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
const wb=require('./workbench-helpers.cjs');
const mod=process.platform==='darwin'?'Meta':'Control';

async function main(){
 const evidence=path.resolve('.local-review/table-sizing-112');await fs.mkdir(evidence,{recursive:true});
 const files=await fs.mkdtemp(path.join(os.tmpdir(),'loop-sizing-files-')),file=path.join(files,'Sizing.md');
 await fs.copyFile(path.resolve('app/resources/icon.png'),path.join(files,'image.png'));
 const source=['# 表格尺寸验收','','| 项目 | 详细内容 | 图片 |','| --- | --- | --- |',
 '| 短 | 这是一段需要限制列宽后自动换行的长文本。'+'这是中文和English long text '.repeat(12)+' | ![图](image.png "[loop-image width=96 align=left]") |',
 '| 列表 | <ul><li>第一项</li><li>第二项</li></ul> | code |',
 '| 多行 | 第一行<br>第二行<br>第三行 | <pre><code>let a = 1;&#10;let b = 2;</code></pre> |',
 '', '| 第二张表 | 保持独立 |','| --- | --- |','| other | value |',''].join('\n');
 await fs.writeFile(file,source);
 const disk=await readKnowledgeDocument(file);
 let run=await launchRepository({activeTaskId:'sizing',taskPane:'notes',tasks:[task('sizing',{title:'表格尺寸',notes:source,knowledgeNote:{...disk,documentState:'SAVED',dirty:false}})]},'table-sizing');
 try{
  const {page,app}=run;
  await page.locator('[data-pane=notes]').click();await wb.minimizeTaskInfo(page);
  const widget=()=>page.locator('.kn-table-widget').first();
  await widget().waitFor();
  await page.waitForFunction(()=>document.querySelector('.kn-table-widget img')?.naturalWidth>0);
  const meta=()=>page.evaluate(()=>({rows:knowledgeCurrentEntry().options.tableRowHeights||[],cols:knowledgeCurrentEntry().options.tableColumnWidths||[]}));
  const markdown=()=>page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
  const size=row=>widget().locator('tr').nth(row).evaluate(el=>el.getBoundingClientRect().height);
  async function menu(scope,index,command,value){
   await widget().hover();await widget().locator(`[data-table-handle=${scope}][data-index="${index}"]`).click({button:'right'});
   await page.locator(`[data-table-command="${command}"]${value===undefined?'':`[data-value="${value}"]`}`).click();
  }
  async function drag(row,dy,cancel=''){
   const edge=widget().locator(`.kn-table-row-resizer[data-row="${row}"]`);
   await edge.scrollIntoViewIfNeeded();const r=await edge.boundingBox();
   await page.mouse.move(r.x+25,r.y+4);await page.mouse.down();await page.mouse.move(r.x+25,r.y+4+dy,{steps:8});
   if(cancel==='Escape')await page.keyboard.press('Escape');
   if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
   if(cancel==='pointercancel')await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel')));
   if(cancel==='leave')await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointerleave')));
   await page.mouse.up();await page.waitForTimeout(70);
  }
  // Give the long paragraph a stable width before vertical dragging.
  await page.evaluate(()=>{const e=knowledgeCurrentEntry(),w=e.root.querySelector('.kn-table-widget');[110,300,140].forEach((v,c)=>e.resizeTableColumn(c,v,w));});
  const natural=await size(2);await drag(2,85);
  assert.ok(await size(2)>=natural+80);const grown=await meta();assert.ok(grown.rows[0][2]>natural);
  assert.equal(await markdown(),source);assert.equal(await fs.readFile(file,'utf8'),source);
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.view.focus();});
  await page.keyboard.press(mod+'+z');assert.deepEqual((await meta()).rows,[]);
  await page.keyboard.press(mod+'+Shift+z');assert.deepEqual((await meta()).rows,grown.rows);
  for(const cancel of ['Escape','blur','pointercancel','leave']){const before=await size(2);await drag(2,45,cancel);assert.ok(Math.abs(await size(2)-before)<1);assert.deepEqual((await meta()).rows,grown.rows);}
  await drag(2,-300);assert.ok(await size(2)>=natural-1,'row cannot clip the list');
  await menu('row',2,'row-fit');assert.ok(Math.abs(await size(2)-natural)<1);
  const fitted=await meta();await menu('row',2,'row-fit');assert.deepEqual(await meta(),fitted);
  await page.evaluate(()=>knowledgeCurrentEntry().finishTableCell());
  await menu('column',1,'column-fit');
  const limited=(await meta()).cols[0][1];assert.ok(limited>=80&&limited<=480);
  await menu('column',1,'column-fit');assert.equal((await meta()).cols[0][1],limited,'fitting is stable');
  await menu('column',0,'column-fit');assert.equal((await meta()).cols[0][0],80,'short text fits minimum');
  await menu('column',2,'column-fit');assert.ok((await meta()).cols[0][2]>=96);
  const edge=widget().locator('.kn-table-resizer[data-column="0"]');await edge.dblclick();assert.equal((await meta()).cols[0][0],80);
  await drag(2,70);const rowsBefore=(await meta()).rows[0];
  await menu('row',2,'row-before');assert.deepEqual((await meta()).rows[0],[...rowsBefore.slice(0,2),0,...rowsBefore.slice(2)]);
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.view.focus();});await page.keyboard.press(mod+'+z');assert.deepEqual((await meta()).rows[0],rowsBefore);
  await menu('row',2,'row-duplicate');assert.deepEqual((await meta()).rows[0],[...rowsBefore.slice(0,3),rowsBefore[2],...rowsBefore.slice(3)]);
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.view.focus();});await page.keyboard.press(mod+'+z');
  await menu('row',2,'row-move',4);
  const moved=rowsBefore.slice();moved.splice(3,0,moved.splice(2,1)[0]);assert.deepEqual((await meta()).rows[0],moved);
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.view.focus();});await page.keyboard.press(mod+'+z');
  await menu('row',1,'row-delete');assert.deepEqual((await meta()).rows[0],rowsBefore.filter((_,i)=>i!==1));
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.view.focus();});await page.keyboard.press(mod+'+z');
  await menu('column',1,'column-before');assert.deepEqual((await meta()).rows[0],rowsBefore);
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.view.focus();});await page.keyboard.press(mod+'+z');
  // Merge and split keep both row and column metadata, including covered rows.
  await page.evaluate(()=>{const e=knowledgeCurrentEntry(),w=e.root.querySelector('.kn-table-widget');e.finishTableCell();e.selectTableRange(w,{row:1,col:0},{row:2,col:1});e.tableLocation={widget:w,row:1,column:0};e.view.dispatch({selection:{anchor:e.tableCellRange(w,1,0).from}});e.table('merge-cells');});
  await widget().locator('td[rowspan="2"][colspan="2"]').waitFor();
  await drag(2,30);const mergedMeta=await meta();
  await menu('row',2,'row-fit');assert.equal((await meta()).rows[0]?.[2]||0,0);
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.view.focus();});await page.keyboard.press(mod+'+z');assert.deepEqual((await meta()).rows,mergedMeta.rows);
  assert.ok((await markdown()).includes('第一项'));
  await menu('column',0,'column-fit');const spanWidth=(await meta()).cols[0][0];
  await menu('column',0,'column-fit');assert.equal((await meta()).cols[0][0],spanWidth);
  await widget().locator('td[rowspan="2"][colspan="2"]').click({position:{x:8,y:12}});
  const beforeSplit=await meta();await widget().locator('[data-table-action=tools]').click();await page.locator('[data-table-command=split-cell]').click();
  await widget().locator('table:not([data-loop-table])').waitFor();assert.deepEqual(await meta(),beforeSplit);
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.view.focus();});await page.keyboard.press(mod+'+z');
  await widget().locator('td[rowspan="2"][colspan="2"]').waitFor();
  // Resizing a second table must not affect the selected/active first one.
  await page.evaluate(()=>{const e=knowledgeCurrentEntry(),w=e.root.querySelectorAll('.kn-table-widget')[1];e.resizeTableRow(1,123,w);});
  assert.equal((await meta()).rows[1][1],123);
  await widget().locator('[data-table-action=tools]').click();await page.locator('[data-table-command=delete]').click();
  assert.deepEqual((await meta()).rows,[[0,123]],'deleting a table shifts later row metadata');
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.view.focus();});await page.keyboard.press(mod+'+z');
  await widget().locator('td[rowspan="2"][colspan="2"]').waitFor();
  const retained=await meta();
  await wb.mode(page,'preview');assert.equal(await page.locator('.kn-reading table').nth(1).locator('tbody tr').first().evaluate(el=>Math.round(el.getBoundingClientRect().height)),123);
  await wb.mode(page,'edit');
  for(const [theme,width,font] of [['light',1280,13],['dark',1024,18]]){
   await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width,850),width);
   await page.evaluate(({theme,font})=>{state.theme=theme;render();document.querySelector('.knowledge-rich-host').style.fontSize=font+'px';},{theme,font});
   await widget().waitFor();await widget().locator('tr').last().scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(evidence,theme+'.png')});
  }
  await page.evaluate(async()=>{const e=knowledgeCurrentEntry();e.finishTableCell();await saveKnowledgeTask(knowledgeActiveDocument().id);captureMountedMilkdownDrafts();save();await flushSave();});
  const expected=await markdown(),saved=JSON.parse(await fs.readFile(path.join(run.profile,'task-data.json'),'utf8'));
  assert.deepEqual(saved.tasks[0].knowledgeNote.tableRowHeights,retained.rows);assert.equal(await fs.readFile(file,'utf8'),expected);
  // Recreate through desktop normalization with the saved session, then inspect.
  const errors=run.errors.slice();await run.close();run=await launchRepository(saved,'table-sizing-reopen');
  await run.page.locator('[data-pane=notes]').click();await run.page.locator('.kn-table-widget').first().waitFor();
  assert.deepEqual(await run.page.evaluate(()=>knowledgeCurrentEntry().options.tableRowHeights),retained.rows);
  assert.equal(await run.page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),expected);
  assert.deepEqual(errors.concat(run.errors),[]);
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({status:'PASS',file,metadata:retained,checks:'real pointer row drag, cancellation, min content height, menus, double click, stable fitting, undo/redo, structural edits, spans, two tables, reading, themes, sizes, disk and reopen'},null,2));
  console.log(JSON.stringify({status:'PASS',evidence}));
 }finally{await run.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

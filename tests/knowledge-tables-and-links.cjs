/* Exercises the shipped UI and disk services, using the editor suite's isolated profile. */
const assert=require('node:assert/strict');
const path=require('node:path');
module.exports=async({page,profile,fs,readTaskData,choose,mode,markdown,append,pause,wb,setChosenPath})=>{
 const reset=async source=>{await page.evaluate(source=>{const e=knowledgeCurrentEntry();e.finishTableCell();e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:source},selection:{anchor:0}});},source);await page.locator('.kn-table-widget').first().waitFor();};
 const tools=async()=>{await page.locator('.kn-table-widget [data-table-action="tools"]').first().click();await page.locator('[data-table-command="details"]').click();await page.locator('#kn-table-row').waitFor();};
 const apply=async op=>{await page.locator(`[data-kn-table="${op}"]`).click();await page.waitForTimeout(50);};
 console.log('Table audit: empty geometry, all row/column actions, alignment, width, paste, keyboard, undo and themes.');
 await choose('c');await mode('edit');
 const empty='前文\n\n| 项目 | 内容 |\n| --- | --- |\n|  |  |\n\n后文';await reset(empty);
 assert.equal(await page.locator('.kn-table-widget [data-table-action]').count(),3);
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>{state.theme=theme;render();},theme);
  const header=page.locator('.kn-table-widget th').first();await header.click();
  const painted=()=>page.locator('.kn-cell-editing').evaluate(cell=>{
    const field=cell.querySelector('.kn-table-cell-editor'),style=getComputedStyle(field),parent=getComputedStyle(cell),walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT),visible=[];let node;
    while(node=walker.nextNode())if(!node.parentElement.closest('textarea')&&node.textContent.trim()&&getComputedStyle(node.parentElement).visibility==='visible')visible.push(node.textContent);
    return {visible,font:style.fontWeight,parentFont:parent.fontWeight,align:style.textAlign,parentAlign:parent.textAlign,background:style.backgroundColor,clipped:field.scrollHeight>field.clientHeight+1};
  });
  let display=await painted();assert.deepEqual(display.visible,[],'the transparent field must be the only painted cell text');assert.equal(display.font,display.parentFont);assert.equal(display.align,display.parentAlign);assert.equal(display.background,'rgba(0, 0, 0, 0)');
  await page.locator('.kn-table-cell-editor').fill('项目与负责人，检查较长中文在输入期间能完整换行显示。');display=await painted();assert.equal(display.clipped,false,JSON.stringify(display));assert.deepEqual(display.visible,[]);
  await page.keyboard.press('Escape');await reset(empty);
  const cell=page.locator('.kn-table-widget tbody td').first();await cell.click();
  const geometry=await cell.evaluate(cell=>{const input=cell.querySelector('.kn-table-cell-editor'),r=cell.getBoundingClientRect(),i=input.getBoundingClientRect(),style=getComputedStyle(input);return {h:r.height,inside:i.bottom<=r.bottom+1&&i.right<=r.right+1&&i.top>=r.top-1,border:style.borderColor,shadow:style.boxShadow};});
  assert.ok(geometry.h>=38&&geometry.inside,JSON.stringify(geometry));
  for(const color of [geometry.border,...geometry.shadow.match(/rgba?\([^)]*\)/g)||[]]){const rgb=color.match(/[\d.]+/g)?.map(Number)||[];assert.ok(!(rgb[1]>rgb[0]+12&&rgb[1]>rgb[2]+8),color);}
  await page.keyboard.press('Escape');assert.equal(await markdown(),empty);
 }
 await page.locator('.kn-table-widget [data-table-action="row-add"]').click();await page.waitForFunction(()=>document.querySelectorAll('.kn-table-widget tbody tr').length===2);
 await page.locator('.kn-table-cell-editor').fill('新增行');await page.keyboard.press('Escape');
 await page.locator('.kn-table-widget [data-table-action="column-add"]').click();await page.waitForFunction(()=>document.querySelectorAll('.kn-table-widget th').length===3);
 await page.locator('.kn-table-cell-editor').fill('新增列');await page.keyboard.press('Escape');
 await tools();await page.locator('#kn-table-row').selectOption('2');await page.locator('#kn-table-column').selectOption('1');await apply('row-before');assert.equal(await page.locator('.kn-table-widget tbody tr').count(),3);
 await tools();await apply('column-before');assert.equal(await page.locator('.kn-table-widget th').count(),4);
 for(const alignment of ['left','center','right']){await tools();await page.locator('#kn-table-align').selectOption(alignment);await apply('align');assert.equal(await page.locator('.kn-table-widget th').first().evaluate(el=>el.style.textAlign),alignment);}
 await tools();await page.locator('#kn-table-column').selectOption('0');await page.locator('.kn-table-controls input[type=number]').fill('240');await page.getByRole('button',{name:'设置列宽',exact:true}).click();
 assert.ok(await page.locator('.kn-table-widget th').first().evaluate(el=>el.getBoundingClientRect().width>=239));
 await mode('preview');assert.ok(await page.locator('.kn-reading th').first().evaluate(el=>el.getBoundingClientRect().width>=239));await mode('edit');
 await tools();await page.locator('#kn-table-row').selectOption('2');await apply('row-delete');assert.equal(await page.locator('.kn-table-widget tbody tr').count(),2);
 await tools();await apply('column-delete');assert.equal(await page.locator('.kn-table-widget th').count(),3);
 await tools();await apply('delete');assert.equal(await page.locator('.kn-table-widget').count(),0);assert.match(await markdown(),/^前文[\s\n]*后文$/);
 await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');assert.equal(await page.locator('.kn-table-widget').count(),1);
 await reset(empty);await page.locator('.kn-table-widget tbody td').last().click();await page.keyboard.press('Tab');await page.waitForFunction(()=>document.querySelectorAll('.kn-table-widget tbody tr').length===2);assert.match(await page.locator('.kn-table-cell-editor').getAttribute('aria-label'),/第2行，第1列/);
 await page.locator('.kn-table-cell-editor').evaluate(input=>{const clipboardData=new DataTransfer();clipboardData.setData('text/plain','甲\t乙|丙\r\n丁\t戊\r\n');input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));});
 await page.waitForFunction(()=>knowledgeCurrentEntry().getMarkdown().includes('戊'));assert.match(await markdown(),/乙\\\|丙/);assert.equal(await page.locator('.kn-table-widget tbody tr').count(),3);
 await page.keyboard.press('Escape');await tools();await page.locator('#kn-table-row').selectOption('0');assert.equal(await page.locator('[data-kn-table="row-delete"]').isDisabled(),true);await page.keyboard.press('Escape');
 // Last body row can be removed; the header and separator still form a table.
 await reset(empty);await tools();await page.locator('#kn-table-row').selectOption('2');await apply('row-delete');assert.equal(await page.locator('.kn-table-widget tbody tr').count(),0);await page.locator('.kn-table-widget [data-table-action="row-add"]').click();await page.waitForFunction(()=>document.querySelectorAll('.kn-table-widget tbody tr').length===1);
 await reset(empty+'\n\n| 第二表 | 列二 |\n| --- | --- |\n| 值 | 值 |');await page.locator('.kn-table-widget').first().locator('tbody td').first().click();await page.locator('.kn-table-widget').nth(1).locator('[data-table-action="row-add"]').click();await page.waitForTimeout(100);assert.equal(await page.locator('.kn-table-widget').first().locator('tbody tr').count(),1);assert.equal(await page.locator('.kn-table-widget').nth(1).locator('tbody tr').count(),2);
 await reset(empty);await page.locator('.kn-table-widget tbody td').first().click();
 await reset('| 项目 | 内容 |\n| --- | --- |\n'+Array.from({length:20},(_,i)=>`| 条目${i} | 内容${i} |`).join('\n'));
 const edgeCell=page.locator('.kn-table-widget tbody tr').nth(10).locator('td').last();await edgeCell.click();await edgeCell.evaluate(el=>el.scrollIntoView({block:'end'}));await page.keyboard.press('Tab');
 const visible=await page.locator('.kn-table-cell-editor').evaluate(field=>{const r=field.getBoundingClientRect(),body=field.closest('.knowledge-body').getBoundingClientRect();return r.top>=body.top-1&&r.bottom<=body.bottom+1;});assert.equal(visible,true,'keyboard table navigation must reveal the focused cell above the footer');
 await page.keyboard.press('Escape');await reset(empty);await page.locator('.kn-table-widget tbody td').first().click();
 const screenshots=process.env.LOOP_TEST_SCREENSHOT_DIR;
 if(screenshots){await page.screenshot({path:path.join(screenshots,'table-empty-edit.png')});}

 console.log('Note audit: independent creation, tabs, shared editing, close/reopen, files, persistence and task deletion.');
 await choose('b');const count=await page.evaluate(()=>state.tasks.length),originalB=await markdown();
 await page.locator('[data-kn-action="new-note"]').click();await page.waitForFunction(()=>knowledgeActiveDocument()?.title==='未命名'&&knowledgeCurrentEntry());await page.evaluate(()=>knowledgeRename(knowledgeActiveDocument()));await page.locator('#kn-rename-title').fill('任务方案与表格');await page.locator('#kn-rename-commit').click();await append('# 任务方案与表格\n');
 await page.waitForFunction(()=>knowledgeActiveDocument()?.title==='任务方案与表格'&&knowledgeCurrentEntry()?.getMarkdown().includes('任务方案与表格'));
 const noteId=await page.evaluate(()=>knowledgeActiveDocument().id);assert.equal(await page.evaluate(()=>state.activeTaskId),'b');assert.equal(await page.evaluate(()=>state.tasks.length),count);
 assert.equal(await page.locator('.kn-switch-note>span').innerText(),'任务方案与表格');
 assert.doesNotMatch(await page.locator('.kn-document-tabs').innerText(),/本任务创建|其他笔记/);
 await append('\n独立笔记第一次修改');await page.locator('[data-kn-document="b"]').click();assert.equal(await markdown(),originalB);
 await page.locator(`[data-kn-document="${noteId}"]`).click();assert.match(await markdown(),/第一次修改/);
 await choose('a');await page.locator('[data-kn-action="recent"]').click();await page.locator(`[data-kn-note="${noteId}"]`).click();
 assert.equal(await page.evaluate(()=>state.activeTaskId),'a');assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),noteId);
 await append('\n跨任务共享修改');const firstTab=await page.locator('.kn-document-tabs [role=tab]').first().getAttribute('data-kn-document');await page.locator('.kn-document-tabs [aria-selected=true]').focus();await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),firstTab);await page.keyboard.press('End');assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),noteId);
 await page.locator(`[data-kn-detach="${noteId}"]`).click();assert.equal(await page.evaluate(id=>state.knowledgeWorkspace.openIds.includes(id),noteId),false);assert.equal(await page.evaluate(id=>knowledgeFindDocument(id).notes.includes('跨任务共享修改'),noteId),true);
 await choose('b');await page.locator('[data-kn-action="recent"]').click();await page.locator(`[data-kn-note="${noteId}"]`).click();assert.match(await markdown(),/跨任务共享修改/);
 // Native-file picker result is the only substitution; actual read/write/gate
 // services handle this new document and survive a process-style reload.
 const file=path.join(profile,'独立外部文件.md');await fs.writeFile(file,'# 外部方案\n\n原始内容');await setChosenPath(file);
 await wb.more(page);await page.locator('.wb-more-menu [data-kn-action="open-file"]').click();await page.waitForFunction(()=>knowledgeActiveDocument()?.knowledgeNote.filePath?.endsWith('独立外部文件.md'));
 const fileId=await page.evaluate(()=>knowledgeActiveDocument().id);assert.equal(await page.evaluate(()=>state.activeTaskId),'b');assert.match(await markdown(),/原始内容/);
 await append('\n外部文件修改');assert.equal((await page.evaluate(id=>saveKnowledgeTask(id),fileId)).success,true);assert.match(await fs.readFile(file,'utf8'),/外部文件修改/);
 const documentsBefore=await page.evaluate(()=>state.knowledgeDocuments.length);await wb.more(page);await page.locator('.wb-more-menu [data-kn-action="open-file"]').click();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>state.knowledgeDocuments.length),documentsBefore);
 await page.evaluate(async()=>{captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});await flushPendingKnowledgeRecoveries({strict:true});save();await flushSave();});
 assert.equal((await readTaskData(profile)).knowledgeDocuments.find(n=>n.id===noteId).notes.includes('跨任务共享修改'),true);
 await page.reload();await page.waitForFunction(()=>state.tasks?.length>0);await choose('b');await page.locator(`[data-kn-document="${noteId}"]`).click();await page.waitForFunction(()=>knowledgeCurrentEntry()?.getMarkdown().includes('跨任务共享修改'));assert.equal(await page.evaluate(()=>state.tasks.length),count);
 await page.evaluate(async()=>{const result=await recovery26Transaction(()=>recovery26DeleteRecords(['b']));if(!result.ok)throw Error(result.message);});
 assert.equal(await page.evaluate(id=>knowledgeFindDocument(id)?.notes.includes('跨任务共享修改'),noteId),true);
 assert.equal(await page.evaluate(()=>Boolean(knowledgeFindDocument('b')?.notes)),true);
 await page.evaluate(async()=>{const entry=state.recentlyDeleted.find(e=>e.kind==='task'&&e.objectId==='b');await recovery26RestoreMany([entry.id],{restoreMoved:true});});
 assert.equal(await page.evaluate(()=>knowledgeAllDocuments().filter(note=>note.id==='b').length),1);
 await choose('b');await page.locator(`[data-kn-document="${noteId}"]`).click();
 if(screenshots)for(const theme of ['light','dark']){await page.evaluate(theme=>{state.theme=theme;render();},theme);await page.screenshot({path:path.join(screenshots,`notes-links-${theme}.png`)});}
};

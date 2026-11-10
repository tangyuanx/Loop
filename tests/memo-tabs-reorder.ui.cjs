const assert = require('node:assert/strict');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

(async () => {
  const note = id => ({ id, title: id, notes: '# '+id+'\n\n'+('保留草稿、选区与正文滚动位置。\n\n').repeat(id==='a'?120:1), knowledgeNote: { noteId: id, title: id, documentState: 'DRAFT' } });
  const run = await launchRepository({ tasks: [task('owner')], knowledgeDocuments: ['a','b','c'].map(note),
    knowledgeWorkspace: { taskId:'owner', visible:true, activeId:'a', openIds:['a','b','c'], tabsByTask:{ owner:['a','b','c'] }, lastByTask:{owner:'a'} } }, 'tab-reorder');
  const { page, app } = run;
  const tabs = () => page.locator('[data-kn-document]').evaluateAll(items => items.map(el => el.dataset.knDocument));
  const tab = id => page.locator(`[data-kn-document="${id}"]`);
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  const position=()=>page.evaluate(()=>{const e=knowledgeCurrentEntry(),r=e.view.state.selection.main;return {anchor:r.anchor,head:r.head,body:document.querySelector('.knowledge-body').scrollTop,cm:e.view.scrollDOM.scrollTop};});
  const same=async expected=>{await settle();const actual=await position();assert.deepEqual(actual,expected,'sorting retains the exact selection and document scroll');};
  try {
    await page.waitForFunction(() => knowledgeCurrentEntry()?.view);
    await page.evaluate(() => { globalThis.__tabEditor = knowledgeCurrentEntry(); __tabEditor.insertText('未保存的文字'); });
    const markdown = await page.evaluate(() => knowledgeCurrentEntry().getMarkdown());
    await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({selection:{anchor:40,head:50}});document.querySelector('.knowledge-body').scrollTop=900;});await settle();
    const before=await position();
    const start = await tab('c').boundingBox(), end = await tab('a').boundingBox();
    await page.mouse.move(start.x+20,start.y+12); await page.mouse.down();
    await page.mouse.move(end.x+5,end.y+12,{steps:8}); await page.mouse.up();
    assert.deepEqual(await tabs(),['c','a','b']);
    assert.equal(await page.evaluate(() => knowledgeCurrentEntry()===__tabEditor),true);
    assert.equal(await page.evaluate(() => knowledgeCurrentEntry().getMarkdown()),markdown);
    assert.equal(await tab('a').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('[data-kn-detach="a"][data-unsaved]').count(),1);
    await same(before);
    await tab('a').press('Alt+Shift+ArrowRight');
    assert.deepEqual(await tabs(),['c','b','a']);
    await same(before);
    const from=await tab('c').boundingBox(),to=await tab('a').boundingBox();
    await page.mouse.move(from.x+15,from.y+12);await page.mouse.down();await page.mouse.move(to.x+40,to.y+12,{steps:6});
    await page.keyboard.press('Escape');await page.mouse.up();
    assert.deepEqual(await tabs(),['c','b','a']);
    await same(before);
    // An actual drag across + must not create, close, activate or rename a note.
    let fromNew=await tab('c').boundingBox(),plus=await page.locator('.kn-document-new').boundingBox();
    await page.mouse.move(fromNew.x+15,fromNew.y+12);await page.mouse.down();await page.mouse.move(plus.x+plus.width/2,plus.y+plus.height/2,{steps:6});await page.mouse.up();
    assert.equal(await page.locator('[data-kn-document]').count(),3);
    assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),'a');
    assert.equal(await page.locator('#kn-rename-title').count(),0);
    await same(before);
    await page.evaluate(()=>knowledgeCurrentEntry().view.focus());await page.keyboard.press('ControlOrMeta+z');
    assert.notEqual(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),markdown,'dragging preserves the original Undo journal');
    await page.keyboard.press('ControlOrMeta+Shift+z');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),markdown);

    // Holding at an edge keeps scrolling without further mousemove events.
    await page.evaluate(()=>{
      const ids=Array.from({length:45},(_,i)=>'overflow-'+i);
      for(const id of ids)state.knowledgeDocuments.push({id,title:id,notes:'# '+id,knowledgeNote:knowledgeDocument.createKnowledgeNoteMetadata({taskId:id,title:id})});
      const s=state.knowledgeWorkspace;s.openIds.push(...ids);s.tabsByTask[state.activeTaskId]=s.openIds.slice();render();knowledgeRevealActiveTab();
    });await settle();
    const original=await tabs(),viewport=page.locator('.kn-document-tabs');
    const beginEdge=async side=>{
      const source=await tab('a').boundingBox(),bounds=await viewport.boundingBox();
      await page.mouse.move(source.x+source.width/2,source.y+12);await page.mouse.down();
      await page.mouse.move(side==='right'?bounds.x+bounds.width-6:bounds.x+6,source.y+12,{steps:4});
    };
    let initialScroll=await viewport.evaluate(el=>el.scrollLeft);
    await beginEdge('right');
    const firstScroll=await viewport.evaluate(el=>el.scrollLeft);
    await page.waitForFunction(left=>document.querySelector('.kn-document-tabs').scrollLeft>left+90,firstScroll);
    assert.equal(await page.locator('[data-tab-insert]').count(),1);
    await page.keyboard.press('Escape');await page.mouse.up();await settle();
    assert.deepEqual(await tabs(),original);assert.equal(await viewport.evaluate(el=>el.scrollLeft),initialScroll);
    await beginEdge('right');
    await page.waitForFunction(left=>document.querySelector('.kn-document-tabs').scrollLeft>left+140,initialScroll);
    await page.mouse.up();await settle();
    assert.notDeepEqual(await tabs(),original);
    assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),'a');
    assert.equal(await page.evaluate(()=>knowledgeCurrentEntry()===__tabEditor),true);
    assert.equal(await page.locator('[data-kn-detach="a"][data-unsaved]').count(),1);
    const committed=await tabs(),scrollBeforeBlur=await viewport.evaluate(el=>el.scrollLeft);
    await beginEdge('left');
    await page.waitForFunction(left=>document.querySelector('.kn-document-tabs').scrollLeft<left-50,scrollBeforeBlur);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();await settle();
    assert.deepEqual(await tabs(),committed);assert.equal(await viewport.evaluate(el=>el.scrollLeft),scrollBeforeBlur);
    assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),markdown);
    await page.evaluate(() => flushSave()); await page.reload();
    await page.waitForFunction(() => knowledgeCurrentEntry()?.view);
    assert.deepEqual(await tabs(),committed);
    assert.equal(await page.evaluate(() => knowledgeCurrentEntry().getMarkdown()),markdown);
    assert.deepEqual(run.errors,[]);
    console.log('PASS #84 real drag/keyboard, selection/document-scroll/Undo/draft continuity, no +/close/rename misfires, stationary-edge autoscroll, Esc/blur restore and persisted order');
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });

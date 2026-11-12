// Exercise #95 against the repository's actual Electron window and editor.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const {minimizeTaskInfo}=require('./workbench-helpers.cjs');
const out=path.resolve(process.env.LOOP_SPLIT_TABS_QA_DIR||'.local-review/knowledge-95-merge-drop-20261112/ui');
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const note=id=>({id,title:'笔记 '+id,notes:'# '+id+'\n\n'+('正文、选区、撤销和独立查找。\n\n').repeat(100)});
 const run=await launchRepository({tasks:[task('owner')],knowledgeDocuments:['a','b','c','d'].map(note),markdownMode:'source',
  knowledgeWorkspace:{taskId:'owner',visible:true,activeId:'a',openIds:['a','b','c','d'],tabsByTask:{owner:['a','b','c','d']},lastByTask:{owner:'a'}}},'split-tabs');
 const {page,app,profile}=run,checks=[];
 const check=s=>{checks.push(s);console.log('PASS '+s);};
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const tab=id=>page.locator(`[data-kn-document="${id}"]`),pane=side=>page.locator(`[data-kn-side="${side}"]`);
 const ids=side=>page.locator(side?`[data-kn-tab-side="${side}"] [data-kn-document]`:'[data-kn-document]').evaluateAll(els=>els.map(el=>el.dataset.knDocument));
 const layout=()=>page.evaluate(()=>JSON.parse(JSON.stringify(state.knowledgeWorkspace)));
 const begin=async(id,point)=>{
  await tab(id).evaluate(button=>Promise.all(button.parentElement.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
  await page.evaluate(()=>window.addEventListener('pointerdown',event=>window.__dragPointer=event.pointerId,{once:true}));
  const r=await tab(id).boundingBox();await page.mouse.move(r.x+Math.min(20,r.width/2),r.y+r.height/2);
  await page.mouse.down();await page.mouse.move(point.x,point.y,{steps:10});await settle();
 };
 const end=async()=>{await page.mouse.up();assert.equal(await page.locator('.kn-tab-drag-ghost,.kn-tab-drop-preview,[data-tab-insert],[data-tab-after],.kn-tab-dragging').count(),0);assert.equal(await page.locator('body.kn-tab-drag-active').count(),0);};
 const edge=async side=>{const r=await page.locator('.knowledge-note-surface').first().boundingBox(),last=await page.locator('.knowledge-note-surface').last().boundingBox();return{x:side==='left'?r.x+12:last.x+last.width-12,y:r.y+130};};
 const bodyPoint=async side=>{
  const split=await page.locator('.kn-split').count();
  const body=split?pane(side).locator('.knowledge-note-surface'):page.locator('.knowledge-note-surface');
  const bounds=await body.boundingBox();
  const fraction=split ? .5 : side==='left' ? .36 : .64;
  return {x:bounds.x+bounds.width*fraction,y:bounds.y+bounds.height*.52};
 };
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).focus());
  await page.waitForFunction(()=>document.hasFocus());
  await page.waitForFunction(()=>knowledgeCurrentEntry('a')?.view);
  await minimizeTaskInfo(page);
  await page.evaluate(()=>{window.__a=knowledgeCurrentEntry('a');__a.insertText('待保存的编辑 ');__a.view.dispatch({selection:{anchor:30,head:43}});document.querySelector('.knowledge-body').scrollTop=430;});await settle();
  const original=await page.evaluate(()=>({text:__a.getMarkdown(),selection:__a.view.state.selection.toJSON(),scroll:document.querySelector('.knowledge-body').scrollTop}));
  const start=await tab('b').boundingBox(),source=await tab('b').locator('..').boundingBox();
  await begin('b',{x:start.x+70,y:start.y+85});
  const ghost=page.locator('.kn-tab-drag-ghost'),first=await ghost.boundingBox();
  assert.equal(await ghost.getAttribute('aria-hidden'),'true');assert.equal(await ghost.locator('.kn-tab-drag-title').textContent(),'笔记 b');
  assert.equal(await ghost.locator('span').count(),1);
  assert.ok(Math.abs(first.width-source.width)<1&&Math.abs(first.height-source.height)<1);
  assert.ok(Math.abs(first.x-(source.x+50))<3,JSON.stringify({start,first}));
  assert.equal(await ghost.evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  await page.mouse.move(start.x+160,start.y+130,{steps:5});await settle();
  const second=await ghost.boundingBox();assert.ok(Math.abs(second.x-first.x-90)<1&&Math.abs(second.y-first.y-45)<1,JSON.stringify({first,second}));
  await page.screenshot({path:path.join(out,'tab-follows-pointer.png')});
  await page.keyboard.press('Escape');await end();assert.deepEqual(await ids(),['a','b','c','d']);
  assert.deepEqual(await page.evaluate(()=>({text:__a.getMarkdown(),selection:__a.view.state.selection.toJSON(),scroll:document.querySelector('.knowledge-body').scrollTop})),original);
  check('lifted tab keeps its shape and grab offset, follows the pointer 1:1, and clears on Escape');
  let r=await tab('a').boundingBox();await begin('d',{x:r.x+3,y:r.y+12});
  const releasedFrom=await ghost.boundingBox();
  await page.evaluate(()=>window.addEventListener('pointerup',()=>{
   const landed=document.querySelector('[data-kn-document="d"]').parentElement;
   window.__landing={x:landed.getBoundingClientRect().x,animating:landed.getAnimations().length>0};
  },{once:true}));
  await end();
  const landing=await page.evaluate(()=>__landing);
  if(!await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)){
   assert.equal(landing.animating,true);assert.ok(Math.abs(landing.x-releasedFrom.x)<2,JSON.stringify({landing,releasedFrom}));
  }
  assert.deepEqual(await ids(),['d','a','b','c']);assert.equal(await page.locator('.kn-split').count(),0);
  assert.equal(await page.evaluate(()=>knowledgeCurrentEntry('a')===__a),true);
  check('top tab bar drag only reorders and retains the live editor');
  let before=await layout();await begin('a',await bodyPoint('right'));
  const preview=page.locator('.kn-tab-drop-preview');
  assert.equal(await preview.getAttribute('data-kn-drop-side'),'right');assert.equal(await page.locator('.kn-split').count(),0);assert.deepEqual(await layout(),before);
  await page.screenshot({path:path.join(out,'single-preview.png')});
  const leftPoint=await bodyPoint('left');await page.mouse.move(leftPoint.x,leftPoint.y);
  assert.equal(await preview.getAttribute('data-kn-drop-side'),'left');assert.deepEqual(await layout(),before);
  r=await page.locator('.knowledge-note-surface').boundingBox();await page.mouse.move(r.x-24,leftPoint.y);assert.equal(await preview.count(),0);await end();
  assert.deepEqual(await layout(),before);assert.deepEqual(await ids(),['d','a','b','c']);
  for(const cancel of ['Escape','blur','pointercancel']){
   await begin('a',await bodyPoint('left'));assert.equal(await preview.getAttribute('data-kn-drop-side'),'left');
   if(cancel==='Escape')await page.keyboard.press('Escape');else if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));else await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:__dragPointer})));
   await end();assert.equal(await page.locator('.kn-tab-drop-preview').count(),0);assert.deepEqual(await layout(),before);
  }
  assert.deepEqual(await page.evaluate(()=>({text:__a.getMarkdown(),selection:__a.view.state.selection.toJSON(),scroll:document.querySelector('.knowledge-body').scrollTop})),original);
  check('the entire single note body previews each half; leaving the note, Escape and blur cancel without changing the layout or draft');
  await begin('d',await bodyPoint('right'));assert.equal(await page.locator('.kn-split').count(),0);
  const previewBounds=await page.locator('.kn-tab-drop-preview').boundingBox();
  const rightEdge=await edge('right');await page.mouse.move(rightEdge.x,rightEdge.y);
  const edgeGhost=await ghost.boundingBox(),windowWidth=await page.evaluate(()=>innerWidth);
  assert.ok(edgeGhost.x+edgeGhost.width<=windowWidth+1,'tab stays visible at the window edge');
  const rightPoint=await bodyPoint('right');await page.mouse.move(rightPoint.x,rightPoint.y);
  await end();
  await page.waitForFunction(()=>knowledgeCurrentEntry('d')?.root?.isConnected&&knowledgeCurrentEntry('a')?.root?.isConnected);
  const rightBody=await pane('right').locator('.knowledge-note-surface').boundingBox();
  assert.ok(Math.abs(rightBody.x-previewBounds.x)<1&&Math.abs(rightBody.width-previewBounds.width)<1,JSON.stringify({previewBounds,rightBody}));
  assert.deepEqual(await ids('left'),['a','b','c']);assert.deepEqual(await ids('right'),['d']);
  assert.equal(await page.locator('.kn-document-tabs [aria-selected="true"]').count(),2);
  await page.locator('.kn-split-divider').press('Shift+ArrowRight');await settle();
  await begin('b',await bodyPoint('left'));
  const leftPreview=await page.locator('.kn-tab-drop-preview').boundingBox();
  const leftBody=await pane('left').locator('.knowledge-note-surface').boundingBox();
  assert.ok(Math.abs(leftPreview.x-leftBody.x)<1&&Math.abs(leftPreview.width-leftBody.width)<1);
  await end();
  assert.deepEqual(await ids('left'),['a','b','c']);assert.equal(await tab('b').getAttribute('aria-selected'),'true');
  await page.evaluate(()=>{window.__d=knowledgeCurrentEntry('d');});
  await tab('b').click();await page.waitForFunction(()=>knowledgeCurrentEntry('b')?.root?.isConnected);
  await page.evaluate(()=>{window.__b=knowledgeCurrentEntry('b');__b.insertText('B 编辑 ');});
  r=await tab('a').boundingBox();await begin('c',{x:r.x+2,y:r.y+12});await end();
  assert.deepEqual(await ids('left'),['c','a','b']);assert.deepEqual(await ids('right'),['d']);
  assert.equal(await page.evaluate(()=>knowledgeCurrentEntry('b')===__b&&knowledgeCurrentEntry('d')===__d),true);
  await tab('a').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator(':focus').getAttribute('data-kn-document'),'b');
  check('release creates two independent tab bars; each keeps its own selected note, order and keyboard focus');
  r=await pane('right').locator('.kn-document-bar').boundingBox();await begin('c',{x:r.x+10,y:r.y+20});
  assert.equal(await page.locator('.kn-tab-drop-preview').count(),0);await end();
  await page.waitForFunction(()=>knowledgeSplitLayout().rightId==='c');
  assert.deepEqual(await ids('left'),['a','b']);assert.deepEqual(await ids('right'),['c','d']);
  assert.equal(await page.evaluate(()=>knowledgeCurrentEntry('b')===__b&&knowledgeCurrentEntry('d')===__d),true);
  assert.equal(await page.locator('[data-kn-document="c"]').count(),1);
  r=await pane('right').locator('.kn-document-new').boundingBox();await begin('b',{x:r.x+10,y:r.y+12});await end();
  await page.waitForFunction(()=>knowledgeCurrentEntry('b')?.root?.isConnected);
  assert.equal(await page.evaluate(()=>knowledgeCurrentEntry('b')===__b),true);
  await pane('right').locator('.cm-content').click();await page.keyboard.press('ControlOrMeta+z');
  assert.equal(await page.evaluate(()=>__b.getEditorText().startsWith('B 编辑 ')),false);
  await page.keyboard.press(process.platform==='darwin'?'Meta+Shift+z':'Control+y');
  assert.equal(await page.evaluate(()=>__b.getEditorText().startsWith('B 编辑 ')),true);
  await tab('b').click({button:'right'});await page.getByRole('menuitem',{name:'移动到左栏',exact:true}).click();
  await begin('d',await bodyPoint('left'));assert.equal(await preview.getAttribute('data-kn-drop-side'),'left');await end();
  assert.deepEqual(await ids('left'),['a','b','d']);assert.deepEqual(await ids('right'),['c']);
  check('cross-pane drag, including release over the note body, and tab menu preserve document identity and editor sessions');
  await page.evaluate(async()=>{captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});save();await flushSave();});
  const persisted=JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8')).knowledgeWorkspace.splitsByTask.owner;
  assert.deepEqual(persisted.leftTabs,['a','b','d']);assert.deepEqual(persisted.rightTabs,['c']);
  await page.reload();await page.waitForFunction(()=>knowledgeCurrentEntry('c')?.root?.isConnected&&knowledgeCurrentEntry('d')?.root?.isConnected);
  await minimizeTaskInfo(page);
  assert.deepEqual(await ids('left'),persisted.leftTabs);assert.deepEqual(await ids('right'),persisted.rightTabs);
  assert.ok(await page.evaluate(()=>knowledgeFindDocument('a').notes.startsWith('待保存的编辑 ')));
  assert.ok(await page.evaluate(()=>knowledgeFindDocument('b').notes.startsWith('B 编辑 ')));
  await pane('right').locator('.kn-document-new').click();await page.waitForFunction(()=>!['a','b','c','d'].includes(knowledgeActiveDocument()?.id)&&knowledgeCurrentEntry()?.view);
  const created=await page.evaluate(()=>knowledgeActiveDocument().id);assert.deepEqual(await ids('right'),['c',created]);
  await page.locator(`[data-kn-detach="${created}"]`).click();assert.equal(await page.locator('.kn-split').count(),1);assert.deepEqual(await ids('right'),['c']);
  check('group order/current notes survive disk reload; each + creates in its pane and closing picks a same-pane fallback');
  await page.evaluate(()=>{
   window.__groupsBeforeOverflow=structuredClone(state.knowledgeWorkspace);const split=knowledgeSplitLayout();
   for(const side of ['left','right'])for(let i=0;i<24;i++){const id='overflow-'+side+'-'+i;state.knowledgeDocuments.push({id,title:id,notes:'# '+id,knowledgeNote:knowledgeDocument.createKnowledgeNoteMetadata({taskId:id,title:id})});split[side+'Tabs'].push(id);}
   knowledgeCommitTabGroups(split);render();
  });await settle();
  const scrolls=()=>page.locator('.kn-document-tabs').evaluateAll(els=>els.map(el=>el.scrollLeft));
  const initialScrolls=await scrolls();await pane('left').locator('.kn-document-tabs').hover();await page.mouse.wheel(0,180);
  await page.waitForFunction(left=>document.querySelector('[data-kn-tab-side="left"] .kn-document-tabs').scrollLeft>left+50,initialScrolls[0]);
  const afterLeft=await scrolls();assert.equal(afterLeft[1],initialScrolls[1]);
  await pane('right').locator('.kn-document-tabs').hover();await page.mouse.wheel(0,160);
  await page.waitForFunction(right=>document.querySelector('[data-kn-tab-side="right"] .kn-document-tabs').scrollLeft>right+50,initialScrolls[1]);
  const afterBoth=await scrolls();assert.equal(afterBoth[0],afterLeft[0]);
  await page.evaluate(()=>render());await settle();assert.deepEqual(await scrolls(),afterBoth);
  await page.evaluate(()=>{state.knowledgeWorkspace=__groupsBeforeOverflow;render();});await settle();
  check('two overflow strips scroll and redraw independently');

  const reopenSplit=async side=>{
   await tab('c').click({button:'right'});
   await page.getByRole('menuitem',{name:`在${side==='left'?'左':'右'}侧分屏打开`,exact:true}).click();
   await pane(side).locator('[data-kn-document="c"]').waitFor();
  };
  await page.evaluate(()=>{window.__cBeforeMerge=knowledgeCurrentEntry('c');});
  await begin('c',await bodyPoint('left'));
  assert.equal(await preview.textContent(),'松手合并为单栏');assert.equal(await page.locator('.kn-split').count(),1);
  await page.screenshot({path:path.join(out,'merge-preview.png')});
  await page.keyboard.press('Escape');await end();
  assert.deepEqual(await ids('left'),['a','b','d']);assert.deepEqual(await ids('right'),['c']);
  await begin('c',await bodyPoint('left'));await end();
  assert.equal(await page.locator('.kn-split').count(),0);assert.deepEqual(await ids(),['a','b','d','c']);
  assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),'c');
  assert.equal(await page.evaluate(()=>knowledgeCurrentEntry('c')===__cBeforeMerge),true);

  await reopenSplit('left');
  r=await pane('right').locator('.kn-document-new').boundingBox();
  await begin('c',{x:r.x+r.width/2,y:r.y+r.height/2});
  assert.equal(await preview.textContent(),'松手合并为单栏');assert.equal(await page.locator('[data-tab-after]').count(),1);
  await end();
  assert.equal(await page.locator('.kn-split').count(),0);assert.deepEqual(await ids(),['a','b','d','c']);
  assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),'c');
  assert.equal(await page.evaluate(()=>knowledgeCurrentEntry('c')===__cBeforeMerge),true);
  check('moving a lone tab to the other pane body or tab bar previews a merge and keeps the moved editor active');
  await reopenSplit('right');
  for(const theme of ['light','dark']){
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).setSize(1024,680));
   await page.evaluate(theme=>{state.theme=theme;state.fontScale='largest';render();},theme);await settle();
   for(const side of ['left','right']){const bar=await pane(side).locator('.kn-document-bar').boundingBox(),plus=await pane(side).locator('.kn-document-new').boundingBox();assert.ok(plus.x>=bar.x&&plus.x+plus.width<=bar.x+bar.width+1);}
   await begin('c',await bodyPoint('left'));assert.equal(await preview.getAttribute('data-kn-drop-side'),'left');
   await page.screenshot({path:path.join(out,`split-preview-${theme}-1024-largest.png`)});await page.keyboard.press('Escape');await end();
  }
  await page.locator('[data-kn-detach="c"]').click();await page.waitForFunction(()=>!document.querySelector('.kn-split'));
  assert.deepEqual(await ids(),['a','b','d']);assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),'a');
  assert.equal(await page.evaluate(()=>knowledgeFindDocument('c')!==undefined),true);
  check('minimum-window light/dark preview stays in the body; closing the last tab merges the empty pane without deleting the note');
  assert.deepEqual(run.errors,[]);await fs.writeFile(path.join(out,'result.json'),JSON.stringify({status:'passed',checks},null,2));
 }catch(error){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({status:'failed',checks,error:error.stack},null,2));throw error;}finally{await run.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

// Real production CodeMirror sessions, BrowserWindow and disk persistence.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {launchRepository,task}=require('./electron-ui-helpers.cjs'),wb=require('./workbench-helpers.cjs');
const out=path.resolve(process.env.LOOP_SPLIT_QA_DIR||'.local-review/memo-20261112/stage4/ui');
const report={checks:[],errors:[],limitations:['native Windows','physical cross-monitor/DPI and human IME']};
(async()=>{await fs.mkdir(out,{recursive:true});const text=side=>'# '+side+'笔记\n\n'+Array.from({length:90},(_,i)=>`${side} 第${i+1}行，共同查找词，保留正文与撤销。`).join('\n\n');
 const owner=task('owner',{title:'左右笔记验收',notes:text('左')});
 const run=await launchRepository({tasks:[owner],knowledgeDocuments:[{id:'right',title:'右侧参考',notes:text('右')},{id:'third',title:'第三篇笔记',notes:'第三篇正文'}],markdownMode:'source',knowledgeWorkspace:{taskId:'owner',activeId:'owner',openIds:['owner','right','third'],tabsByTask:{owner:['owner','right','third']},lastByTask:{owner:'owner'}}},'knowledge-split');
 const {page,app,profile}=run,mod=process.platform==='darwin'?'Meta':'Control',check=s=>{report.checks.push(s);console.log('PASS '+s);};
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const pane=side=>page.locator(`[data-kn-side="${side}"]`),entry=(id,fn)=>page.evaluate(({id,fn})=>Function('entry','return ('+fn+')(entry)')(knowledgeCurrentEntry(id)),{id,fn:String(fn)});
 try{
 await page.locator('[data-pane="notes"]').click();await wb.minimizeTaskInfo(page);await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);await wb.mode(page,'source');
 await page.locator('[data-kn-document="right"]').click({button:'right'});await page.getByRole('menuitem',{name:'在右侧分屏打开',exact:true}).click();
 await page.locator('[data-kn-side="right"] .cm-content').waitFor();await page.waitForFunction(()=>knowledgeCurrentEntry('owner')?.view&&knowledgeCurrentEntry('right')?.view);
 assert.equal(await page.locator('.knowledge-pane').count(),2);
 await page.evaluate(()=>{window.__splitLeft=knowledgeCurrentEntry('owner');window.__splitRight=knowledgeCurrentEntry('right');});
 assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),'right');
 await pane('left').locator('.cm-content').click();await page.keyboard.press(mod+'+Home');await page.keyboard.insertText('LEFT-EDIT ');
 await pane('right').locator('.cm-content').click();await page.keyboard.press(mod+'+Home');await page.keyboard.insertText('RIGHT-EDIT ');
 assert.ok((await entry('owner',e=>e.getEditorText())).startsWith('LEFT-EDIT '));assert.ok((await entry('right',e=>e.getEditorText())).startsWith('RIGHT-EDIT '));
 await page.keyboard.press(mod+'+z');assert.ok(!(await entry('right',e=>e.getEditorText())).startsWith('RIGHT-EDIT '));assert.ok((await entry('owner',e=>e.getEditorText())).startsWith('LEFT-EDIT '));
 await pane('left').locator('[data-kn-action="find"]').click();await pane('left').locator('[name="search"]').fill('共同查找词');
 await pane('right').locator('[data-kn-action="find"]').click();await pane('right').locator('[name="search"]').fill('右 第');
 assert.equal(await pane('left').locator('[name="search"]').inputValue(),'共同查找词');assert.equal(await pane('right').locator('[name="search"]').inputValue(),'右 第');
 check('two real editors keep independent edits, Undo and find queries');
 await pane('left').locator('.kn-find [name="close"]').click();await pane('right').locator('.kn-find [name="close"]').click();
 await pane('left').locator('.knowledge-body').evaluate(el=>{el.scrollTop=480;});await pane('right').locator('.knowledge-body').evaluate(el=>{el.scrollTop=820;});await settle();
 const positions=await page.locator('.knowledge-body').evaluateAll(els=>els.map(el=>el.scrollTop));assert.ok(positions[0]>300&&positions[1]>600,JSON.stringify(positions));
 await page.evaluate(()=>render());await settle();assert.equal(await page.evaluate(()=>__splitLeft===knowledgeCurrentEntry('owner')&&__splitRight===knowledgeCurrentEntry('right')),true);
 assert.deepEqual(await page.locator('.knowledge-body').evaluateAll(els=>els.map(el=>el.scrollTop)),positions);
 const divider=page.locator('.kn-split-divider'),box=await divider.boundingBox();await page.mouse.move(box.x+3,box.y+30);await page.mouse.down();await page.mouse.move(box.x+73,box.y+30,{steps:8});await page.mouse.up();
 const ratio=await page.evaluate(()=>knowledgeSplitLayout().ratio);assert.ok(ratio>.52);
 await divider.focus();await page.keyboard.press('ArrowLeft');assert.ok(await page.evaluate(()=>knowledgeSplitLayout().ratio)<ratio);
 const keepRatio=await page.evaluate(()=>knowledgeSplitLayout().ratio);
 await pane('right').locator('[data-wb-action="focus"]').click();await settle();assert.equal(await pane('left').isVisible(),false);assert.equal(await pane('right').isVisible(),true);
 await page.keyboard.press('Escape');await settle();assert.equal(await pane('left').isVisible(),true);assert.equal(await page.evaluate(()=>knowledgeSplitLayout().ratio),keepRatio);
 assert.equal(await page.evaluate(()=>__splitLeft===knowledgeCurrentEntry('owner')&&__splitRight===knowledgeCurrentEntry('right')),true);
 check('scroll positions survive redraw; divider supports pointer/keyboard; focus restores both editors and width');
 const originalSidebars=await page.evaluate(()=>[state.navCollapsed,state.taskListCollapsed]);
 await pane('right').locator('[data-wb-action="focus"]').click();
 for(const enabled of [true,false]){
   const actual=await app.evaluate(async({BrowserWindow},enabled)=>{
     const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));
     // A transition notification can arrive before the native query reflects
     // its final state. Assert the actual window state, after it settles.
     w.setFullScreen(enabled);const deadline=Date.now()+7000;
     while(w.isFullScreen()!==enabled&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
     return {fullScreen:w.isFullScreen(),bounds:w.getBounds(),visible:w.isVisible()};
   },enabled);assert.equal(actual.fullScreen,enabled,JSON.stringify(actual));await settle();
   assert.equal(await page.evaluate(()=>Workbench.focus),true);assert.equal(await pane('left').isVisible(),false);
 }
 await pane('right').locator('[data-wb-action="focus"]').click();await settle();
 assert.deepEqual(await page.evaluate(()=>[state.navCollapsed,state.taskListCollapsed]),originalSidebars);
 assert.equal(await page.evaluate(()=>knowledgeSplitLayout().ratio),keepRatio);
 check('native fullscreen entry/exit preserves focused side, split ratio and sidebar preferences');
 for(const theme of ['light','dark'])for(const [width,height,scale]of [[1280,850,'normal'],[1024,680,'largest']]){
   await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).setSize(...size),[width,height]);
   await page.evaluate(({theme,scale})=>{state.theme=theme;state.fontScale=scale;render();},{theme,scale});await settle();
   for(const side of ['left','right']){
     await pane(side).locator('[data-kn-action="find"]').click();await pane(side).locator('[name="search"]').fill('共同');
     const paints=await pane(side).locator('[name="search"]').evaluate(el=>[el,el.parentElement].map(el=>{const s=getComputedStyle(el);return [s.borderWidth==='0px'?'':s.borderColor,s.outlineStyle==='none'?'':s.outlineColor,s.boxShadow];}));
     for(const v of paints.flat())for(const m of v.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g))assert.ok(!(+m[2]>+m[1]+12&&+m[2]>+m[3]+8),v);
     const bounds=await pane(side).boundingBox(),find=await pane(side).locator('.kn-find').boundingBox();
     assert.ok(find.x>=bounds.x-1&&find.x+find.width<=bounds.x+bounds.width+1,JSON.stringify({side,bounds,find}));
   }
   await page.screenshot({path:path.join(out,`split-${theme}-${width}-${scale}.png`)});
   await pane('left').locator('.kn-find [name="close"]').click();await pane('right').locator('.kn-find [name="close"]').click();
 }
 await pane('right').locator('[data-wb-action="more"]').click();await page.locator('[data-wb-mode="preview"]').click();await page.waitForFunction(()=>knowledgeCurrentEntry('right').mode==='preview');assert.equal(await entry('owner',e=>e.mode),'source');
 await page.locator('.kn-document-new').click();
 await page.waitForFunction(()=>!['owner','right','third'].includes(knowledgeActiveDocument()?.id)&&knowledgeCurrentEntry()?.view&&knowledgeCurrentEntry().mode==='edit');
 await page.evaluate(()=>knowledgeCurrentEntry().insertText('右栏新草稿'));
 assert.equal(await entry('owner',e=>e.mode),'source');assert.ok((await entry('owner',e=>e.getEditorText())).startsWith('LEFT-EDIT '));
 await page.locator('[data-kn-document="right"]').click();await page.waitForFunction(()=>knowledgeCurrentEntry('right')?.root?.isConnected);
 check('new note in a reading pane opens editable without changing the other pane');
 await pane('right').locator('[data-wb-action="more"]').click();await page.getByRole('menuitem',{name:'合并为单栏',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.kn-split'));
 assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),'right');assert.equal(await page.evaluate(()=>__splitRight===knowledgeCurrentEntry('right')),true);
 await page.locator('[data-kn-document="owner"]').click();await page.waitForFunction(()=>knowledgeCurrentEntry('owner')?.root?.isConnected);assert.equal(await page.evaluate(()=>__splitLeft===knowledgeCurrentEntry('owner')),true);
 await page.locator('[data-kn-document="right"]').click({button:'right'});await page.getByRole('menuitem',{name:'在右侧分屏打开',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.knowledge-pane').length===2);
 await page.evaluate(async()=>{captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});save();await flushSave();});
 const disk=JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8'));assert.ok(disk.knowledgeWorkspace.splitsByTask.owner);assert.ok(disk.tasks[0].notes.startsWith('LEFT-EDIT '));
 await page.reload();await page.waitForFunction(()=>knowledgeSplitLayout()&&knowledgeCurrentEntry('owner')?.view&&knowledgeCurrentEntry('right')?.view);assert.equal(await page.locator('.knowledge-pane').count(),2);
 await page.locator('[data-kn-detach="right"]').click();await page.waitForFunction(()=>!document.querySelector('.kn-split'));assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),'owner');
 check('independent view modes, merge, cached editor reuse, disk/reload and closing either side retain documents');
 assert.deepEqual(run.errors,[]);report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));await run.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

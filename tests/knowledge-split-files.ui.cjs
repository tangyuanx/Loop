const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {launchRepository,task}=require('./electron-ui-helpers.cjs'),{readKnowledgeDocument}=require('../app/main/knowledge-file.cjs'),wb=require('./workbench-helpers.cjs');
const out=path.resolve(process.env.LOOP_SPLIT_FILES_QA_DIR||'.local-review/memo-20261112/stage4/files');
(async()=>{await fs.mkdir(out,{recursive:true});const dir=await fs.mkdtemp(path.join(os.tmpdir(),'loop-split-files-')),leftPath=path.join(dir,'left.md'),rightPath=path.join(dir,'right.md');
 await fs.writeFile(leftPath,'# 左文件\n\n独立文件保存。\n');await fs.writeFile(rightPath,'# 右文件\n\n独立文件保存。\n');
 const leftRead=await readKnowledgeDocument(leftPath),rightRead=await readKnowledgeDocument(rightPath);
 const owner=task('owner',{title:'左文件',notes:leftRead.content,knowledgeNote:{noteId:'owner',title:'左文件',...leftRead,documentState:'SAVED'}});
 const run=await launchRepository({tasks:[owner],knowledgeDocuments:[{id:'right',title:'右文件',notes:rightRead.content,knowledgeNote:{noteId:'right',title:'右文件',...rightRead,documentState:'SAVED'}}],knowledgeWorkspace:{taskId:'owner',activeId:'owner',tabsByTask:{owner:['owner','right']},lastByTask:{owner:'owner'}}},'split-files');
 const {app,page}=run,report={checks:[]},check=s=>{report.checks.push(s);console.log('PASS '+s);};
 const pane=id=>page.locator(`.knowledge-pane[data-task-id="${id}"]`);
 try{
 await page.locator('[data-pane="notes"]').click();await wb.minimizeTaskInfo(page);await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);await wb.mode(page,'source');
 await page.locator('[data-kn-document="right"]').click({button:'right'});await page.getByRole('menuitem',{name:'在右侧分屏打开',exact:true}).click();await page.waitForFunction(()=>knowledgeCurrentEntry('right')?.view);
 await page.evaluate(()=>{window.__leftFileEditor=knowledgeCurrentEntry('owner');window.__rightFileEditor=knowledgeCurrentEntry('right');for(const [id,text]of [['owner','LEFT-DISK '],['right','RIGHT-DISK ']]){const e=knowledgeCurrentEntry(id);e.view.dispatch({selection:{anchor:0}});e.insertText(text);}});
 const saved=await page.evaluate(async()=>({left:await saveKnowledgeTask('owner'),right:await saveKnowledgeTask('right')}));assert.equal(saved.left.success,true);assert.equal(saved.right.success,true);
 assert.ok((await fs.readFile(leftPath,'utf8')).startsWith('LEFT-DISK '));assert.ok((await fs.readFile(rightPath,'utf8')).startsWith('RIGHT-DISK '));
 await fs.rename(rightPath,rightPath+'.unavailable');
 await page.evaluate(()=>{const e=knowledgeCurrentEntry('right');e.view.dispatch({selection:{anchor:0}});e.insertText('RETRY-DRAFT ');});
 const failed=await page.evaluate(()=>saveKnowledgeTask('right'));assert.equal(failed.success,false);
 await pane('right').locator('.knowledge-notice').first().waitFor();assert.equal(await pane('owner').locator('.knowledge-notice').count(),0);
 assert.ok(await page.evaluate(()=>knowledgeCurrentEntry('right').getEditorText().startsWith('RETRY-DRAFT ')));
 await page.evaluate(()=>{const e=knowledgeCurrentEntry('owner');e.view.dispatch({selection:{anchor:0}});e.insertText('LEFT-CONTINUES ');});assert.equal((await page.evaluate(()=>saveKnowledgeTask('owner'))).success,true);
 await fs.rename(rightPath+'.unavailable',rightPath);
 const retry=await page.evaluate(()=>saveKnowledgeTask('right'));assert.equal(retry.success,true,JSON.stringify(retry));assert.ok((await fs.readFile(rightPath,'utf8')).startsWith('RETRY-DRAFT '));
 check('both files save separately; missing right file keeps its draft and error while left continues, then retry succeeds');
 await pane('owner').locator('.cm-content').click();
 await fs.writeFile(rightPath,'# 外部更新右文件\n\n应只提示右侧。\n');
 // The existing file contract automatically reloads a clean note; conflicts
 // require a dirty local draft. Keep that behavior when both notes are visible.
 await page.waitForFunction(()=>knowledgeCurrentEntry('right')?.getEditorText().includes('外部更新右文件'));
 assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),'owner');assert.equal(await pane('owner').locator('.knowledge-notice').count(),0);
 assert.equal(await page.evaluate(()=>knowledgeFindDocument('right').knowledgeNote.documentState),'SAVED');
 assert.equal(await page.evaluate(()=>__leftFileEditor===knowledgeCurrentEntry('owner')),true);
 check('external right-file change and reload remain in the right pane and preserve the left editor');
 await page.locator('[data-kn-document="right"]').focus();await page.keyboard.press('F2');await page.locator('#kn-rename-title').fill('右侧文件改名');await page.locator('#kn-rename-commit').click();await page.waitForFunction(()=>!document.querySelector('#kn-rename-title'));
 const renamed=await page.evaluate(()=>knowledgeFindDocument('right').knowledgeNote.filePath);assert.equal(path.basename(renamed),'右侧文件改名.md');assert.equal(await fs.readFile(renamed,'utf8'),'# 外部更新右文件\n\n应只提示右侧。\n');assert.equal(await page.evaluate(()=>knowledgeFindDocument('owner').knowledgeNote.filePath),leftPath);
 await page.locator('[data-kn-detach="owner"]').click();await page.waitForFunction(()=>!document.querySelector('.kn-split'));assert.equal(await page.evaluate(()=>knowledgeActiveDocument().id),'right');assert.ok((await fs.readFile(leftPath,'utf8')).includes('LEFT-CONTINUES '));
 check('right rename changes its actual file only; closing left merges without deleting either file');
 assert.deepEqual(run.errors,[]);report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));await run.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const wb=require('./workbench-helpers.cjs');
async function main(){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'loop-add-menu-')),file=path.join(folder,'打开笔记.md'),text='# 打开文件\r\n\r\nfoo_bar file.name\r\n';await fs.writeFile(file,text);
 const run=await launchRepository({activeTaskId:'owner',taskPane:'notes',tasks:[task('owner',{notes:'# 原笔记\n\n原文'})]},'add-note-menu');
 try{
  const {app,page}=run;await page.locator('[data-pane=notes]').click();await wb.minimizeTaskInfo(page);await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);
  const plus=()=>page.locator('.kn-document-new'),menu=page.getByRole('menu',{name:'添加知识笔记'});
  const original=await page.evaluate(()=>({count:knowledgeAllDocuments().length,text:knowledgeCurrentEntry().getMarkdown(),id:knowledgeActiveDocument().id}));
  await plus().click();await menu.waitFor();assert.equal(await menu.getByRole('menuitem').count(),2);
  await page.keyboard.press('Escape');assert.equal(await plus().getAttribute('aria-expanded'),'false');assert.equal(await plus().evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(await page.evaluate(()=>({count:knowledgeAllDocuments().length,text:knowledgeCurrentEntry().getMarkdown(),id:knowledgeActiveDocument().id})),original);
  await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
  await plus().click();await menu.getByRole('menuitem',{name:'打开笔记…'}).click();assert.equal(await page.evaluate(()=>knowledgeAllDocuments().length),original.count);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
  await plus().click();await menu.getByRole('menuitem',{name:'打开笔记…'}).click();await page.waitForFunction(()=>knowledgeActiveDocument()?.title==='打开笔记');
  assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),text);assert.equal(await fs.readFile(file,'utf8'),text);
  const opened=await page.evaluate(()=>knowledgeActiveDocument().id),count=await page.evaluate(()=>knowledgeAllDocuments().length);
  await plus().click();await menu.getByRole('menuitem',{name:'打开笔记…'}).click();await page.waitForFunction(id=>knowledgeActiveDocument()?.id===id,opened);assert.equal(await page.evaluate(()=>knowledgeAllDocuments().length),count);
  await plus().focus();await page.keyboard.press('Enter');await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await page.waitForFunction(ids=>!ids.includes(knowledgeActiveDocument()?.id)&&knowledgeCurrentEntry()?.view,[original.id,opened]);
  assert.equal(await page.evaluate(()=>knowledgeAllDocuments().length),count+1);
  const created=await page.evaluate(()=>knowledgeActiveDocument().id);assert.equal(await page.evaluate(id=>state.tasks.find(t=>t.id==='owner').knowledgeNoteIds.includes(id),created),true);
  // Empty workspace still provides both actions through the same +.
  await page.evaluate(()=>{const s=state.knowledgeWorkspace;s.openIds=[];s.activeId='';s.tabsByTask.owner=[];s.lastByTask.owner='';render();});
  await plus().click();await menu.getByRole('menuitem',{name:'新建笔记'}).click();await page.waitForFunction(id=>knowledgeActiveDocument()?.id&&knowledgeActiveDocument().id!==id,created);
  assert.deepEqual(run.errors,[]);console.log('Add-note menu passed: new/open, cancel, duplicate, keyboard, membership, empty workspace and source bytes.');
 }finally{await run.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');

(async()=>{
  const h=await launchRepository({activeTaskId:'memo',taskPane:'notes',tasks:[
    task('memo',{title:'工作记录',notes:'# 工作记录\n\n## 进展\n\n> [!NOTE]- 提示\n>\n> 始终可见的提示内容\n\n| 项目 | 内容 |\n| --- | --- |\n| 样例 | 内容 |'}),
    task('reference',{title:'关联笔记',notes:'[[note:memo]]'}),
  ]},'memo-improvements');
  const {app,page:p}=h;
  try{
    await p.locator('[data-pane="notes"]').click();await p.waitForFunction(()=>knowledgeCurrentEntry()?.view);
    assert.equal(await p.locator('.kn-fold-toggle,.cm-foldGutter').count(),0);
    assert.equal(await p.locator('.kn-callout.is-collapsed,.kn-callout-title[aria-expanded]').count(),0);assert.ok((await p.locator('.kn-callout').innerText()).includes('始终可见的提示内容'));
    await p.evaluate(()=>{knowledgePanels.add(knowledgeActiveDocument().id);knowledgeRefreshPanels(knowledgeActiveDocument());});
    assert.ok(await p.locator('.kn-outline-link').count());assert.equal(await p.locator('.kn-backlink').count(),0);
    await p.evaluate(()=>{const id=knowledgeActiveDocument().id;knowledgePanels.delete(id);knowledgeBacklinkPanels.add(id);knowledgeRefreshPanels(knowledgeActiveDocument());});
    assert.equal(await p.locator('.kn-outline-link').count(),0);assert.equal(await p.locator('.kn-backlink').count(),1);
    await p.locator('[aria-label="关闭反向链接"]').click();
    const directory=path.join(h.profile,'notes'),secondDirectory=path.join(h.profile,'other-notes');await fs.mkdir(directory);await fs.mkdir(secondDirectory);
    await app.evaluate(({dialog},{directory,secondDirectory})=>{globalThis.__memoSaveDialogs=[];dialog.showSaveDialog=async(_parent,options)=>{const opts=options||_parent;globalThis.__memoSaveDialogs.push(opts);return {canceled:false,filePath:(globalThis.__memoSaveDialogs.length===1?directory:secondDirectory)+'/note-'+globalThis.__memoSaveDialogs.length+'.md'};};},{directory,secondDirectory});
    assert.equal((await p.evaluate(()=>saveKnowledgeTask(knowledgeActiveDocument().id))).success,true);
    assert.equal(await p.locator('.kn-document-close[data-unsaved]').count(),0);
    await p.locator('.kn-document-new').click();await p.waitForFunction(()=>knowledgeCurrentEntry()?.view&&knowledgeActiveDocument().id!=='memo');
    assert.equal(await p.locator('.kn-document-tabs [role="tab"]').count(),2);
    assert.equal(await p.locator('.kn-document-close[data-unsaved]').count(),1);
    await p.evaluate(()=>knowledgeCurrentEntry().insertText('新笔记内容'));
    assert.equal((await p.evaluate(()=>saveKnowledgeTask(knowledgeActiveDocument().id))).success,true);
    const options=await app.evaluate(()=>globalThis.__memoSaveDialogs);
    assert.equal(path.dirname(options[1].defaultPath),directory);
    assert.equal(await p.locator('.kn-document-close[data-unsaved]').count(),0);
    assert.equal(await p.locator('[data-kn-receipt]').isVisible(),false);
    assert.equal(await p.locator('.knowledge-footer').evaluate(el=>getComputedStyle(el).position),'absolute');
    await p.evaluate(()=>{knowledgeDetach(knowledgeActiveDocument().id);delete state.knowledgeWorkspace.saveDirectoriesByTask.memo;});
    assert.equal(await p.evaluate(()=>knowledgeSaveDirectory(knowledgeActiveDocument())),secondDirectory,'closed notes created by this task still supply the latest saved directory for old profiles');
    await p.evaluate(()=>flushSave());await p.reload();await p.waitForFunction(()=>knowledgeCurrentEntry()?.view);
    assert.equal(await p.evaluate(()=>knowledgeSaveDirectory(knowledgeActiveDocument())),secondDirectory);
    assert.deepEqual(h.errors,[]);
    console.log('memo stage 1: real Electron tabs, independent panels, successful-save directory, reload, floating footer passed');
  }finally{await h.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

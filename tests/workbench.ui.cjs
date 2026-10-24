/* Exercise the real production workbench and editor, with synthetic disk data. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {_electron}=require('playwright-core'),wb=require('./workbench-helpers.cjs');
const {writeTaskData}=require('../app/main/storage.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const run=process.env.LOOP_WORKBENCH_QA_DIR||await fs.mkdtemp(path.join(os.tmpdir(),'loop-workbench-'));
 const profile=path.join(run,'user-data'),out=path.join(run,'evidence');await fs.mkdir(out,{recursive:true});
 await fs.access(path.join(profile,'task-data.json')).then(()=>{throw Error('Refusing existing test profile')},()=>{});
 const stamp=new Date().toISOString(),content='# 工作台验收\n\n这段文字用于格式与查找。\n\n## 验证步骤\n\n- 保留全部功能\n- 检查菜单\n';
 await writeTaskData(profile,{version:2,activeTaskId:'workbench',taskFilter:'all',tasks:[{id:'workbench',title:'工作台呈现验收',notes:content,nodes:[],deadlineAt:'2026-10-25T10:00:00.000Z',createdAt:stamp,updatedAt:stamp,knowledgeNote:{noteId:'workbench-note',title:'任务笔记',documentState:'DRAFT'}}]});
 const env={...process.env,LOOP_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:require('electron'),args:[root],cwd:root,env});let page;const errors=[];
 try{
  for(let i=0;i<150;i++){page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));if(page)break;await new Promise(r=>setTimeout(r,80));}
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.navigation');
  await page.evaluate(()=>knowledgeOpen(state.tasks.find(t=>t.id==='workbench')));await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);
  assert.equal(await page.locator('.knowledge-header .tabs-bar').count(),1);assert.equal(await page.locator('.knowledge-insert-toolbar').count(),0);assert.equal(await page.locator('.workspace-foot').count(),0);assert.equal(await page.locator('.kn-find').isVisible(),false);
  await page.locator('[data-wb-action=details]').click();assert.equal(await page.locator('.wb-task-details [data-action=toggle-task-priority-menu]').count(),1);await page.locator('.brief21-input[aria-label="背景"]').fill('真实详情输入');await page.locator('[data-wb-action=details]').click();assert.equal(await page.evaluate(()=>state.tasks[0].description),'真实详情输入');assert.equal(await page.locator('.wb-task-context [data-action=toggle-deadline-picker]').count(),1);
  async function selection(text){await page.evaluate(text=>{const e=knowledgeCurrentEntry(),at=e.getEditorText().indexOf(text);e.view.dispatch({selection:{anchor:at,head:at+text.length}});e.view.focus();},text);}
  await selection('这段文字');
  const line=page.locator('.cm-line').filter({hasText:'这段文字'});await line.scrollIntoViewIfNeeded();const position=await line.boundingBox();
  await page.mouse.click(position.x+10,position.y+8,{button:'right'});await page.locator('.wb-context-menu').waitFor();
  const geometry=await page.locator('.wb-context-menu').boundingBox();assert.ok(geometry.width<=230&&geometry.height>geometry.width);
  await page.locator('[data-wb-sub=text]').hover();await page.getByRole('menu',{name:'文本格式',exact:true}).waitFor();await page.screenshot({path:path.join(out,'context-menu.png')});
  await page.locator('.wb-submenu [data-wb-format=bold]').click();assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/\*\*这段文字\*\*/);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().view.hasFocus),true);await page.keyboard.press('ControlOrMeta+z');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),content);
  assert.equal(await page.locator('.cm-content').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  await selection('这段文字');await wb.context(page);await page.locator('[data-wb-sub=insert]').click();await page.locator('[data-wb-action=link]').click();await page.locator('#wb-link').fill('https://example.com');await page.locator('#wb-link-insert').click();assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/\[这段文字\]\(https:\/\/example.com\)/);await page.keyboard.press('ControlOrMeta+z');
  // Synthetic inputs only. Never inspect or alter the operating-system clipboard.
  await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'readText',{configurable:true,value:async()=> '菜单粘贴文本'}));
  await wb.context(page);await page.locator('[data-wb-action=paste-text]').click();await page.waitForFunction(()=>knowledgeCurrentEntry().getMarkdown().includes('菜单粘贴文本'));await page.keyboard.press('ControlOrMeta+z');
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('clipboard:read-image-data-url');ipcMain.handle('clipboard:read-image-data-url',()=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=');});
  await wb.context(page);await page.locator('[data-wb-action=paste]').click();await page.waitForFunction(()=>knowledgeCurrentEntry().getMarkdown().includes('task-image:'));await page.locator('.kn-image-widget img').waitFor();
  await wb.more(page);for(const action of ['relocate-knowledge','save-knowledge-as','knowledge-file-info','close-knowledge-editor','export-knowledge-note','share-task'])assert.equal(await page.locator(`.wb-more-menu [data-action="${action}"]`).count(),1);assert.equal(await page.locator('.wb-more-menu [data-kn-action=rename]').count(),1);await page.keyboard.press('Escape');
  await page.locator('[data-wb-action=focus]').click();assert.equal(await page.locator('.task-list-pane').isVisible(),false);assert.equal(await page.locator('.navigation').isVisible(),false);await page.keyboard.press('Escape');assert.equal(await page.locator('.task-list-pane').isVisible(),true);
  await page.evaluate(()=>{localSaveOutcome='failed';updateLocalSaveReceipt();});assert.equal(await page.locator('.wb-global-status').isVisible(),true);assert.equal(await page.locator('[data-kn-receipt]').isVisible(),false);await page.evaluate(()=>{localSaveOutcome='saved';updateLocalSaveReceipt();});
  for(const theme of ['light','dark'])for(const size of [[1024,680],[1440,900]]){
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(...size),size);await page.evaluate(theme=>{state.theme=theme;render();},theme);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,`${theme}-${size[0]}.png`)});
    await wb.context(page);await page.locator('[data-wb-sub=paragraph]').hover();const boxes=await page.locator('.wb-menu').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}}));assert.ok(boxes.every(r=>r.left>=0&&r.top>=0&&r.right<=r.width&&r.bottom<=r.height));await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'result.json'),JSON.stringify({base:'ed1d1ee',root,profile,passed:true,syntheticPasteInputs:true,errors},null,2));console.log('PASS: shared navigation, task details, deadline, no focus frame, right-click selection, submenus, undo, link input, synthetic text/image paste, file feature coverage, focus, failure receipt and desktop themes.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

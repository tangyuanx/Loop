/* Real Electron renderer, IPC, recovery and disk. Only the native picker
   answers are supplied by the test; native dialogs are also reviewed manually. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright-core');
const {writeTaskData,readTaskData}=require('../app/main/storage.cjs');
const source=path.resolve(__dirname,'..'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'loop-note-files-')),errors=[];
 const out=process.env.LOOP_TEST_SCREENSHOT_DIR||path.join(profile,'evidence');await fs.mkdir(out,{recursive:true});
 const env={...process.env,LOOP_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const stamp=new Date().toISOString();let app,page;
 await writeTaskData(profile,{version:2,taskFilter:'all',tasks:[{id:'a',title:'任务 A',notes:'# 原有笔记\n\n保留旧内容'},{id:'b',title:'任务 B',notes:''},{id:'c',title:'任务 C',notes:''}].map(t=>({...t,nodes:[],createdAt:stamp,updatedAt:stamp}))});
 const start=async()=>{
  app=await _electron.launch({executablePath:require('electron'),args:[source],cwd:source,env});
  for(let i=0;i<150;i++){page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));if(page)break;await pause(100);}
  assert.ok(page);page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>typeof knowledgeOpen==='function'&&state.tasks.some(task=>task.id==='c'));
  const runtime=await app.evaluate(async({app})=>{await app.whenReady();return {appPath:app.getAppPath(),userData:app.getPath('userData'),pid:process.pid}});
  assert.equal(runtime.userData,profile);assert.equal(runtime.appPath,source);await fs.writeFile(path.join(out,'runtime.json'),JSON.stringify(runtime,null,2));
  await app.evaluate(({dialog})=>{global.__noteSavePath='';global.__noteOpenPath='';global.__noteSaves=0;global.__noteOpens=0;
   dialog.showSaveDialog=async()=>{global.__noteSaves++;return global.__noteSavePath?{canceled:false,filePath:global.__noteSavePath}:{canceled:true}};
   dialog.showOpenDialog=async()=>{global.__noteOpens++;return global.__noteOpenPath?{canceled:false,filePaths:[global.__noteOpenPath]}:{canceled:true}};
  });
 };
 const current=()=>page.evaluate(()=>knowledgeActiveDocument()?.id||'');
 const select=async id=>{await page.evaluate(id=>knowledgeOpen(state.tasks.find(t=>t.id===id)),id);await page.waitForFunction(()=>!knowledgeActiveDocument()||knowledgeCurrentEntry()?.view);};
 const ready=async id=>page.waitForFunction(id=>knowledgeCurrentEntry()?.view&&knowledgeActiveDocument()?.id===id,id);
 const edit=async text=>{await page.locator('.cm-content[contenteditable=true]').click();await page.keyboard.type(text);};
 const flush=()=>page.evaluate(async()=>{captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});await flushPendingKnowledgeRecoveries({strict:true});save();await flushSave();});
 const recent=async id=>{await page.locator('.knowledge-header [data-kn-action=recent]').click();await page.locator(`[data-kn-note="${id}"]`).click();await ready(id);};
 try{
  await start();await select('a');await ready('a');assert.equal(await page.locator('.kn-document-tabs').count(),0);
  await select('b');const firstB=await current();assert.notEqual(firstB,'a');await ready(firstB);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),'');assert.equal(await page.evaluate(()=>state.tasks[1].notes),'');
  assert.equal(await page.locator('.kn-document-tabs').count(),0);assert.deepEqual(await page.evaluate(()=>state.knowledgeWorkspace.openIds),[firstB]);
  await select('a');await ready('a');await select('b');await ready(firstB);
  await page.locator('.knowledge-header [data-kn-action=new-note]').click();
  const d1=await current();assert.notEqual(d1,'a');await ready(d1);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),'');assert.equal(await page.locator('[role=dialog]').count(),0);
  assert.equal(await page.locator('.kn-document-tabs [role=tab]').count(),2);await edit('未保存草稿一');
  await page.waitForFunction(()=>document.querySelector('[data-kn-receipt]')?.textContent==='草稿已保留 · 尚未保存为文件');
  assert.equal(await app.evaluate(()=>global.__noteSaves),0);assert.equal(await page.evaluate(()=>knowledgeActiveDocument().knowledgeNote.filePath),null);
  await page.locator('[data-note-save]').click();await page.waitForFunction(()=>!knowledgeFileWriteBusy.size);
  assert.equal(await app.evaluate(()=>global.__noteSaves),1);assert.equal(await current(),d1);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),'未保存草稿一');
  const first=path.join(profile,'第一份方案.md');await app.evaluate((_e,p)=>{global.__noteSavePath=p},first);
  await page.keyboard.press('Meta+s');await page.waitForFunction(p=>knowledgeActiveDocument()?.knowledgeNote.filePath===p,first);
  assert.equal(await fs.readFile(first,'utf8'),'未保存草稿一');
  assert.equal(await page.evaluate(()=>LoopKnowledgeCore.noteTitle(knowledgeActiveDocument())),'第一份方案');
  await select('a');assert.equal(await current(),'a');assert.equal(await page.locator('.kn-document-tabs').count(),0);await recent(d1);
  await select('b');assert.equal(await current(),d1);
  await page.locator('.knowledge-header [data-kn-action=new-note]').click();const d2=await current();await ready(d2);await edit('第二篇仍是草稿');
  await select('a');await ready(d1);await select('b');await ready(d2);
  await page.screenshot({path:path.join(out,'multiple-documents.png')});
  // Each first notebook visit starts blank, while existing tasks remember their document.
  await select('c');const firstC=await current();assert.notEqual(firstC,d2);assert.notEqual(firstC,firstB);await ready(firstC);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),'');assert.equal(await page.evaluate(()=>state.tasks.find(t=>t.id==='c').notes),'');
  assert.equal(await page.locator('.kn-document-tabs').count(),0);assert.deepEqual(await page.evaluate(()=>state.knowledgeWorkspace.openIds),[firstC]);
  await select('b');await ready(d2);await select('c');await ready(firstC);
  const file=path.join(profile,'外部笔记.md');await fs.writeFile(file,'# 本地文件\n\n原始内容');await app.evaluate((_e,p)=>{global.__noteOpenPath=p},file);
  await page.locator('.knowledge-header [data-kn-action=open-file]').click();await page.waitForFunction(p=>knowledgeActiveDocument()?.knowledgeNote.filePath===p,file);
  const external=await current();await ready(external);assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/原始内容/);
  const count=await page.evaluate(()=>state.knowledgeDocuments.length);await page.keyboard.press('Meta+o');await page.waitForTimeout(150);assert.equal(await current(),external);assert.equal(await page.evaluate(()=>state.knowledgeDocuments.length),count);
  await app.evaluate(()=>{global.__noteOpenPath=''});await page.keyboard.press('Meta+o');await page.waitForTimeout(150);assert.equal(await current(),external);
  // Reproduce the actual create-task form while another task's file is open.
  const documentsBeforeCreate=await page.evaluate(()=>state.knowledgeDocuments.length);
  await page.locator('[data-action=add-task]').click();await page.locator('#create-title').fill('刚刚创建的新任务');await page.locator('#create-form button[type=submit]').click();
  await page.waitForFunction(()=>state.tasks.some(task=>task.title==='刚刚创建的新任务'));
  const createdTask=await page.evaluate(()=>state.activeTaskId);assert.equal(await page.evaluate(()=>state.knowledgeDocuments.length),documentsBeforeCreate);await page.locator('[data-pane=notes]').click();
  const createdNote=await current();await ready(createdNote);assert.notEqual(createdNote,external);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),'');
  assert.equal(await page.locator('.kn-document-tabs').count(),0);assert.deepEqual(await page.evaluate(()=>state.knowledgeWorkspace.openIds),[createdNote]);await page.screenshot({path:path.join(out,'new-task-no-tabs.png')});
  assert.equal(await page.evaluate(()=>state.knowledgeDocuments.length),documentsBeforeCreate+1);
  await page.waitForFunction(()=>!pendingPayload&&!saveInFlight);assert.equal((await readTaskData(profile)).knowledgeWorkspace.lastByTask[createdTask],createdNote);
  await edit('新任务自己的记录');await select('c');await ready(external);assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/原始内容/);
  await select(createdTask);await ready(createdNote);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),'新任务自己的记录');
  await select('c');await ready(external);
  await select('b');await ready(d2);await page.locator(`[data-kn-detach="${d2}"]`).click();assert.equal(await page.locator(`[data-kn-document="${d2}"]`).count(),0);await recent(d2);assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/第二篇仍是草稿/);
  await select('a');await ready(d1);await select('b');await ready(d2);await flush();
  const disk=await readTaskData(profile);assert.equal(disk.knowledgeWorkspace.activeId,d2);assert.equal(disk.knowledgeWorkspace.lastByTask.a,d1);assert.equal(disk.knowledgeWorkspace.lastByTask.b,d2);
  assert.deepEqual(disk.knowledgeWorkspace.tabsByTask[createdTask],[createdNote]);assert.equal(disk.knowledgeWorkspace.tabsByTask.a.includes(d2),false);
  await app.close();app=null;await start();await ready(d2);assert.equal(await page.evaluate(()=>state.activeTaskId),'b');assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/第二篇仍是草稿/);
  await select('a');await ready(d1);await select('b');await ready(d2);await select(createdTask);await ready(createdNote);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),'新任务自己的记录');await select('b');await ready(d2);
  assert.doesNotMatch(await page.locator('.knowledge-pane').innerText(),/本任务创建|其他笔记/);
  for(const id of await page.evaluate(()=>state.knowledgeWorkspace.openIds.filter(id=>id!==knowledgeActiveDocument().id)))await page.locator(`[data-kn-detach="${id}"]`).click();
  assert.equal(await page.locator('.kn-document-tabs').count(),0);assert.equal(await current(),d2);
  for(const theme of ['light','dark'])for(const width of [1024,1280]){
   await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width,820),width);
   await page.evaluate(theme=>{state.theme=theme;render()},theme);await ready(d2);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(out,`single-${theme}-${width}.png`)});
   await page.locator('.knowledge-header [data-kn-action=recent]').click();await page.screenshot({path:path.join(out,`recent-${theme}-${width}.png`)});await page.keyboard.press('Escape');
  }
  // Closing the final tab leaves an intentional empty workspace across restart.
  await page.evaluate(()=>knowledgeDetach(knowledgeActiveDocument().id));await page.locator('.kn-empty-document').waitFor();await page.screenshot({path:path.join(out,'empty-workspace.png')});await flush();await app.close();app=null;
  await start();await page.locator('.kn-empty-document').waitFor();assert.equal(await current(),'');
  await recent(d2);assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/第二篇仍是草稿/);await flush();
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'results.json'),JSON.stringify({status:'PASS',source,profile,checks:['legacy migration','no compulsory task note','direct blank creation','draft recovery','cancel and first file save','native open and duplicate prevention','recent reopen','per-task last document','restart restoration','single-tab hiding','intentional empty workspace restart','light/dark 1024/1280'],errors},null,2));
  console.log(JSON.stringify({status:'PASS',profile,out,errors}));
 }catch(error){console.error(error);console.error('Renderer diagnostics',errors,await page?.evaluate(()=>({task:state.activeTaskId,session:state.knowledgeWorkspace,mounts:[...pendingMilkdownMounts.keys()],editors:[...milkdownEditors.keys()]})).catch(()=>null));if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{if(app){const timer=setTimeout(()=>app.process().kill('SIGTERM'),5000);await app.close().catch(()=>{});clearTimeout(timer);}}
})().catch(error=>{console.error(error);process.exitCode=1});

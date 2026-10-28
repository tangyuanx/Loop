/* The same behavioral audit against the real Electron renderer, IPC and disk. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright-core');
const {writeTaskData,readTaskData}=require('../app/main/storage.cjs');
const wb=require('./workbench-helpers.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const source=path.resolve(__dirname,'..'),profile=await fs.mkdtemp(path.join(os.tmpdir(),'loop-tables-links-desktop-')),errors=[];
 const stamp=new Date().toISOString();let app,page;
 const env={...process.env,LOOP_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 await writeTaskData(profile,{version:2,taskFilter:'all',tasks:['a','b','c'].map(id=>({id,title:'任务 '+id,notes:'# 笔记 '+id+'\n\n原始正文',nodes:[],createdAt:stamp,updatedAt:stamp}))});
 const start=async()=>{
  app=await _electron.launch({executablePath:require('electron'),args:[source],cwd:source,env});
  for(let attempt=0;attempt<150;attempt++){page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));if(page)break;await pause(100);}
  if(!page)throw Error('Loop main window did not open');page.setDefaultTimeout(15000);page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});await page.waitForFunction(()=>typeof knowledgeOpen==='function'&&state.tasks?.length===3&&document.readyState==='complete');
  assert.equal(await app.evaluate(async({app})=>{await app.whenReady();return app.getPath('userData')}),profile);
 };
 try{
  await start();
  const choose=async id=>{await page.evaluate(id=>{knowledgeOpen(state.tasks.find(t=>t.id===id));knowledgeAttach(knowledgeFindDocument(id));},id);await page.waitForFunction(id=>knowledgeCurrentEntry(id)?.view&&document.querySelector('.knowledge-pane')?.dataset.taskId===id,id);};
  const mode=async value=>{await wb.mode(page,value);};
  const markdown=()=>page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
  const append=async text=>{await page.evaluate(text=>{const e=knowledgeCurrentEntry();e.view.dispatch({changes:{from:e.view.state.doc.length,insert:text},selection:{anchor:e.view.state.doc.length+text.length},userEvent:'input'});},text);};
  const setChosenPath=async file=>{await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);};
  await require('./knowledge-tables-and-links.cjs')({page,profile,fs,readTaskData,choose,mode,markdown,append,pause,wb,setChosenPath});

  await require('./knowledge-table-design.cjs')({page,choose,mode,markdown});  await page.evaluate(async()=>{captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});await flushPendingKnowledgeRecoveries({strict:true});save();await flushSave();});
  await app.close();app=null;await start();await choose('b');
  const fileNote=(await readTaskData(profile)).knowledgeDocuments.find(note=>note.knowledgeNote.filePath);
  await page.locator(`[data-kn-document="${fileNote.id}"]`).click();await page.waitForFunction(()=>knowledgeCurrentEntry()?.getMarkdown().includes('外部文件修改'));
  await append('\n进程重启后保存');assert.equal((await page.evaluate(id=>saveKnowledgeTask(id),fileNote.id)).success,true);assert.match(await fs.readFile(fileNote.knowledgeNote.filePath,'utf8'),/进程重启后保存/);
  await choose('c');
  for(const theme of ['light','dark'])for(const width of [1024,1280]){
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width,820),width);
    await page.evaluate(theme=>{state.theme=theme;render();},theme);await page.locator('.kn-table-widget').first().waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('[data-table-handle=column]').first().click();assert.equal(await page.locator('.kn-table-menu').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),true);await page.keyboard.press('Escape');
    if(process.env.LOOP_TEST_SCREENSHOT_DIR){await fs.mkdir(process.env.LOOP_TEST_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.LOOP_TEST_SCREENSHOT_DIR,`table-design-${theme}-${width}.png`)});}
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',profile,checks:'complete table/association audit, native file choose/save, disk path authority after Electron restart',errors}));
 }finally{if(app)await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});

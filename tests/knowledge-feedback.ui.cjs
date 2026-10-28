/* Production Electron, IPC and disk. Only native file picker answers and
   explicit task-data write faults/delays are injected in this test process. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {_electron}=require('playwright-core');
const {writeTaskData}=require('../app/main/storage.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
const source=path.resolve(__dirname,'..'),results=[],errors=[];
let app,page,run,profile,files,out;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await pause(80)}throw Error('Condition timed out')}
async function shot(name){await page.screenshot({path:path.join(out,name+'.png')})}
async function test(id,fn){try{results.push({id,status:'PASS',detail:await fn()})}catch(error){results.push({id,status:'FAIL',error:error.stack});await shot(id+'-failure').catch(()=>{})}await fs.writeFile(path.join(out,'results.json'),JSON.stringify({source,profile,files,results,errors},null,2));console.log(JSON.stringify(results.at(-1)))}
async function choose(id){await page.keyboard.press('Escape');await page.locator(`[data-task-row="${id}"] .task-select`).click();await page.locator('[data-pane="notes"]').click();await page.evaluate(id=>knowledgeAttach(knowledgeFindDocument(id)),id);await page.waitForFunction(id=>knowledgeCurrentEntry(id)?.view&&document.querySelector('.knowledge-pane')?.dataset.taskId===id,id)}
async function rename(){await page.locator('[data-wb-action="more"]').click();await page.locator('.wb-more-menu [data-kn-action="rename"]').click();await page.locator('#kn-rename-title').waitFor()}
async function commit(){await page.locator('#kn-rename-commit').click();await page.waitForFunction(()=>!document.querySelector('#kn-rename-commit')?.disabled)}
async function snapshot(id){return page.evaluate(id=>{const t=state.tasks.find(t=>t.id===id);return {notes:t.notes,noteId:t.knowledgeNote.noteId,filePath:t.knowledgeNote.filePath,title:t.knowledgeNote.title,aliases:t.knowledgeNote.aliases,taskTitle:t.title}},id)}
async function presentation(){return page.evaluate(()=>({hint:document.querySelector('[data-note-save]')?.title,receipt:document.querySelector('[data-kn-receipt]')?.textContent,state:document.querySelector('[data-kn-receipt]')?.dataset.state,model:knowledgeSavePresentation(shellActiveTask())}))}
async function menuLabel(){await page.keyboard.press('Escape');await page.locator('[data-action="knowledge-file-menu"]').click();const label=await page.locator('[data-knowledge-save-label]').innerText();await page.keyboard.press('Escape');return label}
async function edit(text){await page.evaluate(text=>{const e=knowledgeCurrentEntry();e.view.dispatch({changes:{from:e.view.state.doc.length,insert:text},userEvent:'input'})},text)}
async function fault(value){await app.evaluate((_e,value)=>{global.__s3Fault=value},value)}
async function release(){await app.evaluate(()=>{global.__s3Release?.();global.__s3Release=null;global.__s3Blocked=false;global.__s3Fault={}})}
(async()=>{
 run=process.env.LOOP_FEEDBACK_QA_DIR?path.resolve(process.env.LOOP_FEEDBACK_QA_DIR):await fs.mkdtemp(path.join(os.tmpdir(),'loop-knowledge-feedback-'));
 profile=path.join(run,'user-data');files=path.join(run,'files');out=path.join(run,'evidence');await fs.mkdir(out,{recursive:true});await fs.mkdir(files,{recursive:true});
 await fs.access(path.join(profile,'task-data.json')).then(()=>{throw Error('Refusing to replace test data')},()=>{});
 const stamp=new Date().toISOString(),tasks=[];
 for(const id of ['rename','failure','late','destination','other','missing','readonly','conflict']){
  const notes='# '+id+' 原始正文\n\n必须保留的笔记内容。\n';let note={};
  if(['missing','readonly','conflict'].includes(id)){const filePath=path.join(files,id+'.md');await fs.writeFile(filePath,notes);note={...await readKnowledgeDocument(filePath),documentState:'SAVED',dirty:false}}
  tasks.push({id,title:id+' 所属任务',notes,nodes:[],createdAt:stamp,updatedAt:stamp,knowledgeNote:{noteId:'feedback-'+id,title:id+' 旧名称',aliases:['保留别名-'+id],documentState:'DRAFT',...note}});
 }
 await writeTaskData(profile,{version:2,knowledgeSchemaVersion:1,taskFilter:'all',activeTaskId:'rename',tasks});
 const env={...process.env,LOOP_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:process.env.LOOP_APP_EXECUTABLE||require('electron'),args:process.env.LOOP_APP_EXECUTABLE?[]:[source],cwd:source,env});
 try{
  await until(()=>{page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));return page});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.navigation');
  const runtime=await app.evaluate(({app})=>({version:app.getVersion(),appPath:app.getAppPath(),userData:app.getPath('userData'),platform:process.platform}));assert.equal(runtime.userData,profile);await fs.writeFile(path.join(out,'runtime.json'),JSON.stringify(runtime,null,2));
  await app.evaluate(({dialog})=>{
   global.__s3Fault={};global.__s3Opens=0;global.__s3SavePath='';
   dialog.showSaveDialog=async()=>global.__s3SavePath?{canceled:false,filePath:global.__s3SavePath}:{canceled:true};
   const fs=process.mainModule.require('node:fs/promises'),open=fs.open,access=fs.access;
   fs.access=async(...args)=>{if(global.__s3ReadOnlyPath===String(args[0])&&args[1]===2)throw Object.assign(Error('测试：文件不可写'),{code:'EACCES'});return access(...args)};
   fs.open=async(...args)=>{const fault=global.__s3Fault;if(fault.prefix&&String(args[0]).startsWith(fault.prefix)){global.__s3Opens++;if(fault.delay){global.__s3Blocked=true;await new Promise(resolve=>{global.__s3Release=resolve})}if(fault.fail)throw Object.assign(Error('测试：任务数据写入失败'),{code:'ENOSPC'})}return open(...args)};
  });
  await test('F07-receipt-after-local-persistence',async()=>{
   await choose('rename');
   await page.evaluate(()=>{shellActiveTask().knowledgeNote.aliases.push('回执刷新样本');save();render()});
   await page.waitForFunction(()=>!pendingPayload&&!saveInFlight);
   await page.waitForFunction(()=>document.querySelector('[data-kn-receipt]')?.textContent===knowledgeReceipt(shellActiveTask()).text);
   assert.equal((await presentation()).receipt,'草稿已保留 · 尚未保存为文件');await shot('local-persistence-receipt');
  });
  await test('F06-blank-click-enter-correction',async()=>{
   await choose('rename');const before=await snapshot('rename');await rename();
   for(const value of ['', '   ', '\u3000\u3000'])for(const method of ['click','enter']){
    await page.locator('#kn-rename-title').fill(value);if(method==='click')await commit();else await page.locator('#kn-rename-title').press('Enter');
    assert.equal(await page.locator('#kn-rename-error').innerText(),'请输入笔记名称');assert.equal(await page.locator('#kn-rename-title').getAttribute('aria-invalid'),'true');
    assert.equal(await page.locator('#kn-rename-title').getAttribute('aria-describedby'),'kn-rename-error');assert.equal(await page.locator('#kn-rename-error').getAttribute('role'),'alert');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'kn-rename-title');assert.deepEqual(await snapshot('rename'),before);
   }
   await shot('blank-name-error');await page.locator('#kn-rename-title').fill('正常中文名称');assert.equal(await page.locator('#kn-rename-error').innerText(),'');assert.equal(await page.locator('#kn-rename-title').getAttribute('aria-invalid'),null);
   await page.locator('#kn-rename-title').press('Enter');await page.locator('#kn-rename-title').waitFor({state:'detached'});
   const after=await snapshot('rename');assert.equal(after.title,'正常中文名称');assert.equal(after.noteId,before.noteId);assert.equal(after.filePath,before.filePath);assert.equal(after.notes,before.notes);assert.equal(after.taskTitle,before.taskTitle);assert.ok(after.aliases.includes(before.title));assert.ok(after.aliases.includes('保留别名-rename'));
   const persisted=JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8')).tasks.find(t=>t.id==='rename');assert.equal(persisted.knowledgeNote.title,after.title);return {cases:6,after};
  });
  await test('F06-composition-and-cancel',async()=>{
   await choose('rename');const before=await snapshot('rename');await rename();await page.locator('#kn-rename-title').fill('组合输入名称');
   await page.locator('#kn-rename-title').dispatchEvent('compositionstart');await page.locator('#kn-rename-title').dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229,bubbles:true});
   assert.equal(await page.locator('#kn-rename-title').count(),1);assert.deepEqual(await snapshot('rename'),before);
   await page.locator('#kn-rename-title').dispatchEvent('compositionend');await page.keyboard.press('Escape');assert.deepEqual(await snapshot('rename'),before);
  });
  await test('F06-save-failure-retry-and-duplicates',async()=>{
   await choose('failure');const before=await snapshot('failure');await page.evaluate(()=>flushSave());await rename();await page.locator('#kn-rename-title').fill('失败重试后的中文名');
   await fault({prefix:path.join(profile,'task-data.json.tmp-'),fail:true});await commit();assert.match(await page.locator('#kn-rename-error').innerText(),/重命名未能保存/);assert.deepEqual(await snapshot('failure'),before);await shot('rename-save-failure');
   await fault({});await page.evaluate(()=>flushSave());await fault({prefix:path.join(profile,'task-data.json.tmp-'),delay:true});await page.locator('#kn-rename-commit').click();
   await until(()=>app.evaluate(()=>global.__s3Blocked===true));assert.equal(await page.locator('#kn-rename-commit').isDisabled(),true);assert.equal(await page.locator('#kn-rename-title').getAttribute('readonly'),'');
   const count=await app.evaluate(()=>global.__s3Opens);await page.evaluate(()=>{document.querySelector('#kn-rename-commit').onclick();document.querySelector('#kn-rename-commit').onclick()});assert.equal(await app.evaluate(()=>global.__s3Opens),count);
   await release();await page.locator('#kn-rename-title').waitFor({state:'detached'});assert.equal((await snapshot('failure')).title,'失败重试后的中文名');
  });
  await test('F06-late-rename-cannot-close-new-dialog',async()=>{
   await choose('late');await page.evaluate(()=>flushSave());await rename();await page.locator('#kn-rename-title').fill('A 晚返回的名称');await fault({prefix:path.join(profile,'task-data.json.tmp-'),delay:true});await page.locator('#kn-rename-commit').click();await until(()=>app.evaluate(()=>global.__s3Blocked===true));
   await choose('other');await rename();await page.locator('#kn-rename-title').fill('B 尚未提交');await page.evaluate(()=>{globalThis.__feedbackField=document.querySelector('#kn-rename-title')});await release();await pause(300);
   assert.equal(await page.evaluate(()=>document.querySelector('#kn-rename-title')===globalThis.__feedbackField),true);assert.equal(await page.locator('#kn-rename-title').inputValue(),'B 尚未提交');await page.keyboard.press('Escape');
  });
  await test('F07-unbound-bind-autosave-unlink',async()=>{
   await choose('destination');await page.evaluate(()=>saveKnowledgeTask('destination',{automatic:true}));let p=await presentation();assert.match(p.hint,/选择位置并保存/);assert.equal(p.receipt,'草稿已保留 · 尚未保存为文件');assert.equal(await menuLabel(),'保存…');
   const bound=path.join(files,'保存目的地.md');await app.evaluate((_e,bound)=>{global.__s3SavePath=bound},bound);await page.locator('[data-action="knowledge-file-menu"]').click();await page.locator('[role="menu"] [data-action="save-knowledge"]').click();
   await page.waitForFunction(()=>state.tasks.find(t=>t.id==='destination').knowledgeNote.filePath&&!knowledgeFileWriteBusy.has('destination'));await page.keyboard.press('Escape');p=await presentation();assert.match(p.hint,/保存到文件/);assert.equal(p.receipt,'已保存到文件');assert.equal(await menuLabel(),'保存到文件');
   await edit('\n自动同步的中文内容');await until(async()=> (await fs.readFile(bound,'utf8')).includes('自动同步的中文内容'));await page.waitForFunction(()=>document.querySelector('[data-kn-receipt]').textContent==='已保存到文件');
   await shot('bound-save-destination');
   // The same production unlink transaction is used by the file menu.
   await page.evaluate(async()=>{await recovery26Transaction(()=>recovery26UnlinkNote('destination'));render()});
   await page.evaluate(()=>saveKnowledgeTask('destination',{automatic:true}));p=await presentation();assert.match(p.hint,/选择位置并保存/);assert.equal(p.receipt,'草稿已保留 · 尚未保存为文件');assert.equal(await menuLabel(),'保存…');await shot('unbound-save-destination');return {bound,p};
  });
  await test('F07-save-pending-failed-and-AB',async()=>{
   await choose('destination');await page.evaluate(async()=>{if(shellActiveTask().knowledgeNote.filePath){await recovery26Transaction(()=>recovery26UnlinkNote('destination'));render()}await saveKnowledgeTask('destination',{automatic:true});await flushSave()});await fault({prefix:path.join(profile,'task-data.json.tmp-'),delay:true});
   await edit('\n保存中状态的实际变更');await page.evaluate(()=>{globalThis.__feedbackSave=saveKnowledgeTask('destination',{automatic:true})});await until(()=>app.evaluate(()=>global.__s3Blocked===true));assert.equal((await presentation()).state,'saving');assert.match((await presentation()).hint,/选择位置并保存/);
   await choose('other');assert.equal((await presentation()).model.destination,'loop');assert.notEqual((await presentation()).state,'saving');await release();await page.evaluate(()=>globalThis.__feedbackSave);
   await choose('destination');await fault({prefix:path.join(profile,'task-data.json.tmp-'),fail:true});await edit('\n保存失败状态的实际变更');await page.evaluate(()=>saveKnowledgeTask('destination',{automatic:true}));assert.equal((await presentation()).state,'failed');assert.match((await presentation()).hint,/选择位置并保存/);
   await fault({});await page.evaluate(()=>saveKnowledgeTask('destination',{automatic:true}));assert.equal((await presentation()).receipt,'草稿已保留 · 尚未保存为文件');
   for(let i=0;i<4;i++){await choose(i%2?'missing':'destination');assert.equal((await presentation()).model.destination,i%2?'file':'loop');assert.match((await presentation()).hint,i%2?/保存到文件/:/选择位置并保存/)}
  });
  await test('F07-missing-readonly-conflict',async()=>{
   await choose('missing');await fs.rename(path.join(files,'missing.md'),path.join(files,'missing.moved'));
   await page.waitForFunction(()=>state.tasks.find(t=>t.id==='missing').knowledgeNote.documentState==='FILE_MISSING');let p=await presentation();assert.match(p.hint,/保存到文件/);assert.notEqual(p.state,'saved');assert.match(p.receipt,/文件已丢失|文件未同步/);
   await choose('readonly');const readonly=path.join(files,'readonly.md');
   // The external test volume does not enforce POSIX chmod. Inject only the
   // W_OK access denial; production read + watcher still derive READ_ONLY.
   await app.evaluate((_e,readonly)=>{global.__s3ReadOnlyPath=readonly},readonly);
   await page.evaluate(()=>syncKnowledgeFileWatcher(state.tasks.find(t=>t.id==='readonly')));
   await page.waitForFunction(()=>state.tasks.find(t=>t.id==='readonly').knowledgeNote.documentState==='READ_ONLY');
   p=await presentation();assert.match(p.hint,/保存到文件/);assert.equal(p.state,'conflict');assert.match(p.receipt,/不可写/);await app.evaluate(()=>{global.__s3ReadOnlyPath=''});
   await choose('conflict');await edit('\n当前冲突草稿');await fs.writeFile(path.join(files,'conflict.md'),'# 新外部版本\n');await page.waitForFunction(()=>state.tasks.find(t=>t.id==='conflict').knowledgeNote.documentState==='EXTERNAL_CHANGED');p=await presentation();assert.match(p.hint,/保存到文件/);assert.equal(p.state,'conflict');assert.match(p.receipt,/外部修改/);
   await shot('conflict-destination');
   await page.evaluate(async()=>{state.knowledgeFileIssues[shellActiveTask().knowledgeNote.noteId]={message:'旧文件读取错误'};knowledgeSaveResults.set('conflict',{error:'旧文件保存失败',filePath:shellActiveTask().knowledgeNote.filePath});await recovery26Transaction(()=>recovery26UnlinkNote('conflict'));render()});
   const unlinked=await presentation();assert.match(unlinked.hint,/选择位置并保存/);assert.notEqual(unlinked.state,'conflict');assert.notEqual(unlinked.state,'failed');assert.ok(!(await menuLabel()).includes('同步'));
   return {p,unlinked,readonlyAccessDenialInjected:true};
  });
 }finally{await release().catch(()=>{});await app.close()}
 if(results.some(r=>r.status==='FAIL')||errors.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});

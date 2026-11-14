/* Real Electron + production IPC/storage/watcher. Native answers are scripted;
   failure/delay injection wraps fs only inside this isolated test process. */
const wb = require('./workbench-helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
const { writeTaskData } = require('../app/main/storage.cjs');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');
const source = path.resolve(__dirname, '..');
const ids = ['cancel','reload','missing','persist','draft','saveas','late-a','late-b','again','clean','reopen','close'];
const results = [], errors = [];
let app, page, run, profile, files, out;
const local = id => '# 本地草稿 ' + id + '\n\n必须保留的输入。\n';
const disk = id => '# 磁盘版本 ' + id + '\n\n来自专用测试文件。\n';
const file = id => path.join(files, id + '.md');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout=15000) {const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await pause(80)}throw Error('Condition timed out')}
async function json(name, value) {await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(value,null,2))}
async function shot(name) {await page.screenshot({path:path.join(out,name+'.png')})}
async function test(id, fn) {
  try {results.push({id,status:'PASS',detail:await fn()})}
  catch(error){results.push({id,status:'FAIL',error:error.stack});await shot(id+'-failure').catch(()=>{})}
  await json('results',{source,run,profile,files,results,errors});console.log(JSON.stringify(results.at(-1)));
}
async function choose(id) {
  await page.keyboard.press('Escape');
  await page.locator(`[data-task-row="${id}"] .task-select`).click();
  if (await page.locator('[data-pane="notes"]').getAttribute('aria-pressed') !== 'true') {
    await page.locator('[data-pane="notes"]').click();
  }
  await page.waitForFunction(id=>knowledgeCurrentEntry(id)?.view&&document.querySelector('.knowledge-pane')?.dataset.taskId===id,id);
  if (!await page.locator('[data-knowledge-conflict]').count()) await wb.minimizeTaskInfo(page);
}
async function open(id) {
  await choose(id);
  await page.evaluate(id=>shellKnowledgeConflict(state.tasks.find(t=>t.id===id)),id);
  await page.locator('[data-knowledge-conflict]').waitFor();
}
async function idle() {await page.waitForFunction(()=>!document.querySelector('[data-knowledge-conflict]')?.hasAttribute('aria-busy'))}
async function click(action) {await page.locator(`[data-knowledge-conflict] [data-action="${action}"]`).click();await idle()}
async function closed() {await page.locator('[data-knowledge-conflict]').waitFor({state:'detached'})}
const content = id => page.evaluate(id=>state.tasks.find(t=>t.id===id).notes,id);
async function prepareRecovery(id) {
  await page.evaluate(async id=>{const task=state.tasks.find(t=>t.id===id);scheduleKnowledgeRecovery(id,task.notes);await flushKnowledgeRecovery(task.knowledgeNote.noteId,{strict:true});save();await flushSave()},id);
}
async function recovery(id) {return page.evaluate(id=>state.knowledgeRecovery.records['note-'+id]?.content,id)}
async function edit(id, text) {
  await page.evaluate(({id,text})=>{const entry=knowledgeCurrentEntry(id);entry.view.dispatch({changes:{from:entry.view.state.doc.length,insert:text},userEvent:'input'});captureMountedMilkdownDrafts();flushNodeNoteDraft(noteDraftKey(id,''),{persist:true})},{id,text});
}
async function inject(options) {
  await app.evaluate((_electron,options)=>{global.__s2Fault=options},options);
}
async function unwatch(id) {await page.evaluate(id=>desktopKnowledgeFile.unwatch({noteId:'note-'+id}),id)}
async function waitBlocked() {await until(()=>app.evaluate(()=>global.__s2Blocked===true))}
async function release() {await app.evaluate(()=>{global.__s2Release?.();global.__s2Release=null;global.__s2Blocked=false;global.__s2Fault={}})}

(async()=>{
  run=process.env.LOOP_CONFLICT_QA_DIR?path.resolve(process.env.LOOP_CONFLICT_QA_DIR):await fs.mkdtemp(path.join(os.tmpdir(),'loop-knowledge-conflict-'));
  profile=path.join(run,'user-data');files=path.join(run,'files');out=path.join(run,'evidence');
  await fs.mkdir(files,{recursive:true});await fs.mkdir(out,{recursive:true});
  await fs.access(path.join(profile,'task-data.json')).then(()=>{throw Error('Refusing to replace test data')},()=>{});
  const tasks=[];const stamp=new Date().toISOString();
  for(const id of ids) {
    const clean = ['clean','reopen','close'].includes(id);
    await fs.writeFile(file(id),clean ? local(id) : disk(id));const read=await readKnowledgeDocument(file(id));
    tasks.push({id,title:'S2 '+id,notes:local(id),nodes:[],createdAt:stamp,updatedAt:stamp,knowledgeNote:{...read,noteId:'note-'+id,title:'S2 '+id,documentState:clean?'SAVED':'EXTERNAL_CHANGED',dirty:!clean,lastSavedHash:clean?read.lastSavedHash:'old-'+id}});
  }
  tasks.push({id:'delete-task',title:'删除回归',notes:'',nodes:[{id:'delete-node',title:'删除节点回归',children:[]}]});
  await writeTaskData(profile,{version:2,knowledgeSchemaVersion:1,taskFilter:'all',activeTaskId:'cancel',tasks});
  const env={...process.env,LOOP_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:process.env.LOOP_APP_EXECUTABLE||require('electron'),args:process.env.LOOP_APP_EXECUTABLE?[]:(process.env.LOOP_NO_SANDBOX?['--no-sandbox',source]:[source]),cwd:source,env});
  try {
    await until(()=>{page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));return page});
    page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.navigation');
    const runtime=await app.evaluate(({app})=>({version:app.getVersion(),appPath:app.getAppPath(),userData:app.getPath('userData'),platform:process.platform}));
    assert.equal(runtime.userData,profile);
    if(process.env.LOOP_APP_EXECUTABLE)assert.ok(runtime.appPath.endsWith('app.asar'));else assert.equal(runtime.appPath,source);
    await json('runtime',runtime);
    await app.evaluate(({dialog})=>{
      global.__s2Dialogs=[];global.__s2Response=1;global.__s2SavePath='';global.__s2Fault={};
      dialog.showMessageBox=async(...args)=>{global.__s2Dialogs.push(args.at(-1));return {response:global.__s2Response}};
      dialog.showSaveDialog=async()=>global.__s2SavePath?{canceled:false,filePath:global.__s2SavePath}:{canceled:true};
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[global.__s2OpenPath]});
      const fs=process.mainModule.require('node:fs/promises');
      const read=fs.readFile,open=fs.open;
      fs.readFile=async(...args)=>{
        const fault=global.__s2Fault;
        if(fault.readPath===String(args[0])) {
          if(fault.delay){global.__s2Blocked=true;await new Promise(resolve=>{global.__s2Release=resolve})}
          if(fault.failRead)throw Object.assign(Error('测试：读取失败'),{code:'EIO'});
        }
        return read(...args);
      };
      fs.open=async(...args)=>{
        if(global.__s2Fault.openPrefix&&String(args[0]).startsWith(global.__s2Fault.openPrefix))throw Object.assign(Error('测试：磁盘空间不足'),{code:'ENOSPC'});
        return open(...args);
      };
    });
    await test('S2-01-cancel-native',async()=>{
      await open('cancel');await prepareRecovery('cancel');
      const before=await page.evaluate(()=>structuredClone(state.tasks.find(t=>t.id==='cancel')));
      await app.evaluate(()=>{global.__s2Response=0});await click('reload-knowledge');
      assert.equal(await page.locator('[data-knowledge-conflict]').count(),1);
      assert.deepEqual(await page.evaluate(()=>structuredClone(state.tasks.find(t=>t.id==='cancel'))),before);
      assert.equal(await recovery('cancel'),local('cancel'));assert.equal(await fs.readFile(file('cancel'),'utf8'),disk('cancel'));
      const options=await app.evaluate(()=>global.__s2Dialogs.at(-1));
      assert.equal(options.title,'重新加载笔记');assert.deepEqual(options.buttons,['取消','放弃修改并重新加载']);assert.equal(options.defaultId,0);assert.equal(options.cancelId,0);
      assert.match(options.message,/不会删除笔记或文件/);await shot('cancel-keeps-conflict');await app.evaluate(()=>{global.__s2Response=1});return options;
    });
    await test('S2-02-reload-success',async()=>{
      await open('reload');await prepareRecovery('reload');await click('reload-knowledge');await closed();
      assert.equal(await content('reload'),disk('reload'));assert.equal(await recovery('reload'),undefined);
      const persisted=JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8')).tasks.find(t=>t.id==='reload');
      assert.equal(persisted.notes,disk('reload'));assert.equal(persisted.knowledgeNote.documentState,'SAVED');
      const focused=await page.evaluate(()=>Boolean(document.activeElement.closest('.cm-editor,[data-action="knowledge-file-menu"]')));assert.equal(focused,true);
      await shot('reload-success');return {persisted:true,focusReturned:focused};
    });
    await test('S2-03-missing-file-retry',async()=>{
      await open('missing');await prepareRecovery('missing');await unwatch('missing');
      await fs.rename(file('missing'),file('missing')+'.moved');await click('reload-knowledge');
      assert.ok((await page.locator('[data-conflict-error]').innerText()).length);assert.equal(await content('missing'),local('missing'));assert.equal(await recovery('missing'),local('missing'));
      await shot('missing-file-error');await fs.rename(file('missing')+'.moved',file('missing'));
      await inject({readPath:file('missing'),failRead:true});await click('reload-knowledge');
      assert.ok((await page.locator('[data-conflict-error]').innerText()).length);assert.equal(await content('missing'),local('missing'));assert.equal(await recovery('missing'),local('missing'));
      await inject({});await click('reload-knowledge');await closed();assert.equal(await content('missing'),disk('missing'));
    });
    await test('S2-04-persistence-failure-retry',async()=>{
      await open('persist');await prepareRecovery('persist');await unwatch('persist');
      await inject({openPrefix:path.join(profile,'task-data.json.tmp-')});await click('reload-knowledge');
      assert.match(await page.locator('[data-conflict-error]').innerText(),/持久化/);assert.equal(await content('persist'),local('persist'));assert.equal(await recovery('persist'),local('persist'));
      await shot('persistence-error');await inject({});await page.evaluate(()=>flushSave());await click('reload-knowledge');await closed();assert.equal(await content('persist'),disk('persist'));
    });
    await test('S2-05-draft-during-read-and-duplicate',async()=>{
      await open('draft');await prepareRecovery('draft');await unwatch('draft');await inject({readPath:file('draft'),delay:true});
      await page.locator('[data-knowledge-conflict] [data-action="reload-knowledge"]').click();await waitBlocked();
      assert.equal(await page.locator('[data-knowledge-conflict] footer button[data-task-id]:disabled').count(),2);await shot('reload-in-progress');
      await page.evaluate(()=>action({action:'reload-knowledge',taskId:'draft'}));
      await edit('draft','\n读取期间新增输入');await release();await idle();
      assert.match(await page.locator('[data-conflict-error]').innerText(),/读取期间笔记发生修改/);assert.match(await content('draft'),/新增输入/);assert.equal(await fs.readFile(file('draft'),'utf8'),disk('draft'));
      await shot('draft-change-protected');await click('reload-knowledge');await closed();
    });
    await test('S2-06-clean-external-edit-prompts-and-reloads',async()=>{
      await choose('clean');
      await fs.writeFile(file('clean'),disk('clean'));
      const dialog=page.locator('[data-knowledge-conflict]');
      await dialog.waitFor();
      assert.equal(await content('clean'),local('clean'));
      assert.match(await dialog.locator('.knowledge-version-grid').innerText(),/原先打开的版本/);
      const confirmations=await app.evaluate(()=>global.__s2Dialogs.length);
      await shot('clean-external-change');
      await fs.writeFile(file('clean'),'# 更新的磁盘版本\n');
      await click('reload-knowledge');await closed();
      assert.equal(await content('clean'),'# 更新的磁盘版本\n');
      assert.equal(await app.evaluate(()=>global.__s2Dialogs.length),confirmations);
    });
    await test('S2-07-saveas-cancel-success',async()=>{
      await open('saveas');await prepareRecovery('saveas');await click('save-knowledge-as');
      assert.equal(await page.locator('[data-knowledge-conflict]').count(),1);assert.equal(await content('saveas'),local('saveas'));assert.equal(await recovery('saveas'),local('saveas'));
      assert.equal(await page.evaluate(()=>state.tasks.find(t=>t.id==='saveas').knowledgeNote.filePath),file('saveas'));
      await app.evaluate((_e,p)=>{global.__s2SavePath=p},file('saveas'));
      await click('save-knowledge-as');
      assert.match(await page.locator('[data-conflict-error]').innerText(),/请选择另一个/);
      assert.equal(await fs.readFile(file('saveas'),'utf8'),disk('saveas'));
      const saved=path.join(files,'另存为.md');await app.evaluate((_e,saved)=>{global.__s2SavePath=saved},saved);
      await inject({openPrefix:path.join(files,'.另存为.md.tmp-')});await click('save-knowledge-as');
      assert.ok((await page.locator('[data-conflict-error]').innerText()).length);assert.equal(await content('saveas'),local('saveas'));assert.equal(await page.evaluate(()=>state.tasks.find(t=>t.id==='saveas').knowledgeNote.filePath),file('saveas'));
      await inject({});await click('save-knowledge-as');await closed();
      assert.equal(await page.evaluate(()=>state.tasks.find(t=>t.id==='saveas').knowledgeNote.filePath),saved);assert.equal(await fs.readFile(saved,'utf8'),local('saveas'));assert.equal(await fs.readFile(file('saveas'),'utf8'),disk('saveas'));return {saved};
    });
    await test('S2-08-late-a-cannot-close-b',async()=>{
      await open('late-a');await prepareRecovery('late-a');await unwatch('late-a');await inject({readPath:file('late-a'),delay:true});
      await page.locator('[data-knowledge-conflict] [data-action="reload-knowledge"]').click();await waitBlocked();
      await page.evaluate(()=>{knowledgeOpen(knowledgeFindDocument('late-b'));shellKnowledgeConflict(knowledgeFindDocument('late-b'));});
      const identity=await page.locator('[data-knowledge-conflict]').getAttribute('data-knowledge-conflict');
      await page.evaluate(()=>{globalThis.__s2Focus=document.activeElement});await release();await until(async()=>await content('late-a')===disk('late-a'));await pause(300);
      assert.equal(await page.locator('[data-knowledge-conflict]').getAttribute('data-knowledge-conflict'),identity);assert.equal(await content('late-b'),local('late-b'));assert.equal(await page.evaluate(()=>document.activeElement===globalThis.__s2Focus),true);await shot('b-survives-late-a');
    });
    await test('S2-09-second-external-conflict',async()=>{
      await open('again');await click('reload-knowledge');await closed();
      await edit('again','\n第二轮本地草稿');await fs.writeFile(file('again'),'# 第二轮外部修改\n');
      await page.locator('[data-knowledge-conflict]').waitFor();
      assert.match(await content('again'),/第二轮本地草稿/);
      assert.match(await page.locator('.knowledge-version-grid').innerText(),/第二轮外部修改/);await shot('second-conflict');await click('reload-knowledge');await closed();assert.equal(await content('again'),'# 第二轮外部修改\n');
    });
    await test('S2-10-real-task-node-delete-regression',async()=>{
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>deleteNode('delete-task','delete-node')),true);
      assert.equal(await page.evaluate(()=>state.tasks.find(t=>t.id==='delete-task').nodes.length),0);
      let options=await app.evaluate(()=>global.__s2Dialogs.at(-1));assert.equal(options.title,'确认删除');assert.deepEqual(options.buttons,['取消','删除']);
      assert.equal(await page.evaluate(()=>deleteTask('delete-task',{skipDraftPrompt:true})),true);
      options=await app.evaluate(()=>global.__s2Dialogs.at(-1));assert.equal(options.title,'确认删除');assert.deepEqual(options.buttons,['取消','删除']);
      assert.equal(await page.evaluate(()=>state.tasks.some(t=>t.id==='delete-task')),false);return options;
    });
    await test('S2-11-reopen-uses-disk-without-watcher',async()=>{
      await choose('reopen');await unwatch('reopen');
      await page.locator('[data-kn-detach="reopen"]').click();
      await page.locator('.kn-empty-document').waitFor();
      await fs.writeFile(file('reopen'),disk('reopen'));
      await app.evaluate((_e,p)=>{global.__s2OpenPath=p},file('reopen'));
      await wb.more(page);
      await page.locator('.wb-more-menu [data-kn-action="open-file"]').click();
      await page.locator('[data-knowledge-conflict]').waitFor();
      assert.match(await page.locator('.knowledge-version-grid').innerText(),/磁盘版本 reopen/);
      await page.keyboard.press('Escape');await closed();
      await page.locator('[data-kn-detach="reopen"]').click();
      await wb.more(page);await page.locator('.wb-more-menu [data-kn-action="recent"]').click();
      await page.locator('[data-kn-note="reopen"]').click();
      await page.locator('[data-knowledge-conflict]').waitFor();
      await click('reload-knowledge');await closed();
      assert.equal(await content('reopen'),disk('reopen'));
    });
    await test('S2-12-close-dirty-tab-cancel-keep-and-save',async()=>{
      await choose('close');
      const tab=page.locator('[data-kn-document="close"]'), cross=page.locator('[data-kn-detach="close"]');
      const dialog=page.locator('[data-knowledge-close]');
      const change='\n关闭前的未保存修改\n';
      await edit('close',change);await cross.click();await dialog.waitFor();await shot('close-unsaved');
      await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
      await page.waitForFunction(()=>document.activeElement.matches('[data-kn-detach="close"]'));
      assert.match(await content('close'),/关闭前的未保存修改/);
      await cross.click();await dialog.getByRole('button',{name:'保留草稿并关闭'}).click();
      await tab.waitFor({state:'detached'});assert.equal(await fs.readFile(file('close'),'utf8'),local('close'));
      assert.match(await recovery('close'),/关闭前的未保存修改/);
      await page.evaluate(()=>knowledgeAttach(knowledgeFindDocument('close')));
      await cross.click();await dialog.getByRole('button',{name:'保存并关闭'}).click();
      await tab.waitFor({state:'detached'});
      assert.equal(await fs.readFile(file('close'),'utf8'),local('close')+change);
    });
    await test('S2-13-close-new-note-and-cancel-save-picker',async()=>{
      await page.locator('.kn-document-new').click();
      const newId=await page.evaluate(()=>knowledgeActiveDocument().id);
      await page.waitForFunction(id=>knowledgeCurrentEntry(id)?.view,newId);
      await edit(newId,'待保存的新笔记');
      await page.locator('[data-kn-detach="'+newId+'"]').click();
      const dialog=page.locator('[data-knowledge-close]');
      await app.evaluate(()=>{global.__s2SavePath=''});
      const saveButton=dialog.getByRole('button',{name:'保存并关闭'});
      await saveButton.click();
      await dialog.locator('[data-kn-close-choice="save"]:enabled').waitFor();
      assert.equal(await page.evaluate(id=>knowledgeFindDocument(id).notes,newId),'待保存的新笔记');
      const saved=path.join(files,'new-note.md');
      await app.evaluate((_e,p)=>{global.__s2SavePath=p},saved);
      await saveButton.click();await dialog.waitFor({state:'detached'});
      assert.equal(await fs.readFile(saved,'utf8'),'待保存的新笔记');
    });
  } finally {await inject({}).catch(()=>{});await release().catch(()=>{});await app.close()}
  if(results.some(result=>result.status==='FAIL')||errors.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});

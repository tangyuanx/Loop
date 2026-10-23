/* Real Loop renderer in Chromium, with the production disk services behind an
   isolated IPC test bridge. This never reads the user's actual Loop profile. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright-core');
const {writeTaskData,readTaskData}=require('../app/main/storage.cjs');
const {readKnowledgeDocument,saveKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
const {readKnowledgeRecovery,writeKnowledgeRecovery,deleteKnowledgeRecovery}=require('../app/main/recovery.cjs');
const {stageKnowledgeAssets}=require('../app/main/knowledge-assets.cjs');
const {createKnowledgePathGate}=require('../app/main/knowledge-access.cjs');
const core=require('../app/renderer/src/knowledge-core.js');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const repository=path.resolve(__dirname,'..'),profile=await fs.mkdtemp(path.join(os.tmpdir(),'loop-knowledge-ui-'));
 let browser;const errors=[];let failFile=false,failStage=false,delayFile=0,delayUpload=0;
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(repository,'.'+pathname);
  if(!file.startsWith(repository+path.sep))return res.writeHead(403).end();
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':file.endsWith('.woff')?'font/woff':file.endsWith('.ttf')?'font/ttf':'text/html');res.end(await fs.readFile(file));}catch{res.writeHead(404).end();}
 });
 try{
  const original=(await fs.readFile(path.join(repository,'tests/fixtures/knowledge.md'),'utf8')).replace(/\r\n?/g,'\n');
  const aPath=path.join(profile,'原始笔记.md');await fs.writeFile(aPath,original);const aDisk=await readKnowledgeDocument(aPath);
  const windowsSource='# Windows\r\n\r\n- [ ] 中文😀\r\n\r\n## 定位\r\n尾行\r\n',dPath=path.join(profile,'Windows 换行.md');
  await fs.writeFile(dPath,windowsSource);const dDisk=await readKnowledgeDocument(dPath);
  const stamp=new Date().toISOString();
  await writeTaskData(profile,{version:2,knowledgeSchemaVersion:1,tasks:[
   {id:'a',title:'任务 A',notes:original,nodes:[],createdAt:stamp,updatedAt:stamp,knowledgeNote:{noteId:'note-a',title:'原始笔记',filePath:aPath,documentState:'SAVED',dirty:false,...aDisk}},
   {id:'b',title:'目标笔记',notes:'# 目标笔记\n\n## 目标标题\n\n可嵌入的段落\n第二行 ^sample-block\n',nodes:[],createdAt:stamp,updatedAt:stamp,knowledgeNote:{noteId:'note-b',title:'目标笔记',documentState:'DRAFT'}},
   {id:'c',title:'第三篇',notes:'# 第三篇\n\n独立内容',nodes:[],createdAt:stamp,updatedAt:stamp,knowledgeNote:{noteId:'note-c',title:'第三篇',documentState:'DRAFT'}},
   {id:'d',title:'Windows 换行',notes:windowsSource,nodes:[],createdAt:stamp,updatedAt:stamp,knowledgeNote:{noteId:'note-d',title:'Windows 换行',filePath:dPath,documentState:'SAVED',dirty:false,...dDisk}}
  ],attachments:{images:{'fixture-image':PNG}},taskGroups:[{id:'work',title:'开发',order:1}]});
  const gate=createKnowledgePathGate({userDataPath:profile,dataFilePath:path.join(profile,'task-data.json')});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,executablePath:process.env.LOOP_TEST_CHROMIUM||undefined,args:process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']:[]});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>{errors.push(e.message);console.error('PAGEERROR:',e.stack);});page.on('console',m=>{if(m.type()==='error')console.error('BROWSER:',m.text().slice(0,1000));});
  await page.exposeFunction('__knowledgeIPC',async(method,payload)=>{
   if(method==='storageRead')return readTaskData(profile);
   if(method==='storageWrite')return writeTaskData(profile,payload);
   if(method==='recoveryRead')return readKnowledgeRecovery(profile);
   if(method==='recoveryWrite')return writeKnowledgeRecovery(profile,payload);
   if(method==='recoveryDelete')return deleteKnowledgeRecovery(profile,payload);
   if(method==='stageAssets'){if(failStage)return {success:false,message:'模拟图片暂存失败'};if(delayUpload)await pause(delayUpload);return stageKnowledgeAssets(profile,payload);}
   if(method==='fileRead'){if(!(await gate.isAllowed(payload.filePath)))return {success:false,code:'PATH_NOT_ALLOWED'};return readKnowledgeDocument(payload.filePath);}
   if(method==='fileSave'){
    if(!(await gate.isAllowed(payload.filePath)))return {success:false,code:'PATH_NOT_ALLOWED'};
    if(delayFile)await pause(delayFile);
    if(failFile)return {success:false,code:'SAVE_FAILED',message:'模拟磁盘写入失败'};
    return saveKnowledgeDocument(payload);
   }
   return {success:true};
  });
  await page.addInitScript(()=>{
   const call=(name,payload)=>window.__knowledgeIPC(name,payload);
   window.personalTaskTrack={platform:'linux',appVersion:'0.1.232',
    storage:{read:()=>call('storageRead'),write:d=>call('storageWrite',d)},
    knowledgeRecovery:{read:()=>call('recoveryRead'),write:r=>call('recoveryWrite',r),delete:id=>call('recoveryDelete',id)},
    knowledgeFile:{read:p=>call('fileRead',p),save:p=>call('fileSave',p),stageAssets:p=>call('stageAssets',p),watch:async p=>{const receipt=await call('fileRead',p);if(receipt.success)window.__fileChange?.({...receipt,noteId:p.noteId,type:'baseline'});return receipt;},onChange:callback=>{window.__fileChange=callback;return ()=>{};},unwatch:async()=>({success:true})}
   };
  });
  const url=`http://127.0.0.1:${server.address().port}/app/renderer/index.html`;
  await page.goto(url);await page.waitForFunction(()=>typeof state!=='undefined'&&state.tasks.some(t=>t.id==='a'));
  async function choose(id){await page.evaluate(id=>knowledgeOpen(state.tasks.find(t=>t.id===id)),id);await page.waitForFunction(id=>knowledgeCurrentEntry(id)?.view && document.querySelector('.knowledge-pane')?.dataset.taskId===id,id,{timeout:5000}).catch(async error=>{console.log('CHOOSE DEBUG',await page.evaluate(()=>({active:state.activeTaskId,pane:state.taskPane,body:document.querySelector('.workspace')?.innerText.slice(0,1000),keys:[...milkdownEditors.keys()],errors:typeof dataProtectionMessage!=='undefined'?dataProtectionMessage:''})));throw error;});}
  const markdown=()=>page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
  const mode=async name=>{await page.locator(`[data-action="knowledge-mode"][data-mode="${name}"]`).click();await page.waitForFunction(name=>knowledgeCurrentEntry()?.mode===name,name);};
  const append=async text=>page.evaluate(text=>{const e=knowledgeCurrentEntry();e.view.dispatch({changes:{from:e.view.state.doc.length,insert:text},selection:{anchor:e.view.state.doc.length+text.length},userEvent:'input'});},text);
  const diskContains=async text=>{for(let i=0;i<100;i++){if((await fs.readFile(aPath,'utf8')).includes(text))return;await pause(50);}assert.fail('disk never received '+text);};
  console.log('UI check 0: CRLF, CR and mixed line endings survive modes, edits, asset migration and undo.');
  await choose('d');
  for(const name of ['edit','preview','source']){await mode(name);assert.equal(await markdown(),windowsSource);}
  assert.equal((await page.evaluate(()=>saveKnowledgeTask('d'))).success,true);
  assert.equal(await fs.readFile(dPath,'utf8'),windowsSource);
  await mode('preview');await page.locator('.kn-reading input[data-task-pos]').first().click();
  await mode('source');await append('\n新增中文😀\n');
  assert.equal((await page.evaluate(()=>saveKnowledgeTask('d'))).success,true);
  assert.equal(await fs.readFile(dPath,'utf8'),windowsSource.replace('- [ ]','- [x]')+'\r\n新增中文😀\r\n');
  await page.evaluate(async()=>{
    const assert=(ok,message)=>{if(!ok)throw new Error(message);};
    for(const separator of ['\r\n','\r','mixed']) {
      const source=separator==='mixed'?'# 格式\r\n\r\n中文😀\n尾行\r![图](task-image:test)\r\n':['# 格式','','中文😀','尾行','![图](task-image:test)',''].join(separator);
      const root=document.createElement('div');document.body.append(root);let changed='';
      const e=await LoopKnowledgeEditor.create({root,sourceMarkdown:source,mode:'source',noteId:'eol-test',onChange:text=>changed=text});
      for(const mode of ['edit','preview','source']){e.setMode(mode);assert(e.getMarkdown()===source,'mode changed '+separator);}
      const at=e.getEditorText().indexOf('中文');
      e.view.dispatch({changes:{from:at,insert:'编辑\n'},userEvent:'input'});
      const edited=source.replace('中文','编辑'+(separator==='mixed'?'\r\n':separator)+'中文');
      assert(e.getMarkdown()===edited&&changed===edited,'editing changed separators '+separator);
      e.format('undo');assert(e.getMarkdown()===source,'undo changed separators '+separator);
      e.format('redo');assert(e.getMarkdown()===edited,'redo changed separators '+separator);
      e.acceptSavedAssetReferences([{source:'task-image:test',relativePath:'./attachments/a.png'}]);
      assert(e.getMarkdown()===edited.replace('task-image:test','./attachments/a.png'),'asset migration changed separators '+separator);
      e.format('undo');assert(e.getMarkdown()===source.replace('task-image:test','./attachments/a.png'),'mapped undo changed separators '+separator);
      await e.destroy();root.remove();
    }
  });
  await choose('a');assert.equal(await markdown(),original);
  console.log('UI check 1: Same view and undo history in all three modes; no serialization at switches.');
  // Same view and undo history in all three modes; no serialization at switches.
  await page.evaluate(()=>window.__firstCM=knowledgeCurrentEntry().view);
  for(const name of ['source','preview','edit','preview','source','edit']){await mode(name);assert.equal(await markdown(),original);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().view===window.__firstCM),true);}
  await page.waitForSelector('.cm-line.kn-h1');
  assert.ok(await page.locator('.cm-line.kn-h1').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>24));
  await mode('preview');
  for(const selector of ['h1','h6','strong','em','s','mark','code','blockquote','table','img','.footnotes','.katex','.kn-callout','.kn-wiki','.kn-embed'])assert.ok(await page.locator('.kn-reading '+selector).count(),selector);
  await page.waitForSelector('.kn-reading .kn-mermaid svg',{timeout:10000}).catch(async e=>{console.log('DIAGRAM DEBUG',await page.locator('.kn-reading .kn-mermaid').evaluateAll(es=>es.map(el=>el.outerHTML)));throw e;});
  assert.equal(await page.locator('.kn-reading script').count(),0);
  assert.ok(!(await page.locator('.kn-reading').innerText()).includes('注释中的'));
  const security=await page.evaluate(async()=>{
    const renderer=knowledgeRendererForTask(state.tasks.find(t=>t.id==='a'));
    const html=renderer.render('<script>window.__noteXss=1</script>\n\n<img src=x onerror="window.__noteXss=1">\n\n[危险](javascript:alert(1))\n\n![私密](../private.png)');
    const root=document.createElement('div');root.innerHTML=html;document.body.append(root);
    const unsafe=[...root.querySelectorAll('script,[onerror],a[href^="javascript:"],img[src*="private"]')].length;
    root.innerHTML=renderer.render('有效正文\n\n```mermaid\nnot a diagram!!!\n```');await renderer.enhance(root);
    const fallback=root.textContent.includes('有效正文')&&root.textContent.includes('已保留源码');root.remove();
    return {unsafe,fallback,executed:window.__noteXss||0};
  });assert.deepEqual(security,{unsafe:0,fallback:true,executed:0});

  assert.match(await page.locator('.kn-reading .kn-embed-body').innerText(),/可嵌入的段落/);
  console.log('UI check 2: Checkbox edits the authoritative Markdown at the precise source offset.');
  // Checkbox edits the authoritative Markdown at the precise source offset.
  await page.locator('.kn-reading input[data-task-pos]').first().click();await diskContains('- [x] 尚未完成');
  await mode('source');
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();const at=e.getMarkdown().indexOf('中文输入');e.view.dispatch({selection:{anchor:at,head:at+4}});e.format('bold');});
  assert.match(await markdown(),/\*\*中文输入\*\*/);await page.evaluate(()=>knowledgeCurrentEntry().format('undo'));assert.ok(!(await markdown()).includes('**中文输入**'));
  await page.evaluate(()=>knowledgeCurrentEntry().format('redo'));assert.match(await markdown(),/\*\*中文输入\*\*/);
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({selection:{anchor:0}});e.openSearch();});
  await page.waitForSelector('.cm-search input[name="search"]');await page.locator('.cm-search input[name="search"]').fill('中文输入');
  await page.locator('.cm-search input[name="replace"]').fill('混合输入');await page.locator('.cm-search button[name="replaceAll"]').click();
  assert.match(await markdown(),/混合输入/);await page.locator('.cm-search [name="close"]').click();
  console.log('UI check 3: Real browser IME composition survives both internal and external autosave.');
  // Real browser IME composition survives both internal and external autosave.
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({selection:{anchor:e.view.state.doc.length}});e.view.focus();window.__imeDOM=e.view.contentDOM;});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition',{text:'中文候选',selectionStart:4,selectionEnd:4});await page.waitForTimeout(1400);
  assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().view.contentDOM===window.__imeDOM),true);
  await cdp.send('Input.insertText',{text:'中文候选😀'});await diskContains('中文候选😀');
  console.log('UI check 4: Lists: complete task does not propagate its checked state to a new item.');
  // Lists: complete task does not propagate its checked state to a new item.
  await append('\n\n- [x] 新建条目');await page.keyboard.press('End');await page.keyboard.press('Enter');assert.match(await markdown(),/- \[ \] $/);
  await page.keyboard.press('Enter');assert.ok(!(await markdown()).endsWith('- [ ] '));
  await append('\n- 第一层');await page.keyboard.press('Tab');assert.match(await markdown(),/    - 第一层$/);await page.keyboard.press('Shift+Tab');assert.match(await markdown(),/\n- 第一层$/);
  console.log('UI check 5: Completion is backed by the real note ID, and can be selected with a keyboard.');
  // Completion is backed by the real note ID, and can be selected with a keyboard.
  await append('\n\n[[');await page.keyboard.type('目标');await page.waitForSelector('.cm-tooltip-autocomplete');await page.keyboard.press('Enter');
  assert.match(await markdown(),/\[\[note:note-b\|目标笔记\]\]/);
  console.log('UI check 6: Modify a table via the same editor transaction and undo history.');
  // Modify a table via the same editor transaction and undo history.
  await page.evaluate(()=>{const e=knowledgeCurrentEntry(),at=e.getMarkdown().indexOf('| 一');e.view.dispatch({selection:{anchor:at+3}});e.table('column-add',1);});
  assert.equal(await page.evaluate(()=>LoopKnowledgeCore.tableAt(knowledgeCurrentEntry().getMarkdown(),knowledgeCurrentEntry().view.state.selection.main.head).rows[0].length),5);
  console.log('UI check 7: Upload anchor maps around text typed before the async staging reply.');
  // Upload anchor maps around text typed before the async staging reply.
  delayUpload=300;
  await page.evaluate(async png=>{
   const e=knowledgeCurrentEntry(),file=new File([Uint8Array.from(atob(png.split(',')[1]),c=>c.charCodeAt(0))],'粘贴.png',{type:'image/png'});
   e.view.dispatch({selection:{anchor:5}});window.__uploadPromise=e.upload(file,5);e.view.dispatch({changes:{from:0,insert:'上传期间输入\n'}});
  },PNG);
  await page.evaluate(()=>window.__uploadPromise);delayUpload=0;
  assert.ok((await markdown()).startsWith('上传期间输入\n'));assert.match(await markdown(),/!\[粘贴.png\]\(task-image:/);
  await page.waitForFunction(()=>knowledgeCurrentEntry().uploads.size===0);
  await page.evaluate(()=>saveKnowledgeTask('a'));
  await mode('preview');await page.waitForFunction(()=>[...document.querySelectorAll('.kn-reading img')].every(img=>img.complete&&img.naturalWidth>0));await mode('source');
  // Exercise actual paste/drop handlers, including visible failure and Retry.
  failStage=true;
  await page.evaluate(png=>{
    const file=new File([Uint8Array.from(atob(png.split(',')[1]),c=>c.charCodeAt(0))],'剪贴.png',{type:'image/png'}),data=new DataTransfer();data.items.add(file);
    knowledgeCurrentEntry().view.contentDOM.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));
  },PNG);
  await page.waitForSelector('.kn-upload-status button');assert.ok(!(await markdown()).includes('剪贴.png'));
  failStage=false;await page.locator('.kn-upload-status button').first().click();await page.waitForFunction(()=>knowledgeCurrentEntry().getMarkdown().includes('剪贴.png'));
  await page.evaluate(png=>{
    const e=knowledgeCurrentEntry(),file=new File([Uint8Array.from(atob(png.split(',')[1]),c=>c.charCodeAt(0))],'拖入.png',{type:'image/png'}),data=new DataTransfer();data.items.add(file);
    const rect=e.view.contentDOM.getBoundingClientRect();e.view.contentDOM.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data,clientX:rect.x+10,clientY:rect.y+10}));
  },PNG);
  await page.waitForFunction(()=>knowledgeCurrentEntry().getMarkdown().includes('拖入.png'));

  console.log('UI check 8: Failed autosave retains editor and recovery; Retry writes the exact draft.');
  // Failed autosave retains editor and recovery; Retry writes the exact draft.
  failFile=true;await append('\n保存失败保留');
  await page.waitForSelector('[data-kn-save-error]');assert.match(await markdown(),/保存失败保留/);
  const recovery=await readKnowledgeRecovery(profile);assert.match(recovery.records['note-a'].content,/保存失败保留/);
  failFile=false;await page.locator('[data-kn-save-error] button').first().click();await diskContains('保存失败保留');
  console.log("UI check 9: Saving A while switching to B may not change B's body or status.");
  // Saving A while switching to B may not change B's body or status.
  delayFile=250;await append('\nA 的第一版本');
  await page.evaluate(()=>{window.__saveA=saveKnowledgeTask('a');});await page.waitForTimeout(50);
  await append('\nA 保存期间继续输入');await page.evaluate(()=>{window.__saveA2=saveKnowledgeTask('a');});
  await choose('b');const bBefore=await markdown();await page.evaluate(()=>Promise.all([window.__saveA,window.__saveA2]));await diskContains('A 保存期间继续输入');assert.equal(await markdown(),bBefore);delayFile=0;
  await choose('a');
  await append('\nA 的第二版本');const many=await page.evaluate(async()=>await Promise.all([saveKnowledgeTask('a'),saveKnowledgeTask('a'),saveKnowledgeTask('a')]));assert.ok(many.every(r=>r.success));await diskContains('A 的第二版本');
  console.log('UI check 10: Concurrent external writer is rejected by the production hash compare.');
  // Concurrent external writer is rejected by the production hash compare.
  await fs.writeFile(aPath,'外部进程的新版本');await append('\n本地冲突稿');
  const conflict=await page.evaluate(()=>saveKnowledgeTask('a'));assert.equal(conflict.code,'EXTERNAL_CHANGE_REQUIRES_CONFIRMATION');assert.equal(await fs.readFile(aPath,'utf8'),'外部进程的新版本');assert.match(await markdown(),/本地冲突稿/);
  await page.evaluate(()=>saveKnowledgeTask('a',{allowExternalOverwrite:true}));await diskContains('本地冲突稿');
  console.log('UI check 11: Alias + stable ID links survive note-only rename and preserve ownership.');
  // Alias + stable ID links survive note-only rename and preserve ownership.
  await choose('b');await page.locator('[data-kn-action="rename"]').click();await page.locator('#kn-rename-title').fill('重命名目标');await page.locator('#kn-rename-commit').click();await page.waitForSelector('#kn-rename-title',{state:'detached'});
  assert.equal(await page.evaluate(()=>state.tasks.find(t=>t.id==='b').title),'目标笔记');
  assert.equal(await page.evaluate(()=>LoopKnowledgeCore.resolve('目标笔记',knowledgeNotes()).note.id),'b');
  await page.locator('[data-kn-action="panels"]').click();assert.match(await page.locator('.kn-side-panel').innerText(),/原始笔记/);
  console.log('UI check 12: Search and switch on Chinese text, create a real task-backed note.');
  // Search and switch on Chinese text, create a real task-backed note.
  await page.keyboard.press('Control+o');await page.locator('#kn-switcher-query').fill('知识笔记新建');await page.locator('#kn-create-note').click();
  await page.waitForFunction(()=>knowledgeCurrentEntry()?.getMarkdown().includes('# 知识笔记新建'));
  const createdId=await page.evaluate(()=>state.activeTaskId);await page.waitForTimeout(1700);
  const owner=await page.evaluate(()=>state.tasks.find(t=>t.id===state.activeTaskId).knowledgeNote.taskId);assert.equal(owner,createdId);
  console.log("UI check 13: Reuse Loop's real Recently Deleted transaction and restore operation.");
  // Reuse Loop's real Recently Deleted transaction and restore operation.
  const archive=await page.evaluate(async id=>{const r=await recovery26Transaction(()=>recovery26RemoveNote(id));render();return r;},createdId);
  assert.ok(archive);assert.equal(await page.evaluate(id=>state.tasks.find(t=>t.id===id).notes,createdId),'');assert.equal(await page.evaluate(id=>knowledgeNotes().some(t=>t.id===id),createdId),false);
  const archiveId=(await readTaskData(profile)).recentlyDeleted.find(n=>n.kind==='note'&&n.ownerTaskId===createdId).id;
  await page.evaluate(async id=>{await recovery26RestoreMany([id],{restoreMoved:true});},archiveId);
  assert.match((await readTaskData(profile)).tasks.find(t=>t.id===createdId).notes,/知识笔记新建/);
  console.log('UI check 14: Recover an unbound draft from disk after reload, not browser localStorage.');
  // Recover an unbound draft from disk after reload, not browser localStorage.
  await choose('c');await append('\n重启恢复内容');await page.evaluate(async()=>{captureMountedMilkdownDrafts();flushNodeNoteDrafts({persist:true});await flushPendingKnowledgeRecoveries({strict:true});await flushSave();});
  await page.reload();await page.waitForFunction(()=>state.tasks?.some(t=>t.id==='c'));await choose('c');assert.match(await markdown(),/重启恢复内容/);
  console.log('UI check 15: Long document: no editor replacement, no input-triggered shell render.');
  // Long document: no editor replacement, no input-triggered shell render.
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();window.__longDOM=e.view.contentDOM;window.__renderCount=0;const before=render;render=function(){window.__renderCount++;return before();};e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:('# 长文\n\n正文 **强调** 与 `代码`。\n\n').repeat(3000)}});});
  const performance=await page.evaluate(()=>{const e=knowledgeCurrentEntry(),times=[];for(let i=0;i<20;i++){const start=performance.now();e.view.dispatch({changes:{from:10,insert:'测'}});times.push(performance.now()-start);}return {max:Math.max(...times),same:e.view.contentDOM===window.__longDOM,renders:window.__renderCount};});
  assert.equal(performance.same,true);assert.equal(performance.renders,0);assert.ok(performance.max<250,JSON.stringify(performance));
  await choose('a');await page.evaluate(source=>{const e=knowledgeCurrentEntry();e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:source},selection:{anchor:source.indexOf('中文输入')}});},original);await mode('preview');
  const screenshots=process.env.LOOP_TEST_SCREENSHOT_DIR;
  if(screenshots){await fs.mkdir(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,'knowledge-reading.png')});await mode('edit');await page.waitForTimeout(250);await page.screenshot({path:path.join(screenshots,'knowledge-live.png')});}
  for(const theme of ['light','dark'])for(const width of [1024,1440]){
   await page.setViewportSize({width,height:900});await page.evaluate(theme=>{state.theme=theme;render();},theme);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: original Markdown, three modes, rich rendering, IME, history, find/replace, lists, completion, tables, async images, failure/retry/recovery, A/B race, concurrent saves, conflict detection, rename/backlinks, create/delete/restore, long document and light/dark responsive UI.');
  console.log('Long-document transaction timing:',performance);
 }finally{await browser?.close();await new Promise(r=>server.close(r));await fs.rm(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});

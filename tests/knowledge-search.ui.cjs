const wb=require('./workbench-helpers.cjs');
/* Real Electron and production storage, with isolated synthetic notes. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {_electron}=require('playwright-core');
const {writeTaskData}=require('../app/main/storage.cjs');
const source=path.resolve(__dirname,'..'),results=[],errors=[];
const original='# 行内查找验收\n\n测试第一行，测试第二处。\n\n中文 **测试** 与 Test test tester。\n\n'+Array.from({length:65},(_,i)=>`第 ${i+1} 行普通内容。`).join('\n')+'\n\n末尾测试，定位到对应行。\n';
let app,page,out;
async function mode(name){await wb.mode(page,name);await page.waitForFunction(name=>knowledgeCurrentEntry()?.mode===name,name);}
async function test(id,fn){try{await fn();results.push({id,status:'PASS'});}catch(e){results.push({id,status:'FAIL',error:e.stack});await page.screenshot({path:path.join(out,id+'-failure.png')});}console.log(JSON.stringify(results.at(-1)));}
(async()=>{
 const run=path.resolve(process.env.LOOP_SEARCH_QA_DIR||await fs.mkdtemp(path.join(os.tmpdir(),'loop-search-')));out=path.join(run,'evidence');await fs.mkdir(out,{recursive:true});
 const profile=path.join(run,'user-data'),stamp=new Date().toISOString();await fs.access(path.join(profile,'task-data.json')).then(()=>{throw Error('Refusing existing data')},()=>{});
 await writeTaskData(profile,{version:2,taskFilter:'all',activeTaskId:'a',tasks:[['a','行内查找与跳转',original],['b','第二篇笔记','# 第二篇\n\n独立内容与独立查找。\n']].map(([id,title,notes])=>({id,title,notes,nodes:[],createdAt:stamp,updatedAt:stamp,knowledgeNote:{noteId:'search-'+id,title,documentState:'DRAFT'}}))});
 const env={...process.env,LOOP_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:process.env.LOOP_APP_EXECUTABLE||require('electron'),args:process.env.LOOP_APP_EXECUTABLE?[]:[source],cwd:source,env});
 try{
  const runtime=await app.evaluate(async({app})=>{await app.whenReady();return {version:app.getVersion(),appPath:app.getAppPath(),userData:app.getPath('userData')};});
  assert.equal(runtime.version,require('../package.json').version);assert.equal(path.resolve(runtime.userData),profile);
  if(process.env.LOOP_APP_EXECUTABLE)assert.ok(runtime.appPath.endsWith('app.asar'));else assert.equal(runtime.appPath,source);
  await fs.writeFile(path.join(out,'runtime.json'),JSON.stringify(runtime,null,2));
  for(let i=0;i<150;i++){page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));if(page)break;await new Promise(r=>setTimeout(r,80));}
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  await page.locator('[data-task-row=a] .task-select').click();await page.locator('[data-pane=notes]').click();await page.waitForFunction(()=>knowledgeCurrentEntry()?.find);
  const input=page.locator('.kn-find [name=search]'),count=page.locator('.kn-find-count');
  const openFind=async()=>{if(!await input.isVisible())await page.locator('[data-kn-action=find]').click();};
  await test('S01-one-inline-entry-and-live-matches',async()=>{
   assert.equal(await page.locator('[data-kn-action=find]').count(),1);assert.equal(await page.locator('[data-kn-action=switcher]').getAttribute('aria-label'),'切换笔记');
   assert.equal(await input.isVisible(),false);assert.equal(await page.locator('[data-kn-action=find]').getAttribute('aria-expanded'),'false');
   await mode('source');assert.equal(await input.isVisible(),false);await openFind();assert.equal(await page.locator('[data-kn-action=find]').getAttribute('aria-expanded'),'true');
   await input.fill('测试');assert.equal(await count.innerText(),'1/4');assert.ok(await page.locator('.cm-searchMatch').count()>=3);assert.equal(await page.locator('[role=dialog]').count(),0);
   assert.equal(await input.evaluate(el=>el===document.activeElement),true);
   await input.press('Enter');assert.equal(await count.innerText(),'2/4');await input.press('Shift+Enter');assert.equal(await count.innerText(),'1/4');
   await page.locator('.kn-find [name=previous]').click();assert.equal(await count.innerText(),'4/4');
   const visible=await page.evaluate(()=>{const e=knowledgeCurrentEntry(),rect=e.view.coordsAtPos(e.view.state.selection.main.from),body=document.querySelector('.knowledge-body').getBoundingClientRect();return rect.top>=body.top&&rect.bottom<=body.bottom;});assert.equal(visible,true);
   await page.screenshot({path:path.join(out,'source-find.png')});
  });
  await test('S02-options-invalid-empty-composition',async()=>{
   await input.fill('test');assert.match(await count.innerText(),/\/3$/);await page.locator('.kn-find [name=caseSensitive]').click();assert.match(await count.innerText(),/\/2$/);
   await page.locator('.kn-find [name=wholeWord]').click();assert.equal(await count.innerText(),'1/1');
   await page.locator('.kn-find [name=regexp]').click();await input.fill('[');assert.equal(await count.innerText(),'无效正则');assert.equal(await input.getAttribute('aria-invalid'),'true');assert.equal(await page.locator('.kn-find [name=replaceAll]').isDisabled(),true);
   await input.fill('not-found');assert.equal(await count.innerText(),'无结果');await input.fill('');assert.equal(await count.innerText(),'');
   for(const name of ['caseSensitive','wholeWord','regexp'])await page.locator(`.kn-find [name=${name}]`).click();
   await input.dispatchEvent('compositionstart');await input.fill('测试');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});assert.equal(await count.innerText(),'');await input.dispatchEvent('compositionend');assert.match(await count.innerText(),/\/4$/);
  });
  await test('S03-replace-and-undo',async()=>{
   await page.locator('.kn-find [name=toggleReplace]').click();assert.equal(await page.locator('.kn-replace-row').isVisible(),true);await page.locator('.kn-find [name=replace]').fill('验证');
   await page.locator('.kn-find [name=replaceAll]').click();assert.equal(await count.innerText(),'无结果');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),original.replaceAll('测试','验证'));
   await page.evaluate(()=>knowledgeCurrentEntry().format('undo'));assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),original);assert.match(await count.innerText(),/\/4$/);
   await page.locator('.kn-find [name=close]').click();assert.equal(await input.inputValue(),'');assert.equal(await input.isVisible(),false);assert.equal(await page.locator('.cm-searchMatch').count(),0);
  });
  await test('S04-shortcut-reattach-modes-and-reading',async()=>{
   await mode('edit');await page.locator('.cm-content').focus();await page.keyboard.press('Control+f');assert.equal(await input.isVisible(),true);assert.equal(await input.evaluate(el=>el===document.activeElement),true);
   await input.press('Escape');assert.equal(await input.isVisible(),false);await page.locator('.cm-content').focus();await page.keyboard.press(process.platform==='darwin'?'Meta+f':'Control+f');assert.equal(await input.evaluate(el=>el===document.activeElement),true);
   await input.fill('测试');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().mode),'edit');
   await page.evaluate(()=>window.__searchView=knowledgeCurrentEntry().view);
   await mode('preview');assert.equal(await input.inputValue(),'测试');assert.match(await count.innerText(),/\/4$/);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().view===window.__searchView),true);
   const n=await page.evaluate(()=>CSS.highlights.get(knowledgeCurrentEntry().find.highlightKey)?.size);assert.equal(n,4);
   await page.locator('.kn-find [name=next]').click();await page.screenshot({path:path.join(out,'reading-find.png')});
   await input.press('Escape');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().mode),'preview');assert.equal(await input.inputValue(),'');assert.equal(await input.isVisible(),false);assert.equal(await page.locator('.knowledge-search-only').isVisible(),false);
   await openFind();await page.locator('.kn-find [name=close]').click();assert.equal(await input.isVisible(),false);
   await mode('source');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),original);
  });
  await test('S05-notes-remain-independent',async()=>{
   await openFind();await input.fill('测试');await page.locator('[data-task-row=b] .task-select').click();await page.waitForFunction(()=>knowledgeCurrentEntry()?.options.noteId==='search-b');assert.equal(await input.inputValue(),'');assert.equal(await input.isVisible(),false);await openFind();await input.fill('独立');assert.match(await count.innerText(),/\/2$/);
   await page.locator('[data-task-row=a] .task-select').click();await page.waitForFunction(()=>knowledgeCurrentEntry()?.options.noteId==='search-a');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),original);
  });
  await test('S06-layout-theme-and-keyboard',async()=>{
   for(const theme of ['light','dark'])for(const size of [[1024,680],[1440,900]]) {
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(...size),size);
    await page.evaluate(theme=>{state.theme=theme;render();},theme);await openFind();await input.fill('测试');await page.locator('.kn-find [name=toggleReplace]').click();
    const geometry=await page.locator('.kn-find').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.knowledge-pane').getBoundingClientRect();return {left:r.left,right:r.right,paneLeft:p.left,paneRight:p.right,overflow:document.documentElement.scrollWidth>innerWidth};});assert.ok(geometry.left>=geometry.paneLeft&&geometry.right<=geometry.paneRight);assert.equal(geometry.overflow,false);
    await page.screenshot({path:path.join(out,`layout-${theme}-${size[0]}.png`)});
    await input.press('Escape');
   }
   assert.deepEqual(errors,[]);
  });
  await test('S07-rendered-table-and-reading-replacement',async()=>{
   await mode('edit');
   await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:'# 表格查找\n\n| 名称 | 状态 |\n| --- | --- |\n| 匹配单元格 | 保留 |\n'}});});
   await openFind();await input.fill('匹配单元格');assert.equal(await count.innerText(),'1/1');assert.ok(await page.locator('.kn-table-widget').count()>0);
   assert.equal(await page.evaluate(()=>CSS.highlights.get(knowledgeCurrentEntry().find.highlightKey).size),1);
   await mode('preview');await input.fill('匹配单元格');assert.equal(await count.innerText(),'1/1');
   await page.locator('.kn-find [name=toggleReplace]').click();assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().mode),'source');
   await page.locator('.kn-find [name=replace]').fill('已替换单元格');await page.locator('.kn-find [name=replaceAll]').click();assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/已替换单元格/);
   await page.evaluate(()=>knowledgeCurrentEntry().format('undo'));assert.match(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),/匹配单元格/);
   assert.deepEqual(errors,[]);
  });
 }finally{await fs.writeFile(path.join(out,'results.json'),JSON.stringify({source,run,results,errors},null,2));await app.close();}
 if(results.some(r=>r.status==='FAIL')||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;app?.close().catch(()=>{});});

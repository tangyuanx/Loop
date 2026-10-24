/* Real Electron release-report regressions; all data and native picker answers
   are isolated. Never reads the user's Loop profile. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {_electron}=require('playwright-core');
const {writeTaskData}=require('../app/main/storage.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
const source=path.resolve(__dirname,'..');let app,page,out,run,files;const results=[],errors=[];
async function test(id,fn){try{await fn();results.push({id,status:'PASS'});}catch(e){results.push({id,status:'FAIL',error:e.stack});await page.screenshot({path:path.join(out,id+'-failure.png')}).catch(()=>{});}console.log(JSON.stringify(results.at(-1)));await fs.writeFile(path.join(out,'results.json'),JSON.stringify({run,source,results,errors},null,2));}
async function open(id='edit'){await page.evaluate(id=>knowledgeOpen(state.tasks.find(t=>t.id===id)),id);await page.waitForFunction(id=>knowledgeCurrentEntry(id)?.view&&document.querySelector('.knowledge-pane')?.dataset.taskId===id,id);}
async function reset(text,from=0,to=from,mode='edit'){await page.evaluate(({text,from,to,mode})=>{shellCloseOverlay({restoreFocus:false});const e=knowledgeCurrentEntry();e.setMode(mode);e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:text},selection:{anchor:from,head:to}});e.view.focus();},{text,from,to,mode});}
const text=()=>page.evaluate(()=>knowledgeCurrentEntry().getEditorText());
const focused=()=>page.evaluate(()=>knowledgeCurrentEntry().view.hasFocus);
async function insert(kind){await page.locator('[data-kn-action="insert-menu"]').click();await page.locator(`.kn-insert-menu [data-kn-format="${kind}"]`).click();}
async function prompt(id){await open(id);await page.locator('[data-action="knowledge-file-menu"]').click();await page.locator('[data-action="close-knowledge-editor"]').click();await page.locator('.knowledge-draft-dialog').waitFor();}
(async()=>{
 run=await fs.mkdtemp(path.join(os.tmpdir(),'loop-report-fixes-'));files=path.join(run,'files');out=path.join(run,'evidence');await fs.mkdir(files);await fs.mkdir(out);
 const stamp=new Date().toISOString(),ids=['edit','keep','delete','save','cancel','delete-task','delete-task-save','delete-task-keep','readonly','image'];
 const tasks=[];
 for(const id of ids){const notes='# '+id+'\n\n测试正文';let binding={};if(id==='readonly'){const filePath=path.join(files,'readonly.md');await fs.writeFile(filePath,notes);binding={...await readKnowledgeDocument(filePath),documentState:'SAVED',dirty:false};await fs.chmod(filePath,0o444);}tasks.push({id,title:id+' 所属任务',notes,nodes:[],createdAt:stamp,updatedAt:stamp,knowledgeNote:{noteId:'private-note-'+id,title:id,documentState:'DRAFT',...binding}});}
 await writeTaskData(path.join(run,'user-data'),{version:2,knowledgeSchemaVersion:1,taskFilter:'all',activeTaskId:'edit',tasks});
 const env={...process.env,LOOP_USER_DATA_DIR:path.join(run,'user-data')};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:process.env.LOOP_APP_EXECUTABLE||require('electron'),args:process.env.LOOP_APP_EXECUTABLE?[]:[source],cwd:source,env});
 try{
  for(let i=0;i<200;i++){page=app.windows().find(p=>p.url().endsWith('/app/renderer/index.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(page);page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.navigation');
  await app.evaluate(({dialog},files)=>{dialog.showSaveDialog=async()=>({canceled:!global.__reportSave,filePath:global.__reportSave||undefined});dialog.showMessageBox=async()=>({response:1});},files);
  await test('D1-dialog-visible-keyboard-cancel',async()=>{
    await prompt('cancel');
    for(const size of [[1024,680],[1440,900]]){await app.evaluate(({BrowserWindow},s)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(...s),size);const box=await page.locator('.knowledge-draft-dialog').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=size[1]&&box.x>=0);await page.screenshot({path:path.join(out,`draft-${size[0]}.png`)});}
    assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('knowledge-draft-dialog')),true);
    await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.knowledge-draft-dialog button').last().evaluate(e=>e===document.activeElement),true);
    await page.keyboard.press('Tab');assert.equal(await page.locator('.knowledge-draft-dialog button').first().evaluate(e=>e===document.activeElement),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('.knowledge-draft-dialog').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'knowledge-file-menu');
  });
  await test('D1-close-three-branches-and-save-cancel',async()=>{
    await prompt('keep');await page.locator('[data-action="keep-knowledge-draft"]').click();assert.equal(await page.evaluate(()=>state.taskPane),'flow');assert.match(await page.evaluate(()=>state.tasks.find(t=>t.id==='keep').notes),/测试正文/);
    await prompt('delete');await page.locator('[data-action="delete-knowledge-draft"]').click();await page.waitForFunction(()=>state.taskPane==='flow');assert.equal(await page.evaluate(()=>state.tasks.find(t=>t.id==='delete').notes),'');
    await prompt('save');await page.locator('[data-action="save-knowledge-before-close"]').click();assert.equal(await page.locator('.knowledge-draft-dialog').count(),1,'native save cancel keeps prompt and draft');
    const saved=path.join(files,'save.md');await app.evaluate((_e,p)=>{global.__reportSave=p},saved);await page.locator('[data-action="save-knowledge-before-close"]').click();await page.waitForFunction(()=>state.taskPane==='flow');assert.match(await fs.readFile(saved,'utf8'),/测试正文/);
  });
  await test('D1-delete-task-choices',async()=>{
    await open('delete-task');await page.evaluate(()=>deleteTask('delete-task'));await page.locator('.knowledge-draft-dialog').waitFor();await page.locator('[data-action="delete-knowledge-draft"]').click();await page.waitForSelector('.knowledge-draft-dialog',{state:'detached'});
    await page.locator('[data-recovery26=commit-delete]').click();await page.waitForFunction(()=>!state.tasks.some(t=>t.id==='delete-task'));
    await open('delete-task-keep');await page.evaluate(()=>deleteTask('delete-task-keep'));await page.locator('[data-action="keep-knowledge-draft"]').click();assert.ok(await page.evaluate(()=>state.tasks.find(t=>t.id==='delete-task-keep')?.notes));
    await open('delete-task-save');await page.evaluate(()=>deleteTask('delete-task-save'));const saved=path.join(files,'deleted-task.md');await app.evaluate((_e,p)=>{global.__reportSave=p},saved);await page.locator('[data-action="save-knowledge-before-delete"]').click();await page.waitForFunction(()=>!state.tasks.some(t=>t.id==='delete-task-save'));assert.match(await fs.readFile(saved,'utf8'),/测试正文/);
  });
  await test('D2-format-type-undo',async()=>{
    await open();
    for(const format of ['bold','italic','inline','bullet','task']){
      await reset('正文',0,2);await page.locator(`[data-action="note-format"][data-format="${format}"]`).click();assert.equal(await focused(),true,format+' retains focus');
      const formatted=await text();assert.notEqual(formatted,'正文');await page.keyboard.type('继续');assert.match(await text(),/继续/);await page.keyboard.press('ControlOrMeta+z');assert.equal(await text(),formatted);await page.keyboard.press('ControlOrMeta+z');assert.equal(await text(),'正文');
    }
    await reset('正文',0,2);await page.locator('.note-heading-select').click();await page.locator('.control22-option').filter({hasText:'标题 2'}).click();assert.equal(await focused(),true,'custom heading dropdown returns editor focus');await page.keyboard.type('继续');assert.match(await text(),/继续/);await page.keyboard.press('ControlOrMeta+z');assert.equal(await text(),'## 正文');
  });
  await test('D3-code-caret',async()=>{await reset('前文',2);await insert('code');await page.keyboard.type('const x = 1;');assert.match(await text(),/```text\nconst x = 1;\n```/);});
  await test('D4-table-caret-and-tab',async()=>{await reset('前文',2);await insert('table');await page.locator('.kn-table-cell-editor').waitFor();await page.keyboard.type('甲');await page.keyboard.press('Tab');await page.keyboard.type('乙');assert.deepEqual(await page.evaluate(()=>LoopKnowledgeCore.tableAt(knowledgeCurrentEntry().getEditorText(),knowledgeCurrentEntry().view.state.selection.main.head).rows[2]),['甲','乙']);});
  await test('D5-block-prefix-and-multiline',async()=>{
    for(const line of ['# 一级标题','> 引用','- 列表','- [ ] 任务']){await reset(line,0,line.length);await page.locator('[data-format="bold"]').click();const expected=line.replace(/([^ ]+)$/, '**$1**');assert.equal(await text(),expected);await page.locator('[data-format="bold"]').click();assert.equal(await text(),line);}
    const lines='# 标题\n\n> 引用\n- 列表';await reset(lines,0,lines.length);await page.locator('[data-format="italic"]').click();assert.equal(await text(),'# *标题*\n\n> *引用*\n- *列表*');
  });
  await test('D8-no-phantom-list-item',async()=>{for(const format of ['bullet','task']){const input='甲\n乙\n丙\n\n';await reset(input,0,input.length);await page.locator(`[data-format="${format}"]`).click();assert.equal((await text()).split('\n').filter(l=>l.startsWith('- ')).length,3);assert.ok((await text()).endsWith('\n\n'));}});
  await test('D12-grid-paste-and-undo',async()=>{
    await reset('段前\n\n| 一 | 二 |\n| --- | --- |\n| 旧 | 保留 |\n\n段后');await page.locator('.kn-table-widget tbody td').first().click();
    await page.locator('.kn-table-cell-editor').evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','甲1\t乙1\n甲2\t乙|2\n');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
    assert.equal(await text(),'段前\n\n| 一 | 二 |\n| --- | --- |\n| 甲1 | 乙1 |\n| 甲2 | 乙\\|2 |\n\n段后');
    await page.locator('.kn-table-cell-editor').waitFor();await page.keyboard.press('ControlOrMeta+z');assert.match(await text(),/\| 旧 \| 保留 \|/);
  });
  await test('D6-single-recovery-notice-D9-reload-receipt',async()=>{
    await open('readonly');await page.evaluate(async()=>{const e=knowledgeCurrentEntry();e.insertText('本地修改');await saveKnowledgeTask('readonly');});assert.equal(await page.locator('.knowledge-notice').count(),1);assert.equal(await page.locator('.knowledge-notice button').filter({hasText:'重试'}).count(),1);
    const file=path.join(files,'readonly.md');await fs.chmod(file,0o644);await fs.writeFile(file,'# 磁盘新内容');await page.evaluate(async()=>{await reloadKnowledgeTask('readonly');render();});assert.equal(await page.locator('[data-kn-receipt]').textContent(),'已保存到文件');assert.equal(await page.locator('[data-kn-save-error]').count(),0);assert.equal(await text(),'# 磁盘新内容');
  });
  await test('D7-no-internal-note-id',async()=>{await open();await page.locator('[data-kn-action="switcher"]').click();assert.doesNotMatch(await page.locator('.kn-switcher-list').innerText(),/private-note/);await page.keyboard.press('Escape');});
  await test('D10-D11-D14-theme-and-keyboard-states',async()=>{
    await reset('==高亮== 和 [[keep]]');
    for(const theme of ['light','dark'])for(const size of [[1024,680],[1440,900]]){
      await app.evaluate(({BrowserWindow},s)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(...s),size);
      await page.evaluate(theme=>{state.theme=theme;state.markdownMode='preview';render();},theme);await page.locator('.kn-reading mark').waitFor();const css=await page.locator('.kn-reading mark').evaluate(e=>({bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}));assert.notEqual(css.bg,'rgba(0, 0, 0, 0)');assert.equal(await page.locator('.kn-reading .kn-wiki').evaluate(e=>getComputedStyle(e).textDecorationLine),'underline');await page.screenshot({path:path.join(out,`reading-${theme}-${size[0]}.png`)});
    }
    await page.evaluate(()=>{state.markdownMode='edit';render()});await page.locator('.note-heading-select').focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.note-heading-select').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
  });
  await test('D13-portable-markdown-export',async()=>{
    await open('image');const md='文字\n\n![样本](task-image:report-image)\n',data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
    await reset(md);await page.evaluate(data=>{state.attachments.images['report-image']=data},data);await page.locator('[data-action="knowledge-file-menu"]').click();await page.locator('[data-action="export-knowledge-note"]').click();const exported=path.join(files,'portable.md');await app.evaluate((_e,p)=>{global.__reportSave=p},exported);await page.locator('#knowledge-export-download').click();await page.waitForSelector('#knowledge-export-download',{state:'detached'});assert.equal(await fs.readFile(exported,'utf8'),md.replace('task-image:report-image',data));assert.equal(await text(),md,'export never rewrites editor source');
  });
  assert.deepEqual(errors,[]);if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
 }finally{await app.close();console.log('Evidence: '+out);}
})().catch(e=>{console.error(e);process.exitCode=1;});

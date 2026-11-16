const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const {readKnowledgeDocument}=require('../app/main/knowledge-file.cjs');
const wb=require('./workbench-helpers.cjs'),mod=process.platform==='darwin'?'Meta':'Control';
async function main(){
 const evidence=await fs.mkdtemp(path.resolve('.local-review/input-literals-')),files=await fs.mkdtemp(path.join(os.tmpdir(),'loop-input-files-'));
 const literalSource=['# 特殊符号','','plain foo_bar file.name C:\\folder\\name 已有\\. 转义','','| 代码与符号 | 保留 |','| --- | --- |','| **bold** foo_bar file.name C:\\folder\\name \\_literal\\_ | `path\\_name` |',''].join('\r\n');
 const codeFile=path.join(files,'Inline.md'),literalFile=path.join(files,'Literals.md');await fs.writeFile(codeFile,'`alpha_beta`');await fs.writeFile(literalFile,literalSource);
 const note=async(id,file)=>{const disk=await readKnowledgeDocument(file);return task(id,{title:id,notes:disk.content,knowledgeNote:{...disk,title:id,documentState:'SAVED',dirty:false}});};
 let run=await launchRepository({activeTaskId:'inline',taskPane:'notes',tasks:await Promise.all([note('inline',codeFile),note('literals',literalFile)])},'input-literals');
 const cases=[];
 try{
  let {page}=run;await page.locator('[data-pane=notes]').click();await wb.minimizeTaskInfo(page);await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);
  const cdp=await page.context().newCDPSession(page);
  for(const edited of [false,true])for(const inside of [false,true])for(const input of ['space','text','composition','composition-space']){
   await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({changes:{from:0,to:e.view.state.doc.length,insert:'`alpha_beta`'},selection:{anchor:0}});e.view.focus();});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.locator('.kn-inline-code').click();await page.keyboard.press('End');
   if(edited){await page.keyboard.press('ArrowLeft');await page.keyboard.insertText('X');if(!inside)await page.keyboard.press('ArrowRight');}
   else if(inside)await page.keyboard.press('ArrowLeft');
   const before=await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
   if(input.startsWith('composition')){
    const text=input==='composition'?'中文':' ';
    await cdp.send('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});await cdp.send('Input.insertText',{text});
   }else if(input==='space')await page.keyboard.press('Space');else await page.keyboard.insertText('中文');
   const after=await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
   assert.ok(after.includes(edited?'alpha_betaX':'alpha_beta'),JSON.stringify({edited,inside,input,before,after}));
   assert.ok(after.startsWith(inside?before.slice(0,-1):before),JSON.stringify({edited,inside,input,before,after}));
   await page.keyboard.press(mod+'+z');assert.ok((await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown())).includes('alpha_beta'));
   await page.keyboard.press(mod+'+Shift+z');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),after);
   cases.push({edited,inside,input,before,after});
  }
  await page.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({changes:{from:e.view.state.doc.length,insert:'\n\n| Code |\n| --- |\n| `cell_alpha` |'}});});
  for(const input of ['space','text','composition']){
   const cell=page.locator('.kn-table-widget tbody td').first();await cell.click();await page.keyboard.press('End');
   if(input==='space')await page.keyboard.press('Space');
   else if(input==='text')await page.keyboard.insertText('中文');
   else{await cdp.send('Input.imeSetComposition',{text:'输入',selectionStart:2,selectionEnd:2});await cdp.send('Input.insertText',{text:'输入'});}
   const after=await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());assert.ok(after.includes('cell_alpha'),after);assert.ok(after.includes('alpha_betaX'),after);
   cases.push({table:true,input,after});await page.keyboard.press('Enter');await page.waitForFunction(()=>!knowledgeCurrentEntry().activeTableCell);
  }
  const expectedCode=await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());assert.equal((await page.evaluate(()=>saveKnowledgeTask('inline'))).success,true);assert.equal(await fs.readFile(codeFile,'utf8'),expectedCode);
  await page.evaluate(()=>knowledgeOpen(state.tasks.find(t=>t.id==='literals')));await page.waitForFunction(()=>knowledgeCurrentEntry()?.options.noteId==='literals');
  const stats=await fs.stat(literalFile);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),literalSource);
  const cell=page.locator('.kn-table-widget tbody td').first();await cell.click({position:{x:10,y:12}});await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),literalSource);assert.equal((await fs.stat(literalFile)).mtimeMs,stats.mtimeMs);
  await cell.click({position:{x:10,y:12}});await page.keyboard.press('End');await page.keyboard.insertText(' 尾巴');
  const editedText=await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown());
  assert.ok(editedText.includes('foo_bar file.name C:\\folder\\name'),editedText);assert.ok(!editedText.includes('foo\\_bar'),editedText);
  assert.equal(await cell.locator('.kn-table-cell-visual').innerText(),String.raw`bold foo_bar file.name C:\folder\name _literal_ 尾巴`);
  await page.keyboard.press(mod+'+z');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),literalSource);
  await page.keyboard.press(mod+'+Shift+z');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),editedText);
  await page.keyboard.press('Enter');await page.waitForFunction(()=>!knowledgeCurrentEntry().activeTableCell);
  assert.equal((await page.evaluate(()=>saveKnowledgeTask('literals'))).success,true);assert.equal(await fs.readFile(literalFile,'utf8'),editedText);
  await wb.mode(page,'source');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),editedText);await wb.mode(page,'edit');
  for(const theme of ['light','dark']){await page.evaluate(theme=>{state.theme=theme;render();},theme);await page.screenshot({path:path.join(evidence,theme+'.png')});}
  await page.evaluate(async()=>{save();await flushSave();});const saved=JSON.parse(await fs.readFile(path.join(run.profile,'task-data.json'),'utf8')),errors=run.errors.slice();
  await run.close();run=await launchRepository(saved,'input-literals-reopen');page=run.page;
  await page.locator('[data-pane=notes]').click();await page.waitForFunction(()=>knowledgeCurrentEntry()?.view);assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),editedText);
  await page.evaluate(()=>knowledgeOpen(state.tasks.find(t=>t.id==='inline')));await page.waitForFunction(()=>knowledgeCurrentEntry()?.options.noteId==='inline');assert.equal(await page.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),expectedCode);
  assert.deepEqual(errors.concat(run.errors),[]);await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({passed:true,cases,files,checks:'native pointer/keyboard, CDP composition, code boundaries, undo/redo, literal punctuation, paths, original bytes on open, CRLF, disk and process reopen'},null,2));console.log(JSON.stringify({passed:true,evidence,cases:cases.length}));
 }finally{await run.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

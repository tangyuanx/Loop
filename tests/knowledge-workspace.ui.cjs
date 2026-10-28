/* Real Electron + production IPC. Synthetic notes/profile only; composition
 * events cover guards, not a claim of manual operating-system IME testing. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {launchRepository,task} = require('./electron-ui-helpers.cjs');
const wb = require('./workbench-helpers.cjs');
const out = path.resolve(process.env.LOOP_STAGE4_QA_DIR || '.local-review/frontend-remediation/stage-04/workspace');
const original = '# 工作记录\r\n\r\n原文与 **重点**。\r\n\r\n| 项目 | 结论 |\r\n| --- | --- |\r\n| 编辑 | 保真 |\r\n\r\n[[另一份笔记]]\r\n';
const long = Array.from({length:600},(_,i)=>`## 标题 ${i+1}\n\n第 ${i+1} 段，长笔记需要保持选区、滚动和撤销。`.repeat(1)).join('\n\n');
const results = {checks:[],inputs:[],performance:null,errors:[]};
let h;
async function settle(p) { await p.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}); }
async function choose(p,id) { await p.locator(`[data-task-row="${id}"] .task-select`).click();await p.locator('[data-pane="notes"]').click();await p.waitForFunction(id=>knowledgeCurrentEntry(id)?.view&&document.querySelector('.knowledge-pane')?.dataset.taskId===id,id); }
function neutral(css,label) {
  for(const key of ['borderTopColor','borderBottomColor','outlineColor','boxShadow']) {
    if(key==='outlineColor'&&css.outlineStyle==='none')continue;
    for(const match of css[key].matchAll(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/g)) {
      if(match[4]==='0')continue;
      const [r,g,b]=match.slice(1,4).map(Number);assert.ok(!(g>r+6&&g>b+6),label+' has a green '+key+': '+css[key]);
    }
  }
}
(async()=>{
 await fs.mkdir(out,{recursive:true});
 h=await launchRepository({activeTaskId:'note',tasks:[task('note',{title:'工作记录',notes:original}),task('other',{title:'另一份笔记',notes:'# 另一份笔记\n\n独有目标正文\n\n[[工作记录]]'}),task('long',{title:'长笔记',notes:long}),task('empty',{title:'空笔记',notes:''})]},'stage04');
 const {app,page:p}=h;p.on('pageerror',e=>results.errors.push(e.message));
 try {
  results.runtime=await app.evaluate(({app})=>({appPath:app.getAppPath(),userData:app.getPath('userData'),versions:process.versions}));
  await choose(p,'note');await p.evaluate(()=>{globalThis.__stage4Editor=knowledgeCurrentEntry();globalThis.__stage4View=knowledgeCurrentEntry().view;});
  for(const value of ['source','preview','edit'])await wb.mode(p,value);
  for(const width of ['wide','full','default'])await wb.width(p,width);
  await wb.panels(p);await p.locator('.kn-side-panel').waitFor();assert.equal(await p.locator('.kn-backlink').count(),1);
  await p.locator('[data-wb-action="focus"]').click();assert.equal(await p.locator('.navigation').isVisible(),false);await p.keyboard.press('Escape');assert.equal(await p.locator('.navigation').isVisible(),true);
  await p.locator('[data-pane="flow"]').click();await p.locator('[data-pane="notes"]').click();
  await choose(p,'other');await choose(p,'note');
  assert.equal(await p.evaluate(()=>knowledgeCurrentEntry()===globalThis.__stage4Editor&&knowledgeCurrentEntry().view===globalThis.__stage4View),true);
  assert.equal(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),original);
  await p.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({selection:{anchor:0}});e.view.focus()});
  await p.keyboard.type('undo-marker');await wb.mode(p,'source');await wb.width(p,'wide');
  await p.evaluate(()=>knowledgeCurrentEntry().view.focus());await p.keyboard.press('ControlOrMeta+z');assert.equal(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),original);
  await p.keyboard.press('ControlOrMeta+Shift+z');assert.ok((await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown())).startsWith('undo-marker'));
  await p.keyboard.press('ControlOrMeta+z');await p.evaluate(()=>saveKnowledgeTask('note'));
  results.checks.push('CRLF/source unchanged; same editor/view through modes, width, panels, focus, tasks and panes; native keyboard Undo/Redo');
  await wb.width(p,'full');await wb.mode(p,'source');await p.evaluate(()=>flushSave());await p.reload();await p.locator('.app').waitFor();await choose(p,'note');
  assert.deepEqual(await p.evaluate(()=>[state.markdownMode,state.knowledgeWidth]),['source','full']);
  assert.equal(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),original);
  await p.evaluate(()=>localStorage.setItem('loop-knowledge-editor-preferences','{"mode":"unknown","width":"__proto__"}'));await p.reload();await p.locator('.app').waitFor();await choose(p,'note');
  assert.deepEqual(await p.evaluate(()=>[state.markdownMode,state.knowledgeWidth]),['source','full'],'published global preferences take priority over an old local cache');
  await p.evaluate(()=>flushSave());
  await app.evaluate(async({app})=>{const fs=process.mainModule.require('node:fs/promises'),path=process.mainModule.require('node:path'),file=path.join(app.getPath('userData'),'task-data.json');const data=JSON.parse(await fs.readFile(file,'utf8'));data.markdownMode='unknown';data.knowledgeWidth='__proto__';await fs.writeFile(file,JSON.stringify(data));});
  await p.reload();await p.locator('.app').waitFor();await choose(p,'note');
  assert.deepEqual(await p.evaluate(()=>[state.markdownMode,state.knowledgeWidth]),['edit','default']);
  results.checks.push('mode/width survive reload via global preferences; stale local cache cannot override them; invalid disk values safely fall back');
  await p.locator('[data-kn-action="switcher"]').click();const query=p.locator('#kn-switcher-query');await query.fill('独有目标正文');
  await query.dispatchEvent('compositionstart');await query.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});assert.equal(await query.count(),1);
  await query.dispatchEvent('compositionend');await query.press('Enter');await p.waitForFunction(()=>state.activeTaskId==='other');await choose(p,'note');
  results.checks.push('switcher composition confirm does not open/create note; committed Enter opens matching real note');
  const readCSS=el=>{const s=getComputedStyle(el);return Object.fromEntries(['backgroundColor','borderTopColor','borderBottomColor','outlineColor','outlineStyle','boxShadow','fontFamily'].map(k=>[k,s[k]]));};
  for(const theme of ['light','dark']) {
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1280,820));
   await p.evaluate(t=>{state.theme=t;render()},theme);await wb.mode(p,'edit');
   await p.locator('[data-kn-action="find"]').click();await p.locator('.kn-find [name=toggleReplace]').click();
   for(const selector of ['.kn-find input[name=search]','.kn-find input[name=replace]']) {
    const el=p.locator(selector);let parentBackground;for(const interaction of ['default','hover','focus']) {
     if(interaction==='default')await el.evaluate(e=>e.blur());if(interaction==='hover')await el.hover();if(interaction==='focus')await el.focus();
     const css=await el.evaluate(readCSS),parent=await el.locator('..').evaluate(readCSS);neutral(css,selector);neutral(parent,selector+' parent');results.inputs.push({theme,selector,interaction,css,parent});
     if(selector.includes('name=search'))assert.equal(css.backgroundColor,'rgba(0, 0, 0, 0)','search input stays transparent in every state');
     if(interaction==='default')parentBackground=parent.backgroundColor;
     assert.equal(parent.backgroundColor,parentBackground,'search parent keeps the same surface on hover/focus');
    }
   }
   await p.keyboard.press('Escape');await p.evaluate(()=>knowledgeCurrentEntry().view.focus());
   const cm=await p.locator('.cm-content').evaluate(readCSS);neutral(cm,'CodeMirror');assert.notEqual(cm.boxShadow,'none','neutral keyboard focus remains visible');
   await p.locator('.kn-table-widget tbody td').first().click();const cell=p.locator('.kn-table-cell-editor');await cell.waitFor();const css=await cell.evaluate(readCSS);neutral(css,'table');assert.equal(css.backgroundColor,'rgba(0, 0, 0, 0)');
   await p.keyboard.press('Escape');await settle(p);await p.screenshot({path:path.join(out,theme+'-edit.png')});
   await wb.mode(p,'preview');await wb.panels(p);await settle(p);await p.screenshot({path:path.join(out,theme+'-reading-panels.png')});
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1024,680));await settle(p);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.join(out,theme+'-1024.png')});
   await p.locator('.kn-side-panel [data-kn-action="panels"]').click();await wb.mode(p,'source');await p.screenshot({path:path.join(out,theme+'-source.png')});
  }
  results.checks.push('light/dark 1280/1024; search default/hover/focus + parents; CodeMirror keyboard cue; transparent table editing; reading/source/outline');
  await choose(p,'empty');await wb.mode(p,'edit');await p.screenshot({path:path.join(out,'empty.png')});
  const start=performance.now();await choose(p,'long');await settle(p);const openMs=performance.now()-start;
  const measure=await p.evaluate(async()=>{const e=knowledgeCurrentEntry(),body=document.querySelector('.knowledge-body');globalThis.__longEntry=e;const doc=e.getMarkdown();body.scrollTop=body.scrollHeight*.6;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const before=body.scrollTop;const samples=[];for(let i=0;i<6;i++){const t=performance.now();render();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));samples.push(performance.now()-t)}return {characters:doc.length,lines:e.view.state.doc.lines,dom:document.querySelectorAll('*').length,scrollBefore:before,scrollAfter:document.querySelector('.knowledge-body').scrollTop,renderTwoFramesMs:samples,sameEntry:knowledgeCurrentEntry()===globalThis.__longEntry};});
  assert.equal(measure.sameEntry,true);assert.ok(Math.abs(measure.scrollAfter-measure.scrollBefore)<4);
  const text=await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown());await wb.mode(p,'preview');await wb.mode(p,'source');await wb.mode(p,'edit');assert.equal(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),text);
  await p.evaluate(()=>{const e=knowledgeCurrentEntry();e.view.dispatch({selection:{anchor:e.view.state.doc.length}});e.view.focus()});const inputStart=performance.now();await p.keyboard.type('perf-marker');await settle(p);const inputMs=performance.now()-inputStart;await p.keyboard.press('ControlOrMeta+z');assert.equal(await p.evaluate(()=>knowledgeCurrentEntry().getMarkdown()),text);
  results.performance={openMs,inputMs,...measure};results.checks.push('600-heading long note: modes preserve text; repeated render keeps view/scroll; physical-keyboard API input undone');
  await p.evaluate(()=>saveKnowledgeTask(state.activeTaskId));await fs.copyFile(path.join(h.profile,'task-data.json'),path.join(out,'verified-task-data.json'));
  assert.deepEqual(results.errors,[]);results.passed=true;
 } catch(error) {results.failure=error.stack;await p.screenshot({path:path.join(out,'failure.png')});throw error;
 } finally {await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));await h.close();}
 console.log(JSON.stringify({passed:results.passed,checks:results.checks,performance:results.performance}));
})().catch(error=>{console.error(error);process.exitCode=1});

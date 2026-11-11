// The real task workspace: editor continuity, tree accessibility and persistence.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const node = (id, children=[], extra={})=>({id,title:id,status:'todo',note:'记录 '+id,children,...extra});
const settle = page => page.evaluate(async()=>{
 await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().endTime!==Infinity).map(a=>a.finished.catch(()=>{})));
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
});
(async()=>{
 let run;
 try{
  let deep=node('depth-12');for(let i=11;i>=0;i--)deep=node('depth-'+i,[deep]);
  run=await launchRepository({tasks:[task('work',{nodes:[node('parent',[node('child',[node('grandchild')]),node('sibling')]),node('other'),deep,
   node('big',Array.from({length:200},(_,i)=>node('large-'+i)))]}),task('second')]},'task-workspace');
  const {app,page,profile,errors}=run;
  const title=id=>page.locator(`.node-title[data-node-id="${id}"]`),collapse=id=>page.locator(`.collapse[data-node-id="${id}"]`);
  const openRecord=async id=>{
   await title(id).click();
   await page.locator(`.node-record-action[data-node-id="${id}"]`).click();
   await page.locator(`.node-record-window[data-node-id="${id}"]`).waitFor();
   await settle(page);
  };
  const brief=page.locator('[data-brief21-key="work:description"]');
  // Empty briefs start collapsed. Enter through the same visible control as
  // the user; focusing a hidden textarea silently leaves focus on <body>.
  const briefToggle=page.locator('[data-brief21-toggle]');
  assert.equal(await briefToggle.getAttribute('aria-expanded'),'false');
  await briefToggle.click();await brief.waitFor({state:'visible'});
  await brief.click();assert.equal(await brief.evaluate(e=>e===document.activeElement),true);
  await page.keyboard.insertText('会话第一段');
  await page.evaluate(()=>render());assert.equal(await brief.evaluate(e=>e===document.activeElement),true,'render retains the visible brief focus');
  await page.keyboard.insertText('，第二段');await page.evaluate(()=>render());
  assert.equal(await brief.inputValue(),'会话第一段，第二段');
  assert.equal(await page.evaluate(()=>shellActiveTask().history.filter(e=>e[1]==='更新任务背景').length),0,'rerenders keep the editing session open');
  await brief.dispatchEvent('keydown',{key:'Escape',isComposing:true});assert.equal(await brief.evaluate(e=>e===document.activeElement),true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.activeElement.matches('.brief21-input'));
  assert.equal(await page.evaluate(()=>shellActiveTask().history.filter(e=>e[1]==='更新任务背景').length),1,'one changed session produces one history entry');
  await brief.focus();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.activeElement.matches('.brief21-input'));assert.equal(await page.evaluate(()=>shellActiveTask().history.filter(e=>e[1]==='更新任务背景').length),1,'unchanged session leaves no history');
  await title('child').focus();await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.nodeId),'grandchild');
  await page.evaluate(()=>{toggleNodeCollapse('work','parent');render();});
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('collapse')&&document.activeElement.dataset.nodeId==='parent'),true,'collapsing a focused descendant returns focus to its parent');
  assert.equal(await page.evaluate(()=>document.querySelector('[data-branch-node="parent"]').inert),true);
  await settle(page);assert.equal(await title('child').count(),0,'closed subtree is removed after its exit');
  await collapse('parent').click();await settle(page);await title('parent').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.nodeId),'child');
  // Interrupt a small branch transition, then leave no hidden focus or animation.
  await page.evaluate(()=>{toggleNodeCollapse('work','parent');render();toggleNodeCollapse('work','parent');render();});await settle(page);
  assert.equal(await title('grandchild').isVisible(),true);
  await collapse('big').click();assert.equal(await page.locator('[data-branch-node="big"] .flow-row').count(),0,'large branches skip retained outgoing DOM');
  await page.emulateMedia({reducedMotion:'reduce'});await collapse('parent').click();
  assert.equal(await title('child').count(),0);assert.equal(await page.evaluate(()=>document.querySelector('[data-branch-node="parent"]').getAnimations().length),0);
  await collapse('parent').click();await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>window.LoopContinuity28.restorePreferences({continuous:false,follow:false}));
  await collapse('parent').click();assert.equal(await title('child').count(),0);
  await collapse('parent').click();await page.evaluate(()=>window.LoopContinuity28.restorePreferences({continuous:true,follow:false}));
  await openRecord('child');const record=page.locator('[data-shell-node-record]');
  await record.focus();await record.evaluate(e=>e.setSelectionRange(e.value.length,e.value.length));await page.keyboard.type(' undo');
  await page.evaluate(()=>{window.__record=document.querySelector('[data-shell-node-record]');render()});
  assert.equal(await page.evaluate(()=>window.__record===document.querySelector('[data-shell-node-record]')),true,'native textarea survives a same-node render');
  assert.match(await record.inputValue(),/undo/);await page.keyboard.press('Meta+z');assert.equal(await record.inputValue(),'记录 child','record Undo survives render');
  await page.keyboard.press('Meta+Shift+z');assert.equal(await record.inputValue(),'记录 child undo','Redo uses the same draft path');
  await page.keyboard.press('Meta+z');
  await page.keyboard.insertText('，切换前的未保存草稿');await openRecord('other');
  assert.match(await page.evaluate(()=>findNode(shellActiveTask().nodes,'child').note),/未保存草稿/);
  await openRecord('child');assert.equal(await page.evaluate(()=>window.__record===document.querySelector('[data-shell-node-record]')),true);
  await record.fill('长记录\n'.repeat(180));await record.evaluate(e=>{e.scrollTop=450;e.setSelectionRange(10,20);e.focus()});
  await page.evaluate(()=>render());assert.equal(await record.evaluate(e=>e.selectionStart),10);assert.equal(await record.evaluate(e=>e.scrollTop),450);
  await openRecord('other');await openRecord('child');
  assert.equal(await record.evaluate(e=>e.scrollTop),450,'each record keeps its own textarea scroll');
  await page.evaluate(()=>{window.__recordBeforeReplacement=document.querySelector('[data-shell-node-record]');state.tasks=normalizeTasks(structuredClone(state.tasks));render()});
  assert.equal(await page.evaluate(()=>window.__recordBeforeReplacement===document.querySelector('[data-shell-node-record]')),false,'a replaced/restored model cannot inherit another edit journal');
  // The current record is a non-modal float; the retired inspector/reading
  // drawer must not return or make the real processing tree inert.
  assert.equal(await page.locator('.inspector,.flow-drawer,.flow-reading').count(),0);
  assert.equal(await page.locator('.flow-pane').evaluate(e=>e.inert),false);
  await page.locator('[data-action="close-node-detail"]').click();await settle(page);
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('node-title')&&document.activeElement.dataset.nodeId==='child'),true);
  await title('depth-12').scrollIntoViewIfNeeded();await title('depth-12').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement.dataset.nodeId),'depth-11');
  const originalSubtree = await page.evaluate(()=>structuredClone(findNode(shellActiveTask().nodes,'parent')));
  await title('parent').scrollIntoViewIfNeeded();await title('parent').click({button:'right'});
  await page.getByRole('menuitem',{name:'删除节点…'}).click();
  await page.locator('[data-recovery26="commit-delete"]').click();
  await page.waitForFunction(()=>!findNode(shellActiveTask().nodes,'parent'));
  await page.locator('[data-recovery26="undo"]').click();
  await page.waitForFunction(()=>findNode(shellActiveTask().nodes,'parent'));
  assert.deepEqual(await page.evaluate(()=>findNode(shellActiveTask().nodes,'parent')),originalSubtree,'deletion Undo restores the exact subtree and records');
  assert.equal(await page.locator('[data-action="focus-next-pending"]').count(),0,'next-pending navigation has been removed');
  // Persist and compare the complete real tree, including parentId/order/notes.
  const saved=await page.evaluate(async()=>{flushNodeNoteDrafts({persist:true});await flushSave();return structuredClone(shellActiveTask().nodes)});
  const disk=JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8'));assert.deepEqual(disk.tasks.find(t=>t.id==='work').nodes,saved);
  await page.reload();await page.locator('.flow-scroll').waitFor();assert.deepEqual(await page.evaluate(()=>shellActiveTask().nodes),saved);
  for(const theme of ['light','dark']){
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1024,720));
   await page.evaluate(theme=>{state.theme=theme;render()},theme);await settle(page);
   await title('child').focus();await page.keyboard.press('Enter');
   await page.locator(`.node-record-action[data-node-id="child"]`).press('Enter');await settle(page);
   assert.equal(await page.locator('.node-record-window').getAttribute('aria-modal'),'false');
   const styles=await record.evaluate(e=>{const c=getComputedStyle(e),p=getComputedStyle(e.closest('.node-record-window'));return {background:c.backgroundColor,outline:c.outlineStyle,surface:c.getPropertyValue('--list').trim(),parent:p.outlineStyle}});
   assert.equal(styles.background,await record.evaluate(e=>{const sample=document.createElement('span');sample.style.color='var(--list)';e.parentElement.append(sample);const value=getComputedStyle(sample).color;sample.remove();return value}));
   await record.focus();
   const focus=await record.evaluate(e=>({outline:getComputedStyle(e).outlineStyle,shadow:getComputedStyle(e).boxShadow}));
   assert.equal(focus.outline,'none');assert.notEqual(focus.shadow,'none','record keeps a visible neutral focus cue');assert.equal(styles.parent,'none');
   await page.keyboard.press('Escape');await settle(page);
  }
  assert.deepEqual(errors,[]);
  console.log('Task workspace passed: visible brief focus and one session/history, IME shortcut protection, deep-tree keyboard/focus, transient Grid pruning/interruption/reduced motion/preferences, bounded record Undo/Redo/selection/drafts/scroll, non-modal float/keyboard/Escape, exact parentId/order/notes persistence, light/dark.');
 }catch(error){
  if(run) console.error('Workspace failure state',await run.page.evaluate(()=>({task:state.activeTaskId,node:state.selectedNodeId,pane:state.taskPane,reading:state.nodeDetailFullscreen,overlay:document.querySelector('#overlay')?.textContent,active:document.activeElement?.outerHTML.slice(0,1200),briefHidden:document.querySelector('.brief')?.hidden,brief:document.querySelector('.brief21-input')?.value})),run.errors);
  throw error;
 }finally{await run?.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

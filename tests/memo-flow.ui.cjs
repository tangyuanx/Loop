const assert=require('node:assert/strict');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
(async()=>{
 const h=await launchRepository({activeTaskId:'flow',tasks:[task('flow',{title:'处理流验收',conclusion:'任务结论',nodes:[{id:'parent',title:'父节点',status:'todo',conclusion:'节点结论',children:[{id:'child',title:'子节点',status:'todo',children:[]}]}]})]},'memo-flow');
 const {app,page:p}=h;
 const settings=p.locator('[data-action="toggle-settings"]');
 const manage=p.locator('.settings-content [data-action="manage-node-states"]');
 async function openStatusSettings(){
  await settings.click();
  await p.locator('[data-action="set-settings-page"][data-page="tasks"]').click();
  await manage.click();
 }
 async function closeStatusSettings(){
  await p.locator('.knowledge-dialog [data-action="close-dialog"]').last().click();
  assert.equal(await manage.evaluate(el=>el===document.activeElement),true);
  await settings.click();
 }
 try{
  await p.locator('[data-flow-column-resizer]').waitFor();
  await p.locator('.node-title[data-node-id="parent"]').waitFor();await p.waitForFunction(()=>state.activeTaskId==='flow');
  await p.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().endTime!==Infinity).map(a=>a.finished.catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  const handle=p.locator('[data-flow-column-resizer]');const before=await p.locator('.flow-column-head > span').first().boundingBox();const rect=await handle.boundingBox();
  await p.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await p.mouse.down();await p.mouse.move(rect.x+rect.width/2+80,rect.y+rect.height/2,{steps:5});await p.mouse.up();
  await p.locator('.flow-column-head').waitFor();const after=await p.locator('.flow-column-head > span').first().boundingBox();assert.ok(after.width>before.width+40);
  const widths=await p.evaluate(()=>({...state.flowWidths}));await handle.focus();await p.keyboard.press('ArrowLeft');assert.ok(await p.evaluate(w=>state.flowWidths.title<w.title,widths));
  const cancelWidths=await p.evaluate(()=>({...state.flowWidths})),cancelRect=await handle.boundingBox();await p.mouse.move(cancelRect.x+cancelRect.width/2,cancelRect.y+cancelRect.height/2);await p.mouse.down();await p.mouse.move(cancelRect.x-40,cancelRect.y+cancelRect.height/2);await p.keyboard.press('Escape');await p.mouse.up();assert.deepEqual(await p.evaluate(()=>state.flowWidths),cancelWidths);assert.equal(await handle.getAttribute('aria-valuenow'),String(Math.round(cancelWidths.title/(cancelWidths.title+cancelWidths.note)*100)));
  await p.evaluate(()=>flushSave());const saved=await p.evaluate(()=>({...state.flowWidths}));await p.reload();await p.locator('[data-flow-column-resizer]').waitFor();assert.deepEqual(await p.evaluate(()=>state.flowWidths),saved);
  assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'child').parentId),'parent');
  await p.locator('[data-action="toggle-node-collapse"][data-node-id="parent"]').click();await p.locator('.flow-branch[data-expanded="false"]').waitFor({state:'attached'});await p.waitForFunction(()=>findNode(shellActiveTask().nodes,'parent').collapsed);
  await p.locator('[data-action="toggle-node-collapse"][data-node-id="parent"]').click();await p.waitForFunction(()=>!findNode(shellActiveTask().nodes,'parent').collapsed);
  assert.equal(await p.locator('[data-action="manage-node-states"]').count(),0);
  await openStatusSettings();await p.locator('.node-state-form [name="name"]').fill('卡住');await p.locator('.node-state-form [type="submit"]').click();
  await p.waitForFunction(()=>state.nodeStates.length===1);await p.waitForFunction(()=>!document.querySelector('.node-state-form [name="id"]').value);
  const stateId=await p.evaluate(()=>state.nodeStates[0].id);await closeStatusSettings();
  const status=p.locator('.node-status[data-node-id="parent"]');
  const statusFill=()=>status.evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.equal(await status.innerText(),'未完成');
  const todoFill=await statusFill();
  await status.click();assert.equal(await status.innerText(),'卡住');
  const customFill=await statusFill();
  assert.equal(await status.evaluate(el=>!el.children.length&&el.parentElement.nextElementSibling.matches('.node-title')),true);
  await p.keyboard.press('Space');assert.equal(await status.innerText(),'已完成');
  assert.equal(new Set([todoFill,customFill,await statusFill()]).size,3);
  await p.keyboard.press('Enter');assert.equal(await status.innerText(),'未完成');
  await status.press('Shift+F10');assert.deepEqual(await p.locator('.status-option').evaluateAll(items=>items.map(el=>el.dataset.status)),['todo',stateId,'done']);
  assert.equal(await p.locator('.status-menu button').count(),3);
  await p.keyboard.press('ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement.dataset.status),stateId);
  await p.keyboard.press('Escape');assert.equal(await p.locator('.status-menu').count(),0);
  await p.locator('.node-title[data-node-id="parent"]').click({button:'right'});await p.locator('.node-context-menu [data-action="open-node-status"]').click();await p.locator(`[data-action="set-node-status"][data-status="${stateId}"]`).click();
  assert.equal(await status.innerText(),'卡住');
  assert.equal(await p.evaluate(()=>taskCompletionBlocker(shellActiveTask())),'FLOW_INCOMPLETE');
  await p.evaluate(()=>flushSave());await p.reload();await status.waitFor();assert.equal(await status.innerText(),'卡住');assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'parent').status),stateId);
  await openStatusSettings();await p.locator('[data-state-edit]').click();await p.locator('.node-state-form [name="name"]').fill('等待中');await p.locator('.node-state-form [type="submit"]').click();await p.waitForFunction(()=>state.nodeStates[0].name==='等待中');await p.waitForFunction(()=>!document.querySelector('.node-state-form [name="id"]').value);
  await p.locator('[data-state-delete]').click();await p.locator('[data-confirm-state-delete]').click();await p.waitForFunction(()=>!state.nodeStates.length);assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'parent').status),'todo');
  await closeStatusSettings();await p.evaluate(()=>flushSave());await p.reload();await p.locator('[data-flow-column-resizer]').waitFor();assert.equal(await p.evaluate(()=>state.nodeStates.length),0);assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'parent').status),'todo');
  assert.deepEqual(h.errors,[]);console.log('memo stages 3/4: real pointer/keyboard column resize, widths reload, original tree/collapse, custom state create/assign/rename/delete migration, reload and completion guard passed');
 }finally{await h.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

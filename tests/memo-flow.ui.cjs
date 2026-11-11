const assert = require('node:assert/strict');
const {launchRepository,task} = require('./electron-ui-helpers.cjs');
(async()=>{
 const legacy={id:'custom_legacy',name:'历史状态',color:'#81735e'};
 const h=await launchRepository({activeTaskId:'flow',nodeStates:[legacy],tasks:[task('flow',{conclusion:'任务结论',nodes:[
  {id:'parent',title:'父节点',status:'todo',conclusion:'节点结论',children:[{id:'child',title:'子节点',status:'custom_legacy',note:'历史记录',children:[]}]}
 ]})]},'memo-flow');
 const p=h.page;
 const status=p.locator('.node-status[data-node-id="parent"]');
 try{
  await status.waitFor();
  assert.equal(await p.locator('[data-flow-column-resizer],.flow-column-head,.flow-node-actions,.node-add').count(),0);
  assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'child').parentId),'parent');
  const collapse=p.locator('[data-action="toggle-node-collapse"][data-node-id="parent"]');
  await collapse.click();await p.waitForFunction(()=>findNode(shellActiveTask().nodes,'parent').collapsed);
  await collapse.click();await p.waitForFunction(()=>!findNode(shellActiveTask().nodes,'parent').collapsed);
  // Keyboard activation follows the same fixed three-state cycle as clicks.
  await status.focus();await status.press('Space');assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'parent').status),'done');
  await status.press('Enter');assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'parent').status),'review');
  await status.press('Space');assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'parent').status),'todo');
  assert.equal(await p.evaluate(()=>taskCompletionBlocker(shellActiveTask())),'FLOW_INCOMPLETE');
  // Hiding the old custom-state UI must not delete existing records or metadata.
  await p.locator('[data-action="toggle-settings"]').click();
  await p.locator('[data-action="set-settings-page"][data-page="tasks"]').click();
  assert.equal(await p.locator('[data-action="manage-node-states"]').count(),0);
  await p.locator('[data-action="toggle-settings"]').click();
  await p.evaluate(()=>flushSave());await p.reload();await status.waitFor();
  assert.deepEqual(await p.evaluate(()=>state.nodeStates),[legacy]);
  assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'child').status),'custom_legacy');
  assert.equal(await p.locator('.flow-row[data-node-id="child"] .node-conclusion-text').innerText(),'历史记录');
  assert.deepEqual(h.errors,[]);
  console.log('PASS memo flow: compact outline, real hierarchy/collapse, keyboard three-state cycle, completion guard and legacy state/record preservation after reload.');
 }finally{await h.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

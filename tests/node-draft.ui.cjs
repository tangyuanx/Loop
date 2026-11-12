// #91: one new-node title/placeholder across real and overlapping commands.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');
const {minimizeTaskInfo}=require('./workbench-helpers.cjs');
(async()=>{
 const h=await launchRepository({activeTaskId:'drafts',tasks:[task('drafts',{nodes:[
  {id:'parent',title:'已有父节点',children:[{id:'child',title:'已有子节点',children:[]}]},
  {id:'other',title:'另一个父节点',children:[]},
 ]}),task('empty')]},'node-draft');
 const {app,page:p,profile,errors}=h,editor=p.locator('[data-shell-node-draft]');
 const settle=()=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const shot=async name=>{if(process.env.LOOP_REVIEW_OUTPUT){await fs.mkdir(process.env.LOOP_REVIEW_OUTPUT,{recursive:true});await p.screenshot({path:path.join(process.env.LOOP_REVIEW_OUTPUT,name+'.png')});}};
 const unique=async()=>{
  await editor.waitFor();
  assert.equal(await editor.count(),1);
  assert.equal(await editor.getAttribute('placeholder'),'输入节点标题');
  assert.equal(await p.locator('.node-draft .node-title,.node-draft .node-conclusion-text,.node-draft .node-status-chip').count(),0,'a new row never duplicates its title or uses the old status text badge');
  assert.equal(await p.locator('.node-draft [role="img"][aria-label="未完成"] svg').count(),1);
  assert.equal(await p.locator('.node-draft').innerText(),'','placeholder text belongs only to the native title field');
  assert.equal(await p.locator('.flow-row .node-title').evaluateAll(items=>items.some(el=>!el.textContent.trim())),false,'no inactive empty node is rendered alongside the draft');
 };
 const add=async(action,nodeId)=>{
  if(action==='add-root-node')await p.locator('.add-node').click();
  else{
   await p.locator(`.node-title[data-node-id="${nodeId}"]`).click({button:'right'});
   await p.getByRole('menuitem',{name:action==='add-child-node'?'添加子节点':'添加同级节点',exact:true}).click();
  }
  await unique();
 };
 try{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).setSize(1280,820));
  await minimizeTaskInfo(p);
  const baseline=await p.evaluate(()=>structuredClone(shellActiveTask().nodes));
  for(const [action,id]of [['add-root-node',null],['add-child-node','parent'],['add-sibling-node','child']]){
   await add(action,id);await editor.press('Escape');await editor.waitFor({state:'detached'});
   assert.equal(await p.evaluate(()=>shellNodeList(shellActiveTask()).length),3);
   await add(action,id);await editor.fill('   ');await editor.press('Enter');await editor.waitFor({state:'detached'});
   assert.equal(await p.evaluate(()=>shellNodeList(shellActiveTask()).length),3);
  }
  // Rapid/reentrant creation uses the same production dispatcher. The old
  // implementation left an empty displayed node beside the active editor.
  await p.evaluate(()=>Promise.all(Array.from({length:10},()=>action({action:'add-root-node',taskId:'drafts'}))));
  await unique();assert.equal(await p.evaluate(()=>shellNodeList(shellActiveTask()).length),4);
  const first=await p.evaluate(()=>state.focusNodeTitleId);
  await p.evaluate(()=>action({action:'add-child-node',taskId:'drafts',nodeId:'parent'}));
  await unique();assert.equal(await p.evaluate(id=>!!findNode(shellActiveTask().nodes,id),first),false);
  assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,state.focusNodeTitleId).parentId),'parent');
  await p.evaluate(()=>Promise.all(Array.from({length:5},()=>action({action:'add-sibling-node',taskId:'drafts',nodeId:'child'}))));
  await unique();assert.equal(await p.evaluate(()=>shellNodeList(shellActiveTask()).length),4);
  await editor.press('Escape');await editor.waitFor({state:'detached'});

  // An old success must not confirm/cancel a newer empty title.
  await add('add-root-node');const old=await p.evaluate(()=>state.focusNodeTitleId);
  await editor.fill('保留已输入的标题');
  await p.locator('.add-node').click();await unique();
  const fresh=await p.evaluate(()=>state.focusNodeTitleId);
  assert.notEqual(fresh,old);
  await p.evaluate(id=>shellCommitNodeDraft('drafts',id),old);
  assert.equal(await p.evaluate(()=>state.focusNodeTitleId),fresh);
  await unique();await editor.press('Escape');await editor.waitFor({state:'detached'});
  assert.equal(await p.locator(`.node-title[data-node-id="${old}"]`).innerText(),'保留已输入的标题');

  await add('add-root-node');await editor.fill('保存失败后的标题');
  await p.evaluate(async()=>{await flushSave();globalThis.__draftFlush=flushSave;flushSave=async()=>false;});
  await editor.press('Enter');await p.waitForFunction(()=>!document.querySelector('[data-shell-node-draft]').dataset.committing);
  await unique();assert.equal(await editor.getAttribute('aria-invalid'),'true');
  assert.equal(await editor.inputValue(),'保存失败后的标题');
  await p.evaluate(()=>{flushSave=__draftFlush;});
  await editor.press('Enter');await editor.waitFor({state:'detached'});

  for(const theme of ['light','dark'])for(const size of ['current','largest']){
   await p.evaluate(({theme,size})=>{state.theme=theme;state.fontScale=size;render();},{theme,size});
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).setSize(1024,720));
   await add('add-root-node');await editor.hover();await editor.focus();await settle();
   const style=await editor.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect(),badge=el.previousElementSibling.getBoundingClientRect();return{background:s.backgroundColor,border:s.borderBottomColor,outline:s.outlineStyle,shadow:s.boxShadow,fits:r.right<=innerWidth&&r.left>badge.right-1,sameLine:Math.abs(r.top-badge.top)<12};});
   assert.equal(style.background,'rgba(0, 0, 0, 0)');assert.equal(style.outline,'none');assert.ok(style.fits&&style.sameLine,JSON.stringify(style));
   const colors=(style.border+' '+style.shadow).match(/rgba?\([^)]*\)/g)||[];
   for(const color of colors){const [r,g,b]=color.match(/[\d.]+/g).map(Number);assert.ok(!(g>r+10&&g>b+10),'no green focus: '+color);}
   await shot(`node-draft-${theme}-${size}`);
   await editor.press('Escape');await editor.waitFor({state:'detached'});
  }
  await p.evaluate(async()=>{save();await flushSave();});
  const disk=JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8'));
  const saved=disk.tasks.find(t=>t.id==='drafts');
  assert.equal(saved.nodes.filter(n=>n.title==='保留已输入的标题').length,1);
  assert.equal(saved.nodes.filter(n=>n.title==='保存失败后的标题').length,1);
  assert.equal(saved.nodes.some(n=>!n.title.trim()),false);
  assert.deepEqual(saved.nodes[0].children.map(n=>n.id),baseline[0].children.map(n=>n.id));
  await p.reload();await p.locator('.flow-scroll').waitFor();
  assert.equal(await editor.count(),0);assert.equal(await p.evaluate(()=>shellNodeList(shellActiveTask()).some(n=>!n.title.trim())),false);
  await p.evaluate(()=>{state.activeTaskId='empty';render();});await add('add-root-node');
  assert.equal(await p.locator('.flow-start:visible').count(),0);
  await shot('node-draft-empty');await editor.press('Escape');await editor.waitFor({state:'detached'});
  assert.equal(await p.locator('.flow-start:visible').count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS #91: one native placeholder/icon row; root/child/sibling and empty tasks; reentrant creation/moving draft; stale save identity; failed save/retry; whitespace/cancel/reload; light/dark/maximum type/neutral focus.');
 }catch(error){await shot('failure');throw error;}finally{await h.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

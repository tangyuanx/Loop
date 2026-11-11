// Production renderer + storage IPC + disk. Only task-data fs.open failures
// and delayed disk acknowledgements are injected inside this isolated app.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {launchRepository,task}=require('./electron-ui-helpers.cjs');

(async()=>{
 const run=await launchRepository({activeTaskId:'a',taskGroups:[{id:'work',title:'工作原名',order:1},{id:'other',title:'另一分组',order:2}],
  tasks:[task('a',{title:'任务原名',groupId:'work',nodes:[{id:'node',title:'节点原名',children:[]}]}),task('b',{title:'另一任务',groupId:'work',order:2})]},'management-names');
 const {app,page:p,profile,errors}=run;
 const out=process.env.LOOP_REVIEW_OUTPUT||path.join(profile,'evidence');await fs.mkdir(out,{recursive:true});
 const results=[];
 const shot=name=>p.screenshot({path:path.join(out,name+'.png')});
 const disk=async()=>JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8'));
 const select=async id=>{await p.locator(`.task-select[data-task-id="${id}"]`).click();await p.waitForFunction(id=>state.activeTaskId===id,id);};
 const fault=mode=>app.evaluate((_electron,mode)=>{global.__nameFault.mode=mode;global.__nameFault.blocked=false;},mode);
 const release=()=>app.evaluate(()=>{global.__nameFault.mode='';global.__nameFault.release?.();global.__nameFault.release=null;global.__nameFault.blocked=false;});
 const flush=()=>p.evaluate(async()=>{save();return flushSave();});
 const done=async name=>{results.push({name,status:'PASS'});console.log(name+' PASS');};
 try{
  await app.evaluate((_electron,prefix)=>{
   const fs=process.mainModule.require('node:fs/promises'),open=fs.open;
   global.__nameFault={mode:'',blocked:false,writes:0};
   fs.open=async(...args)=>{
    const f=global.__nameFault;
    if(String(args[0]).startsWith(prefix)){
     f.writes++;
     if(f.mode==='delay'){f.blocked=true;await new Promise(resolve=>{f.release=resolve;});}
     if(f.mode==='fail')throw Object.assign(Error('测试：名称写盘失败'),{code:'ENOSPC'});
    }
    return open(...args);
   };
  },path.join(profile,'task-data.json.tmp-'));
  const runtime=await app.evaluate(({app})=>({appPath:app.getAppPath(),userData:app.getPath('userData'),pid:process.pid,version:app.getVersion()}));
  assert.equal(runtime.appPath,path.resolve(__dirname,'..'));assert.equal(runtime.userData,profile);
  await fs.writeFile(path.join(out,'runtime.json'),JSON.stringify(runtime,null,2));
  for(const kind of ['row','heading','group']){
   const selector=kind==='row'?'#manage24-row-title':kind==='heading'?'#manage24-title':'#group-title';
   const errorSelector=kind==='row'?'#manage24-row-error':kind==='heading'?'#manage24-title-error':'#manage24-group-error';
   const input=p.locator(selector);
   const model=()=>p.evaluate(kind=>kind==='group'?state.taskGroups.find(g=>g.id==='work').title:state.tasks.find(t=>t.id==='a').title,kind);
   const persisted=async()=>kind==='group'?(await disk()).taskGroups.find(g=>g.id==='work').title:(await disk()).tasks.find(t=>t.id==='a').title;
   const open=async()=>{
    await p.evaluate(()=>{state.activeGroupId='group_all';state.activeTaskId='a';render();});
    if(kind==='row')await p.locator('.task-select[data-task-id="a"]').dblclick();
    if(kind==='heading')await p.locator('.topbar [data-action="edit-task-title"]').click();
    if(kind==='group'){await p.locator('.navigation [data-group-id="work"]').focus();await p.keyboard.press('F2');}
    await input.waitFor();assert.equal(await input.evaluate(el=>el===document.activeElement),true);
   };
   await flush();const original=await model();await open();await input.fill(kind+'失败输入');
   await fault('fail');await input.press('Enter');
   await p.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('aria-invalid')==='true'&&!document.querySelector(selector)?.hasAttribute('data-committing'),selector);
   assert.equal(await input.inputValue(),kind+'失败输入');assert.equal(await model(),original);assert.equal(await persisted(),original);
   assert.match(await p.locator(errorSelector).innerText(),/保存失败/);
   await input.evaluate(el=>el.setSelectionRange(1,3));await p.evaluate(()=>render());
   assert.equal(await input.inputValue(),kind+'失败输入');assert.equal(await input.evaluate(el=>el.selectionStart),1);
   assert.equal(await input.evaluate(el=>el===document.activeElement),true);
   await shot(kind+'-failure');await release();await input.press('Escape');await input.waitFor({state:'detached'});
   assert.equal(await model(),original);assert.equal(await flush(),true);assert.equal(await persisted(),original);
   await done(kind+': disk failure retains draft/error/focus/selection through render; Escape keeps original model/disk');

   await open();await input.fill(kind+'重试保存');await fault('fail');await input.press('Enter');
   await p.waitForFunction(selector=>document.querySelector(selector)?.getAttribute('aria-invalid')==='true'&&!document.querySelector(selector)?.hasAttribute('data-committing'),selector);
   await release();await input.press('Enter');await input.waitFor({state:'detached'});
   assert.equal(await model(),kind+'重试保存');assert.equal(await persisted(),kind+'重试保存');
   await done(kind+': retry closes only after persisted success');

   await open();await input.fill(kind+'输入法草稿');
   await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
   await input.dispatchEvent('keydown',{key:'Escape',isComposing:true,keyCode:229});
   assert.equal(await input.inputValue(),kind+'输入法草稿');assert.equal(await model(),kind+'重试保存');
   await input.press('Escape');await input.waitFor({state:'detached'});
   await open();await input.fill(kind+'已提交');await flush();await fault('delay');await input.press('Enter');
   await app.evaluate(async()=>{const end=Date.now()+10000;while(!global.__nameFault.blocked&&Date.now()<end)await new Promise(r=>setTimeout(r,20));if(!global.__nameFault.blocked)throw Error('Disk write did not block');});
   await input.fill(kind+'已提交 ');
   const writes=await app.evaluate(()=>global.__nameFault.writes);await input.press('Enter');
   assert.equal(await app.evaluate(()=>global.__nameFault.writes),writes,'pending submit is not duplicated');
   await p.evaluate(()=>render());assert.equal(await input.inputValue(),kind+'已提交 ');
   await release();await p.waitForFunction(selector=>!document.querySelector(selector)?.hasAttribute('data-committing'),selector);
   assert.equal(await input.inputValue(),kind+'已提交 ');assert.equal(await model(),kind+'已提交');
   await input.press('Escape');await input.waitFor({state:'detached'});assert.equal(await model(),kind+'已提交');
   assert.equal(await flush(),true);assert.equal(await persisted(),kind+'已提交');
   await done(kind+': IME, pending deduplication, render and newer input survive the old disk acknowledgement');
  }
  // A late task-A result must not replace task B's heading or close its editor.
  await select('a');await p.locator('.topbar .title-edit').click();await p.locator('#manage24-title').fill('A迟到的已提交名称');
  await flush();await fault('delay');await p.locator('#manage24-title').press('Enter');
  await app.evaluate(async()=>{const end=Date.now()+10000;while(!global.__nameFault.blocked&&Date.now()<end)await new Promise(r=>setTimeout(r,20));if(!global.__nameFault.blocked)throw Error('Disk write did not block');});
  await select('b');await p.locator('.topbar .title-edit').click();await p.locator('#manage24-title').fill('B尚未提交');
  await p.evaluate(()=>{globalThis.__newNameField=document.querySelector('#manage24-title');});
  await release();await p.waitForFunction(()=>state.tasks.find(t=>t.id==='a').title==='A迟到的已提交名称');await flush();
  assert.equal(await p.locator('#manage24-title').inputValue(),'B尚未提交');
  assert.equal(await p.evaluate(()=>document.querySelector('#manage24-title')===__newNameField),true);
  await p.locator('#manage24-title').press('Escape');assert.equal(await p.locator('.topbar .title-edit').innerText(),'另一任务');
  await done('late A write preserves B editor, heading and unsubmitted draft');
  await select('a');
  const openTitle=()=>p.evaluate(()=>action({action:'edit-node-title',nodeId:'node'},{currentTarget:document.querySelector('.node-title[data-node-id="node"]')}));
  await openTitle();const dialogTitle=p.locator('#editable-title');await dialogTitle.fill('弹窗失败名称');
  await flush();await fault('fail');await dialogTitle.press('Enter');
  await p.waitForFunction(()=>document.querySelector('#editable-title')?.getAttribute('aria-invalid')==='true'&&!document.querySelector('#editable-title')?.dataset.committing);
  assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'node').title),'节点原名');
  assert.equal(await dialogTitle.inputValue(),'弹窗失败名称');
  await release();await dialogTitle.press('Escape');await dialogTitle.waitFor({state:'detached'});await flush();
  assert.equal((await disk()).tasks.find(t=>t.id==='a').nodes[0].title,'节点原名');
  await openTitle();await dialogTitle.fill('弹窗输入法名称');await dialogTitle.dispatchEvent('compositionstart');
  await dialogTitle.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
  await p.evaluate(()=>document.querySelector('#title-form').requestSubmit());
  assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'node').title),'节点原名');
  await dialogTitle.dispatchEvent('compositionend');await dialogTitle.press('Enter');await dialogTitle.waitFor({state:'detached'});
  assert.equal((await disk()).tasks.find(t=>t.id==='a').nodes[0].title,'弹窗输入法名称');
  await done('production title dialog rolls back failed model writes, cancels safely and ignores composition submit');

  await p.locator('[data-action="toggle-settings"]').click();
  await p.locator('[data-action="set-settings-page"][data-page="tasks"]').click();
  await p.locator('.settings-content [data-action="manage-node-states"]').click();
  const stateName=p.locator('.node-state-form [name="name"]'),stateSubmit=p.locator('.node-state-form [type="submit"]');
  await stateName.fill('状态首次失败');await flush();await fault('fail');await stateSubmit.click();
  await p.waitForFunction(()=>document.querySelector('.node-state-error')?.textContent.includes('保存失败')&&!document.querySelector('.node-state-form [name="name"]').readOnly);
  assert.equal(await p.evaluate(()=>state.nodeStates.length),0);assert.equal(await stateName.inputValue(),'状态首次失败');
  await release();await stateSubmit.click();await p.waitForFunction(()=>state.nodeStates.length===1&&!document.querySelector('.node-state-form [name="id"]').value);
  await p.locator('[data-state-edit]').click();await stateName.fill('状态改名失败');await fault('fail');await stateSubmit.click();
  await p.waitForFunction(()=>document.querySelector('.node-state-error')?.textContent.includes('保存失败')&&!document.querySelector('.node-state-form [name="name"]').readOnly);
  assert.equal(await p.evaluate(()=>state.nodeStates[0].name),'状态首次失败');
  assert.equal(await stateName.inputValue(),'状态改名失败');
  await release();await p.locator('[data-cancel-state]').click();assert.equal(await stateName.inputValue(),'');
  await p.locator('[data-state-edit]').click();await stateName.fill('状态输入法');await stateName.dispatchEvent('compositionstart');
  await p.evaluate(()=>document.querySelector('.node-state-form').requestSubmit());
  assert.equal(await p.evaluate(()=>state.nodeStates[0].name),'状态首次失败');
  await stateName.dispatchEvent('compositionend');await stateSubmit.click();
  await p.waitForFunction(()=>state.nodeStates[0].name==='状态输入法'&&!document.querySelector('.node-state-form [name="id"]').value);
  await stateName.press('Escape');await p.locator('.node-state-form').waitFor({state:'detached'});
  await p.locator('[data-action="toggle-settings"]').click();await flush();
  assert.equal((await disk()).nodeStates[0].name,'状态输入法');
  await done('custom-state name create/rename disk failures restore definitions, retain retry input and respect cancel/IME');
  await select('b');
  for(const theme of ['light','dark']){
   await p.evaluate(theme=>{state.theme=theme;render();},theme);
   await p.locator('.topbar .title-edit').click();await p.locator('#manage24-title').focus();
   const sample=await p.locator('#manage24-title').evaluate(el=>{
    const visibleGreen=style=>{
     const green=color=>{const m=color.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?/);return m&&Number(m[4]??1)>.05&&+m[2]>+m[1]*1.12&&+m[2]>+m[3]*1.08;};
     return ['Top','Right','Bottom','Left'].some(side=>parseFloat(style['border'+side+'Width'])>0&&style['border'+side+'Style']!=='none'&&green(style['border'+side+'Color']))
      ||(parseFloat(style.outlineWidth)>0&&style.outlineStyle!=='none'&&green(style.outlineColor))
      ||(style.boxShadow!=='none'&&[...style.boxShadow.matchAll(/rgba?\([^)]+\)/g)].some(m=>green(m[0])));
    };
    const nodes=[el,el.parentElement,el.parentElement.parentElement];
    return {green:nodes.some(node=>visibleGreen(getComputedStyle(node))),focus:getComputedStyle(el).boxShadow,bg:getComputedStyle(el).backgroundColor};
   });
   assert.equal(sample.green,false);assert.equal(sample.bg,'rgba(0, 0, 0, 0)');
   await shot(theme+'-name-focus');await p.locator('#manage24-title').press('Escape');
  }
  await done('light/dark input and ancestors retain transparent editing without green boundaries');
  await flush();const saved=await disk();await p.reload();await p.locator('.app').waitFor();
  assert.equal(await p.evaluate(()=>state.tasks.find(t=>t.id==='a').title),saved.tasks.find(t=>t.id==='a').title);
  assert.equal(await p.evaluate(()=>state.taskGroups.find(g=>g.id==='work').title),saved.taskGroups.find(g=>g.id==='work').title);
  assert.deepEqual(errors,[]);await done('disk/reload and zero renderer errors');
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({status:'PASS',runtime,results,errors},null,2));
 }catch(error){
  await shot('failure').catch(()=>{});
  await fs.writeFile(path.join(out,'failure-state.json'),JSON.stringify(await p.evaluate(()=>({active:document.activeElement?.outerHTML.slice(0,1000),editingGroupId:state.editingGroupId,titles:state.tasks.map(t=>[t.id,t.title]),groups:state.taskGroups.map(g=>[g.id,g.title])})).catch(()=>null),null,2));
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({status:'FAIL',results,errors,error:error.stack},null,2));throw error;
 }finally{await release().catch(()=>{});await run.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

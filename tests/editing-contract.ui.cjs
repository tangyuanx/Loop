// Real Electron coverage for #89. Uses synthetic data and never opens user files.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {launchRepository,task} = require('./electron-ui-helpers.cjs');

(async()=>{
  const h=await launchRepository({activeTaskId:'editing',tasks:[task('editing',{
    title:'编辑交互验收',description:'背景原文',conclusion:'任务结论原文',
    nodes:[{id:'n',title:'节点原文',note:'记录原文',children:[]}],
  })]},'editing-contract');
  const {app,page:p,profile,errors}=h;
  const output=process.env.LOOP_REVIEW_OUTPUT;
  if(output)await fs.mkdir(output,{recursive:true});
  const saved=()=>p.evaluate(()=>flushSave());
  const fail=()=>p.evaluate(async()=>{await flushSave();globalThis.__editingFlush=flushSave;flushSave=async()=>false;});
  const restore=()=>p.evaluate(async()=>{flushSave=__editingFlush;await flushSave();});
  try{
    const brief=p.locator('[data-brief21-key="editing:description"]');
    await brief.fill('第一行');await brief.press('Shift+Enter');await brief.pressSequentially('second');
    assert.equal(await brief.inputValue(),'第一行\nsecond');
    await brief.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
    assert.equal(await brief.evaluate(el=>el===document.activeElement),true);
    await fail();await brief.press('Enter');await p.waitForFunction(()=>!document.querySelector('.brief21-input').dataset.committing);
    assert.equal(await brief.getAttribute('aria-invalid'),'true');
    assert.equal(await brief.evaluate(el=>el===document.activeElement),true);
    await restore();await brief.press('Escape');
    await p.waitForFunction(()=>!document.activeElement.matches('.brief21-input'));
    assert.equal(await brief.inputValue(),'背景原文');
    await brief.fill('Enter 保存的背景');await brief.press('Enter');
    await p.waitForFunction(()=>!document.activeElement.matches('.brief21-input'));

    await p.locator('.node-title[data-node-id="n"]').dblclick();
    const rename=p.locator('[data-shell-node-rename]');
    await rename.fill('失败的标题');await fail();await rename.press('Enter');
    await p.waitForFunction(()=>!document.querySelector('[data-shell-node-rename]').dataset.committing);
    await restore();await rename.press('Escape');
    assert.equal(await p.locator('.node-title[data-node-id="n"]').innerText(),'节点原文');

    await p.locator('[data-action="open-node-detail"][data-node-id="n"]').click();
    const record=p.locator('[data-shell-node-record]');
    await record.fill('曾经自动保存的记录');
    await p.waitForFunction(()=>findNode(shellActiveTask().nodes,'n').note==='曾经自动保存的记录');
    await p.evaluate(()=>render()); // reuse the same focused record and its session
    await record.fill('重绘后的待保存记录');await record.press('Escape');
    await p.locator('.node-record-window').waitFor({state:'detached'});
    assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'n').note),'记录原文');

    // #91 evidence: root/child drafts must have exactly one title editor and
    // no simultaneous displayed title. No speculative CSS hiding is used.
    for(const parent of [null,'n']){
      if(parent){
        // The production affordance enables pointer input on row hover/focus.
        // Enter the row first, just as a user revealing its actions would.
        await p.locator('.flow-row[data-node-id="n"]').hover();
        await p.waitForFunction(()=>getComputedStyle(document.querySelector('.node-add[data-node-id="n"]')).pointerEvents==='auto');
        await p.locator('.node-add[data-node-id="n"]').click();
      }
      else await p.locator('.flow-outline > [data-action="add-root-node"]').click();
      const draft=p.locator('[data-shell-node-draft]');await draft.waitFor();
      assert.equal(await draft.count(),1);
      assert.equal(await p.locator('.node-draft .node-title').count(),0);
      assert.doesNotMatch(await p.locator('.node-draft').innerText(),/未输入节点标题/);
      await draft.fill('草稿第一行');await draft.press('Shift+Enter');await draft.pressSequentially('second');
      await draft.press('Escape');await draft.waitFor({state:'detached'});
      assert.equal(await p.evaluate(()=>shellNodeList(shellActiveTask()).length),1);
    }

    for(const [theme,width] of [['light',1280],['dark',1024]]){
      await p.evaluate(theme=>{state.theme=theme;render();},theme);
      await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width,820),width);
      await brief.fill('主题与编辑焦点检查');
      if(output){await fs.mkdir(output,{recursive:true});await p.screenshot({path:path.join(output,theme+'-editing.png')});}
      await brief.press('Escape');await p.waitForFunction(()=>!document.activeElement.matches('.brief21-input'));
    }
    await saved();
    const disk=JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8'));
    assert.equal(disk.tasks[0].description,'Enter 保存的背景');
    assert.equal(disk.tasks[0].nodes[0].title,'节点原文');assert.equal(disk.tasks[0].nodes[0].note,'记录原文');
    await p.reload();await p.locator('.node-title').waitFor();
    assert.equal(await p.locator('[data-brief21-key="editing:description"]').inputValue(),'Enter 保存的背景');
    assert.deepEqual(errors,[]);
    console.log('editing-contract: brief Enter/Shift+Enter/IME/failure/Esc; rename failure/cancel; record autosave/redraw/cancel; root/child draft exclusivity; disk/reload passed');
  }catch(error){
    if(output){
      await p.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
      const detail=await p.evaluate(()=>{
        const target=document.querySelector('.node-add[data-node-id="n"]');
        if(!target)return {targetMissing:true};
        const box=target.getBoundingClientRect(),style=getComputedStyle(target),row=target.closest('.flow-row');
        return {box:{x:box.x,y:box.y,width:box.width,height:box.height},pointerEvents:style.pointerEvents,
          opacity:style.opacity,display:style.display,rowHovered:row.matches(':hover'),rowFocused:row.matches(':focus-within'),
          hitStack:document.elementsFromPoint(box.x+box.width/2,box.y+box.height/2).slice(0,8).map(el=>({tag:el.tagName,class:el.className,nodeId:el.dataset.nodeId}))};
      }).catch(failure=>({diagnosticError:failure.message}));
      await fs.writeFile(path.join(output,'failure.json'),JSON.stringify(detail,null,2));
    }
    throw error;
  }finally{await h.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

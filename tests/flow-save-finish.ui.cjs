// Real Electron editing lifecycles with delayed/failed persistence confirmation.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {launchRepository, task} = require('./electron-ui-helpers.cjs');

(async () => {
  const h = await launchRepository({activeTaskId:'save', tasks:[task('save', {
    title:'保存行为验收', description:'背景原文', conclusion:'任务结论原文',
    nodes:[{id:'node', title:'节点原文', note:'记录原文', conclusion:'节点结论原文', children:[]}],
  })]}, 'flow-save-finish');
  const {app, page:p, profile, errors} = h;
  const output = process.env.LOOP_REVIEW_OUTPUT;
  const fail = () => p.evaluate(async () => {
    await flushSave(); globalThis.__originalFlush = flushSave;
    flushSave = async () => false;
  });
  const restore = () => p.evaluate(async () => {flushSave = __originalFlush; await flushSave();});
  const gate = () => p.evaluate(async () => {
    await flushSave(); globalThis.__originalFlush = flushSave;
    globalThis.__saveGate = new Promise(resolve => {globalThis.__releaseSave = resolve;});
    flushSave = () => __saveGate;
  });
  const release = () => p.evaluate(async () => {
    flushSave = __originalFlush; __releaseSave(await flushSave());
  });
  const shot = async name => {
    if (output) {await fs.mkdir(output,{recursive:true}); await p.screenshot({path:path.join(output,name+'.png')});}
  };
  const waitSaved = input => p.waitForFunction(selector => !document.querySelector(selector)?.dataset.committing, input);
  try {
    // Use the production title action and click its actual Save button.
    await p.evaluate(() => action({action:'edit-node-title', nodeId:'node'},
      {currentTarget:document.querySelector('.node-title[data-node-id="node"]')}));
    const title = p.locator('#editable-title'), submit = p.locator('#title-form [type="submit"]');
    await title.fill('按钮保存后的节点标题');
    await fail(); await submit.click(); await waitSaved('#editable-title');
    assert.equal(await title.inputValue(),'按钮保存后的节点标题');
    assert.equal(await title.getAttribute('aria-invalid'),'true');
    assert.match(await p.locator('#entry16-title-error').innerText(), /保存失败/);
    assert.equal(await submit.isEnabled(), true);
    await shot('title-save-failed');
    await restore(); await gate(); await submit.click();
    assert.equal(await submit.isDisabled(),true);
    assert.equal(await title.count(),1,'editor remains until persistence resolves');
    await title.fill('写入中继续修改的标题');
    await p.evaluate(() => document.querySelector('#title-form').requestSubmit());
    assert.equal(await p.evaluate(() => findNode(shellActiveTask().nodes,'node').title),'按钮保存后的节点标题',
      'a repeated submit cannot start a second save while busy');
    await release(); await waitSaved('#editable-title');
    assert.equal(await title.inputValue(),'写入中继续修改的标题','new text is not closed by an old success');
    await submit.click(); await p.waitForFunction(() => !document.querySelector('#title-form'));
    assert.equal(await p.evaluate(() => findNode(shellActiveTask().nodes,'node').title),'写入中继续修改的标题');

    await p.evaluate(() => action({action:'edit-node-title',nodeId:'node'},
      {currentTarget:document.querySelector('.node-title')}));
    await title.fill('旧弹窗完成写入'); await gate(); await submit.click();
    await p.evaluate(() => {
      shellCloseOverlay({restoreFocus:false});
      shellKnowledgeDialog('后续操作','<p>旧保存结果不能关闭这个弹窗</p>','');
    });
    await release();
    assert.match(await p.locator('#overlay').innerText(),/后续操作/);
    await p.evaluate(() => shellCloseOverlay({restoreFocus:false}));

    // The active brief uses direct inputs and Ctrl/Cmd+Enter, not legacy drafts.
    const brief = p.locator('[data-brief21-key="save:conclusion"]');
    await brief.fill('任务结论：保存失败也保留');
    await fail(); await brief.press('ControlOrMeta+Enter'); await waitSaved('[data-brief21-key="save:conclusion"]');
    assert.equal(await brief.evaluate(el => el === document.activeElement),true);
    assert.equal(await brief.inputValue(),'任务结论：保存失败也保留');
    assert.equal(await p.evaluate(() => BRIEF21_SESSIONS.has('save:conclusion')),true);
    await restore();
    await brief.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,keyCode:229});
    assert.equal(await brief.evaluate(el => el === document.activeElement),true,'IME confirmation does not finish');
    await gate(); await brief.press('ControlOrMeta+Enter');
    await brief.fill('任务结论：写入时的新内容'); await release();
    await waitSaved('[data-brief21-key="save:conclusion"]');
    assert.equal(await brief.evaluate(el => el === document.activeElement),true);
    await brief.press('ControlOrMeta+Enter');
    await p.waitForFunction(() => !document.activeElement.matches('[data-brief21-key="save:conclusion"]'));
    assert.equal(await p.evaluate(() => shellActiveTask().history.filter(row=>row[1]==='更新任务结论').length),1);

    // Success only finishes the current area, even with another brief editor active.
    await p.locator('[data-brief21-key="save:description"]').fill('另一编辑区域的内容');
    await p.locator('.node-title[data-node-id="node"]').dblclick();
    const rename = p.locator('[data-shell-node-rename]');
    await rename.fill('行内节点标题'); await fail(); await rename.press('Enter');
    await waitSaved('[data-shell-node-rename]');
    assert.equal(await rename.count(),1); assert.equal(await rename.inputValue(),'行内节点标题');
    await restore(); await rename.press('Enter'); await p.waitForFunction(() => !shellNodeRenameDraft);
    assert.equal(await p.locator('[data-brief21-key="save:description"]').inputValue(),'另一编辑区域的内容');

    await p.locator('[data-action="edit-node-conclusion"]').click();
    const conclusion = p.locator('[data-shell-node-conclusion]');
    await conclusion.fill('节点结论：失败后重试'); await fail(); await conclusion.press('Enter');
    await waitSaved('[data-shell-node-conclusion]');
    assert.equal(await conclusion.count(),1); assert.equal(await conclusion.inputValue(),'节点结论：失败后重试');
    await restore(); await conclusion.press('Enter'); await p.waitForFunction(() => !shellConclusionDraft);

    await p.locator('[data-action="open-node-detail"]').click();
    const record = p.locator('[data-shell-node-record]');
    await record.fill('节点记录第一行'); await record.press('Shift+Enter'); await record.pressSequentially('second');
    await fail(); await record.press('Enter'); await waitSaved('[data-shell-node-record]');
    assert.equal(await record.inputValue(),'节点记录第一行\nsecond');
    assert.equal(await p.locator('.node-record-window').count(),1);
    await restore(); await record.press('Enter'); await p.waitForFunction(() => !state.selectedNodeId);
    await p.evaluate(async () => {save(); await flushSave();});
    const disk = JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8'));
    const saved = disk.tasks.find(t=>t.id==='save');
    assert.equal(saved.nodes[0].title,'行内节点标题');
    assert.equal(saved.nodes[0].conclusion,'节点结论：失败后重试');
    assert.equal(saved.nodes[0].note,'节点记录第一行\nsecond');
    assert.equal(saved.conclusion,'任务结论：写入时的新内容');
    await p.reload(); await p.locator('.node-title').waitFor();
    assert.deepEqual(await p.evaluate(() => shellActiveTask().nodes), saved.nodes);

    for (const theme of ['light','dark']) {
      await p.evaluate(theme => {state.theme=theme;render();}, theme);
      await p.evaluate(() => action({action:'edit-node-title',nodeId:'node'},
        {currentTarget:document.querySelector('.node-title')}));
      await title.fill('主题验收：失败时保留编辑'); await fail(); await submit.click(); await waitSaved('#editable-title');
      const style = await title.evaluate(el => {
        const s=getComputedStyle(el); return {border:s.borderBottomColor,width:s.borderBottomWidth,style:s.borderBottomStyle,outline:s.outlineStyle,shadow:s.boxShadow};
      });
      assert.equal(style.outline,'none');
      const rgb = style.border.match(/[\d.]+/g).slice(0,3).map(Number);
      assert.ok(parseFloat(style.width)===0 || style.style==='none' || !(rgb[1]>rgb[0]+10&&rgb[1]>rgb[2]+10),
        'error border must not be green (existing amber error feedback is allowed): '+JSON.stringify(style));
      await shot(theme+'-title-save-failed');
      await restore(); await submit.click(); await p.waitForFunction(() => !document.querySelector('#title-form'));
    }
    assert.deepEqual(errors,[]);
    console.log('flow-save-finish: Save button failure/retry, delayed success/new input, active brief lifecycle and IME, title/conclusion/record failure retention, Shift+Enter, other-region content, disk/reload and light/dark non-green focus passed');
  } finally {await h.close();}
})().catch(error => {console.error(error);process.exitCode=1;});

// Actual Electron regression for the approved compact processing outline.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {launchRepository, task} = require('./electron-ui-helpers.cjs');
const {minimizeTaskInfo,openFlowOptions} = require('./workbench-helpers.cjs');
const longTitle = '已完成的长标题：保留父子关系、配置字段、解析过程和验证结果。'.repeat(7);
const oldNote = '旧浮窗中的完整记录。\n\n第二段证据与验证过程必须保留。';
const longText = ('完整结论、分析证据和验证结果。'.repeat(8) + '\n').repeat(5);
(async () => {
  const run = await launchRepository({tasks:[task('outline',{title:'处理流极简验收',nodes:[
    {id:'parent',title:'父节点',status:'todo',conclusion:'阶段结论',note:oldNote,children:[
      {id:'complete',title:longTitle,status:'done',conclusion:longText,children:[]},
      {id:'review',title:'待确认节点',status:'review',note:'待确认的已有记录',children:[]},
    ]},
    {id:'blank',title:'没有结论的节点',status:'todo',children:[]},
  ]})]},'flow-outline');
  const {app,page,errors,profile}=run;
  const title=id=>page.locator(`.node-title[data-node-id="${id}"]`);
  const row=id=>page.locator(`.flow-row[data-node-id="${id}"]`);
  const text=id=>row(id).locator('.node-conclusion-text');
  const field=page.locator('[data-shell-node-conclusion]');
  const model=id=>page.evaluate(id=>structuredClone(findNode(shellActiveTask().nodes,id)),id);
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const saveEnter=async locator=>{await locator.press('Enter');await locator.waitFor({state:'detached'});};
  const shot=async name=>{if(process.env.LOOP_REVIEW_OUTPUT){await fs.mkdir(process.env.LOOP_REVIEW_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.LOOP_REVIEW_OUTPUT,name+'.png')});}};
  try {
    await page.locator('.flow-scroll').waitFor();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1280,900));
    await minimizeTaskInfo(page);
    // Successful creation alone shows a durable, dismissible introduction.
    await page.locator('.add-node').click();await page.locator('[data-shell-node-draft]').press('Escape');
    assert.equal(await page.getByText('右键节点可添加结论，双击结论可修改。',{exact:true}).count(),0);
    await page.locator('.add-node').click();await page.locator('[data-shell-node-draft]').fill('首次新建');await page.locator('[data-shell-node-draft]').press('Enter');
    await page.getByText('右键节点可添加结论，双击结论可修改。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'关闭操作反馈',exact:true}).click();
    await page.evaluate(()=>flushSave());await page.reload();await page.locator('.flow-scroll').waitFor();await minimizeTaskInfo(page);
    await page.locator('.add-node').click();await page.locator('[data-shell-node-draft]').fill('第二次新建');await page.locator('[data-shell-node-draft]').press('Enter');
    assert.equal(await page.getByText('右键节点可添加结论，双击结论可修改。',{exact:true}).count(),0);
    assert.equal(await page.locator('.flow-row .node-add,.flow-node-actions,.flow-column-head,.conclusion-expand').count(),0);
    assert.equal(await row('blank').locator('.node-conclusion-text').count(),0);
    // Three states survive persistence and do not change children.
    const children=(await model('parent')).children;
    const sequence=[];for(let i=0;i<3;i++){await row('parent').locator('.node-status').click();sequence.push((await model('parent')).status);}
    assert.deepEqual(sequence,['done','review','todo']);assert.deepEqual((await model('parent')).children,children);
    assert.equal(await page.locator('.status-menu').count(),0);
    await title('parent').click();assert.equal(await page.locator('.node-record-window').count(),0);
    // Right-click creation delegates to the production hierarchy code.
    await title('blank').click({button:'right'});await page.getByRole('menuitem',{name:'添加子节点',exact:true}).click();
    await page.locator('[data-shell-node-draft]').fill('真实子节点');await page.locator('[data-shell-node-draft]').press('Enter');
    assert.equal((await model('blank')).children[0].title,'真实子节点');
    await title('blank').click({button:'right'});await page.getByRole('menuitem',{name:'添加结论',exact:true}).click();await field.fill('右键添加的结论');await saveEnter(field);
    assert.equal((await model('blank')).conclusion,'右键添加的结论');
    // Legacy records are visible, editable and cancel restores both fields.
    await text('parent').dblclick({delay:70});assert.ok((await field.inputValue()).includes(oldNote));
    const original=await model('parent');await field.fill('不保存的结论');await field.press('Escape');assert.deepEqual(await model('parent'),{...original,updatedAt:(await model('parent')).updatedAt});
    await text('parent').dblclick({delay:70});const merged=await field.inputValue();await field.fill(merged+'\n保存后的新内容');await saveEnter(field);
    assert.equal((await model('parent')).note,'');assert.ok((await model('parent')).conclusion.includes(oldNote));
    // Visible title editor and automatic height at multiple widths/themes.
    await title('parent').dblclick({delay:70});const rename=page.locator('[data-shell-node-rename]');await rename.waitFor();
    assert.equal(await rename.inputValue(),'父节点');assert.ok(await rename.evaluate(el=>el.getBoundingClientRect().width)>100);
    await rename.fill('父节点已改名');await saveEnter(rename);assert.equal((await model('parent')).title,'父节点已改名');
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>{state.theme=theme;render();},theme);await settle();
      await text('complete').dblclick({delay:70});await field.waitFor();
      await field.fill(longText+'\n新增换行\n最后一行完整显示');await settle();
      const geometry=await field.evaluate(el=>{const s=getComputedStyle(el);return{fits:el.scrollHeight<=el.clientHeight+1,width:el.getBoundingClientRect().width,outline:s.outlineStyle,shadow:s.boxShadow};});
      assert.ok(geometry.fits);assert.ok(geometry.width>100);assert.equal(geometry.outline,'none');
      await shot('outline-edit-'+theme);await field.press('Escape');
    }
    // Completed title and conclusion independently collapse, hover and pin.
    await page.reload();await page.locator('.flow-scroll').waitFor();await minimizeTaskInfo(page);
    await page.mouse.move(20,20);await settle();
    const compact=await row('complete').evaluate(el=>{const t=el.querySelector('.node-title'),n=el.querySelector('.node-conclusion-preview');return{title:t.clientHeight,note:n.clientHeight,ellipsis:getComputedStyle(n).textOverflow};});
    assert.ok(compact.title<30&&compact.note<30);assert.equal(compact.ellipsis,'ellipsis');
    await title('complete').hover();assert.ok(await title('complete').evaluate(el=>el.clientHeight)>compact.title);
    await page.mouse.move(20,20);await text('complete').hover();assert.ok(await row('complete').locator('.node-conclusion-preview').evaluate(el=>el.clientHeight)>compact.note);
    await text('complete').click();await page.mouse.move(20,20);assert.equal(await row('complete').evaluate(el=>el.classList.contains('expanded-summary')),true);
    await shot('outline-reading');
    // Filtering preserves ancestors and the actual data tree.
    const before=await page.evaluate(()=>structuredClone(shellActiveTask().nodes));
    await (await openFlowOptions(page)).getByRole('button',{name:/^待确认/}).click();assert.equal(await row('review').count(),1);assert.equal(await row('parent').count(),1);assert.equal(await row('blank').count(),0);
    assert.deepEqual(await page.evaluate(()=>shellActiveTask().nodes),before);await (await openFlowOptions(page)).getByRole('button',{name:/^待确认/}).click();
    await page.evaluate(()=>flushSave());const disk=JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8'));
    assert.equal(disk.uiPreferences.nodeConclusionHintSeen,true);assert.equal(disk.tasks[0].nodes[0].children[1].status,'review');
    await page.reload();await page.locator('.flow-scroll').waitFor();assert.ok((await model('parent')).conclusion.includes('保存后的新内容'));assert.deepEqual(errors,[]);
    console.log('PASS: compact outline, legacy records, three-state persistence, one-time hint, real children, double-click editors, save/cancel, automatic height, light/dark focus and completed single-line/hover/pinned reading.');
  } catch(error){await shot('outline-failure');throw error;} finally {await run.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

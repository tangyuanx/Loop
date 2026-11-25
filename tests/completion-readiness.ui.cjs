// Exercise the real completion dialog and its destinations with an isolated profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {launchRepository, task} = require('./electron-ui-helpers.cjs');

(async () => {
  const h = await launchRepository({activeTaskId:'blocked', tasks:[
    task('blocked', {title:'待补齐任务', nodes:[
      {id:'parent', title:'已完成父节点', status:'done', collapsed:true, children:[
        {id:'pending', title:'需要完成的子节点', status:'todo', children:[]},
      ]},
    ]}),
    task('other', {title:'另一任务', conclusion:'另一任务的结论'}),
    task('empty', {title:'只缺结论'}),
  ]}, 'completion-readiness');
  const {app, page:p, errors, profile} = h;
  const output = process.env.LOOP_REVIEW_OUTPUT;
  const complete = async id => {
    // Repository completion replaces the sequence number only on row hover.
    await p.locator(`[data-task-row="${id}"]`).hover();
    await p.locator(`[data-action="toggle-task-done"][data-task-id="${id}"]`).first().click();
  };
  const button = kind => p.locator(`.journey17-ready [data-journey17="${kind}"]`);
  const settle = () => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const shot = async name => {
    if (output) { await fs.mkdir(output,{recursive:true}); await p.screenshot({path:path.join(output,name+'.png')}); }
  };
  try {
    assert.equal(await app.evaluate(({app}) => app.getAppPath()), path.resolve(__dirname,'..'));
    console.log('Real Electron profile:', profile);
    for (const theme of ['light','dark']) {
      const usesThreePlaneLight = theme === 'light' && ['darwin', 'win32'].includes(process.platform);
      await p.evaluate(theme => {
        state.theme=theme; state.journeyReceipt=null; state.activeTaskId='blocked';
        state.selectedNodeId=''; state.taskPane='flow';
        shellActiveTask().conclusion=''; findNode(shellActiveTask().nodes,'pending').status='todo';
        findNode(shellActiveTask().nodes,'parent').collapsed=true;
        shellReviewOnly=theme==='dark'; shellHideCompletedNodes=theme==='dark';
        BRIEF21_EXPANDED.set('blocked',false); render();
      },theme);
      if (usesThreePlaneLight) {
        for (const [selector, expected] of [
          ['.topbar', 'rgb(242, 243, 245)'],
          ['.navigation', 'rgb(242, 243, 245)'],
          ['.task-list-pane', 'rgb(247, 248, 250)'],
          ['.workspace', 'rgb(255, 255, 255)'],
        ]) {
          assert.equal(await p.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor),
            expected, selector + ' matches the three-plane light hierarchy');
        }
      }
      await complete('blocked');
      assert.equal(await button('conclusion').count(),1);
      assert.equal(await button('node').count(),1);
      await shot(theme+'-blocked');
      await button('conclusion').click(); await settle();
      assert.equal(await p.locator('.journey17-ready').count(),0,'navigation closes the readiness dialog');
      const conclusion=p.locator('[data-brief21-key="blocked:conclusion"]');
      assert.equal(await conclusion.isVisible(),true,'a collapsed brief opens');
      assert.equal(await conclusion.evaluate(el=>el===document.activeElement),true,'conclusion receives keyboard focus');
      await conclusion.fill('本任务的处理结论'); await conclusion.press('ControlOrMeta+Enter');
      await complete('blocked');
      assert.equal(await button('conclusion').count(),0,'only unfinished requirements are actionable');
      await button('node').focus(); await p.keyboard.press('Enter'); await settle();
      assert.equal(await p.locator('.journey17-ready').count(),0);
      assert.equal(await p.evaluate(()=>state.selectedNodeId),'pending');
      const target=p.locator('.flow-row[data-node-id="pending"] .node-title');
      await target.waitFor({state:'visible'});
      await p.waitForFunction(()=>document.activeElement?.matches('.node-title[data-node-id="pending"]'));
      assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'parent').collapsed),false);
      assert.equal(await p.evaluate(()=>shellReviewOnly),false,'explicit navigation reveals a node excluded by the current view');
      await shot(theme+'-node-destination');
      await p.locator('.flow-row[data-node-id="pending"] .node-status').click();
      await complete('blocked');
      assert.equal(await p.evaluate(()=>state.tasks.find(t=>t.id==='blocked').status),'done');
      if (usesThreePlaneLight) {
        const ring = p.locator('[data-task-row="blocked"].done .task-check-ring');
        assert.deepEqual(await ring.evaluate(el => {
          const style = getComputedStyle(el);
          return [style.backgroundColor, style.borderTopColor, style.color];
        }), ['rgba(0, 0, 0, 0)', 'rgb(138, 144, 158)', 'rgb(138, 144, 158)'],
        'The completed task keeps a neutral ring and check without a fill');
      }
      await p.locator('[data-journey17="undo"]').click(); await settle();
      assert.equal(await p.evaluate(()=>state.tasks.find(t=>t.id==='blocked').status),'active');
      assert.equal(await p.evaluate(()=>state.tasks.find(t=>t.id==='blocked').conclusion),'本任务的处理结论');
    }
    // A prior receipt must never redirect readiness navigation to its task.
    await p.evaluate(()=>{
      state.activeTaskId='other'; state.selectedNodeId='';
      shellReviewOnly=false; shellHideCompletedNodes=false;
      state.journeyReceipt={id:'other',kind:'created',date:loopTodayKey()}; render();
    });
    await complete('empty');
    assert.equal(await button('node').count(),0);
    await button('conclusion').focus(); await p.keyboard.press('Space'); await settle();
    assert.equal(await p.evaluate(()=>state.activeTaskId),'empty');
    assert.equal(await p.locator('[data-brief21-key="empty:conclusion"]').evaluate(el=>el===document.activeElement),true);
    assert.equal(await p.locator('[data-brief21-key="empty:conclusion"]').inputValue(),'');
    assert.equal(await p.evaluate(()=>state.tasks.find(t=>t.id==='other').conclusion),'另一任务的结论');
    await p.locator('[data-brief21-key="empty:conclusion"]').fill('补齐后可完成');
    await complete('empty');
    await p.locator('[data-journey17="result"]').click(); await settle();
    assert.equal(await p.evaluate(()=>state.activeTaskId),'empty');
    assert.equal(await p.locator('[data-brief21-key="empty:conclusion"]').inputValue(),'补齐后可完成');
    await p.locator('[data-journey17="review"]').click();
    assert.equal(await p.evaluate(()=>state.reviewOpen),true);
    await p.evaluate(async()=>{save(); await flushSave();});
    const disk=JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8'));
    assert.equal(disk.tasks.find(t=>t.id==='empty').status,'done');
    assert.equal(disk.tasks.find(t=>t.id==='blocked').nodes[0].children[0].status,'done');
    assert.deepEqual(errors,[]);
    console.log('PASS completion readiness: no receipt, wrong-task receipt, collapsed brief/ancestor, pointer/Enter/Space, light/dark, completion/result/review/undo and disk persistence.');
  } catch(error) {
    console.error('Readiness diagnostic:',await p.evaluate(()=>({task:state.activeTaskId,selectedNode:state.selectedNodeId,
      active:document.activeElement?.outerHTML.slice(0,500),overlay:document.querySelector('#overlay')?.innerHTML.slice(0,1000)})));
    await shot('failure');throw error;
  } finally {await h.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

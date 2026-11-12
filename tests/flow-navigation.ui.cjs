const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {launchRepository, task} = require('./electron-ui-helpers.cjs');
const {minimizeTaskInfo} = require('./workbench-helpers.cjs');

const stamp = new Date().toISOString();
const node = (id, children = [], fields = {}) => ({id, title:id, status:'todo', updatedAt:stamp, children, ...fields});
const deepTitle=i=>`第 ${i+1} 层：分析问题的上下文、处理步骤与验证结果，这是用于检查长标题换行和路径省略的内容。`;
let deep = node('deep-15',[],{title:deepTitle(15)});
for (let i=14;i>=0;i--) deep = node('deep-'+i,[deep],{title:deepTitle(i)});
const long = Array.from({length:12},(_,i)=>`第${i+1}行：完整保留中英文 content、换行和分析结论。`).join('\n\n');

(async()=>{
  const h=await launchRepository({activeTaskId:'flow',tasks:[task('flow',{history:[['昨天','已有任务记录']],nodes:[
    node('long',[],{conclusion:long}),deep,node('branch-b',[node('b-child')]),
    node('done-parent',[node('unfinished-child')],{status:'done',collapsed:true}),
    ...Array.from({length:1000},(_,i)=>node('bulk-'+i)),
  ]}),task('empty')]},'flow-navigation');
  const {app,page:p,errors,profile}=h;
  const row=id=>p.locator(`.flow-row[data-node-id="${id}"]`);
  const title=id=>p.locator(`.node-title[data-node-id="${id}"]`);
  const nav=p.locator('[data-flow-breadcrumb]');
  const settle=()=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const go=async id=>{
    await row(id).evaluate(el=>{const scroll=el.closest('.flow-scroll');scroll.scrollTop+=el.getBoundingClientRect().top-scroll.getBoundingClientRect().top;});
    await p.waitForFunction(id=>document.querySelector('[data-flow-breadcrumb]')?.dataset.currentNode===id,id);
  };
  const shot=async name=>{if(process.env.LOOP_REVIEW_OUTPUT){await fs.mkdir(process.env.LOOP_REVIEW_OUTPUT,{recursive:true});await p.screenshot({path:path.join(process.env.LOOP_REVIEW_OUTPUT,name+'.png')});}};
  try{
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).setSize(1280,850));
    await minimizeTaskInfo(p); await nav.waitFor(); await settle();
    const original=await p.evaluate(()=>structuredClone(shellActiveTask().nodes));
    const conclusion=row('long').locator('.node-conclusion-preview');
    assert.equal(await conclusion.innerText(),long);
    assert.ok(await conclusion.evaluate(el=>el.clientHeight>=parseFloat(getComputedStyle(el).lineHeight)*11));
    assert.equal(await conclusion.evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'unfinished conclusions are fully readable');
    await go('deep-15');
    await p.locator('[data-flow-nav-overflow]').click();
    assert.equal(await p.locator('.flow-navigation-menu [data-flow-nav-id]').count(),16);
    await p.locator('.flow-navigation-menu [data-flow-nav-id="deep-6"]').focus();
    await p.keyboard.press('Enter'); await p.waitForFunction(()=>!shellOverlayIsOpen());
    await p.waitForFunction(()=>document.activeElement?.dataset.nodeId==='deep-6');
    await p.waitForFunction(()=>document.querySelector('[data-flow-breadcrumb]').dataset.currentNode==='deep-6');
    await go('b-child');
    assert.match(await nav.innerText(),/branch-b/);
    await nav.locator('[data-flow-nav-id="branch-b"]').click();
    await p.waitForFunction(()=>document.activeElement?.dataset.nodeId==='branch-b');
    assert.deepEqual(await p.evaluate(()=>shellActiveTask().nodes),original,'reading/navigation never changes node data');

    // Scroll does not rerender the production tree or detach an active editor.
    await go('long'); await row('long').locator('.node-conclusion-text').dblclick();
    const editor=p.locator('[data-shell-node-conclusion]');
    await editor.fill(long+'\n未提交的草稿');
    await p.evaluate(()=>{globalThis.__flowEditor=document.querySelector('[data-shell-node-conclusion]');globalThis.__flowTree=document.querySelector('.flow-tree');});
    await go('deep-15');
    assert.equal(await p.evaluate(()=>document.querySelector('.flow-tree')===__flowTree&&document.querySelector('[data-shell-node-conclusion]')===__flowEditor),true);
    assert.equal(await editor.inputValue(),long+'\n未提交的草稿');
    await editor.press('Escape'); await editor.waitFor({state:'detached'});

    // Repeated renders retain one runtime, and same-task viewports are kept.
    await go('bulk-400');
    const before=await p.locator('.flow-scroll').evaluate(el=>el.scrollTop);
    await p.evaluate(()=>{render();render();render();}); await settle();
    assert.ok(Math.abs(await p.locator('.flow-scroll').evaluate(el=>el.scrollTop)-before)<2);
    assert.equal(await nav.getAttribute('data-current-node'),'bulk-400');
    await go('deep-15');await p.locator('[data-flow-nav-overflow]').focus();
    await p.evaluate(()=>{findNode(shellActiveTask().nodes,'deep-0').title+='（更新）';render();});await settle();
    assert.equal(await p.locator('[data-flow-nav-overflow]').evaluate(el=>el===document.activeElement),true,'a model redraw restores keyboard focus after the path mounts');
    await go('bulk-400');
    await p.evaluate(()=>globalThis.__scrollTree=document.querySelector('.flow-tree'));
    const metrics=await p.evaluate(async()=>{
      const runtime=shellFlowNavigationRuntime,nav=document.querySelector('[data-flow-breadcrumb]'),scroll=document.querySelector('.flow-scroll');
      const start=performance.now();
      for(let i=0;i<20;i++){scroll.scrollTop+=29;await new Promise(requestAnimationFrame);}
      await new Promise(requestAnimationFrame);
      return {elapsed:performance.now()-start,sameTree:__scrollTree===document.querySelector('.flow-tree'),sameRuntime:runtime===shellFlowNavigationRuntime,current:nav.dataset.currentNode};
    });
    assert.ok(metrics.sameTree&&metrics.sameRuntime&&metrics.current.startsWith('bulk-'));
    console.log('1000-node scroll sample (includes frame waits): '+JSON.stringify(metrics));

    // Current titles and parent links are read from the live model after edits.
    await go('b-child'); await title('b-child').dblclick();
    const rename=p.locator('[data-shell-node-rename]');await rename.fill('改名后的子节点');await rename.press('Enter');await rename.waitFor({state:'detached'});await settle();
    await go('b-child');assert.match(await nav.innerText(),/改名后的子节点/);
    await p.evaluate(()=>action({action:'move-node',nodeId:'b-child',direction:'out'}));await settle();
    await go('b-child');assert.doesNotMatch(await nav.innerText(),/branch-b/);
    await p.evaluate(()=>{const t=shellActiveTask();t.nodes=removeNode(t.nodes,'b-child');render();});await settle();
    assert.doesNotMatch(await nav.innerText(),/改名后的子节点/);

    // Hidden completed ancestors are navigable without deleting their history.
    await p.locator('[data-action="toggle-completed-nodes"]').click();await go('unfinished-child');
    assert.match(await nav.innerText(),/done-parent/);
    await nav.locator('[data-flow-nav-id="done-parent"]').click();await settle();
    await row('done-parent').waitFor();
    assert.equal(await p.evaluate(()=>findNode(shellActiveTask().nodes,'done-parent').status),'done');
    await p.locator('[data-flow-status-history]').click();
    assert.ok(await p.locator('.flow-status-history .task-history-item').count()>1000);
    assert.match(await p.locator('.flow-status-history').innerText(),/已完成/);
    await p.keyboard.press('Escape');await p.waitForFunction(()=>!shellOverlayIsOpen());
    assert.equal(await p.locator('[data-flow-status-history]').evaluate(el=>el===document.activeElement),true);
    await p.locator('[data-action="switch-task-pane"][data-pane="history"]').click();
    assert.match(await p.locator('.article-pane').innerText(),/已有任务记录/);
    assert.equal(await p.evaluate(()=>shellFlowNavigationRuntime),null);
    await p.locator('[data-action="switch-task-pane"][data-pane="flow"]').click();

    for(const theme of ['light','dark'])for(const width of [1280,1024]){
      await p.evaluate(theme=>{state.theme=theme;state.fontScale='largest';render();},theme);
      await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).setSize(width,720),width);
      await minimizeTaskInfo(p);await go('deep-15');await settle();
      const geometry=await p.evaluate(()=>{
        const scroll=document.querySelector('.flow-scroll'),bar=document.querySelector('.flow-context-bar'),nav=document.querySelector('[data-flow-breadcrumb]');
        const title=document.querySelector('.node-title[data-node-id="deep-15"]');
        return {viewport:scroll.clientWidth,content:scroll.scrollWidth,title:title.clientWidth,bar:bar.getBoundingClientRect().height,barFits:bar.scrollWidth<=bar.clientWidth+1,navFits:nav.scrollWidth<=nav.clientWidth+1,bodyFits:document.documentElement.scrollWidth<=innerWidth,offset:getComputedStyle(title.closest('.flow-item')).getPropertyValue('--node-offset')};
      });
      assert.ok(geometry.title>=200&&geometry.bodyFits&&geometry.barFits&&geometry.navFits,JSON.stringify(geometry));
      assert.ok(geometry.content<=Math.max(geometry.viewport,460),JSON.stringify(geometry));
      assert.equal(await nav.locator('button[aria-current]').evaluate(el=>getComputedStyle(el).display),'block','long path labels use actual text ellipsis rather than flex clipping');
      await p.locator('[data-flow-nav-overflow]').focus();
      await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');
      const focus=await p.locator('[data-flow-nav-overflow]').evaluate(el=>({shadow:getComputedStyle(el).boxShadow,outline:getComputedStyle(el).outlineStyle}));
      assert.ok(focus.shadow!=='none'||focus.outline!=='none','neutral keyboard focus remains visible');
      await shot(`flow-${theme}-${width}`);
    }
    await p.evaluate(async()=>{save();await flushSave();});
    const disk=JSON.parse(await fs.readFile(path.join(profile,'task-data.json'),'utf8'));
    assert.ok(disk.tasks[0].history.some(entry=>entry[1]==='已有任务记录'));
    assert.equal(disk.tasks[0].nodes.find(n=>n.id==='long').conclusion,long);
    await p.evaluate(()=>{state.activeTaskId='empty';render();});await settle();
    assert.equal(await nav.innerText(),'暂无节点');
    assert.equal(await nav.locator('button').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS flow navigation: full conclusions; scroll paths/keyboard/overflow; live edits/tree changes; filtered ancestors; state records; draft and viewport continuity; 16 levels/1000 nodes; light/dark/minimum width/large type.');
  }catch(error){await shot('failure');throw error;}finally{await h.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

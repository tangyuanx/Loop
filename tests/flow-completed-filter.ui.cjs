// Real Electron regression using an isolated synthetic profile.
const assert = require('node:assert/strict');
const { launchRepository } = require('./electron-ui-helpers.cjs');

(async () => {
  let run;
  try {
      const stamp = new Date().toISOString();
      const node = (id, status, children = [], collapsed = false) => ({ id, title: id, status, note: 'record ' + id, children, collapsed });
      const tasks = [
        { id: 'task', title: '处理流筛选验证', status: 'active', createdAt: stamp, updatedAt: stamp, nodes: [
          node('done-parent', 'done', [node('done-child', 'done'), node('todo-child', 'todo', [node('blocked', 'blocked')])], true),
          node('todo-root', 'todo', [node('done-leaf', 'done')]), node('later', 'later'),
          ...Array.from({ length: 28 }, (_, i) => node('step-' + i, i % 2 ? 'todo' : 'done')),
        ] },
        { id: 'complete', title: '全部完成', status: 'active', createdAt: stamp, updatedAt: stamp, nodes: [node('only-done', 'done')] },
      ];
    run = await launchRepository({tasks}, 'flow-completed-filter');
    const {app,page,errors}=run;
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1280,820));
    const row = id => page.locator(`.flow-row[data-node-id="${id}"]`);
    const toggle = page.locator('[data-action="toggle-completed-nodes"]');
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    const original = await page.evaluate(() => structuredClone(shellActiveTask().nodes));
    const stats = await page.locator('.flow-toolbar > span').innerText();
    await page.locator('.node-title[data-node-id="todo-root"]').click();
    await toggle.click();
    assert.equal(await toggle.innerText(), '显示已完成');
    assert.equal(await row('done-parent').count(), 0);
    assert.equal(await row('done-leaf').count(), 0);
    assert.equal(await row('todo-child').count(), 1, 'unfinished children of collapsed completed parents stay visible');
    assert.equal(await row('blocked').count(), 1);
    assert.equal(await row('later').count(), 1);
    assert.equal(await page.locator('[data-flow-id="todo-child"]').getAttribute('data-flow-depth'), '1');
    assert.equal(await page.locator('.flow-toolbar > span').innerText(), stats);
    assert.deepEqual(await page.evaluate(() => shellActiveTask().nodes), original, 'filtering never changes hierarchy, records or collapse state');
    await page.locator('[data-action="open-flow-locator"]').click();
    assert.equal(await page.locator('.flow-locator [data-node-id="done-parent"]').count(), 0);
    await page.keyboard.press('Escape');

    // Completing a selected node saves its pending record and removes its inspector.
    await page.locator('[data-shell-node-record]').fill('完成前自动保存的记录');
    await page.evaluate(() => action({ action: 'set-node-status', nodeId: 'todo-root', status: 'done' }));
    assert.equal(await row('todo-root').count(), 0);
    assert.equal(await page.locator('.inspector').count(), 0);
    assert.equal(await page.evaluate(() => findNode(shellActiveTask().nodes, 'todo-root').note), '完成前自动保存的记录');

    // Refresh, show-all and switch-back retain both data and the global preference.
    await page.evaluate(()=>flushSave()); await page.reload(); await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await row('done-parent').count(), 0);
    await toggle.click();
    assert.equal(await row('done-parent').count(), 1);
    assert.equal(await row('todo-child').count(), 0, 'show-all restores the original parent collapse');
    assert.equal(await row('todo-root').count(), 1);
    assert.equal(await page.evaluate(() => findNode(shellActiveTask().nodes, 'todo-root').note), '完成前自动保存的记录');
    await page.locator('.flow-scroll').evaluate(element => { element.scrollTop = 350; });
    await toggle.click();
    await page.waitForTimeout(100);
    const beforeClick = await page.locator('.flow-scroll').evaluate(element => element.scrollTop);
    await page.evaluate(() => action({ action: 'open-node-detail', taskId: 'task', nodeId: 'step-27' }));
    await page.waitForTimeout(100);
    const viewport = await page.locator('.flow-scroll').evaluate(element => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }));
    assert.equal(viewport.top, Math.min(beforeClick, viewport.max), 'node selection keeps scroll position within the resized viewport');
    await page.evaluate(() => { state.activeTaskId = 'complete'; state.selectedNodeId = ''; render(); });
    assert.equal(await row('only-done').count(), 0);
    assert.equal(await page.locator('.flow-filter-empty').innerText(), '所有节点均已完成，已隐藏');
    await page.locator('[data-action="add-root-node"]').click();
    await page.locator('[data-shell-node-draft]').fill('新的未完成节点');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.flow-row .node-title').innerText(), '新的未完成节点');
    assert.equal(await page.locator('.flow-filter-empty').count(), 0);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { state.theme = theme; render(); }, theme);
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1024,720));
      const box = await toggle.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 1024, 'filter is reachable at the supported minimum width: ' + JSON.stringify(box));
    }
    assert.deepEqual(errors, []);
    console.log('Completed filter passed: mixed hierarchy, collapsed completed ancestors, status changes, record autosave, counts, locator, scroll continuity, restart, all-done, add node, minimum desktop width light/dark.');
  } finally { await run?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

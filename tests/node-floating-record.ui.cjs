// Exercise the production renderer with isolated records on both release platforms.
const assert = require('node:assert/strict');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
(async () => {
  const original = '父节点原始记录';
  const run = await launchRepository({ tasks: [task('task', { nodes: [
    { id: 'a', title: '父节点', note: original, children: [{ id: 'child', title: '子节点', note: '子节点原始记录', children: [] }] },
    { id: 'b', title: '另一个节点', note: '另一份记录', children: [] },
  ] })] }, 'floating-record');
  const { app, page, errors } = run;
  try {
    const title = id => page.locator(`.node-title[data-node-id="${id}"]`);
    const open = async id => {
      if (await page.locator(`.node-record-window[data-node-id="${id}"]`).count()) return;
      await title(id).click({ position: { x: 25, y: 20 } });
    };
    const editor = page.locator('[data-shell-node-record]');
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForSelector('.flow-scroll');
    const initialRow = await title('b').boundingBox();
    const width = (await page.locator('.flow-pane').boundingBox()).width;
    await open('a'); await settle();
    assert.equal(await page.locator('.inspector,.node-detail-page,.flow-drawer,.flow-reading').count(), 0);
    assert.equal((await page.locator('.flow-pane').boundingBox()).width, width, 'selection keeps the flow width');
    assert.equal(await editor.inputValue(), original);
    assert.equal(await page.getByRole('dialog', { name: '父节点', exact: true }).count(), 1);
    assert.equal(await page.locator('.flow-tree .node-record-window').count(), 0);
    assert.equal((await title('b').boundingBox()).y, initialRow.y, 'opening a float does not move any node row');
    assert.equal(await page.locator('.workspace > .brief').isVisible(), true, 'selection does not hide the task brief');
    await editor.fill('父节点已编辑，切换后保留');
    await open('b');
    assert.equal(await editor.inputValue(), '另一份记录');
    await open('a');
    assert.equal(await editor.inputValue(), '父节点已编辑，切换后保留');
    await editor.focus(); await page.keyboard.press('End');
    await page.keyboard.insertText('撤销检查');
    const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    await page.keyboard.press(undoKey);
    assert.equal(await editor.inputValue(), '父节点已编辑，切换后保留');
    await page.evaluate(() => render());
    assert.equal(await editor.inputValue(), '父节点已编辑，切换后保留');
    await editor.focus(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.node-record-window').count(), 0);
    await open('child');
    assert.equal(await page.getByRole('dialog', { name: '子节点', exact: true }).count(), 1);
    await editor.fill('子节点新记录');
    await page.getByRole('button', { name: '关闭节点详情', exact: true }).click();
    await title('a').dblclick({ delay: 60, position: { x: 25, y: 20 } });
    const rename = page.locator('[data-shell-node-rename]'); await rename.waitFor();
    await rename.fill('父节点已改名'); await page.keyboard.press('Enter');
    await open('child');
    const handle = page.locator('[data-record-window-handle]');
    const beforeDrag = await page.locator('.node-record-window').boundingBox();
    const head = await handle.boundingBox();
    await page.mouse.move(head.x + 30, head.y + 14); await page.mouse.down();
    await page.mouse.move(24, 24, { steps: 5 }); await page.mouse.up();
    const moved = await page.locator('.node-record-window').boundingBox();
    assert.ok(moved.x !== beforeDrag.x || moved.y !== beforeDrag.y, 'header drags the float');
    assert.ok(moved.x >= 16 && moved.y >= 16, 'drag remains in the viewport');
    await page.evaluate(() => render());
    const retained = await page.locator('.node-record-window').boundingBox();
    assert.equal(retained.x, moved.x); assert.equal(retained.y, moved.y);
    await editor.fill('子节点新记录');
    await page.keyboard.press('Escape');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { state.theme = theme; render(); }, theme);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1024, 720));
      await open('child'); await editor.scrollIntoViewIfNeeded(); await settle();
      const windowBox = await page.locator('.node-record-window').boundingBox();
      assert.ok(windowBox.x >= 0 && windowBox.y >= 0 && windowBox.x + windowBox.width <= 1024 && windowBox.y + windowBox.height <= 720, 'resizing keeps the complete float visible');
      const box = await editor.boundingBox();
      assert.ok(box.width > 100 && box.x >= 0 && box.x + box.width <= 1024);
      await editor.focus();
      const outline = await editor.evaluate(el => ({ shadow: getComputedStyle(el).boxShadow }));
      assert.notEqual(outline.shadow, 'none', 'record keeps the neutral focus underline');
      assert.equal(await page.locator('.inspector,.flow-drawer,.flow-reading').count(), 0);
    }
    await page.evaluate(() => { flushNodeNoteDrafts({ persist: true }); return flushSave(); });
    await page.reload(); await page.waitForSelector('.flow-scroll');
    await open('a'); assert.equal(await editor.inputValue(), '父节点已编辑，切换后保留');
    await open('child'); assert.equal(await editor.inputValue(), '子节点新记录');
    assert.equal(await title('a').innerText(), '父节点已改名');
    assert.deepEqual(errors, []);
    console.log('Floating records passed: dialog title, stable tree layout, drag/clamp, autosave, switching, undo, redraw, close/Esc, rename, light/dark resize and restart.');
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

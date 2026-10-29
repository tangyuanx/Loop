// Exercise the production renderer with isolated records on both release platforms.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
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
      await page.locator(`.node-record-window[data-node-id="${id}"]`).waitFor();
    };
    const editor = page.locator('[data-shell-node-record]');
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForSelector('.flow-scroll');
    const initialRow = await title('b').boundingBox();
    const width = (await page.locator('.flow-pane').boundingBox()).width;
    const briefVisible = await page.locator('.task-work-main > .brief').isVisible();
    await open('a'); await settle();
    assert.equal(await page.locator('.inspector,.node-detail-page,.flow-drawer,.flow-reading').count(), 0);
    assert.equal((await page.locator('.flow-pane').boundingBox()).width, width, 'selection keeps the flow width');
    assert.equal(await editor.inputValue(), original);
    assert.equal(await editor.getAttribute('placeholder'), null);
    assert.equal(await page.getByRole('button', { name: '关闭节点记录', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '调整浮窗大小', exact: true }).count(), 1);
    assert.equal(await page.locator('[data-record-count]').innerText(), `${Array.from(original).length} 字`);
    assert.equal(await page.getByRole('dialog', { name: '父节点', exact: true }).count(), 1);
    assert.equal(await page.locator('.flow-tree .node-record-window').count(), 0);
    assert.equal((await title('b').boundingBox()).y, initialRow.y, 'opening a float does not move any node row');
    assert.equal(await page.locator('.task-work-main > .brief').isVisible(), briefVisible, 'selection preserves the task brief disclosure state');
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
    await page.keyboard.press('Escape');
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
    const panel = page.locator('.node-record-window');
    const resize = async (edge, dx, dy) => {
      const grip = await page.locator(`[data-record-window-resize="${edge}"]`).boundingBox();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2 + dx, grip.y + grip.height / 2 + dy, { steps: 5 });
      await page.mouse.up();
      return panel.boundingBox();
    };
    const enlarged = await resize('se', 100, 80);
    assert.equal(enlarged.width, retained.width + 100);
    assert.equal(enlarged.height, retained.height + 80);
    const editorBeforeResize = await editor.boundingBox();
    for (const [edge, dx, dy, widthChange, heightChange] of [
      ['n', 0, 20, 0, -20], ['e', 20, 0, 20, 0], ['s', 0, 20, 0, 20], ['w', 20, 0, -20, 0],
      ['ne', -20, 20, -20, -20], ['nw', 20, 20, -20, -20], ['sw', 20, -20, -20, -20], ['se', 20, 20, 20, 20],
    ]) {
      const before = await panel.boundingBox();
      const after = await resize(edge, dx, dy);
      assert.equal(after.width, before.width + widthChange, `${edge} adjusts width`);
      assert.equal(after.height, before.height + heightChange, `${edge} adjusts height`);
      if (edge.includes('w')) assert.equal(after.x + after.width, before.x + before.width, 'west resize anchors the east edge');
      if (edge.includes('n')) assert.equal(after.y + after.height, before.y + before.height, 'north resize anchors the south edge');
    }
    assert.ok((await editor.boundingBox()).height < editorBeforeResize.height, 'editor follows the resized body');
    await editor.focus(); await page.keyboard.press('End'); await page.keyboard.insertText('缩放后撤销');
    await resize('e', 20, 0);
    await page.keyboard.press(undoKey);
    assert.equal(await editor.inputValue(), '子节点新记录', 'resize preserves the focused editor and undo history');
    const sized = await panel.boundingBox();
    await page.evaluate(() => render());
    assert.deepEqual(await panel.boundingBox(), sized, 'redraw retains the chosen bounds');
    const minimum = await resize('se', -900, -900);
    assert.equal(minimum.width, 280); assert.equal(minimum.height, 200);
    const sizeGrip = page.getByRole('button', { name: '调整浮窗大小', exact: true });
    await sizeGrip.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
    const keyed = await panel.boundingBox();
    assert.equal(keyed.width, 290); assert.equal(keyed.height, 240);
    await resize('se', 300, 220);
    const eGrip = await page.locator('[data-record-window-resize="e"]').boundingBox();
    await page.mouse.move(eGrip.x + 3, eGrip.y + 30); await page.mouse.down();
    await page.mouse.move(eGrip.x + 23, eGrip.y + 30);
    await panel.dispatchEvent('pointercancel', { pointerId: 1 });
    const cancelled = await panel.boundingBox();
    await page.mouse.move(eGrip.x + 60, eGrip.y + 30); await page.mouse.up();
    assert.deepEqual(await panel.boundingBox(), cancelled, 'cancel ends resizing without lingering handlers');
    const maximum = await resize('se', 1600, 1600);
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.equal(maximum.x + maximum.width, viewport.width - 16);
    assert.equal(maximum.y + maximum.height, viewport.height - 16);
    const expandedNorthWest = await resize('nw', -1600, -1600);
    assert.equal(expandedNorthWest.x, 16); assert.equal(expandedNorthWest.y, 16);
    await resize('se', -620, -360);
    await editor.fill('子节点新记录');
    const beforeClose = await panel.boundingBox();
    await page.getByRole('button', { name: '关闭节点记录', exact: true }).click();
    assert.equal(await panel.count(), 0, 'top-right close dismisses the float');
    await open('child'); assert.equal(await editor.inputValue(), '子节点新记录', 'close flushes the record before reopening');
    assert.deepEqual(await panel.boundingBox(), beforeClose, 'button close and reopen retain position and size');
    await page.getByRole('button', { name: '关闭节点记录', exact: true }).focus(); await page.keyboard.press('Enter');
    assert.equal(await panel.count(), 0, 'close also works from the keyboard');
    await open('child');
    assert.deepEqual(await panel.boundingBox(), beforeClose, 'keyboard close retains the same bounds');
    await editor.focus(); await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    await settle(); // Let the close action restore focus and scroll before clicking again.
    await open('child');
    assert.deepEqual(await panel.boundingBox(), beforeClose, 'Escape close retains the same bounds');
    await page.getByRole('button', { name: '关闭节点记录', exact: true }).click();
    await open('a');
    assert.deepEqual(await panel.boundingBox(), beforeClose, 'opening another node retains the floating window placement');
    await page.getByRole('button', { name: '关闭节点记录', exact: true }).click();
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
      if (process.env.LOOP_FLOATING_QA_DIR) {
        await fs.mkdir(process.env.LOOP_FLOATING_QA_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.LOOP_FLOATING_QA_DIR, `${theme}.png`) });
      }
    }
    await page.evaluate(() => { flushNodeNoteDrafts({ persist: true }); return flushSave(); });
    await page.reload(); await page.waitForSelector('.flow-scroll');
    await open('a'); assert.equal(await editor.inputValue(), '父节点已编辑，切换后保留');
    await open('child'); assert.equal(await editor.inputValue(), '子节点新记录');
    assert.equal(await title('a').innerText(), '父节点已改名');
    assert.deepEqual(errors, []);
    console.log('Floating records passed: stable tree, move, eight resize edges/corners, bounds retention, minimum size, keyboard resize, pointer cancel, close/reopen, autosave, undo, Esc, metadata, rename, light/dark viewport resize and restart.');
  } catch (error) {
    console.error(await page.evaluate(() => ({selected:state.selectedNodeId, position:state.nodeDetailPosition,
      rename: Boolean(document.querySelector('[data-shell-node-rename]')), active:document.activeElement?.outerHTML,
      suppressedFor: suppressFlowNodeClickUntil - Date.now(), panels:document.querySelectorAll('.node-record-window').length})));
    throw error;
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

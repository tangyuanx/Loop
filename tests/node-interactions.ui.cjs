// Real Electron regression using an isolated synthetic profile.
const assert = require('node:assert/strict');
const { launchRepository } = require('./electron-ui-helpers.cjs');

(async () => {
  let run;
  try {
      const stamp = new Date().toISOString();
      const tasks = [{ id: 'task', title: '节点交互验证', status: 'active',
        createdAt: stamp, updatedAt: stamp, nodes: [
          { id: 'a', title: '步骤 A', note: '保留父节点记录', order: 1, children: [{ id: 'ax', title: 'A 的子节点', note: '保留子节点记录', children: [] }] },
          { id: 'b', title: '步骤 B', order: 2, collapsed: true, children: [{ id: 'bx', title: 'B 的子节点', children: [] }] },
          { id: 'c', title: '步骤 C', order: 3, children: [] },
          { id: 'd', title: '步骤 D', order: 4, children: [] },
        ] }];
    run = await launchRepository({tasks}, 'node-interactions');
    const {app,page,errors}=run;
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1280,820));
    await page.waitForSelector('.flow-scroll');
    const settle = () => page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const title = id => page.locator(`.node-title[data-node-id="${id}"]`);
    const row = id => page.locator(`.flow-row[data-node-id="${id}"]`);
    const tree = () => page.evaluate(() => state.tasks.find(t => t.id === 'task').nodes);
    const begin = async id => {
      await page.waitForFunction(() => Date.now() >= suppressFlowNodeClickUntil);
      await title(id).scrollIntoViewIfNeeded(); await settle();
      const box = await title(id).boundingBox();
      await page.mouse.move(box.x + 25, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForFunction(() => flowNodeDragState?.active);
      assert.equal(await page.locator('.flow-node-drop-guide').count(), 1);
    };
    const target = async (id, placement) => {
      // Inline records add vertical space. Aim at a visible row, away from
      // the auto-scroll edge, rather than using coordinates below the viewport.
      await row(id).evaluate(el => el.scrollIntoView({ block: 'center' }));
      await settle();
      const box = await row(id).boundingBox();
      const ratio = placement === 'before' ? .18 : placement === 'after' ? .82 : .5;
      await page.mouse.move(box.x + Math.min(90, box.width / 2), box.y + box.height * ratio, { steps: 3 });
      await page.waitForFunction(({ id, placement }) => flowNodeDragState?.targetId === id && flowNodeDragState?.placement === placement, { id, placement });
    };
    const drop = async () => {
      await page.mouse.up(); await settle();
      assert.equal(await page.locator('.flow-node-drop-guide').count(), 0);
      assert.equal(await page.locator('.flow-row[data-drop]').count(), 0);
      assert.equal(await page.evaluate(() => flowNodeDragState), null);
    };

    // Double-click must work even when click one opens/rebuilds the inspector.
    await title('a').dblclick({ delay: 60 });
    const rename = page.locator('[data-shell-node-rename]');
    await rename.waitFor();
    assert.equal(await page.locator('#title-form').count(), 0, 'rename never opens a dialog');
    assert.equal(await page.evaluate(() => shellOverlayIsOpen()), false);
    assert.equal(await rename.inputValue(), '步骤 A');
    assert.equal(await rename.getAttribute('data-node-id'), 'a', 'relayout still renames the first node');
    assert.equal(await page.evaluate(() => document.activeElement.matches('[data-shell-node-rename]')), true);
    await rename.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    assert.equal(await rename.count(), 1, 'IME confirmation never finishes renaming');
    await rename.fill('   ');
    await page.keyboard.press('Enter');
    assert.equal(await rename.getAttribute('aria-invalid'), 'true');
    assert.equal((await tree())[0].title, '步骤 A', 'blank titles do not overwrite the name');
    await rename.fill('已改名步骤 A');
    await page.keyboard.press('Enter'); await settle();
    assert.equal((await tree())[0].title, '已改名步骤 A');
    assert.equal((await tree())[0].note, '保留父节点记录');
    await title('a').dblclick({ delay: 60, position: { x: 25, y: 20 } }); await rename.waitFor();
    await rename.fill('不保存的名字');
    await page.evaluate(() => render());
    assert.equal(await rename.inputValue(), '不保存的名字', 'rerenders keep the inline draft');
    await page.keyboard.press('Escape');
    assert.equal((await tree())[0].title, '已改名步骤 A');
    await settle();
    assert.equal(await rename.count(), 0);

    await title('a').dblclick({ delay: 60, position: { x: 25, y: 20 } }); await rename.waitFor();
    await rename.fill('   ');
    await page.locator('.flow-toolbar > span').click();
    assert.equal(await rename.count(), 0);
    assert.equal((await tree())[0].title, '已改名步骤 A', 'blank blur restores the original name');
    await title('d').dblclick({ delay: 60, position: { x: 25, y: 20 } }); await rename.waitFor();
    await rename.fill('步骤 D 已改名');
    await title('a').click({ position: { x: 25, y: 20 } }); await settle();
    assert.equal((await tree()).find(n => n.id === 'd').title, '步骤 D 已改名');
    assert.equal(await page.evaluate(() => state.selectedNodeId), 'a', 'blur save retains the clicked action');

    // Long-pressing the title moves a whole subtree into a collapsed parent.
    const selected = await page.evaluate(() => state.selectedNodeId);
    await begin('a'); await target('b', 'inside');
    assert.match(await page.locator('.flow-node-drop-guide').innerText(), /步骤 B.*第 2 层/);
    assert.equal(await row('b').getAttribute('data-drop'), 'inside');
    await drop();
    let nodes = await tree();
    assert.equal(nodes[0].id, 'b'); assert.equal(nodes[0].collapsed, false);
    const moved = nodes[0].children.find(n => n.id === 'a');
    assert.equal(moved.parentId, 'b'); assert.equal(moved.children[0].id, 'ax');
    assert.equal(moved.children[0].note, '保留子节点记录');
    assert.equal(await page.evaluate(() => state.selectedNodeId), selected, 'drag release never activates a title click');
    assert.equal(await page.locator('#title-form').count(), 0);

    // A top/bottom drop changes ordering; cross-level drops use target siblings.
    await begin('c'); await target('b', 'before'); await drop();
    nodes = await tree(); assert.deepEqual(nodes.map(n => n.id), ['c', 'b', 'd']);
    assert.equal(nodes[0].parentId, null);
    await begin('a'); await target('c', 'before'); await drop();
    nodes = await tree(); assert.deepEqual(nodes.map(n => n.id), ['a', 'c', 'b', 'd']);
    assert.equal(nodes[0].parentId, null); assert.equal(nodes[0].children[0].parentId, 'a');

    // Descendant cycles and cancelled gestures cannot mutate the tree.
    const unchanged = await tree();
    await begin('a');
    await row('ax').evaluate(el => el.scrollIntoView({ block: 'center' })); await settle();
    const descendant = await row('ax').boundingBox();
    await page.mouse.move(descendant.x + 80, descendant.y + descendant.height / 2);
    assert.match(await page.locator('.flow-node-drop-guide').innerText(), /不能移动到自身或自己的子节点/);
    await drop(); assert.deepEqual(await tree(), unchanged);
    await begin('d'); await target('b', 'inside');
    await page.keyboard.press('Escape'); await page.mouse.up(); await settle();
    assert.deepEqual(await tree(), unchanged); assert.equal(await page.locator('.flow-node-drop-guide').count(), 0);
    await begin('d'); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up(); await settle();
    assert.deepEqual(await tree(), unchanged);

    // Empty flow space promotes a subtree to the root end.
    await begin('c');
    await page.locator('.add-node').scrollIntoViewIfNeeded(); await settle();
    const end = await page.locator('.add-node').boundingBox();
    await page.mouse.move(end.x + 30, end.y + end.height / 2);
    await page.waitForFunction(() => flowNodeDragState?.root);
    await drop(); nodes = await tree(); assert.deepEqual(nodes.map(n => n.id), ['a', 'b', 'd', 'c']);

    // Status controls are never drag handles, and short clicks open inline records.
    const status = page.locator('.node-status[data-node-id="a"]');
    await status.scrollIntoViewIfNeeded(); await settle();
    const statusBox = await status.boundingBox();
    await page.mouse.move(statusBox.x + statusBox.width / 2, statusBox.y + statusBox.height / 2);
    await page.mouse.down(); await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => flowNodeDragState), null);
    await page.mouse.up(); await page.waitForSelector('.status-menu'); await page.keyboard.press('Escape'); await settle();
    await page.waitForFunction(() => Date.now() >= suppressFlowNodeClickUntil);
    await title('d').click({ position: { x: 25, y: 20 } }); await settle(); assert.equal(await page.evaluate(() => state.selectedNodeId), 'd');
    assert.equal(await page.locator('#title-form').count(), 0);

    await page.waitForFunction(async () => (await window.personalTaskTrack.storage.read()).tasks[0].nodes[0].title === '已改名步骤 A');
    const saved = await tree(); await page.evaluate(()=>flushSave()); await page.reload(); await page.waitForSelector('.flow-scroll');
    assert.deepEqual(await tree(), saved, 'renamed nodes, moved hierarchy and all records survive restart');
    assert.deepEqual(errors, []);
    console.log('Node gestures passed: double-click naming/validation/cancel, long-press reparent/reorder/root, subtree records, cycle rejection, Esc/blur cancel, controls, release suppression and persistence.');
  } finally { await run?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

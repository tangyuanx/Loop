// Real Electron regression using an isolated synthetic profile.
const assert = require('node:assert/strict');
const path = require('node:path');
const { launchRepository } = require('./electron-ui-helpers.cjs');

(async () => {
  let run;
  try {
      const stamp = new Date().toISOString();
      const tasks = [{ id: 'task', title: '节点菜单验证', status: 'active',
        createdAt: stamp, updatedAt: stamp, nodes: Array.from({ length: 45 }, (_, i) => ({ id: `n${i}`, title: `处理步骤 ${i}`,
          status: 'todo', order: i + 1, children: i === 35 ? [{ id: 'child', title: '现有子节点', order: 1, children: [] }] : [] })) }];
    run = await launchRepository({tasks}, 'node-context-menu');
    const {app,page,errors}=run;
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1280,820));
    await page.waitForSelector('.flow-scroll');
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const open = async id => {
      // The desktop closes context menus on native window blur. Bring this
      // test's main window forward before exercising a right-click.
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).focus());
      await page.waitForFunction(()=>document.hasFocus());
      await page.locator(`.node-title[data-node-id="${id}"]`).scrollIntoViewIfNeeded();
      await settle();
      await page.locator(`.node-title[data-node-id="${id}"]`).click({ button: 'right', position: { x: 25, y: 20 } });
      await page.waitForSelector('.node-context-menu');
      assert.equal(await page.locator('.node-context-menu button').count(), 4);
    };
    const nameDraft = async text => {
      assert.equal(await page.locator('[data-shell-node-draft]').count(), 1, 'one draft at the intended level');
      await page.waitForFunction(() => document.activeElement?.matches('[data-shell-node-draft]'));
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !state.focusNodeTitleId);
      await settle();
    };
    const tree = () => page.evaluate(() => state.tasks.find(t => t.id === 'task').nodes);

    // Opening/dismissing on a scrolled flow keeps the exact DOM and inspector.
    await page.locator('.node-title[data-node-id="n35"]').scrollIntoViewIfNeeded();
    await page.locator('.node-title[data-node-id="n35"]').click();
    await settle();
    await page.locator('.node-title[data-node-id="n35"]').scrollIntoViewIfNeeded();
    await settle();
    const before = await page.evaluate(() => {
      window.__flowMenuDOM = document.querySelector('.flow-scroll');
      window.__flowMenuInspector = document.querySelector('.inspector');
      return { top: window.__flowMenuDOM.scrollTop, node: state.selectedNodeId };
    });
    await open('n35');
    assert.deepEqual(await page.evaluate(() => ({ top: document.querySelector('.flow-scroll').scrollTop,
      node: state.selectedNodeId })), before);
    assert.equal(await page.evaluate(() => document.querySelector('.flow-scroll') === window.__flowMenuDOM &&
      document.querySelector('.inspector') === window.__flowMenuInspector), true);
    await page.locator('.node-context-menu button').first().focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.node-context-menu').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.nodeId), 'n35');

    // A sibling is inserted after the target, before its next sibling.
    await open('n35');
    await page.getByRole('menuitem', { name: '添加同级节点' }).click();
    await nameDraft('新增兄弟');
    let nodes = await tree();
    assert.deepEqual(nodes.slice(35, 38).map(n => n.title), ['处理步骤 35', '新增兄弟', '处理步骤 36']);
    assert.equal(nodes[36].parentId, null);
    assert.ok(await page.locator('.flow-scroll').evaluate(el => el.scrollTop) > 0);

    // Collapsed parents expand; child creation never leaks a draft at root.
    await page.locator('[data-action="toggle-node-collapse"][data-node-id="n35"]').click();
    await open('n35');
    await page.getByRole('menuitem', { name: '添加子节点' }).click();
    assert.equal(await page.locator('.flow-children [data-shell-node-draft]').count(), 1);
    await nameDraft('新增子节点');
    nodes = await tree();
    assert.equal(nodes[35].collapsed, false);
    assert.deepEqual(nodes[35].children.map(n => n.title), ['现有子节点', '新增子节点']);
    assert.equal(nodes[35].children[1].parentId, 'n35');

    // Nested sibling/child creation and Esc cancellation retain the hierarchy.
    await open('child');
    await page.getByRole('menuitem', { name: '添加同级节点' }).click();
    await nameDraft('子层兄弟');
    await open('child');
    await page.getByRole('menuitem', { name: '添加子节点' }).click();
    await nameDraft('孙节点');
    nodes = await tree();
    assert.deepEqual(nodes[35].children.map(n => n.title), ['现有子节点', '子层兄弟', '新增子节点']);
    assert.equal(nodes[35].children[1].parentId, 'n35');
    assert.equal(nodes[35].children[0].children[0].parentId, 'child');
    await open('child');
    await page.getByRole('menuitem', { name: '添加子节点' }).click();
    await page.keyboard.press('Escape');
    assert.deepEqual(await tree(), nodes);

    // Empty drafts cancel on outside clicks without consuming the target action.
    const expectCancelled = async () => {
      await page.waitForFunction(() => !state.focusNodeTitleId);
      assert.equal(await page.locator('[data-shell-node-draft]').count(), 0);
      assert.deepEqual(await tree(), nodes);
      assert.equal(await page.locator('[data-pane="flow"] .pane-count').innerText(),
        String(await page.evaluate(() => shellNodeList(shellActiveTask()).length)));
    };
    await page.locator('.add-node').click();
    await page.locator('[data-shell-node-draft]').click();
    assert.equal(await page.locator('[data-shell-node-draft]').count(), 1, 'inside clicks keep the draft');
    await page.locator('.flow-toolbar > span').click();
    await expectCancelled();

    await open('n35');
    await page.getByRole('menuitem', { name: '添加同级节点' }).click();
    await page.locator('[data-shell-node-draft]').fill('   ');
    await page.locator('.node-title[data-node-id="n36"]').click({ position: { x: 25, y: 20 } });
    await expectCancelled();
    assert.equal(await page.evaluate(() => state.selectedNodeId), 'n36', 'the clicked node still opens');

    await open('child');
    await page.getByRole('menuitem', { name: '添加子节点' }).click();
    await page.locator('#search').click();
    await expectCancelled();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'search', 'outside input retains focus');
    await page.keyboard.press('Escape');

    await open('n44');
    await page.getByRole('menuitem', { name: '添加子节点' }).click();
    await page.locator('.flow-toolbar > span').click();
    await expectCancelled();
    assert.equal(await page.locator('.collapse[data-node-id="n44"]').isDisabled(), true);

    await page.locator('.add-node').click();
    const oldDraft = await page.evaluate(() => state.focusNodeTitleId);
    await page.locator('.add-node').click();
    await page.waitForFunction(old => state.focusNodeTitleId && state.focusNodeTitleId !== old, oldDraft);
    assert.equal(await page.locator('[data-shell-node-draft]').count(), 1, 'add again leaves exactly one fresh draft');
    assert.equal(await page.evaluate(id => Boolean(findNode(shellActiveTask().nodes, id)), oldDraft), false);
    await page.locator('.flow-toolbar > span').click();
    await expectCancelled();
    await page.waitForFunction(async () => !(await window.personalTaskTrack.storage.read()).tasks[0].nodes
      .some(node => !node.title.trim()));

    // Existing hover plus uses the same task identity and inline naming path.
    await page.locator('.node-title[data-node-id="child"]').hover();
    await page.locator('.node-add[data-node-id="child"]').click();
    await nameDraft('快捷添加');
    await open('child');
    await page.getByRole('menuitem', { name: '添加子节点' }).click();
    await page.locator('[data-shell-node-draft]').fill('失焦保存标题');
    await page.locator('.flow-toolbar > span').click();
    await page.waitForFunction(() => !state.focusNodeTitleId);
    assert.ok((await tree())[35].children[0].children.some(node => node.title === '失焦保存标题'));
    const saved = await tree();
    await page.waitForFunction(async () => (await window.personalTaskTrack.storage.read()).tasks[0].nodes
      .find(n => n.id === 'n35').children[0].children.some(n => n.title === '快捷添加'));
    await page.evaluate(()=>flushSave()); await page.reload(); await page.waitForSelector('.flow-scroll');
    assert.deepEqual(await tree(), saved, 'names and hierarchy survive a reload');

    // Keyboard menu navigation, viewport clamping, and theme tokens.
    await page.locator('.node-title[data-node-id="n35"]').scrollIntoViewIfNeeded();
    await page.locator('.node-title[data-node-id="n35"]').focus();
    await settle();
    await page.keyboard.press('Shift+F10');
    await page.waitForSelector('.node-context-menu');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'add-sibling-node');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'add-child-node');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'share-node');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'delete-node');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'add-sibling-node');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'delete-node');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'add-sibling-node');
    await page.keyboard.press('Escape');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { state.theme = theme; render(); }, theme);
      await open('n44');
      const box = await page.locator('.node-context-menu').boundingBox();
      assert.ok(box.x >= 12 && box.y >= 12 && box.x + box.width <= 1268 && box.y + box.height <= 770);
      assert.equal(await page.locator('.node-context-menu').evaluate(el => getComputedStyle(el).backgroundColor),
        await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor));
      if (process.env.LOOP_TEST_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.LOOP_TEST_SCREENSHOT_DIR, `node-menu-${theme}.png`) });
      await page.keyboard.press('Escape');
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1000,680));
    await open('n44');
    const narrowMenu = await page.locator('.node-context-menu').boundingBox();
    assert.ok(narrowMenu.x + narrowMenu.width <= 988 && narrowMenu.y + narrowMenu.height <= 630);
    await page.getByRole('menuitem', { name: '添加子节点' }).click();
    await nameDraft('窄窗口子节点');
    assert.equal((await tree()).find(n => n.id === 'n44').children[0].title, '窄窗口子节点');
    assert.deepEqual(errors, []);
    console.log('Node context menu passed: sibling/child/nested creation, empty/whitespace outside cancellation, click/focus retention, fresh drafts, persistence, DOM/scroll retention, keyboard, light/dark, edge clamping.');
  } finally { await run?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

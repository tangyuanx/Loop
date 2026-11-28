// Real production Electron: node completion and inline editing.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, resizeRepositoryWindow, task } = require('./electron-ui-helpers.cjs');
const { openFlowOptions } = require('./workbench-helpers.cjs');
const node = (id, status, conclusion, children = []) => ({ id, title: id, status, conclusion, note: '记录-' + id, children });
(async () => {
  const run = await launchRepository({ tasks: [task('task', { title: '节点状态与结论行高', tags: { blocked: true, later: true }, nodes: [
    node('one', 'todo', '一行短结论。', [node('child', 'todo', '子节点有自己的结论。')]),
    node('two', 'todo', '第一行结论。\n第二行结论。'),
    node('empty', 'todo', ''),
    node('legacy-blocked', 'blocked', '保留原结论。'),
    node('legacy-later', 'later', '保留稍后节点的结论。'),
  ] })] }, 'node-completion');
  const { app, page, errors } = run;
  const row = id => page.locator('.flow-row[data-node-id="' + id + '"]');
  const checkbox = id => row(id).locator('.node-status');
  const cell = id => row(id).locator('.flow-conclusion');
  const editor = page.locator('[data-shell-node-conclusion]');
  const model = id => page.evaluate(id => structuredClone(findNode(shellActiveTask().nodes, id)), id);
  const settle = () => page.evaluate(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {})));
  });
  const snapshot = id => page.evaluate(id => {
    const row = document.querySelector('.flow-row[data-node-id="' + id + '"]'), r = row.getBoundingClientRect();
    const next = [...document.querySelectorAll('.flow-row')][[...document.querySelectorAll('.flow-row')].indexOf(row) + 1]?.getBoundingClientRect();
    const field = row.querySelector('[data-shell-node-conclusion]'), fieldStyle = field && getComputedStyle(field), cellStyle = getComputedStyle(row.querySelector('.flow-conclusion'));
    return { height: r.height, nextTop: next?.top, tabsTop: document.querySelector('.tabs-bar').getBoundingClientRect().top,
      editor: fieldStyle && { font: fieldStyle.fontSize, line: fieldStyle.lineHeight, padding: fieldStyle.padding, border: fieldStyle.borderWidth, box: fieldStyle.boxSizing },
      cell: { font: cellStyle.fontSize, line: cellStyle.lineHeight } };
  }, id);
  try {
    await page.locator('.flow-scroll').waitFor();
    await resizeRepositoryWindow(app, page, 1440, 985);
    await settle();
    const legacy = [(await model('legacy-blocked')).status, (await model('legacy-later')).status];
    const desktopRead = await page.evaluate(async () => (await personalTaskTrack.storage.read()).tasks[0].nodes.map(n => n.status));
    assert.deepEqual(desktopRead, ['todo', 'todo', 'todo', ...legacy], 'desktop and renderer agree on node status');
    assert.match(await checkbox('one').getAttribute('aria-label'), /未完成，切换为已完成$/);
    const child = await model('child');
    await checkbox('one').click(); await settle();
    assert.equal((await model('one')).status, 'done');
    assert.match(await checkbox('one').getAttribute('aria-label'), /已完成，切换为待确认$/);
    assert.equal(await cell('one').evaluate(el => el.matches('.nnote-fold')), true);
    assert.ok((await model('one')).completedAt);
    assert.deepEqual(await model('child'), child, 'checking a parent never changes its child');
    const completedColors = await page.evaluate(() => ({
      title: getComputedStyle(document.querySelector('.flow-row[data-node-id="one"] .node-title')).color,
      conclusion: getComputedStyle(document.querySelector('.flow-row[data-node-id="one"] .flow-conclusion')).color,
      child: getComputedStyle(document.querySelector('.flow-row[data-node-id="child"] .flow-conclusion')).color,
    }));
    assert.notEqual(completedColors.title, completedColors.child, 'completed title uses a quieter tone than unfinished content');
    assert.notEqual(completedColors.conclusion, completedColors.child, 'unfinished child remains fully readable');
    assert.equal(await page.locator('.status-menu').count(), 0);
    await checkbox('one').press('Space'); await settle();
    assert.equal((await model('one')).status, 'review');
    assert.equal((await model('one')).completedAt, '');
    await checkbox('one').press('Enter'); await settle();
    assert.equal((await model('one')).status, 'todo');
    await checkbox('one').click({ modifiers: ['Shift'] });
    await page.getByRole('menu', { name: '选择节点状态' }).waitFor();
    assert.equal((await model('one')).status, 'todo');
    await page.getByRole('menuitemradio', { name: /已完成/ }).click();
    assert.equal((await model('one')).status, 'done');
    await checkbox('one').click(); await checkbox('one').click();
    assert.equal((await model('one')).status, 'todo');
    // The two task-level tags are independent of node completion.
    assert.deepEqual(await page.evaluate(() => ({ blocked: shellActiveTask().tags.blocked, later: shellActiveTask().tags.later })), { blocked: true, later: true });
    for (const config of [{ width: 1440, theme: 'light', fontScale: 'large' }, { width: 1024, theme: 'dark', fontScale: 'largest' }]) {
      await resizeRepositoryWindow(app, page, config.width, 985);
      await page.evaluate(config => { state.theme = config.theme; state.fontScale = config.fontScale; render(); }, config);
      await settle();
      const alignment = await row('one').evaluate(el => {
        const t = el.querySelector('.node-title'), status = el.querySelector('.node-status'), title = t.getBoundingClientRect(), box = status.getBoundingClientRect();
        return Math.abs(box.y + box.height / 2 - title.y - parseFloat(getComputedStyle(t).paddingTop) - parseFloat(getComputedStyle(t).lineHeight) / 2);
      });
      assert.ok(alignment <= .6, 'status button aligns with the first text line at every font size');
      for (const id of ['one', 'two', 'empty']) {
        await row(id).locator('.node-title').click(); await settle();
        const before = await snapshot(id);
        const original = (await model(id)).conclusion;
        await page.keyboard.press('n'); await settle();
        const during = await snapshot(id);
        assert.equal(during.tabsTop, before.tabsTop);
        assert.match(await row(id).locator('.node-conclusion-keys').textContent(), /⇧↵ 换行/);
        await editor.fill((await editor.inputValue()) + '\n新增一行用于验证按内容增长。'); await settle();
        assert.ok((await snapshot(id)).height > during.height);
        await page.keyboard.press('Escape'); await settle();
        assert.equal((await model(id)).conclusion, original);
      }
    }
    // Hidden-completed still preserves unfinished descendants and saves a pending record.
    await page.evaluate(() => { state.theme = 'light'; state.fontScale = 'large'; render(); });
    await page.evaluate(() => updateNodeNoteDraft('task', 'one', '切换完成前的记录'));
    await (await openFlowOptions(page)).getByRole('button',{name:'隐藏已完成'}).click();
    await checkbox('one').click(); await settle();
    assert.equal(await row('one').count(), 0);
    assert.equal((await model('one')).note, '切换完成前的记录');
    assert.equal((await model('one')).conclusion, '一行短结论。');
    await page.getByRole('button', { name: '清除筛选' }).click(); await settle();
    await checkbox('one').click(); await checkbox('one').click(); await settle();
    await page.evaluate(() => flushSave());
    const saved = JSON.parse(await fs.readFile(path.join(run.profile, 'task-data.json'), 'utf8'));
    assert.equal(saved.tasks[0].nodes[0].status, 'todo');
    await page.reload(); await page.locator('.flow-scroll').waitFor();
    assert.equal((await model('one')).status, 'todo');
    assert.equal((await model('one')).note, '切换完成前的记录');
    assert.equal((await model('legacy-later')).conclusion, '保留稍后节点的结论。');
    assert.deepEqual(errors, []);
    console.log('PASS: three-state pointer/keyboard activation, status menu, children/task tags, conclusion editor (light/dark, large type), record flush and restart.');
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

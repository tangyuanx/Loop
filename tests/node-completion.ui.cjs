// Real production Electron: two-state completion and editing without spare rows.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const { openFlowOptions } = require('./workbench-helpers.cjs');
const node = (id, status, conclusion, children = []) => ({ id, title: id, status, conclusion, note: '记录-' + id, children });
(async () => {
  const run = await launchRepository({ tasks: [task('task', { title: '二态勾选与结论行高', tags: { blocked: true, later: true }, nodes: [
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
    await page.locator('.flow-column-head').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1440, 985));
    await settle();
    assert.equal((await model('legacy-blocked')).status, 'todo');
    assert.equal((await model('legacy-later')).status, 'todo');
    const desktopRead = await page.evaluate(async () => (await personalTaskTrack.storage.read()).tasks[0].nodes.map(n => n.status));
    assert.deepEqual(desktopRead, ['todo', 'todo', 'todo', 'todo', 'todo'], 'desktop read normalization also has two states');
    assert.match(await checkbox('one').getAttribute('aria-label'), /未完成，切换为已完成$/);
    assert.equal(await checkbox('one').innerText(), '未完成');
    const child = await model('child');
    await checkbox('one').click(); await settle();
    assert.equal((await model('one')).status, 'done');
    assert.match(await checkbox('one').getAttribute('aria-label'), /已完成，切换为未完成$/);
    assert.equal(await checkbox('one').innerText(), '已完成');
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
    assert.equal((await model('one')).status, 'todo');
    assert.equal((await model('one')).completedAt, '');
    await checkbox('one').press('Enter'); await settle();
    assert.equal((await model('one')).status, 'done');
    await checkbox('one').press('Enter'); await settle();
    assert.equal((await model('one')).status, 'todo');
    await checkbox('legacy-blocked').click(); await settle();
    assert.equal((await model('legacy-blocked')).status, 'done');
    await checkbox('legacy-blocked').click(); await settle();
    assert.equal((await model('legacy-blocked')).status, 'todo');
    // The two task-level tags are independent of node completion.
    assert.deepEqual(await page.evaluate(() => ({ blocked: shellActiveTask().tags.blocked, later: shellActiveTask().tags.later })), { blocked: true, later: true });
    for (const config of [{ width: 1440, theme: 'light', fontScale: 'large' }, { width: 1024, theme: 'dark', fontScale: 'largest' }]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width, 985), config.width);
      await page.evaluate(config => { state.theme = config.theme; state.fontScale = config.fontScale; render(); }, config);
      await settle();
      const alignment = await row('one').evaluate(el => {
        const t = el.querySelector('.node-title'), status = el.querySelector('.node-status'), title = t.getBoundingClientRect(), box = status.getBoundingClientRect();
        return Math.abs(box.y + box.height / 2 - title.y - parseFloat(getComputedStyle(t).lineHeight) / 2);
      });
      assert.ok(alignment <= .6, 'status button aligns with the first text line at every font size');
      for (const id of ['one', 'two', 'empty']) {
        await cell(id).locator('.node-conclusion-text').scrollIntoViewIfNeeded(); await settle();
        const before = await snapshot(id);
        const original = (await model(id)).conclusion;
        await cell(id).locator('.node-conclusion-text').click(); await settle();
        const during = await snapshot(id);
        assert.ok(Math.abs(during.height - before.height) <= 1, id + ' editing must not add a spare line: ' + JSON.stringify({ before, during }));
        assert.ok(Math.abs(during.nextTop - before.nextTop) <= 1, id + ' editing keeps the next row in place');
        assert.equal(during.tabsTop, before.tabsTop);
        assert.equal(await page.locator('.conclusion-edit-hint').count(), 0);
        await editor.fill(original + '\n新增一行用于验证按内容增长。'); await settle();
        assert.ok((await snapshot(id)).height > during.height);
        await page.keyboard.press('Escape'); await settle();
        assert.equal((await model(id)).conclusion, original);
      }
    }
    // Hidden-completed still preserves unfinished descendants and saves a pending record.
    await page.evaluate(() => { state.theme = 'light'; state.fontScale = 'large'; render(); });
    await row('one').locator('.node-title').click();
    await row('one').locator('.node-record-action').click();
    await page.locator('[data-shell-node-record]').fill('切换完成前的记录');
    await (await openFlowOptions(page)).getByRole('button',{name:'隐藏已完成'}).click();
    await checkbox('one').click(); await settle();
    assert.equal(await row('one').count(), 0);
    assert.equal((await model('one')).note, '切换完成前的记录');
    assert.equal((await model('one')).conclusion, '一行短结论。');
    await (await openFlowOptions(page)).getByRole('button',{name:'显示已完成'}).click(); await settle();
    await checkbox('one').click(); await settle();
    await page.evaluate(() => flushSave());
    const saved = JSON.parse(await fs.readFile(path.join(run.profile, 'task-data.json'), 'utf8'));
    assert.ok(saved.tasks[0].nodes.every(n => ['todo', 'done'].includes(n.status)));
    await page.reload(); await page.locator('.flow-column-head').waitFor();
    assert.equal((await model('one')).status, 'todo');
    assert.equal((await model('one')).note, '切换完成前的记录');
    assert.equal((await model('legacy-later')).conclusion, '保留稍后节点的结论。');
    assert.deepEqual(errors, []);
    console.log('PASS: square checkbox pointer/Space/Enter, binary states, legacy normalization, independent children/task tags, no spare editor rows (empty/one/two lines, light/dark largest), record flush and restart.');
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

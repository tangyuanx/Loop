// Real Electron: scopes, search/IME, keyboard, batch undo and list geometry.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

(async () => {
  const run = await launchRepository({ taskGroups: [{ id: 'work', title: '开发工作', order: 1 }, { id: 'other', title: '另一分组', order: 2 }], tasks: [
    task('today', { title: '定位缓存一致性问题', priority: 'high', groupId: 'work', tags: { today: true }, deadlineAt: new Date(Date.now() - 86400000).toISOString(),
      nodes: [{ id: 'first', title: '收集现场日志', status: 'todo', children: [] }, { id: 'second', title: '验证修复', status: 'blocked', children: [] }] }),
    task('later', { title: '整理学习资料', groupId: 'work', order: 2 }),
    task('done', { title: '完成记录', groupId: 'work', status: 'done', resolvedAt: new Date().toISOString(), order: 3 }),
    task('foreign', { title: '其他分组逾期任务', groupId: 'other', deadlineAt: new Date(Date.now() - 86400000).toISOString(), order: 4 }),
    task('long', { title: '这是一个很长的任务标题，用于确认长标题不会撑宽任务列表，也不会改变其他任务的行高'.repeat(4), order: 5 }),
    task('note', { title: '速记内容', captureSource: 'today-widget', order: 6 }), task('blank', { title: '', order: 7 }),
  ] }, 'product');
  const { page, app } = run;
  const ids = () => page.evaluate(() => filteredTasks().map(t => t.id));
  const clear = () => page.locator('.active-list-filters [data-action="clear-list-filters"]').click();
  const filter = async (field, value) => {
    await page.locator('[data-action="open-combined-filter"]').click();
    await page.locator(`#record-${field}`).selectOption(value, { force: true });
    await page.locator('#combined-filter-form button[type="submit"]').click();
  };
  try {
    assert.equal(await page.locator('.task-list-meta').count(), 0);
    assert.equal(await page.locator('[data-task-row="blank"] .task-item-title').innerText(), '未命名任务');
    await page.locator('[data-task-row="today"] .task-select').click();
    await page.locator('[data-action="focus-next-pending"]').click();
    assert.equal(await page.evaluate(() => state.selectedNodeId), 'first');
    await page.locator('[data-action="focus-next-pending"]').click();
    assert.equal(await page.evaluate(() => state.selectedNodeId), 'second');
    await page.locator('.navigation [data-value="today"]').click();
    await filter('priority', 'low');
    assert.equal(await page.locator('.workspace-empty h2').innerText(), '没有匹配的任务');
    await clear(); assert.equal(await page.evaluate(() => shellRoute()), 'today');
    await page.locator('[data-action="show-today-completed"]').click();
    await filter('priority', 'low'); await clear();
    assert.equal(await page.evaluate(() => state.todayFilter), 'done');
    await page.locator('.navigation [data-group-id="work"]').click();
    await page.locator('.filter-tab[data-value="done"]').click();
    await filter('priority', 'low'); await clear(); assert.deepEqual(await ids(), ['done']);
    await page.locator('.filter-tab[data-value="active"]').click();
    await filter('deadline', 'overdue');
    assert.equal(await page.evaluate(() => state.activeGroupId), 'work');
    assert.deepEqual(await ids(), ['today'], 'deadline filter stays inside the selected group');
    await clear(); assert.deepEqual(await ids(), ['today', 'later']);
    await filter('kind', 'quick'); assert.deepEqual(await ids(), []); await clear();
    await page.locator('.navigation [data-value="all"]').click();
    assert.equal(await page.evaluate(() => state.activeGroupId), 'group_all');
    await filter('kind', 'quick'); assert.deepEqual(await ids(), ['note']); await clear();
    await page.locator('#search').fill('现场日志');
    assert.deepEqual(await ids(), ['today']);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.taskId), 'today');
    await page.locator('#search').fill('找不到的内容');
    assert.match(await page.locator('#task-results .empty').innerText(), /没有匹配的任务/);
    await page.locator('#search').press('Escape'); assert.equal(await page.evaluate(() => state.query), '');
    await page.locator('#search').evaluate(input => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.value = '速记'; input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    assert.equal(await page.evaluate(() => state.query), '');
    await page.locator('#search').evaluate(input => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    assert.deepEqual(await ids(), ['note']); await page.locator('[data-action="clear-search"]').click();
    await page.locator('[data-bulk-action="start"]').click();
    await page.evaluate(() => { render(); render(); shellBindBulk(); shellBindBulk(); });
    await page.locator('[data-bulk-id="later"]').click();
    assert.deepEqual(await page.evaluate(() => [...shellBulk.ids]), ['later'], 'one click selects once after retained renders');
    await page.locator('[data-bulk-action="more"]').click();
    await page.locator('[data-bulk-action="priority"]').click();
    await page.locator('[data-bulk-action="choose-priority"][data-bulk-value="high"]').click();
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'later').priority), 'high');
    await page.locator('[data-bulk-action="undo"]').click();
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'later').priority), 'medium');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.bulk-row').count(), 0);
    await page.locator('[data-task-row="later"] .task-select').click();
    await page.locator('[data-task-row="later"] .task-select').press('F2');
    await page.locator('#manage24-row-title').fill(''); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#manage24-row-title').getAttribute('aria-invalid'), 'true');
    await page.locator('#manage24-row-title').fill('重命名学习资料'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => state.tasks.find(t => t.id === 'later').title === '重命名学习资料');
    await page.locator('.task-select').first().focus(); await page.keyboard.press('Control+n');
    await page.locator('#create-form').waitFor(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#create-form').count(), 0);
    await page.keyboard.press('Control+k'); assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
    // The real properties and move panels preserve the task's existing data.
    await page.locator('[data-task-row="later"] .task-select').click();
    await page.locator('[data-action="open-task-menu"]').click();
    await page.locator('[data-manage24="properties"]').click();
    await page.locator('[data-manage24-priority="low"]').click();
    await page.locator('[data-manage24="time"]').click();
    await page.locator('#manage24-date').fill('2030-01-15');
    await page.locator('#manage24-time-input').fill('16:30');
    await page.locator('#manage24-cycle').selectOption('daily', { force: true });
    await page.locator('#manage24-property-form button[type="submit"]').click();
    await page.waitForFunction(() => state.tasks.find(t => t.id === 'later').recurrence.frequency === 'daily');
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'later').priority), 'low');
    assert.equal(await page.evaluate(() => localDateKey(new Date(state.tasks.find(t => t.id === 'later').deadlineAt))), '2030-01-15');
    await page.locator('[data-action="open-task-menu"]').click();
    await page.locator('[data-task-menu] [data-action="toggle-task-group-select"]').click();
    await page.locator('[data-manage24-target="other"]').click();
    await page.locator('#manage24-move-form button[type="submit"]').click();
    await page.waitForFunction(() => state.tasks.find(t => t.id === 'later').groupId === 'other');
    assert.equal(await page.evaluate(() => state.activeGroupId), 'group_all');
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'later').recurrence.frequency), 'daily');
    const source = await page.locator('[data-task-row="long"]').boundingBox();
    const target = await page.locator('[data-task-row="today"]').boundingBox();
    // The completion button replaces the sequence on hover; the row's inset
    // is the production long-press drag area rather than that action button.
    await page.mouse.move(source.x + 2, source.y + source.height / 2);
    await page.mouse.down(); await page.waitForFunction(() => taskDragState?.active);
    await page.mouse.move(target.x + 12, target.y + 3, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => filteredTasks()[0].id === 'long');
    await page.waitForFunction(() => Date.now() >= suppressTaskClickUntil);
    await page.locator('[data-bulk-action="start"]').click();
    await page.locator('[data-bulk-id="today"]').click(); await page.locator('[data-bulk-id="note"]').click();
    await page.locator('[data-bulk-action="complete"]').click();
    assert.match(await page.locator('.bulk-review-count').innerText(), /1 项可以完成.*1 项保持原状/);
    await page.locator('[data-bulk-action="confirm-complete"]').click();
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'today').status), 'active');
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'note').status), 'done');
    await page.locator('[data-bulk-action="undo"]').click();
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'note').status), 'active');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { state.taskDateFilter = '2030-01-15'; render(); });
    await page.locator('[data-action="clear-list-date-filter"]').click();
    assert.equal(await page.evaluate(() => state.taskDateFilter), '');
    // Calendar/review task detours retain their original page and focus route.
    await page.locator('.navigation [data-action="toggle-calendar"]').click();
    await page.evaluate(() => openTaskFromGlobalList('today'));
    await page.evaluate(() => render());
    await page.locator('[data-action="return-global-page"]').click();
    assert.equal(await page.evaluate(() => shellRoute()), 'calendar');
    await page.locator('.navigation [data-action="toggle-review"]').click();
    await page.evaluate(() => { openTaskFromGlobalList('today'); render(); });
    await page.locator('[data-action="return-global-page"]').click();
    assert.equal(await page.evaluate(() => shellRoute()), 'review');
    await page.locator('.navigation [data-value="all"]').click();
    for (const theme of ['light', 'dark']) for (const width of [1024, 1280]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width, 820), width);
      await page.evaluate(theme => { state.theme = theme; render(); }, theme);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const rows = await page.locator('.task-rows > .task-item').evaluateAll(es => es.map(e => ({ height: e.getBoundingClientRect().height, width: e.getBoundingClientRect().width, parent: e.parentElement.getBoundingClientRect().width })));
      for (const row of rows) { assert.equal(row.height, 44); assert.equal(row.width, row.parent); }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator('.topbar').evaluate(e => e.getBoundingClientRect().height), 48);
      if (process.env.LOOP_TEST_SCREENSHOT_DIR) { await fs.mkdir(process.env.LOOP_TEST_SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.LOOP_TEST_SCREENSHOT_DIR, `product-${theme}-${width}.png`) }); }
    }
    assert.deepEqual(run.errors, []);
    console.log('PASS: real Electron scope/status, quick notes, search/IME/keyboard, batch single binding/mixed completion/undo, rename errors, dates/recurrence, move, long-press reorder, calendar/review return and light/dark geometry.');
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

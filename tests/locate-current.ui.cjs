const assert = require('node:assert/strict');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

(async () => {
  const stamp = new Date().toISOString();
  const completions = Array.from({ length: 55 }, (_, index) => task(`locate-${index}`, {
    title: `定位验收 ${index}`, groupId: 'work', order: index + 10, status: 'done', resolvedAt: stamp,
    notes: index === 27 ? '# 定位验收\n\n' + '保留右栏的编辑内容和滚动位置。\n\n'.repeat(100) : '',
  }));
  const pending = Array.from({ length: 35 }, (_, index) => task(`pending-${index}`, {
    title: `今日待办 ${index}`, groupId: 'work', order: index + 1, tags: { today: true },
  }));
  const run = await launchRepository({
    taskGroups: [{ id: 'work', title: '验收分组', order: 1 }],
    tasks: [...pending, ...completions, task('quick-note', { title: '验收速记', captureSource: 'today-widget' })],
    markdownMode: 'source',
  }, 'locate-current');
  const { page, app } = run;
  try {
    const todayNav = page.locator('.navigation [data-value="today"]');
    await todayNav.click();
    const footer = page.locator('.list-foot');
    assert.deepEqual(await footer.locator('button').allTextContents(), ['定位当前', '多选']);
    await page.locator('.list-filter [data-action="set-today-filter"][data-value="done"]').click();
    assert.deepEqual(await footer.locator('button').allTextContents(), ['定位当前', '多选']);
    const list = page.locator('#task-results');
    const selected = list.locator('[data-task-row="locate-27"] .task-select');
    await selected.click();
    await page.locator('[data-action="switch-task-pane"][data-pane="notes"]').click();
    await page.waitForFunction(() => knowledgeCurrentEntry()?.view);
    await page.evaluate(() => {
      window.locateEditor = knowledgeCurrentEntry();
      locateEditor.insertText('待保存的文字 ');
      locateEditor.view.dispatch({ selection: { anchor: 20, head: 28 } });
      document.querySelector('.knowledge-body').scrollTop = 300;
      document.querySelector('#task-results').scrollTop = 0;
    });
    const locate = page.getByRole('button', { name: '定位当前', exact: true });
    const bulk = page.locator('.list-foot [data-bulk-action="start"]');
    const assertFooterEdges = async () => {
      const offsets = await page.locator('.list-foot').evaluate(footer => {
        const rect = footer.getBoundingClientRect();
        const style = getComputedStyle(footer);
        const locate = footer.querySelector('.scale20-locate').getBoundingClientRect();
        const bulk = footer.querySelector('.bulk-entry').getBoundingClientRect();
        return [locate.left - rect.left - parseFloat(style.paddingLeft),
          rect.right - bulk.right - parseFloat(style.paddingRight)];
      });
      assert.ok(offsets.every(offset => Math.abs(offset) <= 1), `footer edge offsets: ${offsets}`);
    };
    const layout = () => page.evaluate(() => ({
      viewport: [scrollX, scrollY],
      panes: ['.nav-groups', '.task-list-pane', '.list-heading', '.list-foot', '.workspace'].map(selector => {
        const element = document.querySelector(selector);
        const { x, y, width, height } = element.getBoundingClientRect();
        return [x, y, width, height, element.scrollLeft, element.scrollTop];
      }),
      context: [shellRoute(), state.todayFilter, state.activeGroupId, state.activeTaskId, state.taskPane, state.query],
      editor: { same: locateEditor === knowledgeCurrentEntry(), text: locateEditor.getEditorText(),
        selection: locateEditor.view.state.selection.toJSON(), top: document.querySelector('.knowledge-body').scrollTop },
    }));
    await locate.waitFor();
    await assertFooterEdges();
    const before = await layout();
    assert.ok(before.editor.top > 0);
    const bulkBounds = await bulk.boundingBox();
    const { x, y, width, height } = await locate.boundingBox();
    await page.mouse.dblclick(x + width / 2, y + height / 2);
    await locate.waitFor({ state: 'hidden' });
    await assertFooterEdges();
    assert.deepEqual(await bulk.boundingBox(), bulkBounds);
    assert.equal(await page.evaluate(() => shellBulk.active), false);
    assert.deepEqual(await layout(), before);
    const centerOffset = await selected.evaluate(button => {
      const list = button.closest('#task-results');
      const row = button.closest('.task-item').getBoundingClientRect();
      return row.top + row.height / 2 - list.getBoundingClientRect().top - list.clientHeight / 2;
    });
    assert.ok(Math.abs(centerOffset) <= 1, 'locating centers a row away from the list boundaries');

    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await locate.waitFor();
    await locate.press('Enter');
    await locate.waitFor({ state: 'hidden' });
    assert.equal(await selected.evaluate(button => button === document.activeElement), true);
    assert.deepEqual(await layout(), before);
    await todayNav.click();
    assert.equal(await page.evaluate(() => state.todayFilter), 'active');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(window => window.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1024, 680));
    await page.waitForFunction(() => innerWidth <= 1024);
    await page.evaluate(() => {
      state.sidebarWidth = 230;
      state.fontScale = 'largest';
      render();
    });
    await list.locator('[data-task-row="pending-26"] .task-select').click();
    await page.waitForFunction(() => state.activeTaskId === 'pending-26');
    await list.evaluate(element => {
      const selected = element.querySelector('.task-item.selected');
      const rowTop = selected.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
      element.scrollTop = rowTop > element.scrollHeight / 2 ? 0 : element.scrollHeight;
    });
    await locate.waitFor();
    await assertFooterEdges();
    const narrowBulkBounds = await bulk.boundingBox();
    await locate.click();
    await locate.waitFor({ state: 'hidden' });
    await assertFooterEdges();
    assert.deepEqual(await bulk.boundingBox(), narrowBulkBounds);

    await page.locator('.navigation [data-value="active"]').click();
    await page.locator('.list-filter [data-action="toggle-quick-inbox"]').click();
    assert.equal(await list.locator('[data-task-row="quick-note"]').isVisible(), true);
    assert.deepEqual(run.errors, []);
    console.log('PASS: locating scrolls only the task list and preserves footer actions, note draft, and Today navigation.');
  } finally {
    await run.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

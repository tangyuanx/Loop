// Real renderer checks for choosing work and preserving scope while filtering.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

(async () => {
  const repository = path.resolve(__dirname, '..');
  const server = http.createServer(async (request, response) => {
    const file = path.resolve(repository, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(repository + path.sep)) return response.writeHead(403).end();
    try {
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.LOOP_TEST_CHROMIUM || undefined });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const stamp = new Date().toISOString();
      localStorage.setItem('task-flow-sheet-prototype-v2', JSON.stringify([
        { id: 'today', title: '定位缓存一致性问题', priority: 'high', groupId: 'work', tags: { today: true },
          createdAt: stamp, updatedAt: stamp, deadlineAt: new Date(Date.now() - 86400000).toISOString(),
          nodes: [{ id: 'first', title: '收集现场日志', status: 'todo', children: [] },
            { id: 'second', title: '验证修复', status: 'blocked', children: [] }] },
        { id: 'later', title: '整理学习资料', groupId: 'work', createdAt: stamp, updatedAt: stamp, nodes: [] },
        { id: 'long', title: '这是一个很长的任务标题，用于确认长标题不会撑宽任务列表，也不会改变其他任务的行高', createdAt: stamp, updatedAt: stamp, nodes: [] },
        { id: 'note', title: '速记', captureSource: 'quick', createdAt: stamp, updatedAt: stamp, nodes: [] },
        { id: 'blank', title: '', createdAt: stamp, updatedAt: stamp, nodes: [] },
      ]));
      localStorage.setItem('task-track-groups', JSON.stringify([{ id: 'work', title: '开发工作', order: 1 }]));
      localStorage.setItem('task-track-task-filter', 'all');
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/app/renderer/index.html`);
    await page.waitForSelector('.task-item');
    assert.equal(await page.locator('.task-list-meta').count(), 0, 'task titles have no subtitle');
    const assertUniformRows = async () => {
      const rows = await page.locator('.task-rows > .task-item').evaluateAll(elements => elements.map(el => {
        const { x, width, height } = el.getBoundingClientRect();
        const parent = el.parentElement.getBoundingClientRect();
        return { x, width, height, parentWidth: parent.width };
      }));
      assert.ok(rows.length >= 2);
      for (const row of rows) {
        assert.equal(row.x, rows[0].x, 'rows share the same left edge');
        assert.equal(row.width, rows[0].width, 'long and short tasks have equal width');
        assert.equal(row.width, row.parentWidth, 'rows fit their list');
        assert.equal(row.height, 44, 'all rows use the same single-line height');
      }
    };
    await assertUniformRows();
    assert.equal(await page.locator('[data-task-row="blank"] .task-item-title').innerText(), '未命名任务');
    await page.locator('[data-action="focus-next-pending"]').click();
    assert.equal(await page.evaluate(() => state.selectedNodeId), 'first', 'start from the first pending node');
    await page.locator('[data-action="focus-next-pending"]').click();
    assert.equal(await page.evaluate(() => state.selectedNodeId), 'second');

    // Applying and clearing Today filters must never change the route.
    await page.locator('.navigation [data-value="today"]').click();
    await page.locator('[data-action="open-combined-filter"]').click();
    await page.locator('#combined-filter-form button[type="submit"]').click();
    assert.equal(await page.evaluate(() => shellRoute()), 'today');
    await page.locator('[data-action="open-combined-filter"]').click();
    await page.locator('#record-priority').selectOption('low', { force: true });
    await page.locator('#combined-filter-form button[type="submit"]').click();
    assert.equal(await page.locator('.active-list-filters').count(), 1);
    assert.equal(await page.locator('.workspace-empty h2').innerText(), '没有匹配的任务');
    await page.locator('.active-list-filters [data-action="clear-list-filters"]').click();
    assert.equal(await page.evaluate(() => shellRoute()), 'today');
    assert.equal(await page.locator('.active-list-filters').count(), 0);

    // Group scope survives clearing optional filters, and empty flows offer entry.
    await page.locator('.navigation [data-action="select-nav-group"][data-group-id="work"]').click();
    await page.locator('[data-action="open-combined-filter"]').click();
    await page.locator('#record-priority').selectOption('low', { force: true });
    await page.locator('#combined-filter-form button[type="submit"]').click();
    await page.locator('.active-list-filters [data-action="clear-list-filters"]').click();
    assert.equal(await page.evaluate(() => state.activeGroupId), 'work');
    await page.locator('[data-task-row="later"] .task-select').click();
    await page.waitForSelector('.flow-start');
    assert.equal(await page.locator('.flow-start').count(), 1);
    await page.locator('.add-node').click();
    await page.locator('[data-shell-node-draft]').fill('整理第一份笔记');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !state.focusNodeTitleId);
    assert.equal(await page.locator('.flow-start').count(), 0);
    await page.locator('.task-select').first().focus();
    await page.keyboard.press('Control+n');
    await page.waitForSelector('#create-form');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#create-form').count(), 0);

    await page.evaluate(() => { state.activeGroupId = ALL_TASKS_GROUP_ID; state.taskFilter = 'all'; render(); });
    for (const theme of ['light', 'dark']) {
      for (const width of [1024, 1280]) {
        await page.setViewportSize({ width, height: 760 });
        await page.evaluate(theme => { state.theme = theme; render(); }, theme);
        await assertUniformRows();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.locator('[data-action="open-task-menu"]').evaluate(el => {
          const rect = el.getBoundingClientRect(); return rect.right <= innerWidth && rect.width >= 28;
        }), true);
        if (process.env.LOOP_TEST_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.LOOP_TEST_SCREENSHOT_DIR, `product-${theme}-${width}.png`) });
      }
    }
    assert.deepEqual(errors, []);
    console.log('Product experience passed: uniform single-line task rows, first pending step, Today/group filter scope, empty-flow creation, keyboard creation, light/dark and narrow layouts.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

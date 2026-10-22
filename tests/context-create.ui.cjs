// Exercise the real shell containers: legacy menu markup alone is insufficient.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

(async () => {
  const repository = path.resolve(__dirname, '..');
  const server = http.createServer(async (request, response) => {
    const file = path.resolve(repository, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(repository + path.sep)) { response.writeHead(403).end(); return; }
    try {
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.LOOP_TEST_CHROMIUM || undefined,
      args: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (localStorage.getItem('task-flow-sheet-prototype-v2')) return;
      const stamp = new Date().toISOString();
      localStorage.setItem('task-flow-sheet-prototype-v2', JSON.stringify([{ id: 'task', title: '右键新增验证',
        createdAt: stamp, updatedAt: stamp, tags: { today: true }, nodes: Array.from({ length: 40 }, (_, i) => ({
          id: `n${i}`, title: `步骤 ${i}`, status: 'todo', order: i + 1, children: [] })) }]));
      localStorage.setItem('task-track-task-filter', 'all');
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/app/renderer/index.html`);
    await page.waitForSelector('.flow-scroll');
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const blankMenu = async (selector, name) => {
      const target = page.locator(selector);
      const box = await target.boundingBox();
      // Left gutter is outside rows, inputs, and the inline add button.
      await page.mouse.click(box.x + 12, box.y + box.height - 8, { button: 'right' });
      await page.getByRole('menu', { name, exact: true }).waitFor();
    };
    const addNode = async title => {
      await page.getByRole('menuitem', { name: '新增节点', exact: true }).click();
      await page.locator('[data-shell-node-draft]').fill(title);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !state.focusNodeTitleId);
    };

    await page.locator('.node-title[data-node-id="n35"]').click();
    await page.locator('.node-title[data-node-id="n35"]').scrollIntoViewIfNeeded();
    await settle();
    const before = await page.evaluate(() => {
      window.__createFlow = document.querySelector('.flow-scroll');
      window.__createList = document.querySelector('.tasks-scroll');
      window.__createInspector = document.querySelector('.inspector');
      return { task: state.activeTaskId, node: state.selectedNodeId, draft: state.recordDraft, top: window.__createFlow.scrollTop };
    });
    // Rebinding retained regions must not duplicate menu activation.
    await page.evaluate(() => { bind(); bind(); });
    for (const [selector, name] of [['.flow-scroll', '处理流操作'], ['.tasks-scroll', '任务列表操作']]) {
      await blankMenu(selector, name);
      assert.deepEqual(await page.evaluate(() => ({ task: state.activeTaskId, node: state.selectedNodeId,
        draft: state.recordDraft, top: document.querySelector('.flow-scroll').scrollTop })), before);
      assert.equal(await page.evaluate(() => document.querySelector('.flow-scroll') === window.__createFlow
        && document.querySelector('.tasks-scroll') === window.__createList
        && document.querySelector('.inspector') === window.__createInspector), true);
      await page.getByRole('menu', { name, exact: true }).locator('button').focus();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#context-menu-root .context-menu').count(), 0);
    }
    await blankMenu('.flow-scroll', '处理流操作');
    await addNode('右键新增根节点');
    assert.equal(await page.evaluate(() => shellActiveTask().nodes.length), 41, 'one root created');
    assert.equal(await page.evaluate(() => shellActiveTask().nodes.at(-1).parentId), null);

    // Existing node and task menus must take precedence over blank-area menus.
    await page.locator('.node-title[data-node-id="n35"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '添加子节点', exact: true }).waitFor();
    assert.equal(await page.getByRole('menuitem', { name: '新增节点', exact: true }).count(), 0);
    await page.locator('.task-item[data-task-id="task"]').click({ button: 'right' });
    await page.locator('.task-context-menu').waitFor();
    assert.equal(await page.getByRole('menuitem', { name: '新增任务', exact: true }).count(), 0);

    await blankMenu('.tasks-scroll', '任务列表操作');
    await page.getByRole('menuitem', { name: '新增任务', exact: true }).click();
    await page.locator('#create-title').fill('右键创建任务');
    await page.locator('#create-form button[type="submit"]').click();
    await page.waitForFunction(() => state.tasks.some(task => task.title === '右键创建任务'));
    assert.equal(await page.evaluate(() => state.tasks.length), 2);

    // Empty flow and empty filtered lists still expose creation.
    await page.waitForSelector('.flow-scroll');
    assert.equal(await page.locator('.flow-row[data-context="node"]').count(), 0);
    await blankMenu('.flow-scroll', '处理流操作');
    await addNode('空处理流首个节点');
    await page.evaluate(() => { state.tasks = []; state.activeTaskId = ''; state.selectedNodeId = ''; render(); });
    await blankMenu('.tasks-scroll', '任务列表操作');
    await page.getByRole('menuitem', { name: '新增任务', exact: true }).click();
    await page.locator('#create-title').fill('空列表首个任务');
    await page.locator('#create-form button[type="submit"]').click();
    await page.waitForFunction(() => state.tasks.length === 1);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('task-flow-sheet-prototype-v2'))?.[0]?.title === '空列表首个任务');
    await page.reload();
    await page.waitForSelector('.task-item');
    assert.equal(await page.locator('.task-item').count(), 1);
    assert.deepEqual(errors, []);
    console.log('Context creation passed: real blank areas, root/task creation, empty lists/flows, row-menu precedence, retained DOM/selection/scroll, repeated bindings, persistence.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

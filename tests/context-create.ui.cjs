// Exercise the real shell containers: legacy menu markup alone is insufficient.
const assert = require('node:assert/strict');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

(async () => {
  const run = await launchRepository({ tasks: [task('task', { title: '右键新增验证', tags: { today: true }, nodes: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, title: `步骤 ${i}`, status: 'todo', order: i + 1, children: [] })) })] }, 'context-create');
  const { page, errors } = run;
  try {
    await page.waitForSelector('.flow-scroll');
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const blankMenu = async (selector, name) => {
      const target = page.locator(selector);
      const box = await target.boundingBox();
      // Left gutter is outside rows, inputs, and the inline add button.
      const point = { x: box.x + 12, y: box.y + box.height - 8 };
      const hit = await page.evaluate(({ x, y }) => ({ height: innerHeight, hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 500) }), point);
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.getByRole('menu', { name, exact: true }).waitFor()
        .catch(error => { throw new Error(`${error.message}; ${JSON.stringify({ selector, box, point, hit })}`); });
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
    await page.evaluate(async () => { save(); await flushSave(); });
    await page.reload();
    await page.waitForSelector('.task-item');
    assert.equal(await page.locator('.task-item').count(), 1);
    assert.deepEqual(errors, []);
    console.log('Context creation passed: real blank areas, root/task creation, empty lists/flows, row-menu precedence, retained DOM/selection/scroll, repeated bindings, persistence.');
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

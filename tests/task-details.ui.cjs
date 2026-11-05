const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

(async () => {
  const evidence = path.resolve('.local-review/task-details-20261030/ui');
  await fs.mkdir(evidence, { recursive: true });
  const run = await launchRepository({ activeTaskId: 'details', taskGroups: [
    { id: 'work', title: '产品设计', order: 1 },
    { id: 'long', title: '跨团队任务与知识工作空间的长期设计迭代', order: 2 },
  ], tasks: [task('details', { title: '任务详情整理验收', groupId: 'work', description: '保留任务背景与当前处理流。',
    nodes: [{ id: 'node', title: '核对任务属性与真实保存', note: '保留节点记录', children: [] }] })] }, 'task-details');
  const { app, page, errors } = run;
  const card = page.locator('.task-info-card');
  const field = action => card.locator(`[data-action="${action}"]`);
  const expand = async () => {
    await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    if (await field('toggle-task-info').getAttribute('aria-expanded') === 'false') await field('toggle-task-info').click();
    await page.locator('.task-info-body').waitFor({ state: 'visible' });
  };
  try {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/app/renderer/index.html')); w.setSize(1280, 820); w.focus(); });
    await expand();
    assert.deepEqual(await card.locator('.task-info-label').allTextContents(), ['分组', '优先级', '截止时间', '循环', '今日']);
    assert.doesNotMatch(await card.innerText(), /处理中|已完成/);
    assert.doesNotMatch(await page.evaluate(() => renderShellTaskProperties({ ...shellActiveTask(), status: 'done' })), /处理中|已完成/);
    assert.equal(await card.locator('.task-info-row').count(), 5);
    for (const action of ['toggle-deadline-picker', 'open-task-recurrence', 'toggle-task-tag']) {
      assert.equal(await field(action).locator('.task-info-value').innerText(), '', 'unset values stay blank');
    }
    const defaultWidth = (await card.boundingBox()).width;
    await page.screenshot({ path: path.join(evidence, 'light-1280-default.png') });

    // Toggling metadata does not remount the real tree or consume brief drafts.
    await page.locator('[data-brief21-key="details:description"]').fill('任务背景草稿仍在原位');
    await page.locator('.node-title[data-node-id=node]').click();
    await page.evaluate(() => { window.__detailsFlow = document.querySelector('.flow-scroll'); window.__detailsInspector = document.querySelector('.inspector'); });
    const width = await page.locator('.task-work-main').evaluate(el => el.getBoundingClientRect().width);
    await field('toggle-task-info').click();
    assert.equal(await field('toggle-task-info').getAttribute('aria-expanded'), 'false');
    await expand();
    assert.equal(await page.locator('.task-work-main').evaluate(el => el.getBoundingClientRect().width), width);
    assert.equal(await page.evaluate(() => document.querySelector('.flow-scroll') === window.__detailsFlow && document.querySelector('.inspector') === window.__detailsInspector && state.selectedNodeId === 'node'), true);
    assert.equal(await page.locator('[data-brief21-key="details:description"]').inputValue(), '任务背景草稿仍在原位');
    await field('toggle-task-group-select').focus();
    await page.keyboard.press('Escape');
    assert.equal(await field('toggle-task-info').getAttribute('aria-expanded'), 'false');
    await page.waitForFunction(() => document.activeElement?.dataset.action === 'toggle-task-info');
    await expand();

    // All five rows still drive the existing production controls and storage.
    await field('toggle-task-priority-menu').click();
    await page.getByRole('menuitemradio', { name: '高优先' }).click();
    await page.waitForFunction(() => shellActiveTask().priority === 'high');
    await page.locator('#overlay .priority-popover').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => shellActiveTask().priority), 'high');
    await field('toggle-task-group-select').click();
    await page.getByRole('radio', { name: /未分组/ }).click();
    await page.locator('#manage24-move-form button[type=submit]').click();
    await page.waitForFunction(() => !shellActiveTask().groupId);
    await page.waitForFunction(() => document.querySelector('.task-info-group .task-info-value')?.textContent === '');
    assert.equal(await field('toggle-task-group-select').locator('.task-info-value').innerText(), '');
    await field('toggle-task-group-select').click();
    await page.locator('[data-manage24-target="long"]').click();
    await page.locator('#manage24-move-form button[type=submit]').click();
    await page.waitForFunction(() => shellActiveTask().groupId === 'long');
    assert.equal(await page.evaluate(() => shellActiveTask().groupId), 'long');
    await field('toggle-deadline-picker').click();
    await page.locator('#deadline-form [data-action=shell-schedule-day]').first().click();
    await page.locator('#deadline-time').fill('18:30');
    await page.locator('#deadline-form button[type=submit]').click();
    assert.match(await page.evaluate(() => shellActiveTask().deadlineAt), /T/);
    await field('open-task-recurrence').click();
    await page.locator('[data-action=shell-recurrence-mode][data-mode=daily]').click();
    await page.locator('#recurrence-time').fill('09:00');
    await page.locator('#recurrence-form button[type=submit]').click();
    assert.equal(await page.evaluate(() => shellActiveTask().recurrence.frequency), 'daily');
    await field('toggle-task-tag').click();
    assert.equal(await field('toggle-task-tag').getAttribute('aria-pressed'), 'true');
    assert.equal(await field('toggle-task-tag').locator('.task-info-value').innerText(), '已手动加入');
    await field('toggle-task-tag').click();
    assert.equal(await field('toggle-task-tag').getAttribute('aria-pressed'), 'false');
    assert.equal(await field('toggle-task-tag').locator('.task-info-value').innerText(), '');
    assert.equal(await page.evaluate(() => isTaskScheduledForToday(shellActiveTask())), true, 'manual membership does not cancel the deadline or recurrence');
    assert.equal(await page.evaluate(() => shellActiveTask().status), 'active', 'removing the status label does not rewrite completion data');

    for (const theme of ['light', 'dark']) for (const size of [[1024, 680], [1440, 900]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(...size), size);
      await page.evaluate(theme => { state.theme = theme; render(); }, theme);
      await expand();
      const bounds = await card.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size[0] && bounds.y + bounds.height <= size[1]);
      assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      assert.ok(bounds.width >= defaultWidth, 'content can widen the panel when needed');
      assert.equal(await card.locator('.task-info-row').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth)), true);
      await field('toggle-task-group-select').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'toggle-task-priority-menu');
      const focus = await field('toggle-task-priority-menu').evaluate(el => { const s = getComputedStyle(el); return { outline: s.outlineColor, width: s.outlineWidth }; });
      assert.equal(focus.width, '1px');
      assert.match(focus.outline, /^rgb\((\d+), \1, \1\)$/);
      await page.screenshot({ path: path.join(evidence, `${theme}-${size[0]}-configured.png`) });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1024, 680));
    await page.evaluate(() => { applySetting('font-scale', 'largest'); render(); });
    await expand();
    assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await card.locator('.task-info-row').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth)), true);
    await page.screenshot({ path: path.join(evidence, 'dark-1024-largest.png') });
    await page.evaluate(() => flushSave());
    const saved = await page.evaluate(() => window.personalTaskTrack.storage.read());
    assert.equal(saved.tasks[0].priority, 'high'); assert.equal(saved.tasks[0].groupId, 'long');
    assert.equal(saved.tasks[0].recurrence.frequency, 'daily'); assert.ok(saved.tasks[0].deadlineAt);
    assert.equal(saved.tasks[0].nodes[0].note, '保留节点记录');
    await page.reload(); await card.waitFor(); await expand();
    assert.equal(await page.evaluate(() => shellActiveTask().priority), 'high');
    assert.equal(await page.evaluate(() => shellActiveTask().groupId), 'long');
    assert.doesNotMatch(await card.innerText(), /处理中|已完成/);
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: true, profile: run.profile, errors, actualControlsAndDisk: true, defaultWidth, screenshots: 6 }, null, 2));
    console.log('PASS task details: five real property actions, persistence/reload, status label removed, manual/automatic today distinction, collapse/focus, tree/draft retention, themes/sizes.');
  } catch (error) {
    console.error(await page.evaluate(() => ({ collapsed: [...shellTaskInfoCollapsed], choices: [...shellTaskInfoChoices], overlay: document.querySelector('#overlay')?.innerText, task: state.activeTaskId })));
    throw error;
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

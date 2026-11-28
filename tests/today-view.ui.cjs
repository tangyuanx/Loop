const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

const stamp = (day, time) => new Date(`2026-11-${day}T${time}`).toISOString();
const firstDeadline = stamp(26, '08:42');
const secondDeadline = stamp(27, '17:26');
const fixture = [
  task('overdue', { title: '需要顺延的任务', deadlineAt: firstDeadline, priority: 'high', nodes: [
    { id: 'review', title: '待核对', status: 'review', children: [] },
    { id: 'done-node', title: '已核对', status: 'done', children: [] },
  ] }),
  task('other-overdue', { title: '另一项逾期任务', deadlineAt: secondDeadline, priority: 'low' }),
  task('due', { title: '今天九点到期', deadlineAt: stamp(28, '09:00'), tags: { today: true } }),
  task('pinned', { title: '手动安排', deadlineAt: stamp(29, '18:00'), tags: { today: true, later: true } }),
  task('recurring', { title: '每日检查', tags: { today: true },
    recurrence: { frequency: 'daily', time: '08:00', anchorDate: '2026-11-20' } }),
  task('completed', { title: '今天已完成', status: 'done', resolvedAt: stamp(28, '11:15') }),
  task('old-completed', { title: '昨日已完成', status: 'done', resolvedAt: stamp(27, '11:15') }),
  task('future', { title: '明天处理', deadlineAt: stamp(29, '16:00') }),
  task('quick', { title: '来自浮窗的速记', captureSource: 'today-widget', tags: { today: true }, createdAt: stamp(28, '10:36') }),
];

async function verifyToday(theme) {
  const run = await launchRepository({ theme, tasks: fixture }, `today-view-${theme}`);
  const { page } = run;
  const action = name => page.locator(`[data-action="${name}"]`);
  const row = id => page.locator(`#task-results [data-task-row="${id}"]`);
  const section = label => page.getByRole('list', { name: label, exact: true });
  const sectionIds = label => section(label).locator('[data-task-row]').evaluateAll(rows => rows.map(row => row.dataset.taskRow));
  const quick = page.locator('.list-filter .quick-inbox-button');
  const feedback = page.locator('.workspace-feedback-message');
  const saved = async () => {
    assert.equal(await page.evaluate(() => flushSave()), true);
    const data = JSON.parse(await fs.readFile(path.join(run.profile, 'task-data.json'), 'utf8'));
    return Object.fromEntries(data.tasks.map(item => [item.id, item]));
  };
  try {
    await page.evaluate(() => loopSetPreviewClock('2026-11-28T12:00'));
    const taskQuickBounds = await quick.boundingBox();
    const todayNav = page.locator('.navigation [data-value="today"]');
    await todayNav.click();
    assert.deepEqual(await quick.boundingBox(), taskQuickBounds, `${theme}: 速记与任务页同位`);
    assert.equal(await page.locator('.list-filter .filter-tab').count(), 0);
    assert.deepEqual(await page.locator('.list-foot button').allTextContents(), ['定位当前', '多选']);
    assert.deepEqual(await page.locator('.list-section-head > span:first-child').allTextContents(), ['已逾期', '今日到期', '今日安排', '今天完成']);
    assert.deepEqual(await sectionIds('已逾期'), ['overdue', 'other-overdue']);
    assert.deepEqual(await sectionIds('今日到期'), ['due']);
    assert.deepEqual(new Set(await sectionIds('今日安排')), new Set(['pinned', 'recurring']));
    assert.deepEqual(await sectionIds('今天完成'), ['completed']);
    assert.equal(await row('due').locator('.task-row-qact, .task-meta-due.overdue').count(), 0);
    assert.equal(await row('recurring').locator('.task-row-qact').count(), 0);
    assert.equal(await row('overdue').locator('.task-meta-review').innerText(), '1 待确认');

    const geometry = await page.locator('.today-strip').evaluate(strip => {
      const stat = strip.querySelector('.today-stat');
      const [over, , open, , done] = stat.children;
      const overStyle = getComputedStyle(over);
      const bar = strip.querySelector('.today-bar');
      const baseline = element => {
        const marker = document.createElement('span');
        marker.style.cssText = 'display:inline-block;width:0;height:0';
        element.append(marker);
        const top = marker.getBoundingClientRect().top;
        marker.remove();
        return top;
      };
      const flaggedRow = document.querySelector('[data-task-row="overdue"]');
      const anchor = getComputedStyle(flaggedRow, '::before');
      const review = getComputedStyle(flaggedRow.querySelector('.task-meta-review'));
      const resolveColor = value => {
        const marker = document.createElement('i');
        marker.style.color = value;
        strip.append(marker);
        const color = getComputedStyle(marker).color;
        marker.remove();
        return color;
      };
      return {
        labels: [over, open, done].map(element => element.innerText),
        baselines: [over, open, done].map(baseline),
        plain: [overStyle.backgroundColor, overStyle.padding, overStyle.borderRadius, overStyle.fontSize],
        colors: [overStyle.color, anchor.backgroundColor, review.color],
        statusColors: [resolveColor('var(--status-danger)'), resolveColor('var(--status-review-ink)')],
        trackHeight: bar.getBoundingClientRect().height,
        fill: bar.firstElementChild.getBoundingClientRect().width / bar.getBoundingClientRect().width,
        anchorWidth: anchor.width,
        anchorPosition: [anchor.display, anchor.top, anchor.left],
        reviewBackground: review.backgroundColor,
      };
    });
    assert.deepEqual(geometry.labels, ['2 逾期', '5 项待办', '已完成 1/6']);
    assert.ok(geometry.baselines.every(top => Math.abs(top - geometry.baselines[0]) <= 0.5));
    assert.deepEqual(geometry.plain.slice(0, 3), ['rgba(0, 0, 0, 0)', '0px', '0px']);
    assert.equal(geometry.plain[3], '12px');
    assert.deepEqual(geometry.colors, [geometry.statusColors[0], geometry.statusColors[0], geometry.statusColors[1]]);
    assert.equal(geometry.trackHeight, 2);
    assert.ok(Math.abs(geometry.fill - 0.17) < 0.01);
    assert.equal(geometry.anchorWidth, '2px');
    assert.deepEqual(geometry.anchorPosition, ['block', '9px', '1px']);
    assert.equal(geometry.reviewBackground, 'rgba(0, 0, 0, 0)');

    const toggleDone = action('toggle-today-done');
    const arrow = toggleDone.locator('svg');
    assert.ok(await arrow.evaluate(svg => Math.abs(svg.getBoundingClientRect().right - svg.parentElement.getBoundingClientRect().right + 8) <= 1));
    await toggleDone.press('Enter');
    assert.equal(await toggleDone.getAttribute('aria-expanded'), 'false');
    assert.equal(await row('completed').count(), 0);
    await page.waitForFunction(() => document.activeElement.matches('[data-action="toggle-today-done"]'));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.is-done-toggle svg')).transform === 'matrix(0, -1, 1, 0, 0, 0)');
    await toggleDone.press('Enter');
    assert.equal(await toggleDone.getAttribute('aria-expanded'), 'true');
    assert.equal(await row('completed').count(), 1);

    await row('pinned').locator('.task-select').press('F2');
    const rename = page.locator('#manage24-row-title');
    await rename.fill('更新手动安排标题');
    await page.locator('.list-section-head').filter({ hasText: '今日安排' }).click();
    await rename.waitFor({ state: 'detached' });
    assert.equal(await row('pinned').locator('.task-item-title').innerText(), '更新手动安排标题');
    assert.equal(await row('pinned').locator('.task-row-qact').count(), 1);

    await row('due').locator('.task-select').click();
    await page.waitForFunction(() => state.activeTaskId === 'due');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const defer = row('overdue').locator('.task-row-qact');
    assert.equal(await defer.evaluate(button => getComputedStyle(button).opacity), '0');
    await row('overdue').hover();
    assert.equal(await defer.evaluate(button => getComputedStyle(button).opacity), '1');
    assert.equal(await row('overdue').locator('.task-pri-bars').isVisible(), false);
    await defer.click();
    assert.equal(await feedback.innerText(), '已顺延到今天');
    assert.equal(await page.evaluate(() => state.activeTaskId), 'due');
    assert.deepEqual(await sectionIds('已逾期'), ['other-overdue']);
    assert.deepEqual(await sectionIds('今日到期'), ['overdue', 'due']);
    assert.equal((await saved()).overdue.deadlineAt, stamp(28, '08:42'));
    await action('undo-defer-today').click();
    assert.equal((await saved()).overdue.deadlineAt, firstDeadline);

    await action('open-combined-filter').click();
    await action('open-advanced-list-filter').click();
    await page.locator('#record-priority').selectOption('high', { force: true });
    await page.locator('#combined-filter-form button[type="submit"]').click();
    const bulk = action('defer-all-overdue');
    await bulk.locator('..').hover();
    await bulk.click();
    assert.equal(await feedback.innerText(), '已将 1 项逾期任务顺延到今天');
    const filteredSave = await saved();
    assert.equal(filteredSave.overdue.deadlineAt, stamp(28, '08:42'));
    assert.equal(filteredSave['other-overdue'].deadlineAt, secondDeadline);
    await action('undo-defer-today').click();
    await page.locator('.active-list-filters [data-action="clear-list-filters"]').click();
    await bulk.locator('..').hover();
    await bulk.click();
    assert.equal(await feedback.innerText(), '已将 2 项逾期任务顺延到今天');
    assert.equal(await section('已逾期').count(), 0);
    const bulkSave = await saved();
    assert.equal(bulkSave.overdue.deadlineAt, stamp(28, '08:42'));
    assert.equal(bulkSave['other-overdue'].deadlineAt, stamp(28, '17:26'));
    await action('undo-defer-today').click();
    const restored = await saved();
    assert.equal(restored.overdue.deadlineAt, firstDeadline);
    assert.equal(restored['other-overdue'].deadlineAt, secondDeadline);

    await row('pinned').locator('.task-select').focus();
    await page.keyboard.press('Tab');
    const unpin = row('pinned').locator('.task-row-qact');
    assert.equal(await unpin.evaluate(button => button === document.activeElement && getComputedStyle(button).opacity === '1'), true);
    const selected = await page.evaluate(() => state.activeTaskId);
    await page.keyboard.press('Enter');
    assert.equal(await feedback.innerText(), '已移出今日安排');
    assert.equal(await row('pinned').count(), 0);
    assert.equal(await page.evaluate(() => state.activeTaskId), selected);
    assert.deepEqual((await saved()).pinned.tags, { today: false, blocked: false, later: true });
    await action('undo-dock-today').click();
    assert.equal((await saved()).pinned.tags.today, true);
    assert.equal(await row('pinned').count(), 1);

    const quickBackground = () => quick.evaluate(button => getComputedStyle(button).backgroundColor);
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.quick-inbox-button')).backgroundColor === 'rgba(0, 0, 0, 0)');
    const quickBounds = await quick.boundingBox();
    assert.equal(quickBounds.height, 24);
    assert.ok(quickBounds.width >= 32);
    assert.equal(await row('quick').count(), 0);
    const selection = await page.evaluate(() => state.activeTaskId);
    const summary = await page.locator('.today-stat').innerText();
    await quick.click();
    assert.equal(await quick.getAttribute('aria-pressed'), 'true');
    assert.equal(await quick.getAttribute('title'), '关闭速记');
    assert.deepEqual(await quick.boundingBox(), quickBounds);
    assert.equal(await page.locator('.list-heading .list-title').innerText(), '今日');
    assert.equal(await page.locator('.today-stat').innerText(), summary);
    assert.equal(await page.evaluate(() => state.activeTaskId), selection);
    assert.equal(await row('quick').locator('time').innerText(), '10:36');
    assert.ok((await row('quick').boundingBox()).y < (await row('overdue').boundingBox()).y);
    assert.deepEqual(await sectionIds('已逾期'), ['overdue', 'other-overdue']);
    assert.deepEqual(await sectionIds('今日到期'), ['due']);
    assert.deepEqual(new Set(await sectionIds('今日安排')), new Set(['pinned', 'recurring']));
    assert.deepEqual(await sectionIds('今天完成'), ['completed']);
    await page.mouse.move(0, 0);
    const [red, green, blue, alpha] = (await quickBackground()).match(/[\d.]+/g).map(Number);
    assert.deepEqual([red, green, blue], theme === 'light' ? [24, 26, 32] : [255, 255, 255]);
    assert.ok(Math.abs(alpha - (theme === 'light' ? 0.065 : 0.08)) < 1 / 255);
    await page.locator('.list-heading [data-action="add-task"]').click();
    assert.equal(await page.evaluate(() => state.createDraft?.kind), 'task');
    await page.keyboard.press('Escape');
    await row('quick').locator('.task-select').click();
    await page.waitForFunction(() => state.activeTaskId === 'quick');
    await quick.click();
    assert.equal(await quick.getAttribute('aria-pressed'), 'false');
    assert.equal(await quick.getAttribute('title'), '打开速记');
    assert.deepEqual(await quick.boundingBox(), quickBounds);
    assert.equal(await row('quick').count(), 0);
    assert.equal(await page.locator('.today-stat').innerText(), summary);
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.quick-inbox-button')).backgroundColor === 'rgba(0, 0, 0, 0)');
    await action('open-list-search').click();
    await page.locator('#search').fill('今天已完成');
    assert.equal(await quick.count(), 0);
    assert.equal(await page.locator('.today-clear').count(), 0);
    await page.locator('#search').press('Escape');

    const todayData = await page.evaluate(() => {
      const tasks = state.tasks;
      state.tasks = tasks.filter(task => task.id === 'completed');
      state.activeTaskId = '';
      render();
      return tasks;
    });
    assert.equal(await page.locator('.today-stat .all-done').innerText(), '今日已闭环');
    assert.equal(await page.locator('.today-clear').innerText(), '今日待办已全部完成');
    await page.evaluate(tasks => {
      state.tasks = tasks.filter(task => task.id === 'future');
      state.activeTaskId = '';
      render();
    }, todayData);
    const empty = page.locator('#task-results .today-empty');
    assert.equal(await empty.getByRole('status').innerText(), '今天还没有安排任务');
    assert.equal(await page.locator('.today-stat').innerText(), '今日暂无安排');
    assert.equal(await page.locator('.today-bar, .list-section-head').count(), 0);
    await empty.getByRole('button', { name: '去任务挑选' }).click();
    assert.equal(await page.evaluate(() => shellRoute()), 'tasks');
    await todayNav.click();
    await empty.getByRole('button', { name: '新建任务' }).click();
    assert.equal(await page.evaluate(() => state.createDraft?.today), true);
    assert.deepEqual(run.errors, []);
    console.log(`PASS: Today overview, sections, shortcuts and persistent undo (${theme}).`);
  } finally {
    await run.close();
  }
}

(async () => {
  for (const theme of ['light', 'dark']) await verifyToday(theme);
})().catch(error => { console.error(error); process.exitCode = 1; });

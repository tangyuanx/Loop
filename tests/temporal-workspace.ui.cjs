// Real Electron: work runtime, import preview, local dates and page detours.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const evidence = path.resolve(process.env.LOOP_TEMPORAL_QA_DIR || '.local-review/frontend-remediation/stage-05/ui');
const report = { checks: [], layouts: [], inputs: [], errors: [] };
const data = {
  uiPreferences: { continuous: true, follow: true, workNavigationEnabled: true },
  taskGroups: [{ id: 'work', title: '项目工作', order: 1 }, { id: 'growth', title: '学习资料', order: 2 }],
  tasks: [
    task('a', { title: '核对截止日期与本地边界', groupId: 'work', deadlineAt: new Date(2026, 9, 27, 23, 59).toISOString(), conclusion: '验证已完成。', priority: 'high', tags: { today: true } }),
    task('b', { title: '记录真实处理过程', groupId: 'work', order: 2, description: '记录下一步。' }),
    task('long', { title: '长标题的工作事项与后续验证'.repeat(14), groupId: 'work', order: 3, description: '长摘要记录，保持完整内容与明确的日期范围。'.repeat(40), createdAt: new Date(2026, 9, 27, 23, 59, 59).toISOString() }),
    task('growth-a', { title: '理解队列顺延', groupId: 'growth', order: 1, conclusion: '学习完成。', deadlineAt: new Date(2026, 9, 27, 17, 10).toISOString(), recurrence: { frequency: 'daily', time: '17:10' } }),
    task('growth-b', { title: '验证学习来源保持分组顺序', groupId: 'growth', order: 2 }),
    task('done', { title: '已解决问题的结论', groupId: 'work', order: 4, status: 'done', conclusion: '已确认闭环。', resolvedAt: new Date(2026, 9, 27, 23, 59, 59).toISOString() }),
    task('tomorrow', { title: '下一天的记录', groupId: 'work', order: 5, createdAt: new Date(2026, 9, 28, 0).toISOString(), deadlineAt: new Date(2026, 9, 28, 0).toISOString() }),
  ],
};
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

(async () => {
  await fs.mkdir(evidence, { recursive: true });
  const run = await launchRepository(data, 'temporal');
  const { page, app } = run;
  const check = name => { report.checks.push(name); console.log(`PASS ${name}`); };
  const at = async value => { await page.evaluate(value => { loopSetPreviewClock(value); render(); }, value); await settle(page); };
  const open = async () => { if (!await page.locator('.work15-dialog').count()) await page.locator('.work15-pill').click(); await settle(page); };
  const tab = async value => { await page.locator(`[data-work15="tab"][data-tab="${value}"]`).click(); await settle(page); };
  const queue = () => page.evaluate(() => LoopWorkNavigationBridge.snapshot().workTaskIds);
  try {
    await page.waitForFunction(() => globalThis.LoopWork);
    await page.evaluate(() => {
      loopSetPreviewClock('2026-10-27T10:20');
      state.workNavigation = LoopWorkNavigationModel.defaultWorkNavigation(loopNow());
      state.workNavigation.config.growth.sourceGroupId = 'growth';
      LoopWork.restorePreferences({ workNavigationEnabled: true });
      render();
      LoopWorkNavigationBridge.setRuntime({ workQueueIds: ['a', 'b', 'long', 'tomorrow'], activeWorkTaskId: 'a' });
    });
    await open();
    assert.match(await page.locator('.work15-current h3').innerText(), /核对截止日期/);
    await tab('schedule');
    await page.locator('[data-work15="phase"][data-phase="growth"]').click();
    assert.match(await page.locator('.work15-current h3').innerText(), /理解队列顺延/);
    assert.equal(await page.evaluate(() => state.workNavigation.runtime.manualPhaseId), 'growth');
    assert.equal(await page.evaluate(() => new Date(state.workNavigation.runtime.manualPhaseExpiresAt).getHours()), 11);
    await at('2026-10-27T11:50');
    assert.match(await page.locator('.work15-current h3').innerText(), /暂时离开/);
    assert.equal(await page.evaluate(() => state.workNavigation.runtime.manualPhaseId), '');
    assert.equal(await page.locator('[data-work15="complete"]').count(), 0);
    check('manual phase uses existing runtime and expires at lunch');
    for (const [time, text] of [['09:00', '下一阶段'], ['12:00', '暂时离开'], ['17:05', '暂时离开'], ['17:10', '理解队列顺延'], ['18:10', '已结束']]) {
      await at(`2026-10-27T${time}`);
      assert.match(await page.locator('.work15-current h3').innerText(), new RegExp(text));
    }
    await at('2026-10-30T15:00');
    assert.match(await page.locator('.work15-current h3').innerText(), /参加周例会/);
    await tab('schedule');
    assert.match(await page.locator('[data-phase="friday-meeting"]').innerText(), /15:00–16:00/);
    assert.match(await page.locator('[data-phase="growth"]').innerText(), /17:10–18:10/);
    await at('2026-10-30T16:00'); await tab('current');
    assert.equal(await page.locator('[data-work15="complete"]').count(), 1);
    check('before work, lunch, transition, learning, end and Friday meeting');
    await at('2026-10-27T10:20');
    await page.evaluate(() => LoopWorkNavigationBridge.setRuntime({ workQueueIds: ['a', 'b', 'long', 'tomorrow'], activeWorkTaskId: 'a' }));
    await tab('queue');
    await page.locator('[data-work15="kind"][data-kind="work"]').click();
    await page.locator('select[data-work15-estimate="b"]').selectOption('90', { force: true });
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'b').estimateMinutes), 90);
    await page.locator('[data-work15="skip"]').click();
    assert.deepEqual((await queue()).slice(0, 3), ['b', 'a', 'long']);
    await page.locator('[data-work15="defer"]').click();
    assert.equal((await queue()).at(-1), 'b');
    await page.locator('[data-work15="block"]').click();
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'a').tags.blocked), true);
    assert.ok(!(await queue()).includes('a'));
    await page.evaluate(() => { state.tasks.find(t => t.id === 'a').nodes = [{ ...makeNode('a', null, 1), id: 'blocked-step', title: '等待验证', status: 'blocked' }]; });
    await page.locator('[data-work15="recover"][data-task-id="a"]').click();
    assert.match(await page.locator('.work15-error').innerText(), /卡住节点/);
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'a').nodes[0].status), 'blocked');
    await page.evaluate(() => { state.tasks.find(t => t.id === 'a').nodes[0].status = 'done'; });
    await page.locator('[data-work15="recover"][data-task-id="a"]').click();
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'a').tags.blocked), false);
    assert.ok((await queue()).includes('a'));
    assert.equal(await page.evaluate(() => state.workNavigation.runtime.blockedTaskIds.length), 0);
    await page.locator('[data-work15="choose"][data-task-id="a"]').click();
    await tab('current');
    await page.locator('[data-work15="complete"]').click();
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'a').status), 'done');
    assert.notEqual(await page.evaluate(() => state.workNavigation.runtime.activeWorkTaskId), 'a');
    await open();
    // A failed completion stays visible and actionable, without a transient error.
    await page.locator('[data-work15="complete"]').click();
    assert.match(await page.locator('.work15-error[role="alert"]').innerText(), /填写结论/);
    await page.evaluate(() => {
      const t = state.tasks.find(t => t.id === state.workNavigation.runtime.activeWorkTaskId);
      t.conclusion = '临时验证结论'; t.nodes = [makeNode(t.id, null, 1)];
    });
    await page.locator('[data-work15="complete"]').click();
    assert.match(await page.locator('.work15-error[role="alert"]').innerText(), /未完成节点/);
    await page.evaluate(() => {
      const t = state.tasks.find(t => t.id === state.workNavigation.runtime.activeWorkTaskId);
      t.conclusion = ''; t.nodes = [];
    });
    await page.locator('[data-work15="close"]').click(); await settle(page);
    assert.equal(await page.evaluate(() => document.activeElement.matches('.work15-pill')), true);
    await page.evaluate(() => {
      state.workNavigation.config.work.autoAdvance = false;
      state.tasks.find(t => t.id === 'b').conclusion = '完成验证。';
      LoopWorkNavigationBridge.setRuntime({ activeWorkTaskId: 'b', workAdvancePaused: false });
    });
    await open(); await tab('current'); await page.locator('[data-work15="complete"]').click();
    assert.equal(await page.evaluate(() => state.workNavigation.runtime.workAdvancePaused), true);
    await open();
    assert.match(await page.locator('.work15-current h3').innerText(), /选择任务继续/);
    await tab('queue'); await page.locator('[data-work15="kind"][data-kind="work"]').click();
    await page.locator('[data-work15="choose"]').first().click();
    assert.equal(await page.evaluate(() => state.workNavigation.runtime.workAdvancePaused), false);
    assert.ok(await page.evaluate(() => Boolean(state.workNavigation.runtime.activeWorkTaskId)));
    await page.evaluate(() => { state.workNavigation.config.work.autoAdvance = true; });
    check('skip, defer, block, recover, completion advance and persistent validation');
    await open(); await tab('queue');
    const countBefore = await page.evaluate(() => state.tasks.length);
    await page.locator('[data-work15="import"]').click();
    const learningPlan = { schemaVersion: 1, type: 'loop-learning-plan', plan: { id: 'qa-plan', title: '验证计划', targetGroup: '学习资料' }, tasks: [{ itemId: 'one', title: '只在确认后添加的学习任务', estimateMinutes: 60 }, { itemId: 'two', title: '保持来源身份的学习任务', estimateMinutes: 45 }] };
    await page.locator('#work15-import-raw').fill(JSON.stringify(learningPlan));
    await page.locator('[data-work15="preview"]').click();
    assert.equal(await page.locator('.work15-preview li').count(), 2);
    assert.equal(await page.evaluate(() => state.tasks.length), countBefore, 'preview never writes');
    await page.locator('[data-work15-minutes="0"]').fill('721');
    assert.equal(await page.locator('[data-work15="import-confirm"]').isDisabled(), true);
    await page.locator('[data-work15-minutes="0"]').fill('');
    assert.equal(await page.locator('[data-work15="import-confirm"]').isDisabled(), true);
    await page.locator('[data-work15-minutes="0"]').fill('90');
    await page.locator('[data-work15-check="1"]').uncheck();
    await page.locator('[data-work15="import-confirm"]').click();
    const imported = await page.evaluate(() => state.tasks.find(t => t.title === '只在确认后添加的学习任务'));
    assert.equal(imported.estimateMinutes, 90); assert.equal(imported.origin.kind, 'learning-plan'); assert.equal(imported.groupId, 'growth');
    assert.equal(await page.evaluate(() => state.tasks.length), countBefore + 1);
    await open(); await tab('queue'); await page.locator('[data-work15="import"]').click();
    await page.locator('#work15-import-raw').fill('1. 只在确认后添加的学习任务\n2. 新任务\n3. 新任务');
    await page.locator('[data-work15="preview"]').click();
    assert.equal(await page.locator('.work15-preview input[type="checkbox"]:disabled').count(), 2);
    await page.locator('[data-work15="back-import"]').click();
    await page.locator('#work15-import-raw').fill('{invalid json');
    await page.locator('[data-work15="preview"]').click();
    assert.match(await page.locator('.work15-error').innerText(), /JSON/);
    assert.equal(await page.evaluate(() => state.tasks.length), countBefore + 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.work15-pill').getAttribute('aria-expanded'), 'false');
    check('learning JSON and text preview, estimates, selection, duplicates and invalid input');
    await at('2026-10-27T23:59');
    await page.evaluate(() => LoopWorkNavigationBridge.setRuntime({ workQueueIds: ['b', 'long', 'tomorrow'], activeWorkTaskId: 'b', manualPhaseId: 'growth', manualPhaseExpiresAt: new Date(2026, 9, 28, 1).toISOString() }));
    await at('2026-10-28T00:00');
    assert.equal(await page.evaluate(() => state.workNavigation.runtime.dateKey), '2026-10-28');
    assert.equal(await page.evaluate(() => state.workNavigation.runtime.manualPhaseId), '');
    assert.equal(await page.evaluate(() => state.workNavigation.config.growth.sourceGroupId), 'growth');
    await at('2026-10-31T10:00'); await open(); await tab('current');
    await page.locator('[data-work15="start-weekend"]').click();
    assert.equal(await page.evaluate(() => Boolean(state.workNavigation.runtime.weekendStartedAt)), true);
    assert.equal(await page.locator('[data-work15="complete"]').count(), 1);
    await page.keyboard.press('Escape');
    check('local cross-day reset and weekend manual start keep learning source');

    await at('2026-10-27T10:20');
    await page.locator('.navigation [data-action="toggle-calendar"]').click();
    await page.evaluate(() => { state.calendarMonth = '2026-10-01'; state.calendarSelectedDate = '2026-10-27'; render(); });
    assert.match(await page.locator('.agenda').innerText(), /循环 · 每天/);
    assert.match(await page.locator('.calendar-legend').innerText(), /当前截止日/);
    assert.equal(await page.locator('.calendar-day[tabindex="0"]').count(), 1);
    await page.locator('.calendar-day[tabindex="0"]').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => state.calendarSelectedDate), '2026-10-28');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.date), '2026-10-28');
    await page.evaluate(() => { state.calendarMonth = '2026-01-01'; state.calendarSelectedDate = '2026-01-31'; render(); });
    await page.locator('[data-action="shift-calendar-month"][data-direction="1"]').click();
    assert.equal(await page.evaluate(() => state.calendarSelectedDate), '2026-02-28');
    await page.locator('.calendar-day[tabindex="0"]').focus(); await page.keyboard.press('PageDown');
    assert.equal(await page.evaluate(() => state.calendarSelectedDate), '2026-03-28');
    await page.locator('[data-action="calendar-today"]').click();
    await page.locator('[data-action="open-calendar-task"][data-task-id="growth-a"]').click();
    await page.locator('[data-action="return-global-page"]').click(); await settle(page);
    assert.equal(await page.evaluate(() => state.calendarSelectedDate), '2026-10-27');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.taskId), 'growth-a');
    await page.locator('[data-action="apply-calendar-date"]').click();
    assert.ok((await page.evaluate(() => filteredTasks().map(t => t.id))).includes('growth-a'));
    assert.ok(!(await page.evaluate(() => filteredTasks().map(t => t.id))).includes('tomorrow'));
    await page.locator('[data-action="return-global-page"]').click();
    check('deadline calendar, recurrence label, keyboard, month-end clamp and exact return');
    await page.locator('.navigation [data-action="toggle-review"]').click();
    for (const preset of ['week', 'month', 'year', 'all', 'custom']) {
      await page.locator(`[data-action="set-review-preset"][data-preset="${preset}"]`).first().click();
      assert.equal(await page.evaluate(() => state.reviewPreset), preset);
    }
    await page.evaluate(() => { state.reviewDateField = 'created'; state.reviewStartDate = '2026-10-27'; state.reviewEndDate = '2026-10-27'; render(); });
    assert.equal(await page.locator('.review-task-title[data-task-id="tomorrow"]').count(), 0);
    assert.equal(await page.locator('.review-task-title[data-task-id="long"]').count(), 1);
    assert.match(await page.locator('.review-table .date').first().innerText(), /2026-10-27/);
    await page.locator('.temporal-summary summary').first().click();
    assert.ok((await page.locator('.temporal-summary[open] .summary').innerText()).length > 180);
    await page.locator('.review-task-title[data-task-id="long"]').click();
    await page.locator('[data-action="return-global-page"]').click(); await settle(page);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.taskId), 'long');
    assert.equal(await page.evaluate(() => state.reviewDateField), 'created');
    await page.evaluate(() => { state.reviewDateField = 'resolved'; render(); });
    assert.ok((await page.evaluate(() => reviewTasks().map(x => x.task.status))).every(x => x === 'done'));
    await page.evaluate(() => { state.reviewDateField = 'updated'; render(); });
    assert.equal(await page.locator('.review-table th').last().innerText(), '更新日期');
    await page.locator('#review-end').fill('2026-10-26'); await page.locator('#review-end').press('Tab');
    await page.waitForFunction(() => state.reviewEndDate === '2026-10-26');
    assert.equal(await page.locator('#review-end').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('.review-table').count(), 0);
    assert.match(await page.locator('#review-range-error').innerText(), /不能早于/);
    check('five review ranges, all date fields, inclusive local end, long content and error');

    // One batched layout/input inspection, with both themes and real window sizes.
    for (const theme of ['light', 'dark']) for (const width of [1280, 1024]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width, 820), width);
      await page.evaluate(theme => { state.theme = theme; state.reviewEndDate = '2026-10-27'; state.reviewDateField = 'created'; render(); }, theme);
      await settle(page);
      for (const route of ['review', 'calendar', 'work', 'schedule', 'queue', 'import', 'preview']) {
        if (route === 'calendar') await page.locator('.navigation [data-action="toggle-calendar"]').click();
        if (route === 'work') await open();
        if (['schedule', 'queue'].includes(route)) await tab(route);
        if (route === 'import') await page.locator('[data-work15="import"]').click();
        if (route === 'preview') { await page.locator('#work15-import-raw').fill('1. 长内容导入任务'.repeat(6) + '\n2. 第二项任务'); await page.locator('[data-work15="preview"]').click(); }
        await settle(page);
        const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth > innerWidth, body: [...document.querySelectorAll('.calendar-layout,.review-content,.work15-dialog,.work15-body')].some(e => e.scrollWidth > e.clientWidth + 1) }));
        assert.equal(overflow.document, false); assert.equal(overflow.body, false);
        await page.screenshot({ path: path.join(evidence, `${route}-${theme}-${width}.png`) });
        report.layouts.push({ theme, width, route, overflow });
        const inputs = page.locator('.work15-dialog input:not([type="checkbox"]),.work15-dialog textarea,.review-range input');
        for (let i = 0; i < await inputs.count(); i++) {
          const input = inputs.nth(i); if (!await input.isVisible() || await input.isDisabled()) continue;
          for (const state of ['default', 'hover', 'focus']) {
            if (state === 'hover') await input.hover();
            if (state === 'focus') await input.focus();
            const styles = await input.evaluate(e => [e, e.parentElement].map(e => { const s = getComputedStyle(e); return { border: s.borderColor, borderWidth: s.borderWidth, outline: s.outline, shadow: s.boxShadow, background: s.backgroundColor }; }));
            for (const s of styles) {
              assert.equal(s.shadow, 'none');
              for (const color of [s.borderWidth !== '0px' ? s.border : '', !s.outline.includes('none') ? s.outline : '']) {
                for (const match of color.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)) assert.ok(!(Number(match[2]) > Number(match[1]) + 12 && Number(match[2]) > Number(match[3]) + 8), JSON.stringify(s));
              }
            }
            report.inputs.push({ theme, width, route, state, styles });
          }
        }
      }
      await page.keyboard.press('Escape');
      await page.locator('.navigation [data-action="toggle-review"]').click();
    }
    check('28 theme/window layouts, input and parent default/hover/focus');
    await page.locator('.navigation [data-action="toggle-settings"]').click();
    await page.evaluate(() => { activeSettingsPage = 'advanced'; render(); });
    assert.equal(await page.locator('.work15-weekdays input').count(), 7);
    await page.locator('.work15-weekdays input[value="4"]').focus();
    await page.keyboard.press('Tab');
    const weekdayFocus = await page.locator('.work15-weekdays input[value="5"] + span').evaluate(e => ({ label: e.textContent, outline: getComputedStyle(e).outline, offset: getComputedStyle(e).outlineOffset }));
    assert.equal(weekdayFocus.label, '五'); assert.equal(weekdayFocus.offset, '-2px');
    assert.doesNotMatch(weekdayFocus.outline, /2px/);
    report.weekdayFocus = weekdayFocus;
    await page.locator('.navigation [data-value="all"]').click();
    await page.evaluate(() => { state.tasks = state.tasks.filter(t => t.status === 'done'); state.workNavigation.runtime.activeWorkTaskId = ''; render(); });
    await open(); await tab('queue');
    assert.match(await page.locator('.work15-empty').innerText(), /没有未完成任务/);
    assert.equal(await page.locator('[data-work15="block"]').count(), 0);
    await page.screenshot({ path: path.join(evidence, 'empty-queue.png') });
    check('empty queue has no executable task actions');
    assert.deepEqual(run.errors, []); report.complete = true;
  } catch (error) { report.failure = error.stack; report.failureState = await page.evaluate(() => ({ snapshot: LoopWorkNavigationBridge.snapshot(), overlay: document.querySelector('#overlay').innerText })).catch(() => null); throw error; }
  finally { report.errors = run.errors; await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2)); await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

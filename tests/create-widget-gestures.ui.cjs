// Real creation dialog and Today BrowserWindow; no replacement UI or bridge mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const evidence = path.resolve(process.env.LOOP_STAGE3_QA_DIR || '.local-review/memo-20261111/stage3/ui');
const report = { checks: [], layouts: [], limitations: ['Physical native title-bar dragging and cross-monitor/DPI', 'native Windows', 'human IME acceptance'] };
(async () => {
  await fs.mkdir(evidence, { recursive: true });
  const run = await launchRepository({ tasks: [task('today', { title: '保留真实任务与处理流', tags: { today: true } })], activeTaskId: 'today', taskGroups: [{ id: 'work', title: '工作', order: 1 }] }, 'stage3-create-widget');
  const { app, page, errors, profile } = run;
  const check = text => { report.checks.push(text); console.log('PASS ' + text); };
  const settle = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const native = async (action, value) => app.evaluate(({ BrowserWindow }, { action, value }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/today-widget.html'));
    if (action === 'bounds') return w.getBounds();
    if (action === 'set') { w.setBounds(value, false); return w.getBounds(); }
    if (action === 'show') { w.show(); w.focus(); }
  }, { action, value });
  try {
    await page.locator('[data-action="add-task"]').click();
    await page.locator('#create-title').fill('创建草稿');
    await page.locator('#create-description').fill('保留第一行\n背景第二行');
    await page.locator('[data-entry16-priority="high"]').click();
    await page.locator('[data-entry16="date"]').click();
    await page.locator('[data-entry16-date]').nth(1).click();
    await page.locator('[data-entry16="cycle"]').click();
    await page.locator('[data-entry16-frequency="weekly"]').click();
    await page.locator('#create-group').selectOption('work');
    await page.locator('[name="today"]').check();
    await page.keyboard.press('Escape');
    await page.locator('[data-action="add-task"]').click();
    assert.equal(await page.locator('#create-title').inputValue(), '创建草稿');
    assert.equal(await page.locator('#create-description').inputValue(), '保留第一行\n背景第二行');
    assert.equal(await page.locator('#create-group').inputValue(), 'work');
    assert.equal(await page.locator('[data-entry16-priority="high"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[name="today"]').isChecked(), true);
    assert.equal(await page.locator('[data-entry16-frequency="weekly"]').getAttribute('aria-pressed'), 'true');
    const deadline = await page.locator('#create-deadline').inputValue();
    await page.locator('#create-title').evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    assert.equal(await page.evaluate(() => state.tasks.length), 1);
    await page.locator('#create-form button[type="submit"]').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.composerType), 'task');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.type), 'submit');
    check('dismiss/reopen retains all task fields; IME Enter is ignored and Tab stays inside the dialog');

    for (const theme of ['light', 'dark']) for (const [width, height, scale] of [[1280, 850, 'normal'], [1024, 680, 'largest']]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).setSize(...size), [width, height]);
      await page.evaluate(({ theme, scale }) => { state.theme = theme; state.fontScale = scale; render(); }, { theme, scale });
      await settle(page);
      const layout = await page.evaluate(() => {
        const form = document.querySelector('#create-form'), body = form.querySelector('.entry16-body'), footer = form.querySelector('footer');
        return { viewport: [innerWidth, innerHeight], form: form.getBoundingClientRect().toJSON(), footer: footer.getBoundingClientRect().toJSON(), bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth };
      });
      assert.ok(layout.form.x >= 0 && layout.form.y >= 0 && layout.form.bottom <= layout.viewport[1] + 1, JSON.stringify(layout));
      assert.ok(layout.footer.bottom <= layout.viewport[1] && layout.footer.height > 30);
      assert.ok(layout.bodyScrollWidth <= layout.bodyWidth + 1, JSON.stringify(layout));
      await page.locator('.entry16-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const top = await page.locator('.entry16-body').evaluate(el => el.scrollTop);
      await page.locator('[data-entry16-weekday="0"]').click();
      const after = await page.locator('.entry16-body').evaluate(el => el.scrollTop);
      assert.ok(Math.abs(top - after) < 2, `disclosure must preserve scroll: ${top} -> ${after}`);
      for (const selector of ['#create-title', '#create-description', '#create-group', '#create-deadline', '#create-time', '#create-reminder', '#create-cycle-time']) {
        for (const state of ['default', 'hover', 'focus']) {
          const el = page.locator(selector);
          if (state === 'hover') await el.hover();
          if (state === 'focus') await el.focus();
          const paints = await el.evaluate(el => [el, el.parentElement, el.parentElement.parentElement].map(el => { const s = getComputedStyle(el); return [s.borderWidth === '0px' ? '' : s.borderColor, s.outlineStyle === 'none' ? '' : s.outlineColor, s.boxShadow]; }));
          for (const value of paints.flat()) for (const match of value.matchAll(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/g)) {
            if (match[4] === '0') continue;
            assert.ok(!(+match[2] > +match[1] + 12 && +match[2] > +match[3] + 8), `${selector} ${state}: ${value}`);
          }
        }
      }
      await page.locator('#create-title').focus();
      if (!process.env.LOOP_STAGE3_FUNCTIONAL_ONLY) await page.screenshot({ path: path.join(evidence, `create-${theme}-${width}-${scale}.png`) });
      report.layouts.push({ theme, scale, ...layout });
    }
    check('light/dark, normal/largest and minimum/common windows retain neutral fields, visible footer and scroll continuity');
    await page.locator('#create-title').focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await page.waitForFunction(() => !document.querySelector('#create-form'));
    await page.evaluate(async () => { await flushSave(); });
    const disk = JSON.parse(await fs.readFile(path.join(profile, 'task-data.json'), 'utf8'));
    const created = disk.tasks.find(t => t.title === '创建草稿');
    assert.ok(created); assert.equal(created.description, '保留第一行\n背景第二行');
    assert.equal(created.groupId, 'work'); assert.equal(created.priority, 'high'); assert.equal(created.tags.today, true);
    assert.ok(created.deadlineAt.startsWith(deadline)); assert.equal(created.recurrence.frequency, 'weekly');
    await page.locator('[data-action="add-task"]').click();
    await page.locator('[data-composer-type="quick"]').click();
    await page.locator('#create-title').fill('取消不创建');
    await page.locator('[data-entry16="cancel"]').click();
    await page.waitForFunction(() => document.activeElement?.dataset.action === 'add-task');
    await page.locator('[data-action="add-task"]').click();
    assert.equal(await page.locator('#create-title').inputValue(), '');
    await page.locator('[data-entry16="cancel"]').click();
    check('creation persists one task with its properties; cancel clears the draft and returns keyboard focus');

    const widget = app.windows().find(p => p.url().endsWith('/today-widget.html')) || await app.waitForEvent('window');
    widget.setDefaultTimeout(10000); widget.on('pageerror', e => errors.push(e.message));
    await widget.locator('.today-widget').waitFor();
    await page.evaluate(() => { state.theme = 'light'; state.fontScale = 'normal'; render(); });
    await widget.evaluate(() => personalTaskTrack.todayWidget.setPreferences({ position: 'top-left', compact: false }));
    await native('show'); await settle(widget);
    await widget.evaluate(() => { window.__stage3Header = document.querySelector('.widget-header'); window.__stage3Panel = document.querySelector('.today-widget'); window.__stage3Tabs = document.querySelector('.widget-tabs'); });
    for (let i = 0; i < 3; i++) await page.evaluate(i => { state.tasks.find(t => t.id === 'today').title = '后台更新 ' + i; render(); }, i);
    await widget.getByText('后台更新 2', { exact: true }).waitFor();
    assert.equal(await widget.evaluate(() => __stage3Header === document.querySelector('.widget-header') && __stage3Panel === document.querySelector('.today-widget') && __stage3Tabs === document.querySelector('.widget-tabs')), true);
    const regions = await widget.evaluate(() => ['.widget-header', '.widget-tabs', '.widget-tabs button', '.widget-header button', '[data-widget-resize]'].map(selector => [selector, getComputedStyle(document.querySelector(selector)).webkitAppRegion]));
    assert.deepEqual(regions.map(v => v[1]), ['drag', 'drag', 'no-drag', 'no-drag', 'no-drag']);
    check('background snapshots retain the live native drag header; blank tabs drag while controls opt out');

    // A genuine native move immediately after fit must not be lost to the old
    // 350 ms blanket suppression (setBounds here simulates the OS move event).
    await widget.evaluate(() => personalTaskTrack.todayWidget.resize({ height: 360, edge: 'bottom' }));
    const beforeMove = await native('bounds');
    const moved = await native('set', { ...beforeMove, x: beforeMove.x + 70, y: beforeMove.y + 45 });
    await widget.waitForFunction(({ x, y }) => personalTaskTrack.todayWidget.getState().then(s => s.position === 'custom' && s.customBounds.x === x && s.customBounds.y === y), moved);
    await widget.locator('[data-action="compact-widget"]').click(); await widget.locator('.today-widget.compact').waitFor();
    await widget.locator('[data-action="compact-widget"]').click(); await widget.locator('.today-widget:not(.compact)').waitFor();
    const restored = await native('bounds');
    assert.ok(restored.x > 50 && restored.y > 50, 'expand must not snap back to the preset corner');
    check('native move directly after resizing persists a custom position through compact/expand');

    await widget.evaluate(() => personalTaskTrack.todayWidget.setPreferences({ position: 'top-left', autoHeight: false, height: 300 }));
    await settle(widget);
    for (const edge of ['bottom', 'top']) {
      if (edge === 'top') { const b = await native('bounds'); await native('set', { ...b, y: b.y + 180 }); }
      const initial = await native('bounds');
      const handle = widget.locator(`[data-widget-resize="${edge}"]`), box = await handle.boundingBox();
      await widget.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await widget.mouse.down();
      const sign = edge === 'top' ? -1 : 1;
      await widget.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + sign * 24, { steps: 3 });
      await widget.waitForFunction(() => document.querySelector('.widget13-resizing'));
      await settle(widget);
      const middle = await native('bounds'); assert.ok(middle.height >= initial.height + 15, JSON.stringify({ edge, initial, middle }));
      await page.evaluate(() => { state.tasks.find(t => t.id === 'today').title += ' · 调整中更新'; render(); });
      await settle(widget);
      const stillCaptured = await handle.evaluate(el => el.hasPointerCapture(1));
      assert.ok(stillCaptured, 'native resize must retain pointer capture after its first window resize');
      // Move again with the held pointer after that first native resize.
      const nextBox = await handle.boundingBox();
      await widget.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2 + sign * 24, { steps: 3 });
      await settle(widget); await widget.mouse.up(); await settle(widget);
      const final = await native('bounds');
      assert.ok(final.height > middle.height + 12, JSON.stringify({ edge, initial, middle, final }));
      if (edge === 'bottom') assert.equal(final.y, initial.y);
      else assert.equal(final.y + final.height, initial.y + initial.height);
      assert.equal(await widget.locator('.widget13-resizing').count(), 0);
    }
    check('continuous real top/bottom resize survives multiple native bounds changes and keeps the opposite edge fixed');
    await widget.waitForTimeout(450);
    const cancelHandle = widget.locator('[data-widget-resize="bottom"]'), cancelBox = await cancelHandle.boundingBox();
    await widget.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + 3); await widget.mouse.down();
    await page.evaluate(() => { state.tasks.find(t => t.id === 'today').title = '取消后立即显示后台更新'; render(); });
    await settle(widget);
    await cancelHandle.evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
    await widget.mouse.up();
    await widget.getByText('取消后立即显示后台更新', { exact: true }).waitFor();
    assert.equal(await widget.locator('.widget13-resizing').count(), 0);
    check('cancelled pointer gestures immediately flush queued background updates');
    // A completed drag suppresses its trailing click for 400 ms; this is a new
    // intentional tab action, rather than that synthetic trailing click.
    await widget.waitForTimeout(450);
    await widget.locator('[data-widget-type="quick"]').click();
    await widget.locator('#widget-capture').fill('速记草稿与选区');
    await widget.locator('#widget-capture').evaluate(el => { window.__stage3Capture = el; el.setSelectionRange(2, 5); });
    await page.evaluate(() => { state.tasks.find(t => t.id === 'today').title = '不打断速记'; render(); });
    await settle(widget);
    assert.equal(await widget.evaluate(() => __stage3Capture === document.querySelector('#widget-capture')), true);
    assert.equal(await widget.locator('#widget-capture').inputValue(), '速记草稿与选区');
    assert.deepEqual(await widget.locator('#widget-capture').evaluate(el => [el.selectionStart, el.selectionEnd]), [2, 5]);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { state.theme = theme; render(); }, theme); await settle(widget);
      if (!process.env.LOOP_STAGE3_FUNCTIONAL_ONLY) await widget.screenshot({ path: path.join(evidence, `widget-${theme}.png`) });
    }
    check('background refresh preserves the native quick-capture editor, draft and selection');
    assert.deepEqual(errors, []); report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.failure = error.stack; await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); throw error; }
  finally { await fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2)); await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

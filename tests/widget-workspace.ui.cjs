// Real production BrowserWindows, isolated synthetic tasks. No browser mock UI.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const evidence = path.resolve(process.env.LOOP_WIDGET_QA_DIR || '.local-review/frontend-remediation/stage-07/ui');
const report = { checks: [], layouts: [], inputs: [], errors: [], limitations: ['native Windows', 'physical cross-monitor/DPI', 'human IME and pointer feel'] };
const settle = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

(async () => {
  await fs.mkdir(evidence, { recursive: true });
  const run = await launchRepository({ tasks: [
    task('today-a', { title: '核对独立窗口与真实操作', tags: { today: true }, conclusion: '已完成真实验证' }),
    task('today-b', { title: '需要保留的长任务标题与处理内容'.repeat(12), order: 2, tags: { today: true } }),
    task('quick-a', { title: '速记中的想法', captureSource: 'today-widget', description: '这里保留补充内容。', todayQuickCaptureOrder: 1 }),
    task('quick-b', { title: '等待整理的另一条速记', captureSource: 'today-widget', todayQuickCaptureOrder: 2 }),
    task('quick-c', { title: '删除与恢复保护', captureSource: 'today-widget', todayQuickCaptureOrder: 3 }),
  ], taskGroups: [{ id: 'group-work', title: '项目与知识整理'.repeat(12), order: 1 }] }, 'widget-stage7');
  const { app, page, profile } = run;
  let widget, surface;
  const check = text => { report.checks.push(text); console.log('PASS ' + text); };
  const shot = async (p, name) => { if (!process.env.LOOP_WIDGET_FUNCTIONAL_ONLY) { await settle(p); await p.screenshot({ path: path.join(evidence, name + '.png') }); } };
  const native = async (which, action, value) => app.evaluate(({ BrowserWindow }, { which, action, value }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith(`/app/renderer/${which}.html`));
    if (action === 'bounds') return win.getBounds();
    if (action === 'hide') win.hide();
    if (action === 'show') { win.show(); win.focus(); }
    if (action === 'size') win.setSize(...value);
    if (action === 'front') return { topmost: win.isAlwaysOnTop(), visible: win.isVisible(), focused: win.isFocused() };
    return true;
  }, { which, action, value });
  const open = async (kind, id = '') => {
    const result = await widget.evaluate(async ({ kind, id }) => {
      const panel = document.querySelector('.today-widget').getBoundingClientRect();
      const button = document.querySelector(id ? `[data-widget12="row-menu"][data-widget-id="${id}"]` : '[data-action="widget-preferences"]');
      const rect = (button || document.querySelector('.widget-header')).getBoundingClientRect();
      const value = { kind, taskId: id, anchor: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, panel: { x: panel.x, y: panel.y, w: panel.width, h: panel.height } };
      let result;
      for (let i = 0; i < 20; i++) {
        result = await personalTaskTrack.todayWidget.openSurface(value);
        if (result.code !== 'BUSY') break;
        await new Promise(r => setTimeout(r, 50));
      }
      return result;
    }, { kind, id });
    assert.equal(result.success, true, 'the native controller accepts opening this surface');
    surface = app.windows().find(p => p.url().endsWith('/widget-surface.html')) || await app.waitForEvent('window');
    surface.setDefaultTimeout(10000);
    if (!surface.__s7Observed) { surface.__s7Observed = true; surface.on('pageerror', e => report.errors.push(e.message)); }
    await surface.locator('#surface-host > :first-child').waitFor();
    if (id) await surface.locator(`[data-widget-id="${id}"]`).first().waitFor();
    await settle(surface);
    return surface;
  };
  const close = async () => { await surface.evaluate(() => personalTaskTrack.widgetSurface.close({ reason: 'escape' })); await settle(widget); };
  const lane = async value => { await widget.locator(`[data-widget-type="${value}"]`).click(); await settle(widget); };
  const audit = async (p, selector, label) => {
    const field = p.locator(selector); if (!await field.count()) return;
    for (const state of ['default', 'hover', 'focus']) {
      if (state === 'hover') await field.hover();
      if (state === 'focus') await field.focus();
      const styles = await field.evaluate(el => [el, el.parentElement, el.parentElement.parentElement].map(n => { const s = getComputedStyle(n); return { tag: n.tagName, id: n.id, background: s.backgroundColor, border: s.borderColor, borderWidth: s.borderWidth, outline: s.outline, shadow: s.boxShadow }; }));
      for (const s of styles) {
        assert.ok(s.shadow === 'none' || s.shadow.includes('inset'), JSON.stringify(s));
        for (const v of [s.borderWidth === '0px' ? '' : s.border, s.outline.includes('none') ? '' : s.outline]) {
          for (const c of v.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)) assert.ok(!(+c[2] > +c[1] + 12 && +c[2] > +c[3] + 8), JSON.stringify(s));
        }
      }
      report.inputs.push({ label, state, styles });
    }
  };
  try {
    await app.evaluate(({ BrowserWindow }) => {
      global.__s7WindowCalls = [];
      for (const method of ['show', 'hide', 'focus']) {
        const original = BrowserWindow.prototype[method];
        BrowserWindow.prototype[method] = function (...args) { global.__s7WindowCalls.push({ method, url: this.webContents.getURL(), at: Date.now(), stack: new Error().stack }); return original.apply(this, args); };
      }
    });
    await page.waitForFunction(() => typeof initializeTodayWidgetBridge === 'function');
    widget = app.windows().find(p => p.url().endsWith('/today-widget.html')) || await app.waitForEvent('window');
    widget.setDefaultTimeout(10000); widget.on('pageerror', e => report.errors.push(e.message));
    await widget.locator('.today-widget').waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      global.__s7Levels = [];
      const original = BrowserWindow.prototype.setAlwaysOnTop;
      BrowserWindow.prototype.setAlwaysOnTop = function (...args) { global.__s7Levels.push({ url: this.webContents.getURL(), args }); return original.apply(this, args); };
    });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { state.theme = theme; render(); }, theme);
      await widget.locator('[data-widget12="row-menu"][data-widget-id="today-b"]').click();
      surface = app.windows().find(p => p.url().endsWith('/widget-surface.html')) || await app.waitForEvent('window');
      await surface.locator('.widget13-menu').waitFor();
      const parented = await app.evaluate(({ BrowserWindow }) => {
        const child = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/widget-surface.html'));
        return child.getParentWindow()?.webContents.getURL().endsWith('/today-widget.html');
      });
      assert.equal(parented, true, 'the native menu is owned by the widget');
      // A delayed editing-release and app activation refresh used to put the
      // widget over this visible native menu.
      await widget.evaluate(() => personalTaskTrack.todayWidget.setEditing(false));
      const levels = await app.evaluate(() => global.__s7Levels.slice(-2));
      assert.ok(levels[0].url.endsWith('/today-widget.html'));
      assert.ok(levels[1].url.endsWith('/widget-surface.html'));
      if (process.platform === 'darwin') assert.ok(levels[1].args[2] > levels[0].args[2]);
      assert.match(await widget.locator('[data-widget-id="today-b"].widget13-more path').getAttribute('d'), /^M12 5h/);
      await shot(surface, `native-row-menu-${theme}`);
      await widget.locator('[data-widget-type="quick"]').click();
      assert.equal(await widget.locator('[data-widget-type="quick"]').getAttribute('aria-pressed'), 'true', 'one click both closes the menu and changes lane');
      await widget.waitForFunction(() => document.querySelector('#widget-capture'));
      await open('row-menu', 'quick-a');
      await widget.locator('#widget-capture').click();
      assert.equal(await widget.evaluate(() => document.activeElement.id), 'widget-capture', 'one outside click focuses the chosen field');
      await widget.locator('#widget-capture').fill('单次点击后直接输入');
      assert.equal(await widget.locator('#widget-capture').inputValue(), '单次点击后直接输入');
      await open('row-menu', 'quick-a');
      await native('index', 'show');
      await page.waitForTimeout(50);
      assert.equal((await native('index', 'front')).focused, true, 'outside dismissal must not pull focus back to the widget');
      assert.equal((await native('widget-surface', 'front')).visible, false);
      // The two close sources can report the same outside gesture. Neither
      // should steal destination focus or suppress the next keyboard command.
      await widget.evaluate(() => personalTaskTrack.todayWidget.closeSurface({ reason: 'outside' }));
      assert.equal((await native('index', 'front')).focused, true);
      await native('today-widget', 'show');
      await lane('task');
    }
    check('owned native menu stays above widget refresh; one outside click operates its destination and duplicate close preserves focus');
    await lane('quick');
    await widget.locator('#widget-capture').fill('尚未提交的草稿\n保留完整补充内容');
    await widget.evaluate(() => { globalThis.__s7Composer = document.querySelector('#widget-capture'); __s7Composer.setSelectionRange(2, 6); });
    await native('index', 'hide');
    await page.evaluate(() => { state.tasks.find(t => t.id === 'quick-b').description = '从主窗刷新'; save(); render(); });
    await settle(widget);
    assert.equal(await widget.evaluate(() => document.querySelector('#widget-capture') === __s7Composer), true);
    assert.equal(await widget.locator('#widget-capture').inputValue(), '尚未提交的草稿\n保留完整补充内容');
    await page.evaluate(() => personalTaskTrack.todayWidget.setPreferences({ opacity: 82 }));
    assert.equal(await widget.evaluate(() => document.querySelector('#widget-capture') === __s7Composer), true);
    await page.evaluate(() => personalTaskTrack.todayWidget.hide());
    await page.evaluate(() => personalTaskTrack.todayWidget.show());
    assert.equal(await widget.locator('#widget-capture').inputValue(), '尚未提交的草稿\n保留完整补充内容');
    check('draft, composer identity and selection survive hidden main window, snapshots, opacity and widget reopen');

    // Actual request delivery twice must mutate main data once, including an
    // asynchronous deletion/response and reinitialized subscriptions.
    await page.evaluate(() => initializeTodayWidgetBridge());
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
      for (let i = 0; i < 2; i++) main.webContents.send('today-widget:create-task', { requestId: 's7-duplicate-create', title: '同一请求只添加一次', description: '保留', addToToday: false });
    });
    await page.waitForFunction(() => state.tasks.some(t => t.title === '同一请求只添加一次'));
    assert.equal(await page.evaluate(() => state.tasks.filter(t => t.title === '同一请求只添加一次').length), 1);
    check('duplicate request delivery and bridge reinitialization create one record');

    // Delay the production handler; real repeated Enter events cannot submit
    // a second request while the first is waiting.
    await page.evaluate(() => { globalThis.__s7Create = createQuickCapture; createQuickCapture = (...args) => { globalThis.__s7CreateCalls = (globalThis.__s7CreateCalls || 0) + 1; return __s7Create(...args); }; });
    await widget.locator('#widget-capture').fill('快速保存只产生一条');
    await widget.evaluate(() => { const el = document.querySelector('#widget-capture'); for (let i = 0; i < 3; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await page.waitForFunction(() => state.tasks.some(t => t.title === '快速保存只产生一条'));
    assert.equal(await page.evaluate(() => __s7CreateCalls), 1);
    await widget.waitForFunction(() => !document.querySelector('#widget-capture').readOnly);
    await page.evaluate(() => { createQuickCapture = __s7Create; });
    check('rapid Enter submits one capture, with disabled save and a busy state');

    await widget.locator('[data-widget12="edit"][data-widget-id="quick-a"]').focus();
    await widget.keyboard.press('Enter');
    await widget.locator('#widget-title-input').fill('改名草稿需要保留');
    await native('index', 'show');
    await page.evaluate(() => { state.tasks.find(t => t.id === 'quick-b').title = '背景刷新后的速记'; save(); render(); });
    await settle(widget);
    assert.equal(await widget.locator('#widget-title-input').inputValue(), '改名草稿需要保留');
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'quick-a').title), '速记中的想法');
    await native('today-widget', 'show');
    await widget.locator('#widget-title-input').focus(); await widget.keyboard.press('Enter');
    await page.waitForFunction(() => state.tasks.find(t => t.id === 'quick-a').title === '改名草稿需要保留');
    await widget.waitForFunction(() => !document.querySelector('#widget-title-input'));
    await widget.locator('[data-widget-id="quick-b"].widget-title').waitFor();
    check('rename draft survives native window blur and queued snapshot; Enter commits and applies latest rows');

    // Real auxiliary keyboard navigation, order, lane move, promote, delete.
    await open('row-menu', 'quick-b');
    await surface.keyboard.press('End'); assert.equal(await surface.evaluate(() => document.activeElement.dataset.widget12), 'delete-quick');
    await surface.keyboard.press('Home'); assert.equal(await surface.evaluate(() => document.activeElement.dataset.widget12), 'open-record');
    const beforeOrder = await widget.locator('[data-widget-row]').evaluateAll(rows => rows.map(row => row.dataset.widgetRow));
    await surface.locator('[data-widget12="move-up"]').click();
    await widget.waitForFunction(index => [...document.querySelectorAll('[data-widget-row]')].findIndex(row => row.dataset.widgetRow === 'quick-b') === index, beforeOrder.indexOf('quick-b') - 1);
    await open('row-menu', 'quick-b'); await surface.locator('[data-widget12="to-today"]').click();
    await page.waitForFunction(() => state.tasks.find(t => t.id === 'quick-b').captureSource !== 'today-widget');
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'quick-b').tags.today), true);
    await lane('task'); await open('row-menu', 'quick-b'); await surface.locator('[data-widget12="to-quick"]').click();
    await page.waitForFunction(() => state.tasks.find(t => t.id === 'quick-b').captureSource === 'today-widget');
    await lane('quick'); await open('promote', 'quick-a');
    await surface.locator('[data-group-value="group-work"]').click();
    await page.waitForFunction(() => state.tasks.find(t => t.id === 'quick-a').groupId === 'group-work');
    assert.equal(await page.evaluate(() => state.tasks.find(t => t.id === 'quick-a').description), '这里保留补充内容。');
    await open('delete', 'quick-c');
    await surface.locator('.dialog-head button').focus(); await surface.keyboard.press('Shift+Tab');
    assert.equal(await surface.evaluate(() => document.activeElement.dataset.widget12), 'confirm-delete');
    await surface.keyboard.press('Escape'); assert.equal(await page.evaluate(() => state.tasks.some(t => t.id === 'quick-c')), true);
    await open('delete', 'quick-c'); await surface.locator('[data-widget12="confirm-delete"]').click();
    await page.waitForFunction(() => !state.tasks.some(t => t.id === 'quick-c'));
    assert.equal(await page.evaluate(() => r26Archive().some(e => e.objectId === 'quick-c')), true);
    check('real auxiliary menu keyboard, reorder, both lane transfers, promotion and recoverable deletion');

    // Failure response is local fault injection, not a claim of disk failure.
    await page.evaluate(() => { globalThis.__s7Delete = deleteQuickCaptureFromWidget; deleteQuickCaptureFromWidget = () => new Promise(resolve => { globalThis.__s7DeleteRelease = () => resolve({ success: false, code: 'DELETE_FAILED' }); }); });
    await open('delete', 'quick-b'); await surface.locator('[data-widget12="confirm-delete"]').click();
    await page.waitForFunction(() => typeof __s7DeleteRelease === 'function');
    await surface.keyboard.press('Escape');
    assert.equal(await surface.locator('.dialog').count(), 1);
    assert.equal(await native('widget-surface', 'front').then(s => s.visible), true);
    await page.evaluate(() => __s7DeleteRelease());
    await surface.waitForFunction(() => document.querySelector('.widget-surface-feedback').textContent.includes('重试'));
    assert.equal(await native('widget-surface', 'front').then(s => s.visible), true);
    assert.equal(await page.evaluate(() => state.tasks.some(t => t.id === 'quick-b')), true);
    await page.evaluate(() => { deleteQuickCaptureFromWidget = __s7Delete; });
    await close(); check('failed deletion keeps confirmation and retry feedback; busy Escape does not dismiss');

    await lane('task'); await widget.locator('[data-complete-task="today-a"]').click();
    await page.waitForFunction(() => state.tasks.find(t => t.id === 'today-a').status === 'done');
    check('completion uses the main data model and updates the real floating list');

    // Geometry on the attached physical display; no multi-monitor claim.
    for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      await page.evaluate(position => personalTaskTrack.todayWidget.setPreferences({ position }), position);
      await open('settings');
      const bounds = await native('widget-surface', 'bounds');
      const area = await app.evaluate(({ screen }, bounds) => screen.getDisplayMatching(bounds).workArea, bounds);
      const panel = await surface.locator('#surface-host > :first-child').boundingBox();
      assert.ok(bounds.x + panel.x >= area.x && bounds.y + panel.y >= area.y);
      assert.ok(bounds.x + panel.x + panel.width <= area.x + area.width + 1);
      assert.ok(bounds.y + panel.y + Math.min(panel.height, bounds.height - panel.y) <= area.y + area.height + 1);
      report.layouts.push({ position, bounds, area, panel }); await close();
    }
    await page.evaluate(() => personalTaskTrack.todayWidget.setPreferences({ position: 'top-left' }));
    const bottomResize = await widget.evaluate(() => personalTaskTrack.todayWidget.resize({ height: 410, edge: 'bottom' }));
    await widget.waitForFunction(height => Math.abs(document.querySelector('.today-widget').offsetHeight - height) <= 1, bottomResize.height);
    assert.equal(await widget.locator('.today-widget').evaluate(el => el.classList.contains('widget13-sized')), true);
    const topResize = await widget.evaluate(() => personalTaskTrack.todayWidget.resize({ height: 300, edge: 'top' }));
    await widget.waitForFunction(height => Math.abs(document.querySelector('.today-widget').offsetHeight - height) <= 1, topResize.height);
    await widget.evaluate(() => personalTaskTrack.todayWidget.resize({ reset: true }));
    await widget.waitForFunction(() => !document.querySelector('.today-widget').style.height);
    const before = await native('today-widget', 'bounds');
    await widget.locator('.widget-header').focus(); await widget.keyboard.press('ArrowRight');
    const after = await native('today-widget', 'bounds'); assert.ok(after.x >= before.x);
    check('actual display corner positioning, auxiliary clamping, top/bottom resize/reset and keyboard nudge');

    for (const theme of ['light', 'dark']) for (const scale of ['normal', 'largest']) {
      await page.evaluate(({ theme, scale }) => { state.theme = theme; state.fontScale = scale; state.zhFont = 'songti'; state.enFont = 'inter'; save(); render(); }, { theme, scale });
      await lane('quick'); await widget.locator('#widget-capture').fill('保留输入的同一层背景');
      await audit(widget, '#widget-capture', `${theme}-${scale}-capture`);
      const bgs = report.inputs.slice(-3).map(v => v.styles[1].background); assert.equal(new Set(bgs).size, 1);
      await shot(widget, `widget-${theme}-${scale}`);
      await open('settings');
      const range = surface.locator('#widget12-opacity'); await range.focus();
      const old = await range.inputValue(); await surface.keyboard.press('ArrowLeft'); await settle(surface);
      assert.equal(await surface.evaluate(() => document.activeElement.id), 'widget12-opacity');
      assert.equal(Number(await range.inputValue()), Math.max(70, Number(old) - 1));
      // Change appearance while the auxiliary window is already open.
      const nextTheme = theme === 'light' ? 'dark' : 'light';
      await page.evaluate(t => { state.theme = t; save(); render(); }, nextTheme);
      await surface.waitForFunction(t => document.documentElement.dataset.theme === t, nextTheme);
      await page.evaluate(t => { state.theme = t; save(); render(); }, theme);
      await surface.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
      const appearance = await Promise.all([page, widget, surface].map(p => p.evaluate(() => ({ theme: document.documentElement.dataset.theme, scale: getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim(), sans: getComputedStyle(document.documentElement).getPropertyValue('--sans').trim(), dpr: devicePixelRatio }))));
      assert.equal(new Set(appearance.map(v => JSON.stringify({ theme: v.theme, scale: v.scale, sans: v.sans }))).size, 1);
      await shot(surface, `settings-${theme}-${scale}`); await close();
      await widget.locator('[data-widget-id="quick-b"].widget-title').focus(); await widget.keyboard.press('Enter');
      await audit(widget, '#widget-title-input', `${theme}-${scale}-rename`);
      assert.equal(await widget.locator('#widget-title-input').evaluate(n => getComputedStyle(n).backgroundColor), 'rgba(0, 0, 0, 0)');
      await widget.keyboard.press('Escape');
      await open('row-menu', 'quick-b'); await shot(surface, `menu-${theme}-${scale}`); await close();
      await open('promote', 'quick-b'); await shot(surface, `promote-${theme}-${scale}`); await close();
      await open('delete', 'quick-b'); await shot(surface, `delete-${theme}-${scale}`); await close();
      report.layouts.push({ theme, scale, appearance });
    }
    check('light/dark, font scale/families, persistent input plane and all four auxiliary surfaces propagate live');
    await page.evaluate(() => personalTaskTrack.todayWidget.setPreferences({ alwaysOnTop: false, clickThrough: true, opacity: 70 }));
    assert.equal((await native('today-widget', 'front')).topmost, false);
    assert.equal(await widget.locator('.today-widget').evaluate(n => getComputedStyle(n).opacity), '0.7');
    await page.evaluate(() => personalTaskTrack.todayWidget.setPreferences({ alwaysOnTop: true, clickThrough: false, opacity: 100 }));
    const state = await page.evaluate(() => personalTaskTrack.todayWidget.getState());
    assert.equal(state.alwaysOnTop, true); assert.equal(state.clickThrough, false);
    await widget.evaluate(() => personalTaskTrack.todayWidget.openMain('quick-b'));
    await page.waitForFunction(() => state.activeTaskId === 'quick-b');
    assert.equal((await native('index', 'front')).visible, true);
    check('topmost, opacity, passthrough preferences and main-window wake use native controller');
    assert.deepEqual(report.errors, []); assert.deepEqual(run.errors, []);
    report.complete = true;
  } catch (error) { report.failure = error.stack; report.native = await app.evaluate(({ BrowserWindow }) => ({ windows: BrowserWindow.getAllWindows().map(w => ({ url: w.webContents.getURL(), visible: w.isVisible(), focused: w.isFocused(), bounds: w.getBounds() })), calls: global.__s7WindowCalls.slice(-24) })).catch(() => []); throw error; }
  finally { await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2)); await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

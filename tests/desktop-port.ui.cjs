const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const { readTaskData } = require('../app/main/storage.cjs');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');

const evidence = path.resolve(process.env.LOOP_DESKTOP_PORT_EVIDENCE || '.local-review/desktop-port-20261128');
const now = '2026-11-28T12:00';
const id = 'desktop-port';
const noteId = 'desktop-port-note';
const noteTitle = '窗口层级调研';
const markdown = '# 窗口层级调研\n\nElectron 在 Windows 上的窗口层级取决于调用时机。\n\n'
  + '## 启动顺序\n\n检查应用启动和托盘恢复路径。\n\n'
  + '## 层级对照\n\n| 窗口 | Windows 11 | macOS |\n| --- | --- | --- |\n| floating | 上层窗口 | 复现 |\n| pop-up-menu | 待确认 | 待确认 |\n\n'
  + Array.from({ length: 24 }, (_, i) => `### 验证记录 ${i + 1}\n\n验证资料与窗口行为。\n\n`).join('');

async function assertNeutral(page, selector) {
  const locator = page.locator(selector);
  const green = await locator.evaluate(el => {
    const failures = [];
    const check = state => {
      for (let node = el; node && !node.matches('.workspace, #overlay'); node = node.parentElement) {
        const css = getComputedStyle(node);
        const paints = [css.boxShadow, css.outlineStyle !== 'none' && css.outlineWidth !== '0px' && css.outlineColor];
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          if (css[`border${side}Width`] !== '0px' && css[`border${side}Style`] !== 'none') paints.push(css[`border${side}Color`]);
        }
        for (const paint of paints.filter(Boolean)) {
          for (const [, r, g, b, alpha = 1] of paint.matchAll(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/g)) {
            if (+alpha > 0 && +g > +r + 8 && +g > +b + 8) failures.push({ state, node: node.className, paint });
          }
        }
      }
    };
    check('current');
    el.focus();
    check('focused');
    return failures;
  });
  assert.deepEqual(green, [], selector);
  await locator.hover();
  assert.deepEqual(await locator.evaluate(element => {
    const css = getComputedStyle(element);
    return [css.borderTopColor, css.outlineColor, css.boxShadow]
      .flatMap(paint => [...paint.matchAll(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/g)])
      .filter(([, r, g, b, alpha = 1]) => +alpha > 0 && +g > +r + 8 && +g > +b + 8)
      .map(match => match[0]);
  }), [], `${selector} hover`);
}

async function sizeWindow(app, width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(w, h);
  }, [width, height]);
}

async function main() {
  await fs.mkdir(evidence, { recursive: true });
  const files = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-port-file-'));
  let run;
  try {
    const file = path.join(files, `${noteTitle}.md`);
    await fs.writeFile(file, markdown);
    const disk = await readKnowledgeDocument(file);
    assert.equal(disk.success, true);
    run = await launchRepository({
      activeTaskId: id, theme: 'light',
      tasks: [task(id, {
        title: '排查 Windows 升级后今日浮窗不再置顶',
        description: '用户反馈升级后今日浮窗在 Windows 11 上会被其他窗口遮住。macOS 正常。',
        hypothesis: '排查 Squirrel 启动时机与 setAlwaysOnTop 调用顺序，记录对照结果。',
        deadlineReminderMinutes: null,
        nodes: [{ id: 'parent', title: '复现问题', status: 'done', children: [
          { id: 'child', title: '记录 Windows 与 macOS 行为', status: 'todo', children: [], records: [] },
        ], records: [] }],
        history: [['刚刚', '更新验证记录']],
      })],
      knowledgeDocuments: [{ id: noteId, title: noteTitle, notes: markdown,
        knowledgeNote: { ...disk, noteId, title: noteTitle, documentState: 'SAVED', dirty: false } }],
      knowledgeWorkspace: { taskId: id, activeId: noteId, openIds: [noteId],
        tabsByTask: { [id]: [noteId] }, lastByTask: { [id]: noteId } },
    }, 'desktop-port');
    const { app, page, profile, errors } = run;
    const runtime = await app.evaluate(({ app }) => ({ source: app.getAppPath(), profile: app.getPath('userData'), version: app.getVersion(), pid: process.pid }));
    assert.equal(runtime.source, path.resolve(__dirname, '..'));
    assert.equal(runtime.profile, profile);
    console.log(JSON.stringify(runtime));

    await sizeWindow(app, 1404, 800);
    await page.evaluate(value => { loopSetPreviewClock(value); render(); }, now);
    const dock = page.locator('.pdock');
    const brief = page.locator('.brief21-docked');
    const row = brief.locator('.brief-rows');
    const toggle = brief.locator('[data-brief21-toggle]');
    const schedule = dock.locator('[data-slot="schedule"]');
    const panel = page.locator('.prop-pop');
    const slot = name => dock.locator(`[data-slot="${name}"]`);
    const tab = name => page.locator(`.pane-tab[data-pane="${name}"]`);
    const set = (key, value) => panel.locator(`[data-p="${key}"][data-value="${value}"]`);
    const field = key => panel.locator(`[data-pi="${key}"]`);
    const screen = (theme, name) => page.screenshot({ path: path.join(evidence, `${theme}-${name}.png`), animations: 'disabled' });
    const closePanel = async () => { await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' }); };
    const diskTask = async () => (await readTaskData(profile)).tasks.find(item => item.id === id);
    const saved = async (predicate) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const item = await diskTask();
        if (predicate(item)) return item;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.fail('Timed out waiting for task-data.json');
    };

    await row.waitFor();
    assert.deepEqual(await dock.locator('button').evaluateAll(buttons => buttons.map(button => [button.dataset.slot, button.textContent.trim()])),
      [['schedule', ''], ['priority', '中'], ['today', ''], ['marks', '']]);
    await page.locator('.breadcrumb').hover();
    await page.waitForFunction(() => [...document.querySelectorAll('.pdock button:not(.set)')].every(button => +getComputedStyle(button).opacity < .6));
    assert.equal(await slot('priority').evaluate(button => getComputedStyle(button).opacity), '1');
    await page.locator('.work-head .task-title').hover();
    await page.waitForFunction(() => [...document.querySelectorAll('.pdock button')].every(button => getComputedStyle(button).opacity === '1'));
    console.log('PASS fixed dock slots show medium priority; unset slots remain quiet until hovered');

    await slot('today').click();
    await page.locator('[data-action="undo-dock-today"]').click();
    assert.equal(await slot('today').getAttribute('aria-pressed'), 'false');
    await slot('today').click();
    await page.locator('[data-workspace-dismiss]').click();
    await slot('priority').click();
    assert.equal(await set('priority', 'medium').getAttribute('aria-pressed'), 'true');
    await set('priority', 'low').click();
    assert.equal(await slot('priority').innerText(), '低');
    await set('priority', 'medium').click();
    assert.equal(await slot('priority').innerText(), '中');
    await set('priority', 'high').click();
    assert.equal(await panel.isVisible(), true);
    assert.equal(await slot('priority').innerText(), '高');
    await closePanel();
    assert.equal(await slot('priority').evaluate(button => document.activeElement === button), true);
    await slot('marks').click();
    await set('mark', 'blocked').click();
    await set('mark', 'later').click();
    assert.equal(await slot('marks').innerText(), '卡住 · 稍后');
    await page.locator('.work-head .task-title').click({ position: { x: 3, y: 3 } });
    await panel.waitFor({ state: 'hidden' });

    await schedule.click();
    await field('date').fill('2026-11-27');
    await field('time').fill('17:42');
    const dated = await saved(item => item.deadlineAt === new Date('2026-11-27T17:42').toISOString());
    assert.equal(dated.priority, 'high');
    assert.equal(dated.tags.today, true);
    assert.equal(dated.tags.blocked, true);
    assert.match(await schedule.innerText(), /11\/27 17:42/);
    await set('custom', '').click();
    const cases = [
      ['daily', 3, [5], '每 3 天'],
      ['weekly', 2, [1, 5], '每 2 周 · 周一、五'],
      ['monthly', 2, [1, 5], '每 2 个月'],
      ['yearly', 4, [1, 5], '每 4 年'],
    ];
    for (const [frequency, interval, weekdays, label] of cases) {
      await field('unit').selectOption(frequency);
      if (frequency === 'weekly') {
        for (const day of weekdays) {
          const button = set('weekday', String(day));
          if (await button.getAttribute('aria-pressed') === 'false') await button.click();
        }
      }
      await field('interval').fill(String(interval));
      await field('interval').evaluate(el => el.blur());
      await saved(item => item.recurrence.frequency === frequency && item.recurrence.interval === interval
        && item.recurrence.weekdays.join() === weekdays.join());
      assert.match(await schedule.getAttribute('title'), new RegExp(label.replace(' · ', ' .* ')));
      assert.equal(await panel.isVisible(), true);
    }
    await closePanel();
    console.log('PASS live deadline, all four recurrence units, storage readback, marks, priority and Today undo');

    await tab('notes').click();
    await row.waitFor({ state: 'hidden' });
    assert.ok((await brief.boundingBox()).height <= 36);
    assert.equal(await brief.locator('.bwarn').isVisible(), true);
    await toggle.click();
    await row.waitFor();
    await toggle.click();
    await row.waitFor({ state: 'hidden' });
    await tab('history').click();
    assert.equal(await row.isVisible(), false);
    await tab('flow').click();
    await row.waitFor();
    await toggle.click();
    await tab('notes').click();
    await tab('flow').click();
    assert.equal(await row.isVisible(), false);
    await toggle.click();
    console.log('PASS brief folding, optional notes expansion and flow preference');

    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { state.theme = value; render(); }, theme);
      await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
      const geometry = () => page.evaluate(() => [
        '.pdock', '.brief-rows .brief21-input', '.flow-toolbar-add', '.task-menu-action',
      ].map(selector => [selector, document.querySelector(selector).getBoundingClientRect().right]));
      const edges = await geometry();
      const rights = edges.map(([, right]) => right);
      assert.ok(Math.max(...rights) - Math.min(...rights) <= 2, JSON.stringify(edges));
      await page.mouse.move(100, 100);
      for (const [mode, width] of [['priority', 180], ['marks', 152]]) {
        await slot(mode).click();
        assert.equal((await panel.boundingBox()).width, width);
        assert.equal(await panel.evaluate(element => {
          const panel = element.getBoundingClientRect();
          return panel.right <= innerWidth - 12 && [...element.querySelectorAll('button')].every(button => {
            const rect = button.getBoundingClientRect();
            return rect.right <= panel.right - 10 && rect.left >= panel.left + 10;
          });
        }), true);
        await screen(theme, mode);
        await closePanel();
      }
      await page.mouse.move(100, 100);
      await page.waitForFunction(() => [...document.querySelectorAll('.pdock .high, .pdock .over, .pdock .stuck')]
        .every(button => getComputedStyle(button).backgroundColor === 'rgba(0, 0, 0, 0)'));
      const colors = await dock.locator('.high, .over, .stuck').evaluateAll(buttons => buttons.map(button => {
        const css = getComputedStyle(button);
        return [css.backgroundColor, css.color, getComputedStyle(button.querySelector('svg')).color];
      }));
      assert.equal(colors.length, 3);
      for (const [background, color, icon] of colors) {
        assert.equal(background, 'rgba(0, 0, 0, 0)');
        assert.equal(color, icon);
        assert.match(color, theme === 'light' ? /182, 64, 46/ : /226, 115, 95/);
      }
      await screen(theme, 'flow');
      await assertNeutral(page, '.brief-rows [data-brief21-key$=":description"]');
      await schedule.click();
      assert.equal((await panel.boundingBox()).width, 288);
      for (const key of ['date', 'time', 'interval', 'unit']) await assertNeutral(page, `.prop-pop [data-pi="${key}"]`);
      await screen(theme, 'schedule');
      await closePanel();

      await tab('notes').click();
      await page.waitForFunction(() => knowledgeCurrentEntry()?.view);
      const centers = await brief.locator('.brief21-toggle > span, .brief21-meter, .bwarn').evaluateAll(labels => labels.map(label => {
        const rect = label.getBoundingClientRect();
        return rect.top + rect.height / 2;
      }));
      assert.equal(centers.length, 3);
      const [titleCenter, countCenter, warningCenter] = centers;
      assert.ok(Math.abs(titleCenter - warningCenter) <= 0.5, JSON.stringify(centers));
      assert.ok(Math.abs(countCenter - titleCenter - 0.5) <= 0.1, JSON.stringify(centers));
      const bar = page.locator('.kn-document-bar');
      const outline = page.locator('.kn-outline');
      const body = page.locator('.knowledge-body');
      const float = page.locator('.kn-float');
      await outline.waitFor();
      await body.evaluate(el => { el.scrollTop = 0; });
      await page.waitForFunction(() => !document.querySelector('.kn-float').classList.contains('raised'));
      assert.equal((await bar.boundingBox()).height, 34);
      const plus = await bar.locator('[data-kn-action="new-note"]').boundingBox();
      const barBox = await bar.boundingBox();
      assert.equal(barBox.x + barBox.width - plus.x - plus.width, 16);
      assert.equal((await bar.locator('.kn-document-tab:has([aria-selected=true])').boundingBox()).height, 24);
      assert.equal(await float.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
      assert.ok((await float.boundingBox()).x + (await float.boundingBox()).width <= (await outline.boundingBox()).x);
      const padding = await page.evaluate(() => ['.kn-article', '.kn-outline'].map(selector => getComputedStyle(document.querySelector(selector)).paddingTop));
      assert.deepEqual(padding, ['18px', '18px']);
      await screen(theme, 'notes');
      await float.locator('[data-wb-action="more"]').click();
      for (const key of ['open-file', 'recent', 'new-note']) await page.locator(`.wb-more-menu [data-kn-action="${key}"]`).waitFor();
      await page.keyboard.press('Escape');
      await float.locator('[data-kn-action="find"]').click();
      const find = float.locator('.kn-find');
      await find.waitFor();
      await page.waitForFunction(() => Math.abs(document.querySelector('.kn-find').getBoundingClientRect().width - 248) <= 1);
      assert.equal(await float.locator('[data-kn-action="find"]').isVisible(), false);
      assert.ok((await find.boundingBox()).x + (await find.boundingBox()).width <= (await outline.boundingBox()).x);
      await assertNeutral(page, '.kn-find input[name="search"]');
      await screen(theme, 'notes-find');
      await float.locator('.kn-find [name="close"]').click();
      await float.locator('[data-kn-action="find"]').waitFor();
      await body.evaluate(el => { el.scrollTop = 160; });
      await page.locator('.kn-float.raised').waitFor();
      await body.evaluate(el => { el.scrollTop = 0; });
      await page.waitForFunction(() => !document.querySelector('.kn-float').classList.contains('raised'));
      await tab('history').click();
      await screen(theme, 'history');
      await tab('flow').click();
      console.log(`PASS ${theme}: aligned right edges, clear semantic states, neutral inputs, compact tabs and floating tools`);
    }
    assert.deepEqual(errors, []);
    const persisted = await readTaskData(profile);
    await run.close();
    run = await launchRepository({ ...persisted, activeTaskId: id }, 'desktop-port-restart');
    await run.page.locator('.pdock [data-slot="schedule"]').click();
    assert.equal(await run.page.locator('.prop-pop [data-pi="date"]').inputValue(), '2026-11-27');
    assert.equal(await run.page.locator('.prop-pop [data-pi="time"]').inputValue(), '17:42');
    assert.equal(await run.page.locator('.prop-pop [data-pi="unit"]').inputValue(), 'yearly');
    assert.equal(await run.page.locator('.prop-pop [data-pi="interval"]').inputValue(), '4');
    assert.deepEqual(run.errors, []);
    console.log('PASS new Electron process restores a saved custom rule and deadline');
  } finally {
    await run?.close();
    await fs.rm(files, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

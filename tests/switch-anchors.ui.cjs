const assert = require('node:assert/strict');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

const group = 'work';
const longGroup = '验证长分组名称保持顶栏定位'.repeat(8);
const tasks = [
  task('main', {
    title: '切换位置 · 主任务',
    groupId: group,
    description: '此简报用于核对展开和收起时的笔记操作。',
    notes: '# 验收笔记\n\n' + '这里是用于查找的示例文字。\n\n'.repeat(70),
    nodes: [{ id: 'parent', title: '父节点', children: [{ id: 'child', title: '子节点', children: [] }] }],
  }),
  task('other', { title: '第二项任务', order: 2 }),
];

(async () => {
  const run = await launchRepository({ activeTaskId: 'main', tasks, taskGroups: [{ id: group, title: longGroup, order: 1 }] }, 'switch-anchors');
  const { page, app, errors } = run;
  const action = id => page.locator(`[data-action="${id}"]`);
  const pane = name => page.locator(`.pane-tab[data-pane="${name}"]`);
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const fit = () => page.waitForFunction(() => {
    const card = document.querySelector('.task-info-card');
    const toolbar = document.querySelector('.knowledge-note-actions');
    return card?.getBoundingClientRect().bottom <= toolbar?.getBoundingClientRect().top - 7;
  });
  const nav = action('toggle-nav');
  const list = action('toggle-task-list');
  const details = action('toggle-task-info');
  const brief = page.locator('[data-brief21-toggle]');
  const find = page.locator('[data-kn-action="find"]');
  const focus = page.locator('[data-wb-action="focus"]');
  const more = page.locator('[data-wb-action="more"]');

  const compare = async (expected, ...controls) => {
    assert.deepEqual(await Promise.all(controls.map(control => control.boundingBox())), expected);
  };
  const clickBox = box => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const expanded = async (control, value) => assert.equal(await control.getAttribute('aria-expanded'), String(value));
  try {
    await page.waitForFunction(() => window.LoopContinuity28 && document.querySelector('.pane-tab[data-pane="flow"]'));
    await page.evaluate(() => LoopContinuity28.restorePreferences({ continuous: true, follow: false }));
    for (const { width, theme, fontScale } of [{ width: 1280, theme: 'light', fontScale: 'normal' }, { width: 1024, theme: 'dark', fontScale: 'largest' }]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width, 720);
      }, width);
      await page.evaluate(({ theme, fontScale }) => { state.theme = theme; state.fontScale = fontScale; render(); }, { theme, fontScale });
      await frame();
      const header = await Promise.all([nav.boundingBox(), list.boundingBox()]);
      assert.ok(header.every(Boolean));
      const workspace = page.locator('.workspace');
      const widthBefore = (await workspace.boundingBox()).width;
      await clickBox(header[1]);
      await expanded(list, false);
      assert.equal(await page.locator('.task-list-pane').isVisible(), false);
      assert.ok((await workspace.boundingBox()).width > widthBefore);
      await compare(header, nav, list);
      await clickBox(header[0]);
      await expanded(nav, false);
      await compare(header, nav, list);
      await clickBox(header[1]);
      await expanded(list, true);
      assert.equal(await page.locator('.task-list-pane').isVisible(), true);
      await compare(header, nav, list);
      await nav.press('Enter');
      await expanded(nav, true);
      assert.ok(await nav.evaluate(el => el === document.activeElement));
      await compare(header, nav, list);

      // Exercise a manually expanded card with the brief folded. Both surfaces
      // must still be usable and the note's editing viewport must not move.
      if (await brief.getAttribute('aria-expanded') === 'true') await brief.click();
      if (await details.getAttribute('aria-expanded') === 'false') await details.click();
      await pane('notes').click();
      await page.locator('.knowledge-pane .cm-content').waitFor();
      await fit();
      await expanded(details, true);
      const detailBox = await details.boundingBox();
      const noteBox = await page.locator('.knowledge-body').boundingBox();
      const toolBoxes = await Promise.all([find.boundingBox(), focus.boundingBox(), more.boundingBox()]);
      const detailRows = page.locator('.task-info-body');
      assert.ok(await detailRows.evaluate(el => el.clientHeight > 0 && el.scrollHeight > el.clientHeight), 'detail rows scroll within the card');
      const today = detailRows.locator('[data-action="toggle-task-tag"]');
      await today.focus();
      assert.ok(await detailRows.evaluate(el => el.scrollTop > 0), 'keyboard focus brings the last detail row into view');
      await find.click();
      await page.locator('.kn-find input[name="search"]').waitFor();
      await compare(toolBoxes.slice(1), focus, more);
      await page.keyboard.press('Escape');
      await more.click();
      await page.locator('.wb-more-menu').waitFor();
      await page.keyboard.press('Escape');
      await expanded(details, true);
      await details.press('Escape');
      await expanded(details, false);
      await details.press('Enter');
      await expanded(details, true);
      await compare([detailBox], details);
      await compare([noteBox], page.locator('.knowledge-body'));
      await compare(toolBoxes, find, focus, more);

      await clickBox(header[1]);
      await clickBox(header[0]);
      await page.evaluate(() => { window.switchAnchorEditor = knowledgeCurrentEntry().view; });
      await focus.click();
      await frame();
      assert.equal(await page.locator('.navigation').isVisible(), false);
      const full = await workspace.boundingBox();
      assert.equal(full.x, 0);
      assert.equal(full.width, await page.evaluate(() => innerWidth));
      await pane('flow').click();
      assert.equal(await page.locator('.navigation').isVisible(), true);
      await compare(header, nav, list);
      await pane('notes').click();
      await frame();
      assert.equal(await page.locator('.navigation').isVisible(), false);
      assert.ok(await page.evaluate(() => knowledgeCurrentEntry().view === window.switchAnchorEditor));
      await focus.click();
      await fit();
      await compare(header, nav, list);
      await clickBox(header[0]);
      await clickBox(header[1]);
      await pane('flow').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      console.log(`PASS ${width}px ${theme} ${fontScale}: same-position pointer/keyboard toggles, notes and details hit targets, focus round trip`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await run.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

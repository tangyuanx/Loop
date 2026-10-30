const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright-core');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const { readTaskData } = require('../app/main/storage.cjs');
const node = (id, title, children = [], links = [], order = 0) => ({ id, title, note: `记录-${id}`, children, downstreamNodeIds: links, order });
(async () => {
  const evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-share-evidence-'));
  let run, reopened, appClosed = false;
  try {
    run = await launchRepository({ activeTaskId: 'share', tasks: [task('share', { title: '任务分享范围验收', description: '不应泄露的任务背景', notes: '不应泄露的整份笔记', nodes: [
      node('a', '核对需求与证据', [node('a1', '整理用户反馈', [node('a11', '归纳关键问题')])], ['b'], 1),
      node('unrelated', '不相关的同级步骤', [], [], 2),
      node('b', '验证解决方案', [node('b1', '检查边界情况')], ['c'], 3),
      node('c', '交付结果', [], [], 4),
    ] })] }, 'node-share-ui');
    const { app, page, profile, errors } = run;
    const open = async () => { await page.locator('.node-title[data-node-id=a]').hover(); await page.locator('.node-share-action[data-node-id=a]').click(); await page.locator('.node-share-dialog').waitFor(); };
    const close = async () => { await page.keyboard.press('Escape'); await page.locator('.node-share-dialog').waitFor({ state: 'detached' }); };
    await open();
    assert.match(await page.locator('#node-share-count').textContent(), /6 个/);
    assert.doesNotMatch(await page.locator('#node-share-preview').textContent(), /不相关/);
    await page.locator('#node-share-children').selectOption('0');
    await page.locator('#node-share-downstream').selectOption('0');
    assert.match(await page.locator('#node-share-count').textContent(), /1 个/);
    await page.locator('#node-share-children').selectOption('1');
    assert.match(await page.locator('#node-share-count').textContent(), /2 个/);
    await page.locator('#node-share-downstream').selectOption('1');
    assert.match(await page.locator('#node-share-count').textContent(), /4 个/);
    await close();
    await page.waitForFunction(() => document.activeElement?.matches('.node-share-action[data-node-id=a]'));

    // The right-click entry opens the same scope, without changing tree/selection.
    await page.locator('.node-title[data-node-id=a]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '分享此节点…' }).click();
    await close();
    await page.waitForFunction(() => document.activeElement?.matches('.node-title[data-node-id=a]'));
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: '分享此节点…' }).click();
    await page.locator('.node-share-relations summary').click();
    await page.locator('#node-share-search').fill('不相关');
    await page.locator('#node-share-links input[value=unrelated]').check();
    assert.equal(await page.locator('#node-share-export').isDisabled(), true);
    await page.locator('#node-share-save-links').click();
    assert.match(await page.locator('#node-share-count').textContent(), /7 个/);
    // Saved associations survive a close/open; unsaved edits do not leak.
    await close(); await open();
    assert.match(await page.locator('#node-share-count').textContent(), /7 个/);
    await page.locator('.node-share-relations summary').click();
    await page.locator('#node-share-links input[value=unrelated]').uncheck();
    await close(); await open();
    assert.match(await page.locator('#node-share-count').textContent(), /7 个/);
    await page.locator('.node-share-relations summary').click();
    await page.locator('#node-share-links input[value=unrelated]').uncheck();
    await page.locator('#node-share-save-links').click();
    assert.match(await page.locator('#node-share-count').textContent(), /6 个/);

    // Actual main-process exporter writes Markdown/PDF; only the OS path chooser is automated.
    const md = path.join(evidence, 'selected.md'), pdf = path.join(evidence, 'selected.pdf');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, md);
    await page.locator('#node-share-export').click();
    await page.locator('.node-share-dialog').waitFor({ state: 'detached' });
    const markdown = await fs.readFile(md, 'utf8');
    assert.match(markdown, /记录-a11/); assert.match(markdown, /核对需求与证据 → 验证解决方案/);
    assert.doesNotMatch(markdown, /不相关|不应泄露/);
    await open();
    await page.locator('#node-share-records').uncheck();
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, md);
    await page.locator('#node-share-export').click();
    await page.locator('.node-share-dialog').waitFor({ state: 'detached' });
    assert.doesNotMatch(await fs.readFile(md, 'utf8'), /记录-/);
    await open();
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, pdf);
    await page.locator('#node-share-export').click();
    await page.locator('.node-share-dialog').waitFor({ state: 'detached' });
    assert.equal((await fs.readFile(pdf)).subarray(0, 4).toString(), '%PDF');
    await open();
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
    await page.locator('#node-share-export').click();
    await page.waitForFunction(() => !document.querySelector('#node-share-export').disabled);
    assert.equal(await page.locator('.node-share-dialog').isVisible(), true);
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => { throw Error('synthetic export failure'); }; });
    await page.locator('#node-share-export').click();
    await page.locator('#node-share-error').getByText('导出失败，请重试。').waitFor();
    assert.equal(await page.locator('#node-share-export').isEnabled(), true);
    await close();

    const focusStates = [];
    for (const theme of ['light', 'dark']) for (const size of [[1024, 680], [1440, 900]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(...size), size);
      await page.evaluate(theme => { state.theme = theme; render(); }, theme);
      await page.locator('[data-action=toggle-task-info]').click();
      await page.screenshot({ path: path.join(evidence, `${theme}-${size[0]}-details.png`) });
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app/renderer/index.html')).focus());
      await page.locator('.node-title[data-node-id=a]').click({ button: 'right' });
      await page.locator('.node-context-menu').waitFor();
      await page.screenshot({ path: path.join(evidence, `${theme}-${size[0]}-menu.png`) });
      await page.keyboard.press('Escape');
      await open();
      await page.screenshot({ path: path.join(evidence, `${theme}-${size[0]}-share-default.png`) });
      await page.locator('.node-share-relations summary').click();
      const input = page.locator('#node-share-search');
      for (const interaction of ['default', 'hover', 'focus']) {
        if (interaction === 'hover') await input.hover();
        if (interaction === 'focus') await input.focus();
        focusStates.push(await input.evaluate((el, state) => {
          const styles = [el, el.parentElement, el.closest('.dialog')].map(e => { const s = getComputedStyle(e); return { border: s.borderColor, outline: s.outlineColor, shadow: s.boxShadow, bg: s.backgroundColor }; });
          return { state, styles };
        }, `${theme}-${size[0]}-${interaction}`));
      }
      const states = focusStates.slice(-3);
      assert.equal(states[0].styles[0].bg, states[2].styles[0].bg, 'search input stays transparent');
      assert.equal(states[0].styles[1].bg, states[2].styles[1].bg, 'search parent keeps its surface');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('.node-share-dialog')), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.locator('.node-share-dialog').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true);
      await page.screenshot({ path: path.join(evidence, `${theme}-${size[0]}-share.png`) });
      await close();
    }
    await page.waitForFunction(() => localSaveOutcome === 'saved');
    assert.deepEqual((await readTaskData(profile)).tasks[0].nodes[0].downstreamNodeIds, ['b']);
    assert.deepEqual(errors, []);
    await app.close(); appClosed = true;
    const env = { ...process.env, LOOP_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
    reopened = await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..')], env });
    const restored = await reopened.firstWindow();
    await restored.waitForFunction(() => typeof state !== 'undefined' && state.tasks[0]?.nodes?.length > 0);
    assert.deepEqual(await restored.evaluate(() => state.tasks[0].nodes[0].downstreamNodeIds), ['b']);
    await fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: true, profile, actualMarkdownAndPdf: true, automatedSaveDialog: true, focusStates, errors }, null, 2));
    console.log(`PASS node share: scopes, relationships, disk/restart, Markdown/PDF, failure/cancel, focus, themes/sizes. Evidence: ${evidence}`);
  } finally { await reopened?.close(); if (run) { if (!appClosed) await run.app.close(); await fs.rm(run.profile, { recursive: true, force: true }); } }
})().catch(error => { console.error(error); process.exitCode = 1; });

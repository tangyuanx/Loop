// Real Electron regression for stationary switches and cold editor races.
// A test IPC guard prevents any accidental native cursor movement.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
const wb = require('./workbench-helpers.cjs');

(async () => {
  const repository = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-switch-regression-'));
  let app;
  try {
    const groups = ['a', 'b'].map(id => ({ id, title: id, order: id === 'a' ? 1 : 2 }));
    const tasks = groups.map(g => ({ id: g.id, groupId: g.id, title: g.title, status: 'active', priority: 'medium',
      tags: { today: true }, nodes: [], history: [], notes: '# 笔记\n\n' + '长文阅读与草稿。\n\n'.repeat(180) }));
    await fs.writeFile(path.join(profile, 'task-data.json'), JSON.stringify({ version: 2, knowledgeSchemaVersion: 1, tasks, taskGroups: groups, activeGroupId: 'a' }));
    const env = { ...process.env, LOOP_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: require('electron'), args: [repository], cwd: repository, env });
    await app.firstWindow();
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      page = app.windows().find(p => p.url().endsWith('/app/renderer/index.html'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(page); await page.waitForFunction(() => window.LoopContinuity28 && window.LoopKnowledgeEditor && document.querySelector('.pane-tab'));
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => LoopContinuity28.restorePreferences({ continuous: true, follow: true }));
    await app.evaluate(({ ipcMain }) => {
      global.__pointerRegression = { arms: 0, starts: 0 };
      ipcMain.removeAllListeners('pointer-continuity:arm');
      ipcMain.on('pointer-continuity:arm', () => { global.__pointerRegression.arms++; });
      ipcMain.removeHandler('pointer-continuity:start');
      ipcMain.handle('pointer-continuity:start', () => {
        global.__pointerRegression.starts++;
        return { ok: false };
      });
    });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => {
      window.__creates = {};
      const original = LoopKnowledgeEditor.create;
      LoopKnowledgeEditor.create = async options => {
        const id = options.root.dataset.taskId;
        __creates[id] = (__creates[id] || 0) + 1;
        const instance = await original(options);
        if (id === 'b' && __creates[id] === 1) await new Promise(resolve => { window.__releaseColdEditor = resolve; });
        return instance;
      };
    });
    const panes = ['flow', 'notes', 'history'];
    const button = name => page.locator(`.pane-tab[data-pane="${name}"]`);
    const before = Object.fromEntries(await Promise.all(panes.map(async name => [name, await button(name).boundingBox()])));
    for (const name of ['notes', 'history', 'flow', 'history', 'notes', 'flow', 'notes']) {
      const rect = before[name];
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
      assert.equal(await button(name).getAttribute('aria-pressed'), 'true', 'the old hit target still activates its pane');
      assert.deepEqual(await button(name).boundingBox(), rect);
    }
    await page.waitForFunction(() => !window.loopPointerContinuity.currentClick());
    const followed = await app.evaluate(() => global.__pointerRegression);
    if (await page.evaluate(() => LoopContinuity28.preferences().available)) assert.ok(followed.arms > 0);
    assert.equal(followed.starts, 0, 'stationary buttons never request a system cursor move');
    await page.waitForFunction(() => knowledgeCurrentEntry('a')?.view);
    await page.evaluate(() => { render(); window.__editorA = knowledgeCurrentEntry('a').view; });
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => document.querySelector('.nav-button[data-setting-button="task-filter"][data-value="today"]').click());
      await page.evaluate(() => document.querySelector('.nav-button[data-setting-button="task-filter"][data-value="all"]').click());
    }
    assert.equal(await page.evaluate(() => __editorA === knowledgeCurrentEntry()?.view), true);
    await page.evaluate(() => document.querySelector('[data-action="select-nav-group"][data-group-id="b"]').click());
    await page.waitForFunction(() => __creates.b === 1 && typeof window.__releaseColdEditor === 'function');
    // External reload/replacement while create() is outstanding must invalidate
    // the old document and eventually initialize the current host.
    await page.evaluate(() => {
      discardMountedKnowledgeEditor('b'); state.tasks.find(t => t.id === 'b').notes = '# 新文档\n\n外部刷新内容'; render();
      window.__releaseColdEditor();
    });
    await page.waitForFunction(() => knowledgeCurrentEntry('b')?.view && pendingMilkdownMounts.size === 0);
    assert.match(await page.locator('.cm-content').innerText(), /外部刷新内容/);
    await page.evaluate(() => { window.__editorB = knowledgeCurrentEntry('b').view; });
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => document.querySelector('[data-action="select-nav-group"][data-group-id="a"]').click());
      assert.equal(await page.evaluate(() => __editorA === knowledgeCurrentEntry()?.view), true);
      await page.evaluate(() => document.querySelector('[data-action="select-nav-group"][data-group-id="b"]').click());
      assert.equal(await page.evaluate(() => __editorB === knowledgeCurrentEntry()?.view), true);
    }
    // One real menu action must reach the retained editor exactly once.
    await page.evaluate(() => {
      for (let i = 0; i < 12; i++) render();
      const editor = knowledgeCurrentEntry();
      const pos = editor.view.state.doc.toString().indexOf('外部刷新内容');
      editor.view.dispatch({ selection: { anchor: pos, head: pos + '外部刷新内容'.length } });
      window.__formatCalls = 0;
      const format = editor.format;
      editor.format = function (...args) { window.__formatCalls++; return format.apply(this, args); };
      editor.view.focus();
    });
    await wb.format(page, 'bold');
    assert.equal(await page.evaluate(() => window.__formatCalls), 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, followed, creates: await page.evaluate(() => __creates),
      scenes: ['stationary rapid switches never request cursor movement', 'navigation retains editor', 'group editor reuse', 'cold initialization replacement retries', 'single format binding'] }, null, 2));
  } finally { await app?.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

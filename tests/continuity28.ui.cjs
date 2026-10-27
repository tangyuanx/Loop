// Actual Electron renderer checks. Synthetic DOM clicks deliberately do not arm
// native following; this suite never moves the user's system mouse.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

(async () => {
  const repository = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-continuity28-ui-'));
  let app;
  try {
    const now = new Date().toISOString();
    const nodes = Array.from({ length: 80 }, (_, i) => ({ id: `node${i}`, title: `连续性节点 ${i}`, status: 'todo', order: i + 1,
      note: '# 节点记录\n\n' + '保留当前上下文。\n\n'.repeat(60), children: i === 4 ? Array.from({ length: 12 }, (_, j) => ({ id: `child${j}`, title: `子节点 ${j}`, status: 'todo', order: j + 1, children: [] })) : [] }));
    await fs.writeFile(path.join(profile, 'task-data.json'), JSON.stringify({ version: 2, knowledgeSchemaVersion: 1,
      taskGroups: [{ id: 'group1', title: '连续性检验', order: 1 }], activeGroupId: 'group1', activeTaskId: 'task1',
      theme: 'light', fontScale: 'normal', tasks: [{ id: 'task1', title: '操作连续性', groupId: 'group1', status: 'active', priority: 'medium', order: 1,
        description: '同一内容下比较最终几何', hypothesis: '检查真实渲染器', conclusion: '', notes: '# 笔记\n\n' + '保留编辑实例。\n\n'.repeat(100), nodes,
        history: Array.from({ length: 80 }, (_, i) => ['刚刚', `历史记录 ${i}`]), createdAt: now, updatedAt: now }] }));
    const env = { ...process.env, LOOP_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: require('electron'), args: [repository], cwd: repository, env });
    await app.firstWindow();
    let page;
    const deadline = Date.now() + 15000;
    while (!page && Date.now() < deadline) {
      page = app.windows().find(p => p.url().endsWith('/app/renderer/index.html'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!page) throw new Error('Main renderer did not open');
    await page.waitForFunction(() => window.LoopContinuity28 && document.querySelector('.flow-scroll'));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const settle = () => page.evaluate(async () => {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await frames();
      await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {})));
      await frames();
    });
    const choose = async pane => { await page.evaluate(p => document.querySelector(`.pane-tab[data-pane="${p}"]`).click(), pane); await settle(); };
    const geometry = () => page.evaluate(() => Object.fromEntries(['.tabs-bar', '.tab-content', '.workspace'].map(selector => {
      const r = document.querySelector(selector).getBoundingClientRect(); return [selector, { x: r.x, y: r.y, width: r.width, height: r.height }];
    })));
    assert.equal((await page.evaluate(() => window.loopPointerContinuity.status())).available, process.platform === 'darwin');
    const start = await geometry();
    await page.evaluate(() => { document.querySelector('.flow-scroll').scrollTop = 780; });
    const savedFlow = await page.locator('.flow-scroll').evaluate(el => el.scrollTop);
    await choose('notes'); await page.waitForSelector('.cm-content');
    await page.evaluate(() => { window.__continuityEditor = document.querySelector('.cm-content'); document.querySelector('.knowledge-body').scrollTop = 440; });
    const noteTop = await page.locator('.knowledge-body').evaluate(el => el.scrollTop);
    await choose('history'); await page.evaluate(() => { document.querySelector('.article-pane').scrollTop = 430; });
    const historyTop = await page.locator('.article-pane').evaluate(el => el.scrollTop);
    await choose('flow'); assert.equal(await page.locator('.flow-scroll').evaluate(el => el.scrollTop), savedFlow);
    assert.deepEqual(await geometry(), start, 'the same final layout must be retained');
    await choose('notes'); assert.equal(await page.evaluate(() => document.querySelector('.cm-content') === window.__continuityEditor), true, 'retains the actual editor instance/DOM');
    assert.equal(await page.locator('.knowledge-body').evaluate(el => el.scrollTop), noteTop);
    await choose('history'); assert.equal(await page.locator('.article-pane').evaluate(el => el.scrollTop), historyTop);
    await choose('notes'); await choose('flow'); await choose('history'); await choose('flow'); // Six directions through the real renderer.
    // Node selection must share the task's flow viewport, even on first open.
    // Opening the record can resize the flow; only actual boundaries may clamp it.
    await page.evaluate(() => { document.querySelector('.flow-scroll').scrollTop = 2200; });
    const beforeNodeOpen = await page.locator('.flow-scroll').evaluate(el => el.scrollTop);
    assert.ok(beforeNodeOpen > 0, 'the fixture must actually scroll');
    await page.evaluate(() => document.querySelector('.node-title[data-node-id="node60"]').click()); await settle();
    const afterNodeOpen = await page.locator('.flow-scroll').evaluate((el, saved) => Math.min(saved, el.scrollHeight - el.clientHeight), beforeNodeOpen);
    assert.equal(await page.locator('.flow-scroll').evaluate(el => el.scrollTop), afterNodeOpen, 'first node open preserves the flow position');
    await page.evaluate(() => document.querySelector('.node-title[data-node-id="node61"]').click()); await settle();
    assert.equal(await page.locator('.flow-scroll').evaluate(el => el.scrollTop), afterNodeOpen, 'switching nodes keeps the same flow position');
    await page.evaluate(() => document.querySelector('.node-title[data-node-id="node60"]').click()); await settle();
    assert.equal(await page.locator('.flow-scroll').evaluate(el => el.scrollTop), afterNodeOpen, 'returning to the previous node keeps the flow position');
    await page.evaluate(() => document.querySelector('[data-action="close-node-detail"]').click()); await settle();
    assert.equal(await page.locator('.flow-scroll').evaluate(el => el.scrollTop), afterNodeOpen, 'closing a record keeps the current flow position');
    await page.evaluate(() => document.querySelector('.node-title[data-node-id="node4"]').click()); await settle();
    await page.evaluate(() => document.querySelector('[data-action="close-node-detail"]').click()); await settle();
    // DOM-only synthetic click has no trusted pointer intent; Escape does.
    await page.evaluate(() => { state.selectedNodeId = 'node4'; render(); }); await settle();
    assert.equal(await page.evaluate(() => document.querySelector('.inspector')?.dataset.nodeId), 'node4');
    // Dispatch from a DOM target, like a real key. Dispatching at Window itself
    // does not traverse the capture phase and is a different event lifecycle.
    await page.evaluate(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); await settle();
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.nodeId), 'node4');
    const identity = await page.evaluate(() => {
      const result = [];
      for (const selector of ['.tabs-bar', '.flow-row', '.brand', '.task-heading-actions', '.nav-bottom']) {
        const el = document.querySelector(selector); if (!el) continue;
        const value = el.dataset.pointerGroup;
        result.push({ selector, unique: !!value && document.querySelectorAll(`[data-pointer-group="${CSS.escape(value)}"]`).length === 1 });
      }
      return result;
    });
    assert.ok(identity.every(item => item.unique), JSON.stringify(identity));
    assert.equal((await page.evaluate(() => window.loopPointerContinuity.status())).last, null, 'synthetic/keyboard operations never move the system pointer');
    assert.deepEqual(errors, []);
    // Stage3 deliberately changes workspace geometry from the historical
    // frozen Demo. Verify the current real layout returns exactly after each
    // pane round trip, retaining the existing editor and viewport assertions.
    const layoutRoundTrips = [];
    for (const pane of ['flow', 'notes', 'history']) {
      await choose(pane); const before = await geometry();
      await choose(pane === 'flow' ? 'history' : 'flow');
      await choose(pane); const after = await geometry();
      assert.deepEqual(after, before, `current ${pane} geometry survives a round trip`);
      layoutRoundTrips.push({ pane, before, after });
    }
    console.log(JSON.stringify({ passed: true, scenes: ['six pane directions', 'long-flow scroll', 'notes/history scroll', 'actual editor retained', 'detail Escape focus', 'group uniqueness', 'final geometry retained', 'no synthetic pointer arm'], identity, savedFlow, noteTop, historyTop, layoutRoundTrips }, null, 2));
  } finally { await app?.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

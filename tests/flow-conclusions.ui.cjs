// Production Electron: conclusion editing, persistence, layout and tree identity.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, resizeRepositoryWindow, task } = require('./electron-ui-helpers.cjs');
const stamp = '2026-11-08T08:00:00.000Z';
const n = (id, title, status, conclusion, children = [], note = '') =>
  ({ id, title, status, conclusion, children, note, createdAt: stamp, updatedAt: stamp });
const normal = task('normal', { title: '优化导出体验', description: '定位大任务导出卡顿，确定优化方案并验证。', nodes: [
  n('scope', '确认卡顿范围', 'done', '耗时集中在文档生成，大任务才会明显卡顿。', [
    n('reproduce', '复现大任务导出', 'done', '500 个节点时稳定复现，约需 8 秒。', [], '保留原始性能日志'),
    n('trace', '记录各阶段耗时', 'done', '文档排版占主要耗时，读取数据正常。'),
  ]),
  n('solution', '确定优化方案', 'todo', '优先拆分文档生成，避免占用界面线程。', [
    n('compare', '比较分批与后台生成', 'done', '后台生成更合适，分批仍会打断操作。'),
    n('compatibility', '验证格式兼容', 'todo', '| 格式 | 结果 |\n| --- | --- |\n| Markdown | 可以编辑 |'),
  ]),
  n('regression', '回归导出与节点关系', 'todo', ''),
] });
let deep = n('deep-leaf', '较深层级的长标题'.repeat(12) + 'LongUnbrokenIdentifier'.repeat(8), 'todo', '最深层结论仍属于当前节点。', [], '深层记录不变');
for (let i = 13; i >= 0; i--) deep = n('depth-' + i, '第 ' + (i + 2) + ' 层：核对节点关系', 'todo', '这一层的结论独立保留。', [deep]);
const longConclusion = ('排版测试：保留多层父子关系、同级顺序和处理记录，结论和完成状态分别保存。' + '\n').repeat(16) + 'END-OF-CONCLUSION';
const longTitle = '验证多层节点与完整处理记录下的导出兼容，确保所有内容可以完整阅读。'.repeat(4) + 'UnbrokenTitleSegment'.repeat(8);
const edge = task('edge', { title: '长内容与深层级验收', nodes: [
  n('long', longTitle, 'todo', longConclusion),
  { ...n('deep-root', '深层级分支：展开后检查真实缩进', 'todo', '逐层核对父子关系。', [deep]), collapsed: true },
  n('tail', '另一个同级节点', 'todo', '用于检查行对齐和横向滚动。'),
] });

(async () => {
  const run = await launchRepository({ tasks: [normal, edge] }, 'flow-conclusions');
  const { app, page, errors } = run;
  const output = process.env.LOOP_REVIEW_OUTPUT;
  const shot = async name => { if (output) { await fs.mkdir(output, { recursive: true }); await page.screenshot({ path: path.join(output, name + '.png') }); } };
  const settle = () => page.evaluate(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {})));
  });
  const size = (width, height) => resizeRepositoryWindow(app, page, width, height);
  const activate = async id => {
    await page.evaluate(id => { state.activeTaskId = id; state.selectedNodeId = ''; state.taskPane = 'flow'; render(); }, id);
    await settle();
  };
  const conclusion = id => page.locator('.flow-conclusion[data-conclusion-node="' + id + '"]');
  const title = id => page.locator('.node-title[data-node-id="' + id + '"]');
  const editor = page.locator('[data-shell-node-conclusion]');
  const value = id => page.evaluate(id => findNode(shellActiveTask().nodes, id).conclusion, id);
  try {
    await page.locator('.flow-scroll').waitFor();
    await size(1440, 985);
    assert.equal(await page.locator('.nnote-fold').count(), 4);
    assert.equal(await page.locator('.node-conclusion-preview').count(), 2);
    await title('reproduce').click(); await settle();
    assert.equal(await page.locator('.node-record-window').count(), 0, 'title selection does not open a record');
    assert.equal(await title('reproduce').getAttribute('aria-pressed'), 'true');
    await shot('candidate-normal-light');
    const original = await value('reproduce');
    const originalEditorValue = await page.evaluate(() => shellNodeConclusionValue(findNode(shellActiveTask().nodes, 'reproduce')));
    await conclusion('reproduce').click();
    await conclusion('reproduce').getByRole('button', { name: '收起' }).click();
    assert.equal(await conclusion('reproduce').evaluate(el => el.matches('.nnote-fold')), true);
    await title('reproduce').press('n');
    await editor.waitFor();
    assert.equal(await page.locator('.node-record-window').count(), 0);
    const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
    await page.keyboard.insertText('新增结论');
    await page.evaluate(() => { window.__conclusionEditor = document.querySelector('[data-shell-node-conclusion]'); render(); });
    assert.equal(await editor.evaluate(el => el === window.__conclusionEditor && el === document.activeElement), true, 'rerenders reuse the focused editor');
    await page.keyboard.press(undoKey); assert.equal(await editor.inputValue(), originalEditorValue);
    await page.keyboard.press(redoKey); assert.equal(await editor.inputValue(), originalEditorValue + '新增结论');
    await editor.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true });
    assert.equal(await editor.count(), 1, 'IME confirmation never finishes editing');
    await page.keyboard.press('Escape');
    assert.equal(await value('reproduce'), original, 'Escape restores the edit session');
    await title('reproduce').press('n');
    await editor.fill('可搜索且持久保存的短结论');
    await editor.press('Shift+Enter'); await page.keyboard.insertText('保留原始性能日志');
    const savedConclusion = '可搜索且持久保存的短结论\n保留原始性能日志';
    await editor.press('Enter'); await editor.waitFor({ state: 'detached' });
    assert.equal(await value('reproduce'), savedConclusion);
    await page.locator('[data-recovery26="undo"]').click();
    await page.waitForFunction(value => findNode(shellActiveTask().nodes, 'reproduce').conclusion === value, original);
    assert.equal(await page.evaluate(() => findNode(shellActiveTask().nodes, 'reproduce').note), '保留原始性能日志');
    await title('reproduce').press('n');
    await editor.fill(savedConclusion); await editor.press('Enter'); await editor.waitFor({ state: 'detached' });
    assert.match(await page.evaluate(() => taskMarkdown(shellActiveTask())), /结论：[\s\S]*可搜索且持久保存的短结论/);
    await page.evaluate(() => flushSave());
    const disk = JSON.parse(await fs.readFile(path.join(run.profile, 'task-data.json'), 'utf8'));
    assert.equal(disk.tasks[0].nodes[0].children[0].conclusion, savedConclusion);
    await page.reload(); await page.locator('.flow-scroll').waitFor();
    assert.equal(await value('reproduce'), savedConclusion);
    await page.locator('[data-action="open-flow-locator"]').click();
    await page.locator('#flow-locator-query').fill('可搜索且持久保存');
    assert.equal(await page.locator('.flow-locator .flow-result[data-node-id="reproduce"]').count(), 1);
    await page.keyboard.press('Escape');
    // Move a genuine subtree. Child records and conclusions stay attached.
    await title('trace').click();
    await page.evaluate(() => { openTaskFromGlobalList('normal', 'reproduce'); render(); });
    assert.equal(await title('reproduce').getAttribute('aria-pressed'), 'true', 'global navigation selects the requested node');
    const before = await page.evaluate(() => structuredClone(findNode(shellActiveTask().nodes, 'scope')));
    await page.waitForFunction(() => Date.now() >= suppressFlowNodeClickUntil);
    const from = await title('scope').boundingBox();
    await page.mouse.move(from.x + 20, from.y + from.height / 2); await page.mouse.down();
    await page.waitForFunction(() => flowNodeDragState?.active);
    const target = await page.locator('.flow-row[data-node-id="solution"]').boundingBox();
    await page.mouse.move(target.x + 90, target.y + target.height / 2, { steps: 4 });
    await page.waitForFunction(() => flowNodeDragState?.targetId === 'solution' && flowNodeDragState?.placement === 'inside');
    await page.mouse.up(); await settle();
    const after = await page.evaluate(() => findNode(shellActiveTask().nodes, 'scope'));
    assert.equal(after.parentId, 'solution');
    assert.deepEqual(after.children, before.children);
    assert.equal(after.conclusion, before.conclusion);
    await page.locator('[data-recovery26="undo"]').click();
    await page.waitForFunction(() => !findNode(shellActiveTask().nodes, 'scope').parentId);
    assert.equal(await page.evaluate(() => shellActiveTask().nodes[0].id), 'scope');
    const cell = conclusion('compatibility').locator('td').last();
    await cell.dblclick();
    const input = page.getByRole('textbox', { name: '编辑结论表格单元格' });
    await input.fill('取消编辑');
    await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229 });
    assert.equal(await input.count(), 1);
    await input.press('Escape');
    assert.equal(await cell.innerText(), '可以编辑');
    await cell.press('Enter');
    await input.fill('首行'); await input.press('Shift+Enter'); await page.keyboard.insertText('次行 | 字面竖线');
    await input.press('Enter'); await input.waitFor({ state: 'detached' });
    assert.match(await value('compatibility'), /首行<br>次行/);
    assert.equal(await cell.evaluate(el => el.querySelectorAll('br').length), 1);
    assert.equal(await cell.evaluate(el => el === document.activeElement), true);
    await activate('edge');
    for (const [width, height, theme] of [[1440, 985, 'light'], [1024, 820, 'dark'], [640, 740, 'light']]) {
      await size(width, height);
      await page.evaluate(theme => { state.theme = theme; render(); }, theme); await settle();
      const layout = await page.evaluate(() => {
        const row = document.querySelector('.flow-row[data-node-id="long"]');
        const title = row.querySelector('.node-title'), cell = row.querySelector('.flow-conclusion');
        const flow = document.querySelector('.flow-scroll');
        return { outerOverflow: document.documentElement.scrollWidth > innerWidth + 1, titleOverflow: title.scrollWidth > title.clientWidth + 1,
          overlap: title.getBoundingClientRect().bottom > cell.getBoundingClientRect().top, flowOverflow: flow.scrollWidth > flow.clientWidth,
          lefts: [...document.querySelectorAll('.flow-conclusion')].map(el => el.getBoundingClientRect().left) };
      });
      assert.equal(layout.outerOverflow, false, 'outer app never scrolls horizontally');
      assert.equal(layout.titleOverflow, false, 'long and unbroken titles wrap');
      assert.equal(layout.overlap, false, 'titles never enter conclusion cells');
      const longAlignment = await page.locator('.flow-row[data-node-id="long"]').evaluate(el => {
        const title = el.querySelector('.node-title'), status = el.querySelector('.node-status'), t = title.getBoundingClientRect(), box = status.getBoundingClientRect();
        return Math.abs(box.y + box.height / 2 - t.y - parseFloat(getComputedStyle(title).paddingTop) - parseFloat(getComputedStyle(title).lineHeight) / 2);
      });
      assert.ok(longAlignment <= .6, 'multiline titles keep their status button on the first line');
      assert.ok(Math.max(...layout.lefts) - Math.min(...layout.lefts) < 1, 'all conclusions share a column');
      await shot('candidate-long-' + theme + '-' + width);
      const full = await conclusion('long').locator('.node-conclusion-preview').evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight, text: el.textContent }));
      assert.ok(full.scroll <= full.height + 1);
      assert.ok(full.text.endsWith('END-OF-CONCLUSION'));
      await conclusion('long').locator('.node-conclusion-text').dblclick();
      const focus = await editor.evaluate(el => {
        const style = getComputedStyle(el);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const green = color => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
          return a > 0 && g > r + 8 && g > b + 8;
        };
        const shadowColor = style.boxShadow.match(/(?:rgba?|color)\([^)]*\)/)?.[0];
        return { bg: style.backgroundColor, outline: style.outlineStyle,
          inset: style.boxShadow.includes('inset'), green: Boolean(shadowColor && green(shadowColor)) };
      });
      assert.deepEqual(focus, { bg: 'rgba(0, 0, 0, 0)', outline: 'none', inset: true, green: false });
      await page.keyboard.press('Escape');
    }
    await size(1024, 820);
    await page.locator('[data-action="toggle-node-collapse"][data-node-id="deep-root"]').click(); await settle();
    const deepLayout = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.flow-conclusion')];
      const flow = document.querySelector('.flow-scroll');
      return { aligned: Math.max(...cells.map(el => el.getBoundingClientRect().left)) - Math.min(...cells.map(el => el.getBoundingClientRect().left)) < 1,
        internalOverflow: flow.scrollWidth > flow.clientWidth, outerOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        depth: document.querySelector('[data-flow-id="deep-leaf"]').dataset.flowDepth };
    });
    assert.equal(deepLayout.aligned, false, "conclusions follow each node’s indentation"); assert.equal(deepLayout.internalOverflow, false); assert.equal(deepLayout.outerOverflow, false);
    assert.equal(deepLayout.depth, '15');
    await title('deep-leaf').scrollIntoViewIfNeeded(); await settle();
    await shot('candidate-deep-1024');
    await conclusion('deep-leaf').locator('.node-conclusion-text').dblclick();
    await editor.fill('最深层编辑后保存的结论\n深层记录不变'); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    assert.equal(await value('deep-leaf'), '最深层编辑后保存的结论\n深层记录不变');
    assert.deepEqual(errors, []);
    console.log('PASS: selection, conclusion editing/undo/IME, disk reload, search/export, subtree identity, long wrapping, expansion, light/dark focus, 640/1024/1440 and 16 levels.');
  } catch (error) {
    await shot('failure'); throw error;
  } finally { await run.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

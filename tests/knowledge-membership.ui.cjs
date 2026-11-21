const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');
const { readTaskData } = require('../app/main/storage.cjs');
const { readTaskPackage } = require('../app/main/task-share-format.cjs');

async function main() {
  const review = process.argv.includes('--review');
  const root = path.resolve(__dirname, '..');
  const evidence = await fs.mkdtemp(path.join(root, '.local-review/note-task-ownership-'));
  const files = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-membership-files-'));
  const referenceId = 'task_' + randomUUID();
  const assetId = 'asset_' + randomUUID();
  const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
  const assetFile = createHash('sha256').update(picture).digest('hex') + '.png';
  const aPath = path.join(files, '项目交付.md');
  const referenceDirectory = path.join(files, 'reference');
  await fs.mkdir(referenceDirectory);
  const bPath = path.join(referenceDirectory, '参考研究.md');
  const aText = '# 项目交付\n\n[研究参考](./外部任务.md)\n\n[方法参考](./其他资料.md)\n\n[已登记参考](./reference/参考研究.md)\n';
  const bText = '# 参考研究\n\n![有效图片](loop-asset:' + assetId + ')\n\n[旧附件](./已移动.pdf)\n';
  await fs.writeFile(aPath, aText);
  await fs.writeFile(bPath, bText);
  const aRead = await readKnowledgeDocument(aPath);
  const bRead = await readKnowledgeDocument(bPath);
  const run = await launchRepository({
    activeTaskId: 'a', taskPane: 'notes', fontScale: 'large',
    tasks: [
      task('a', { title: '项目交付', notes: aText, description: '只分享本任务明确收录的内容。',
        knowledgeLinks: [referenceId], knowledgeNote: { ...aRead, title: '交付说明', documentState: 'SAVED' } }),
      task(referenceId, { title: '其他任务的研究', notes: bText,
        knowledgeNote: { ...bRead, title: '参考研究', documentState: 'SAVED' },
        sharedAssets: [{ id: assetId, file: assetFile, type: 'image/png', name: '研究图片.png', owners: [referenceId] }] }),
    ],
    knowledgeDocuments: [
      { id: 'closed', title: '交付清单', creatorTaskId: 'a', notes: '# 交付清单\n\n保留关闭页签后的本任务笔记。' },
      { id: 'search-only', title: '另一份研究资料', creatorTaskId: referenceId, notes: '通过搜索临时选入。' },
    ],
    knowledgeWorkspace: { taskId: 'a', activeId: 'a', tabsByTask: { a: ['a', referenceId] }, lastByTask: { a: 'a' } },
  }, 'knowledge-membership', process.env.LOOP_APP_EXECUTABLE);
  const { app, page, profile, errors } = run;
  const assetDirectory = path.join(profile, 'task-share-assets', referenceId);
  await fs.mkdir(assetDirectory, { recursive: true });
  await fs.writeFile(path.join(assetDirectory, assetFile), picture);
  const runtime = await app.evaluate(({ app }) => ({
    appPath: app.getAppPath(), userData: app.getPath('userData'), pid: process.pid, version: app.getVersion(),
  }));
  if (process.env.LOOP_APP_EXECUTABLE) assert.match(runtime.appPath, /app\.asar$/);
  else assert.equal(runtime.appPath, root);
  assert.equal(runtime.userData, profile);
  const report = { runtime, evidence, files, checks: [], errors };
  const check = label => { report.checks.push(label); console.log('PASS ' + label); };
  const openShare = async () => {
    await page.locator('.task-share-action[data-task-id="a"]').click();
    await page.locator('#task-share-summary').getByText(/篇.*笔记/).waitFor();
  };
  const close = async () => {
    await page.keyboard.press('Escape');
    await page.locator('[data-task-share-dialog]').waitFor({ state: 'detached' });
  };
  const openMenu = async () => {
    await page.locator('.knowledge-pane[data-task-id="' + referenceId + '"] [data-wb-action="more"]').click();
  };
  try {
    await page.locator('[data-pane="notes"]').click();
    await page.waitForFunction(() => knowledgeCurrentEntry('a')?.view);
    await openShare();
    assert.match(await page.locator('#task-share-summary').textContent(), /2 篇任务笔记/);
    assert.equal(await page.locator('#task-share-missing').count(), 0);
    assert.equal(await page.locator('#task-share-scope').isVisible(), false);
    assert.equal(await page.locator('#task-share-export').isEnabled(), true);
    await page.screenshot({ path: path.join(evidence, 'light-default.png') });
    if (review) {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/app/renderer/index.html'));
        window.setTitle('Loop · 笔记归属与任务分享审阅');
        window.setSize(1280, 850);
        window.show();
        window.focus();
      });
      await fs.writeFile(path.join(evidence, 'runtime.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ ...runtime, evidence, referenceId }));
      await new Promise(resolve => app.once('close', resolve));
      return;
    }
    await page.locator('#task-share-adjust > summary').click();
    await page.locator('#task-share-references > summary').click();
    const reference = page.locator('[data-share-note="' + referenceId + '"]');
    assert.equal(await reference.isChecked(), false);
    await reference.check();
    await page.locator('#task-share-missing > summary').getByText('1 项附件不可用').waitFor();
    assert.equal(await page.locator('[data-share-locate]').isVisible(), false);
    assert.equal(await page.locator('#task-share-export').isDisabled(), true);
    await page.locator('.task-share-send-dialog').screenshot({ path: path.join(evidence, 'light-missing-summary.png') });
    await page.locator('#task-share-missing > summary').click();
    await page.locator('[data-share-issue-source] > summary').click();
    assert.match(await page.locator('.task-share-issue-groups').textContent(), /参考研究.*已移动.pdf|参考研究.*旧附件/s);
    await page.locator('#task-share-allow-incomplete').check();
    await page.locator('#task-share-format').selectOption('pack');
    // A format switch requests a fresh acknowledgement of the resulting file.
    await page.locator('#task-share-allow-incomplete').check();
    const packFile = path.join(evidence, 'temporary-reference.looptask');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, packFile);
    await page.locator('#task-share-export').click();
    await page.locator('#task-share-receipt').getByText(/已导出/).waitFor();
    const unpacked = await readTaskPackage(packFile, evidence);
    assert.equal(unpacked.pack.notes.length, 3);
    assert.equal(unpacked.assets.size, 1);
    assert.equal(await page.evaluate(id => state.tasks.find(task => task.id === 'a').knowledgeNoteIds.includes(id), referenceId), false);
    await reference.uncheck();
    await page.locator('#task-share-missing').waitFor({ state: 'detached' });
    await page.locator('#task-share-export:enabled').waitFor();
    assert.doesNotMatch(await page.locator('#task-share-summary').textContent(), /附件/);
    await reference.check();
    await page.locator('#task-share-missing').waitFor();
    await page.locator('#task-share-missing > summary').click();
    await page.locator('[data-share-issue-source] > summary').click();
    const relocatedFile = path.join(evidence, 'relocated.pdf');
    await fs.writeFile(relocatedFile, '%PDF-1.7\nRestored attachment');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, relocatedFile);
    await page.locator('[data-share-locate]').click();
    await page.locator('#task-share-missing').waitFor({ state: 'detached' });
    await page.locator('#task-share-export:enabled').waitFor();
    assert.match(await page.locator('#task-share-summary').textContent(), /2 个附件/);
    assert.equal(await page.evaluate(id => state.tasks.find(task => task.id === id).notes.includes('./已移动.pdf'), referenceId), true);
    await reference.uncheck();
    await page.locator('#task-share-export:enabled').waitFor();
    await page.locator('#task-share-reference-query').fill('另一份');
    await page.locator('[data-share-note="search-only"]').check();
    await page.locator('#task-share-summary').getByText(/3 篇笔记/).waitFor();
    await close();
    await openShare();
    assert.match(await page.locator('#task-share-summary').textContent(), /2 篇任务笔记/);
    await close();
    check('default membership, unregistered Markdown references, closed notes and one-time reference export');

    await page.locator('[data-kn-document="' + referenceId + '"]').click();
    await page.waitForFunction(id => knowledgeCurrentEntry(id)?.view, referenceId);
    await page.evaluate(id => { window.__memberEditor = knowledgeCurrentEntry(id); }, referenceId);
    await openMenu();
    await page.locator('.wb-more-menu').screenshot({ path: path.join(evidence, 'membership-menu.png') });
    await page.getByRole('menuitem', { name: '加入本任务', exact: true }).click();
    await page.waitForFunction(id => state.tasks.find(task => task.id === 'a').knowledgeNoteIds.includes(id) && localSaveOutcome === 'saved', referenceId);
    assert.equal(await page.evaluate(id => knowledgeCurrentEntry(id) === window.__memberEditor, referenceId), true);
    await openMenu();
    await page.getByRole('menuitem', { name: '改为参考笔记', exact: true }).click();
    await page.waitForFunction(id => !state.tasks.find(task => task.id === 'a').knowledgeNoteIds.includes(id) && localSaveOutcome === 'saved', referenceId);
    assert.equal(await page.evaluate(id => knowledgeCurrentEntry(id) === window.__memberEditor, referenceId), true);
    await page.evaluate(async () => { save(); await flushSave(); });
    await app.evaluate((_electron, prefix) => {
      const fs = process.mainModule.require('node:fs/promises');
      const original = fs.open;
      global.__membershipFailure = true;
      fs.open = async (...args) => {
        if (global.__membershipFailure && String(args[0]).startsWith(prefix)) throw Object.assign(Error('Synthetic membership failure'), { code: 'ENOSPC' });
        return original(...args);
      };
    }, path.join(profile, 'task-data.json.tmp-'));
    await openMenu();
    await page.getByRole('menuitem', { name: '加入本任务', exact: true }).click();
    await page.locator('[data-kn-membership-status]').getByText(/保存失败/).waitFor();
    assert.equal((await readTaskData(profile)).tasks.find(task => task.id === 'a').knowledgeNoteIds.includes(referenceId), false);
    await app.evaluate(() => { global.__membershipFailure = false; });
    await page.getByRole('menuitem', { name: '重试保存归属', exact: true }).click();
    await page.waitForFunction(() => localSaveOutcome === 'saved');
    assert.equal((await readTaskData(profile)).tasks.find(task => task.id === 'a').knowledgeNoteIds.includes(referenceId), true);
    await openMenu();
    await page.getByRole('menuitem', { name: '改为参考笔记', exact: true }).click();
    await page.waitForFunction(() => localSaveOutcome === 'saved');
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.tasks.find(task => task.id === 'a')?.knowledgeNoteIds);
    assert.equal(await page.evaluate(id => state.tasks.find(task => task.id === 'a').knowledgeNoteIds.includes(id), referenceId), false);
    assert.equal(await page.evaluate(() => knowledgeSaveDirectory(knowledgeActiveDocument())), referenceDirectory, 'a reference keeps the original owning task directory');
    await page.locator('.kn-document-new').click();
    await page.waitForFunction(() => knowledgeCurrentEntry()?.view && knowledgeActiveDocument().creatorTaskId === 'a');
    const created = await page.evaluate(() => knowledgeActiveDocument().id);
    assert.equal(await page.evaluate(id => state.tasks.find(task => task.id === 'a').knowledgeNoteIds.includes(id), created), true);
    assert.equal(await page.evaluate(() => knowledgeSaveDirectory(knowledgeActiveDocument())), files, 'new task notes do not inherit the reference directory');
    check('persistent join and removal, write failure and retry, editor reuse, restart and new-note membership');

    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { state.theme = theme; state.fontScale = 'largest'; render(); }, theme);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(1024, 680);
      });
      await openShare();
      await page.locator('#task-share-adjust > summary').click();
      await page.locator('#task-share-references > summary').click();
      const input = page.locator('#task-share-reference-query');
      const before = await input.evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el.parentElement).backgroundColor]);
      await input.hover();
      await input.focus();
      const after = await input.evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el.parentElement).backgroundColor]);
      assert.deepEqual(after, before);
      assert.equal(after[0], 'rgba(0, 0, 0, 0)');
      assert.equal(await input.evaluate(el => getComputedStyle(el).borderWidth), '0px');
      assert.equal(await input.evaluate(el => getComputedStyle(el).boxShadow), 'none');
      const parentStyle = await input.evaluate(el => {
        const style = getComputedStyle(el.parentElement);
        return { border: style.borderColor, outline: style.outlineStyle, shadow: style.boxShadow };
      });
      assert.notEqual(parentStyle.shadow, 'none');
      for (const rgb of (parentStyle.border + parentStyle.shadow).matchAll(/rgba?\((\d+), (\d+), (\d+)/g)) {
        assert.ok(+rgb[2] - Math.max(+rgb[1], +rgb[3]) < 7);
      }
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true);
      const dialog = page.locator('.task-share-send-dialog');
      assert.equal(await dialog.evaluate(el => {
        const box = el.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth;
      }), true);
      await dialog.screenshot({ path: path.join(evidence, theme + '-references.png') });
      await close();
    }
    check('light and dark search focus, largest typography, minimum window and keyboard containment');

    await page.evaluate(async id => {
      await knowledgeSetMembership('a', id, true);
      recovery26DeleteRecords([id]);
      save();
      await flushSave();
    }, referenceId);
    const deleted = await page.evaluate(id => state.recentlyDeleted.find(entry => entry.record?.id === id)?.id, referenceId);
    assert.ok(deleted);
    await page.evaluate(id => recovery26PurgeReview([id]), deleted);
    await page.locator('#recovery26-purge-agree').check();
    await page.locator('[data-recovery26="purge-confirm"]').click();
    await page.waitForFunction(id => !state.recentlyDeleted.some(entry => entry.id === id) && localSaveOutcome === 'saved', deleted);
    const asset = await page.evaluate(({ assetId, referenceId }) => window.personalTaskTrack.taskShare.asset({
      href: 'loop-asset:' + assetId, ownerId: referenceId,
    }), { assetId, referenceId });
    assert.equal(asset.success, true);
    assert.equal(asset.dataUrl, 'data:image/png;base64,' + picture.toString('base64'));
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.tasks.find(task => task.id === 'a')?.knowledgeNoteIds);
    const afterRestart = await page.evaluate(({ assetId, referenceId }) => window.personalTaskTrack.taskShare.asset({
      href: 'loop-asset:' + assetId, ownerId: referenceId,
    }), { assetId, referenceId });
    assert.equal(afterRestart.success, true);
    check('shared note and imported resource survive source task deletion, archive purge and restart');
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
    console.log('Knowledge membership evidence: ' + evidence);
    if (review) await app.close();
    else { await run.close(); await fs.rm(files, { recursive: true, force: true }); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

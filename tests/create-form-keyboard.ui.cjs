const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');

(async () => {
  const run = await launchRepository({ taskGroups: [{ id: 'work', title: '工作组', order: 1 }], tasks: [task('original', {
    nodes: [{ id: 'node', title: '已有处理节点', status: 'todo', children: [] }],
  })] }, 'create-form-keyboard');
  const { app, page, profile, errors } = run;
  const form = page.locator('#create-form');
  const title = form.locator('#create-title');
  const description = form.locator('#create-description');
  const open = () => page.locator('[data-action="add-task"]').click();
  const disk = async () => JSON.parse(await fs.readFile(path.join(profile, 'task-data.json'), 'utf8')).tasks;
  const count = () => page.evaluate(() => state.tasks.length);
  const quit = () => app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/index.html')).close();
  });
  try {
    await page.evaluate(() => flushSave());
    await app.evaluate(({ dialog }, temporaryTaskDataPrefix) => {
      const fs = process.mainModule.require('node:fs/promises');
      const open = fs.open;
      globalThis.createWriteMode = 'normal';
      fs.open = async (filename, ...options) => {
        if (String(filename).startsWith(temporaryTaskDataPrefix)) {
          if (globalThis.createWriteMode === 'fail') throw Object.assign(Error('simulated disk failure'), { code: 'ENOSPC' });
          if (globalThis.createWriteMode === 'wait') await new Promise(resolve => { globalThis.releaseCreateWrite = resolve; });
        }
        return open(filename, ...options);
      };
      globalThis.createQuitPrompts = [];
      dialog.showMessageBox = async (_parent, options) => {
        globalThis.createQuitPrompts.push(options);
        const response = await new Promise(resolve => { globalThis.answerCreateQuit = resolve; });
        return { response };
      };
    }, path.join(profile, 'task-data.json.tmp-'));

    const locate = page.locator('[data-action="open-flow-locator"]');
    await locate.click();
    const query = page.locator('#flow-locator-query');
    await query.fill('已有');
    await query.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.nodeId), 'node');
    await page.keyboard.press('Escape');
    assert.equal(await locate.evaluate(el => document.activeElement === el), true);

    const originalGroup = await page.evaluate(() => shellActiveTask().groupId);
    await page.locator('[data-action="open-task-menu"]').click();
    await page.locator('[data-task-menu] [data-action="toggle-task-group-select"]').click();
    const moveSearch = page.locator('#manage24-move-search');
    await moveSearch.fill('工作');
    await page.locator('[data-manage24-target="work"]').click();
    await moveSearch.press('Shift+Enter');
    assert.ok(await moveSearch.isVisible());
    await moveSearch.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.manage24Target), 'work');
    assert.equal(await page.evaluate(() => shellActiveTask().groupId), originalGroup);
    await page.keyboard.press('Escape');

    await open();
    await title.fill('新建任务重试');
    await title.press('Shift+Enter');
    assert.equal(await count(), 1);
    await title.dispatchEvent('compositionstart');
    await title.press('Enter');
    assert.equal(await count(), 1);
    await title.dispatchEvent('compositionend');
    await form.getByRole('button', { name: '截止与提醒' }).click();
    await form.locator('#create-deadline').press('Enter');
    assert.equal(await count(), 1, 'the date control does not submit the form');
    assert.equal(await form.getAttribute('aria-busy'), null);
    await description.fill('第一行');
    await description.press('End');
    await description.press('Enter');
    await page.keyboard.insertText('第二行');
    await description.press('Shift+Enter');
    await page.keyboard.insertText('第三行');
    assert.equal(await description.inputValue(), '第一行\n第二行\n第三行');
    await description.press('Escape');
    await form.waitFor({ state: 'detached' });
    await open();
    assert.equal(await description.inputValue(), '第一行\n第二行\n第三行');

    await app.evaluate(() => { globalThis.createWriteMode = 'fail'; });
    await title.evaluate(el => { el.focus(); el.setSelectionRange(1, 3); });
    await title.press('Enter');
    await form.getByRole('button', { name: '重试保存' }).waitFor();
    assert.match(await form.locator('footer [role="status"]').innerText(), /未能保存/);
    assert.equal(await title.inputValue(), '新建任务重试');
    assert.deepEqual(await title.evaluate(el => [el === document.activeElement, el.selectionStart, el.selectionEnd]), [true, 1, 3]);
    assert.equal(await count(), 1);
    assert.equal((await disk()).length, 1);
    await app.evaluate(() => { globalThis.createWriteMode = 'normal'; });
    await page.evaluate(() => flushSave());
    assert.equal((await disk()).length, 1, 'unrelated saves cannot publish the failed creation');

    await title.fill('修改后创建');
    await app.evaluate(() => { globalThis.createWriteMode = 'wait'; });
    await title.press('Enter');
    await page.waitForFunction(() => document.querySelector('#create-form')?.getAttribute('aria-busy') === 'true');
    await title.press('Enter');
    await title.press('Escape');
    assert.ok(await form.isVisible());
    assert.equal(await count(), 1);
    await quit();
    assert.ok(await page.evaluate(() => personalTaskTrack.windowControls.getState()));
    assert.equal(await app.evaluate(() => globalThis.createQuitPrompts.length), 0);
    await app.evaluate(() => {
      if (typeof globalThis.releaseCreateWrite !== 'function') throw Error('the disk write is not waiting');
      globalThis.createWriteMode = 'normal';
      globalThis.releaseCreateWrite();
    });
    await form.waitFor({ state: 'detached' });
    assert.equal(await count(), 2);
    assert.equal((await disk()).filter(task => task.title === '修改后创建').length, 1);

    await open();
    await form.getByRole('button', { name: '速记', exact: true }).click();
    await title.fill('主窗口速记');
    await title.press('ControlOrMeta+Enter');
    await form.waitFor({ state: 'detached' });
    assert.equal((await disk()).filter(task => task.title === '主窗口速记' && task.captureSource === 'today-widget').length, 1);

    await open();
    await title.fill('退出时仍未提交');
    await title.press('Escape');
    await form.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => prepareForUpdateInstall()), false);
    assert.equal(await title.inputValue(), '退出时仍未提交');
    await title.press('Escape');
    await form.waitFor({ state: 'detached' });
    await quit();
    // A user can take longer to answer than the normal recovery flush timeout.
    await new Promise(resolve => setTimeout(resolve, 2200));
    assert.deepEqual(await app.evaluate(() => globalThis.createQuitPrompts[0]?.buttons), ['返回编辑', '放弃并退出']);
    await app.evaluate(() => globalThis.answerCreateQuit(0));
    await title.waitFor();
    assert.equal(await title.inputValue(), '退出时仍未提交');
    assert.equal((await disk()).length, 3);
    assert.deepEqual(errors, []);

    await quit();
    const closed = app.waitForEvent('close', { timeout: 10000 });
    await app.evaluate(async () => {
      const deadline = Date.now() + 5000;
      while (globalThis.createQuitPrompts.length < 2 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (globalThis.createQuitPrompts.length < 2) throw Error('no confirmation on second quit');
      globalThis.answerCreateQuit(1);
    });
    await closed;
    assert.equal((await disk()).some(task => task.title === '退出时仍未提交'), false);
    console.log('Create form keyboard passed: explicit and modified Enter, composition guard, failed write/retry without a phantom task, duplicate prevention, real quit handshake and draft retention/discard.');
  } finally {
    // Only the isolated fixture can be force-closed. This prevents a failed
    // assertion from leaving a synthetic confirmation waiting for an answer.
    if (!page.isClosed()) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await run.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

/* #88 acceptance: the real Loop renderer in Chromium, the production file
   services behind the IPC bridge, and one isolated profile on disk. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const { writeTaskData, readTaskData } = require('../app/main/storage.cjs');
const { readKnowledgeDocument, renameKnowledgeDocument, saveKnowledgeDocument } = require('../app/main/knowledge-file.cjs');
const { readKnowledgeRecovery, writeKnowledgeRecovery, deleteKnowledgeRecovery } = require('../app/main/recovery.cjs');
const { createKnowledgePathGate } = require('../app/main/knowledge-access.cjs');
const wb = require('./workbench-helpers.cjs');

const repository = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label = 'condition') {
  for (let attempt = 0; attempt < 160; attempt++) {
    let result;
    try { result = await check(); } catch { result = false; }
    if (result) return result;
    await pause(80);
  }
  throw new Error('Timed out waiting for ' + label);
}
async function exists(target) { try { await fs.stat(target); return true; } catch { return false; } }

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-rename-ui-'));
  const out = process.env.LOOP_TEST_SCREENSHOT_DIR || path.join(profile, 'evidence');
  await fs.mkdir(out, { recursive: true });

  const content = '# 设计方案\n\n保留正文与代码块。\n\n```js\nconst kept = true;\n```\n';
  const originalPath = path.join(profile, '设计方案.md');
  await fs.writeFile(originalPath, content);
  const originalDisk = await readKnowledgeDocument(originalPath);

  // A second bound note reaches the first one by relative path. Stable and
  // title links are also present and must survive untouched.
  const referrerSource = '# 关联笔记\n\n[设计方案](./设计方案.md)\n\n[[note:note-main|设计方案]]\n\n[[设计方案]]\n';
  const referrerPath = path.join(profile, '关联笔记.md');
  await fs.writeFile(referrerPath, referrerSource);
  const referrerDisk = await readKnowledgeDocument(referrerPath);

  const stamp = new Date().toISOString();
  const make = (id, title, notes, knowledgeNote) => ({ id, title, notes, nodes: [], createdAt: stamp, updatedAt: stamp, knowledgeNote });
  await writeTaskData(profile, {
    version: 2, knowledgeSchemaVersion: 1, taskFilter: 'all', activeTaskId: 'main',
    tasks: [
      make('main', '设计方案', content, { noteId: 'note-main', title: '设计方案', filePath: originalPath, documentState: 'SAVED', dirty: false, ...originalDisk }),
      make('referrer', '关联笔记', referrerSource, { noteId: 'note-referrer', title: '关联笔记', filePath: referrerPath, documentState: 'SAVED', dirty: false, ...referrerDisk }),
      make('draft', '草稿记录', '# 草稿\n\n尚未保存为文件。', { noteId: 'note-draft', title: '草稿记录', documentState: 'DRAFT' }),
    ],
    knowledgeWorkspace: { taskId: 'main', activeId: 'main', visible: true, openIds: ['main'], tabsByTask: { main: ['main'] }, lastByTask: { main: 'main' } },
  });

  const gate = createKnowledgePathGate({ userDataPath: profile, dataFilePath: path.join(profile, 'task-data.json') });
  let renameFault = '';
  const server = http.createServer(async (request, response) => {
    const file = path.resolve(repository, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(repository + path.sep)) return response.writeHead(403).end();
    try {
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });

  const results = [], errors = [];
  let browser, page;
  const test = async (name, action) => {
    results.push({ name, detail: await action(), status: 'PASS' });
    console.log(name + ' PASS');
  };
  const openNote = async id => {
    await page.evaluate(id => { knowledgeOpen(state.tasks.find(task => task.id === id)); knowledgeAttach(knowledgeFindDocument(id)); }, id);
    await page.waitForFunction(id => knowledgeCurrentEntry(id)?.view && document.querySelector('.knowledge-pane')?.dataset.taskId === id, id, { timeout: 8000 });
    await wb.minimizeTaskInfo(page);
  };
  const openRenameDialog = async () => {
    await page.keyboard.press('Escape');
    await wb.more(page);
    await page.locator('.wb-more-menu [data-kn-action="rename"]').click();
    await page.locator('#kn-rename-title').waitFor();
  };
  const submitRename = async title => {
    await page.locator('#kn-rename-title').fill(title);
    await page.locator('#kn-rename-commit').click();
  };
  const renameError = () => page.locator('#kn-rename-error').innerText();
  const tabLabel = id => page.locator('.kn-document-tabs [data-kn-document="' + id + '"] span').innerText();
  const storedNote = async id => (await readTaskData(profile)).tasks.find(task => task.id === id).knowledgeNote;
  const linkDialog = () => page.locator('#kn-update-links');
  const dismissLinkDialog = async () => {
    // The update offer is raised after the rename receipt, so it may still be
    // on its way when the caller continues.
    const appeared = await page
      .waitForFunction(() => Boolean(document.querySelector('#kn-update-links')), null, { timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) return;
    await page.locator('.knowledge-dialog [data-action="close-dialog"]').first().click();
    await page.waitForFunction(() => !document.querySelector('#kn-update-links'));
  };
  const shot = name => page.screenshot({ path: path.join(out, name + '.png') });

  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.LOOP_TEST_CHROMIUM || undefined,
      args: process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] : [],
    });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR:', error.stack); });

    await page.exposeFunction('__knowledgeIPC', async (method, payload) => {
      if (method === 'storageRead') return readTaskData(profile);
      if (method === 'storageWrite') return writeTaskData(profile, payload);
      if (method === 'recoveryRead') return readKnowledgeRecovery(profile);
      if (method === 'recoveryWrite') return writeKnowledgeRecovery(profile, payload);
      if (method === 'recoveryDelete') return deleteKnowledgeRecovery(profile, payload);
      if (method === 'fileRead') {
        if (!(await gate.isAllowed(payload.filePath))) return { success: false, code: 'PATH_NOT_ALLOWED' };
        return readKnowledgeDocument(payload.filePath);
      }
      if (method === 'fileSave') {
        if (!(await gate.isAllowed(payload.filePath))) return { success: false, code: 'PATH_NOT_ALLOWED' };
        return saveKnowledgeDocument(payload);
      }
      if (method === 'fileRename') {
        if (!(await gate.isAllowed(payload.filePath))) return { success: false, code: 'PATH_NOT_ALLOWED' };
        if (renameFault) {
          return { canceled: false, success: false, code: renameFault, errorCode: renameFault, operation: 'rename', filePath: payload.filePath, message: '没有权限重命名文件，请检查文件或所在目录的权限' };
        }
        const result = await renameKnowledgeDocument(payload);
        if (result?.success) {
          if (result.filePath) gate.approve(result.filePath);
          if (result.previousFilePath) gate.approve(result.previousFilePath);
        }
        return result;
      }
      return { success: true };
    });
    await page.addInitScript(({ platform }) => {
      const call = (name, payload) => window.__knowledgeIPC(name, payload);
      window.personalTaskTrack = {
        platform,
        appVersion: '0.2.18',
        storage: { read: () => call('storageRead'), write: data => call('storageWrite', data) },
        knowledgeRecovery: { read: () => call('recoveryRead'), write: record => call('recoveryWrite', record), delete: id => call('recoveryDelete', id) },
        knowledgeFile: {
          choose: payload => call('fileChoose', payload),
          read: payload => call('fileRead', payload),
          save: payload => call('fileSave', payload),
          rename: payload => call('fileRename', payload),
          stageAssets: payload => call('stageAssets', payload),
          watch: async payload => {
            const receipt = await call('fileRead', payload);
            if (receipt.success) window.__fileChange?.({ ...receipt, noteId: payload.noteId, type: 'baseline' });
            return receipt;
          },
          onChange: callback => { window.__fileChange = callback; return () => {}; },
          unwatch: async () => ({ success: true }),
          updateBaseline: async () => ({ success: true }),
        },
      };
    }, { platform: process.platform });
    await page.goto(`http://127.0.0.1:${server.address().port}/app/renderer/index.html`);
    await page.waitForFunction(() => typeof state !== 'undefined' && state.tasks.some(task => task.id === 'main'));
    await openNote('main');

    await test('E01 rename moves the real file and keeps tab, path and binding together', async () => {
      const renamedPath = path.join(profile, '新设计方案.md');
      await openRenameDialog();
      assert.equal(await page.locator('#kn-rename-title').inputValue(), '设计方案');
      await submitRename('新设计方案');
      await page.waitForFunction(() => !document.querySelector('#kn-rename-title'));
      await until(async () => await exists(renamedPath), 'renamed file');
      assert.equal(await fs.readFile(renamedPath, 'utf8'), content);
      assert.equal(await exists(originalPath), false);
      await until(async () => (await tabLabel('main')) === '新设计方案', 'tab label');
      const stored = await storedNote('main');
      assert.equal(stored.title, '新设计方案');
      assert.equal(stored.filePath, renamedPath);
      const live = await page.evaluate(() => {
        const note = state.tasks.find(task => task.id === 'main').knowledgeNote;
        return { state: note.documentState, filePath: note.filePath, issues: state.knowledgeFileIssues?.[note.noteId] || null };
      });
      assert.equal(live.state, 'SAVED');
      assert.equal(live.filePath, renamedPath);
      assert.equal(live.issues, null);
      await shot('renamed');
      return { renamedPath };
    });

    await test('E02 the rename offers to update relative links and keeps identity links', async () => {
      await linkDialog().waitFor();
      assert.match(await page.locator('.knowledge-dialog').innerText(), /1 处相对链接/);
      await linkDialog().click();
      await until(async () => (await fs.readFile(referrerPath, 'utf8')).includes('./新设计方案.md'), 'rewritten link');
      const rewritten = await fs.readFile(referrerPath, 'utf8');
      assert.match(rewritten, /\[设计方案\]\(\.\/新设计方案\.md\)/);
      assert.match(rewritten, /\[\[note:note-main\|设计方案\]\]/);
      assert.match(rewritten, /\[\[设计方案\]\]/);
      const stored = await storedNote('referrer');
      assert.equal(stored.documentState, 'SAVED');
      assert.equal((await readTaskData(profile)).tasks.find(task => task.id === 'referrer').notes, rewritten);
      return { rewritten };
    });

    await test('E03 the renamed note still opens after a fresh start', async () => {
      const renamedPath = path.join(profile, '新设计方案.md');
      await page.reload();
      await page.waitForFunction(() => typeof state !== 'undefined' && state.tasks.some(task => task.id === 'main'));
      await openNote('main');
      assert.equal(await page.evaluate(() => knowledgeCurrentEntry().getMarkdown()), content);
      const live = await page.evaluate(() => {
        const note = state.tasks.find(task => task.id === 'main').knowledgeNote;
        return { filePath: note.filePath, state: note.documentState };
      });
      assert.equal(live.filePath, renamedPath);
      assert.equal(live.state, 'SAVED');
      return live;
    });

    await test('E04 duplicate, illegal and denied names are refused without touching anything', async () => {
      const renamedPath = path.join(profile, '新设计方案.md');
      const occupied = path.join(profile, '方案冲突.md');
      await fs.writeFile(occupied, '别人的文件');
      await openRenameDialog();
      await submitRename('方案冲突');
      await until(async () => (await renameError()).includes('同名文件已存在'), 'conflict message');
      assert.equal(await page.locator('#kn-rename-title').count(), 1);
      assert.equal(await tabLabel('main'), '新设计方案');
      assert.equal((await storedNote('main')).filePath, renamedPath);
      assert.equal(await fs.readFile(occupied, 'utf8'), '别人的文件');
      assert.equal(await fs.readFile(renamedPath, 'utf8'), content);
      await shot('name-conflict');

      await submitRename('方案/第一期');
      await until(async () => (await renameError()).includes('字符'), 'illegal character message');
      assert.equal((await storedNote('main')).title, '新设计方案');
      assert.equal(await exists(path.join(profile, '方案')), false);

      renameFault = 'PERMISSION_DENIED';
      await submitRename('权限失败的新名');
      await until(async () => (await renameError()).includes('权限'), 'permission message');
      assert.equal((await storedNote('main')).filePath, renamedPath);
      assert.equal(await tabLabel('main'), '新设计方案');
      assert.equal(await fs.readFile(renamedPath, 'utf8'), content);
      assert.equal(await exists(path.join(profile, '权限失败的新名.md')), false);
      await shot('permission-denied');
      renameFault = '';

      // The dialog stays usable: the corrected name now succeeds.
      await submitRename('确认后的新名');
      await page.waitForFunction(() => !document.querySelector('#kn-rename-title'));
      const corrected = path.join(profile, '确认后的新名.md');
      await until(async () => await exists(corrected), 'corrected rename');
      assert.equal((await storedNote('main')).filePath, corrected);
      await dismissLinkDialog();
      return { corrected };
    });

    await test('E05 unsaved content survives the rename and later saves use the new path', async () => {
      const newest = path.join(profile, '带草稿的新名.md');
      await openNote('main');
      await wb.mode(page, 'source');
      await page.locator('.cm-content').focus();
      await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+End');
      await page.keyboard.insertText('\n未保存的补充');
      await openRenameDialog();
      await submitRename('带草稿的新名');
      await page.waitForFunction(() => !document.querySelector('#kn-rename-title'));
      await until(async () => await exists(newest), 'renamed file with a draft');
      await until(async () => (await page.evaluate(() => knowledgeActiveDocument()?.notes || '')).includes('未保存的补充'), 'draft kept');
      await dismissLinkDialog();
      const dirty = await storedNote('main');
      assert.equal(dirty.filePath, newest);
      assert.notEqual(dirty.documentState, 'FILE_MISSING');
      // Our own rename must not report the note as saved while the draft is
      // still only in memory.
      const onDisk = await fs.readFile(newest, 'utf8');
      const live = await page.evaluate(() => {
        const note = knowledgeActiveDocument().knowledgeNote;
        return { state: note.documentState, dirty: note.dirty };
      });
      if (!onDisk.includes('未保存的补充')) {
        assert.ok(live.dirty || live.state !== 'SAVED', 'an unsaved draft must not be reported as saved');
      }
      await page.evaluate(() => saveKnowledgeTask('main'));
      await until(async () => (await fs.readFile(newest, 'utf8')).includes('未保存的补充'), 'draft written to the new path');
      assert.equal(await exists(path.join(profile, '确认后的新名.md')), false);
      return { filePath: (await storedNote('main')).filePath };
    });

    await test('E06 closing the tab keeps the file on disk', async () => {
      const newest = path.join(profile, '带草稿的新名.md');
      await page.locator('[data-kn-detach="main"]').click();
      await page.waitForFunction(() => !document.querySelector('[data-kn-document="main"]'));
      assert.equal(await exists(newest), true);
      assert.equal((await readTaskData(profile)).tasks.find(task => task.id === 'main').knowledgeNote.filePath, newest);
      return { stillOnDisk: true };
    });

    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
    console.log('PASS #88 rename sync, name refusals, unsaved draft, link update, restart and tab close');
    await browser.close();
    server.close();
  } catch (error) {
    errors.push(String(error?.stack || error));
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2)).catch(() => {});
    console.error('FAIL', error);
    if (browser) await browser.close().catch(() => {});
    server.close();
    process.exitCode = 1;
  }
})();

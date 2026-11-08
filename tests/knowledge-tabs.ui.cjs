/* Production Electron, real pointer/keyboard input and isolated files. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
const { writeTaskData, readTaskData } = require('../app/main/storage.cjs');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');
const wb = require('./workbench-helpers.cjs');

const source = path.resolve(__dirname, '..');
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const result = await check();
    if (result) return result;
    await pause(80);
  }
  throw new Error('Condition timed out');
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-tabs-'));
  const out = process.env.LOOP_TEST_SCREENSHOT_DIR || path.join(profile, 'evidence');
  await fs.mkdir(out, { recursive: true });
  const filePath = path.join(profile, 'original.md');
  const markdown = '# 知识笔记\n\n保留正文和文件绑定。\n';
  await fs.writeFile(filePath, markdown);
  const disk = await readKnowledgeDocument(filePath);
  const stamp = new Date().toISOString();
  const make = (id, title) => ({
    id, title, nodes: [], notes: markdown, createdAt: stamp, updatedAt: stamp,
    knowledgeNote: { noteId: id, title, documentState: 'DRAFT' },
  });
  const main = make('main', '知识笔记体验复盘');
  main.knowledgeNote = { ...main.knowledgeNote, ...disk, filePath, documentState: 'SAVED' };
  const longTitle = '知识笔记兼容性及历史文件迁移验证清单';
  const extra = [make('long', longTitle), make('draft', '临时记录')];
  const groups = [8, 26].map(count => {
    const owner = make('group-' + count, count + ' 个页签');
    const notes = Array.from({ length: count }, (_, i) => make(owner.id + '-' + i, String(i + 1).padStart(2, '0') + ' · 笔记内容'));
    return { owner, notes };
  });
  await writeTaskData(profile, {
    version: 2, knowledgeSchemaVersion: 1, taskFilter: 'all', activeTaskId: main.id,
    tasks: [main, ...groups.map(group => group.owner)],
    knowledgeDocuments: [...extra, ...groups.flatMap(group => group.notes)],
    knowledgeWorkspace: {
      taskId: main.id, activeId: main.id, visible: true, openIds: [main.id, 'long', 'draft'],
      tabsByTask: { main: [main.id, 'long', 'draft'], ...Object.fromEntries(groups.map(group => [group.owner.id, group.notes.map(note => note.id)])) },
      lastByTask: { main: main.id, ...Object.fromEntries(groups.map(group => [group.owner.id, group.notes[0].id])) },
    },
  });
  const env = { ...process.env, LOOP_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const errors = [], results = [];
  let app, page;
  const start = async () => {
    app = await _electron.launch({ executablePath: require('electron'), args: [source], cwd: source, env });
    page = await until(() => app.windows().find(window => window.url().endsWith('/app/renderer/index.html')));
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.navigation').waitFor();
    const runtime = await app.evaluate(({ app }) => ({
      appPath: app.getAppPath(), profile: app.getPath('userData'), version: app.getVersion(), pid: process.pid,
    }));
    assert.equal(runtime.appPath, source);
    assert.equal(runtime.profile, profile);
    await fs.writeFile(path.join(out, 'runtime.json'), JSON.stringify(runtime, null, 2));
  };
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const tab = id => page.locator('.kn-document-tabs [data-kn-document="' + id + '"]');
  const active = id => page.waitForFunction(id => knowledgeActiveDocument()?.id === id && knowledgeCurrentEntry()?.view, id);
  const choose = async id => {
    await page.keyboard.press('Escape');
    await page.locator('[data-task-row="' + id + '"] .task-select').click();
    await page.locator('[data-pane=notes]').click();
    await wb.minimizeTaskInfo(page);
    await frame();
  };
  const size = async width => {
    await app.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(width, 820);
    }, width);
    await frame();
  };
  const shot = name => page.screenshot({ path: path.join(out, name + '.png') });
  const measure = () => page.locator('.kn-document-bar').evaluate(bar => {
    const viewport = bar.querySelector('.kn-document-tabs');
    return {
      widths: [...viewport.children].map(node => node.getBoundingClientRect().width),
      scroll: viewport.scrollLeft, width: viewport.clientWidth, content: viewport.scrollWidth,
      compact: bar.hasAttribute('data-compact'),
      clipped: [...viewport.querySelectorAll('[role=tab] span')].some(span => span.scrollWidth > span.clientWidth),
    };
  });
  const left = () => page.getByRole('button', { name: '向左滚动页签' });
  const right = () => page.getByRole('button', { name: '向右滚动页签' });
  const test = async (name, action) => {
    results.push({ name, detail: await action(), status: 'PASS' });
    console.log(name + ' PASS');
  };
  try {
    await start();
    await choose('main');
    await active('main');
    await test('new, open and recent are only exposed in the more menu',async()=>{
      for(const action of ['new-note','open-file','recent']){
        assert.equal(await page.locator('.knowledge-pane [data-kn-action="'+action+'"]').count(),0);
      }
      await wb.more(page);
      for(const action of ['new-note','open-file','recent']){
        assert.equal(await page.locator('.wb-more-menu [data-kn-action="'+action+'"]').count(),1);
      }
      await page.keyboard.press('Escape');
    });
    await test('double-click rename, keyboard cancel and persistence', async () => {
      await tab('long').dblclick();
      const input = page.locator('#kn-rename-title');
      assert.equal(await input.inputValue(), longTitle);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement.dataset.knDocument === 'long');
      await tab('main').dblclick();
      await input.fill('笔记标题已修改');
      await page.locator('#kn-rename-commit').click();
      await page.waitForFunction(() => document.querySelector('[data-kn-document=main] span').textContent === '笔记标题已修改');
      await until(async () => (await readTaskData(profile)).tasks[0].knowledgeNote.title === '笔记标题已修改');
      assert.equal(await fs.readFile(filePath, 'utf8'), markdown);
      await tab('main').press('F2');
      assert.equal(await input.inputValue(), '笔记标题已修改');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement.dataset.knDocument === 'main');
    });
    await test('equal tab widths and continuous surfaces in both themes', async () => {
      const samples = [];
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { state.theme = theme; render(); }, theme);
        for (const width of [1024, 1280]) {
          await size(width);
          const sample = await measure();
          assert.equal(new Set(sample.widths).size, 1);
          assert.ok(sample.clipped);
          const colors = await page.locator('.knowledge-pane').evaluate(pane =>
            ['.knowledge-header', '.kn-document-bar', '.knowledge-body'].map(selector => getComputedStyle(pane.querySelector(selector)).backgroundColor));
          assert.equal(new Set(colors).size, 1);
          await tab('main').hover();
          const backgrounds = await tab('main').evaluate(node => [...node.parentElement.children].map(button => getComputedStyle(button).backgroundColor));
          assert.deepEqual(backgrounds, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
          samples.push({ theme, width, ...sample });
          await shot(theme + '-' + width);
        }
      }
      return samples;
    });
    await test('shrink before overflow, preserve scroll through task changes', async () => {
      await choose('group-8');
      await active('group-8-0');
      const wide = await measure();
      await size(1024);
      const narrow = await measure();
      assert.equal(new Set(wide.widths).size, 1);
      assert.ok(narrow.widths[0] < wide.widths[0] && narrow.widths[0] > 40);
      assert.equal(narrow.content, narrow.width);
      assert.equal(await right().isVisible(), false);
      await shot('eight-tabs');
      await size(1280);
      await choose('group-26');
      await active('group-26-0');
      const compact = await measure();
      assert.deepEqual([...new Set(compact.widths)], [40]);
      assert.ok(compact.compact && compact.content > compact.width);
      assert.equal(await left().isDisabled(), true);
      await right().click();
      await until(() => left().isEnabled());
      await left().click();
      await until(() => left().isDisabled());
      const viewport = page.locator('.kn-document-tabs');
      await viewport.hover();
      await page.mouse.wheel(0, 170);
      await until(async () => (await measure()).scroll >= 169);
      await page.mouse.wheel(-80, 0);
      await until(async () => Math.abs((await measure()).scroll - 90) <= 1);
      await choose('main');
      await choose('group-26');
      assert.ok(Math.abs((await measure()).scroll - 90) <= 1);
      // A retained render must not bind a second wheel listener.
      await page.evaluate(() => render());
      await viewport.hover();
      await page.mouse.wheel(0, 50);
      await until(async () => Math.abs((await measure()).scroll - 140) <= 1);
      await shot('overflow-tabs');
      await tab('group-26-0').press('End');
      await active('group-26-25');
      await until(() => right().isDisabled());
      await size(1024);
      await until(() => right().isDisabled());
      const lastVisible=await tab('group-26-25').evaluate(button=>{
        const tab=button.parentElement.getBoundingClientRect();
        const viewport=button.closest('.kn-document-tabs').getBoundingClientRect();
        return tab.left>=viewport.left-1&&tab.right<=viewport.right+1;
      });
      assert.equal(lastVisible,true);
      await size(1280);
      await tab('group-26-25').press('Home');
      await active('group-26-0');
      await until(() => left().isDisabled());
      for (let i = 25; i >= 8; i--) await page.locator('[data-kn-detach="group-26-' + i + '"]').click();
      assert.equal(await right().isVisible(), false);
      assert.ok((await measure()).widths.every(width => width > 40));
      return { wide, narrow, compact };
    });
    await test('draft, selection and undo survive switching and restart', async () => {
      await choose('main');
      await active('main');
      await wb.mode(page, 'source');
      await page.locator('.cm-content').focus();
      await page.keyboard.press(modifier + '+End');
      await page.keyboard.insertText('新增草稿正文');
      await tab('draft').click();
      await active('draft');
      await tab('main').click();
      await active('main');
      assert.match(await page.evaluate(() => knowledgeCurrentEntry().getMarkdown()), /新增草稿正文/);
      await page.locator('.cm-content').focus();
      await page.keyboard.press(modifier + '+z');
      assert.equal(await page.evaluate(() => knowledgeCurrentEntry().getMarkdown()), markdown);
      await page.keyboard.insertText('撤销后继续');
      await page.keyboard.press(modifier + '+s');
      await until(async () => (await fs.readFile(filePath, 'utf8')).includes('撤销后继续'));
      await app.close();
      app = null;
      await start();
      await active('main');
      assert.equal(await tab('main').innerText(), '笔记标题已修改');
      assert.match(await page.evaluate(() => knowledgeCurrentEntry().getMarkdown()), /撤销后继续/);
    });
    await test('single tab, empty workspace and new note', async () => {
      await wb.minimizeTaskInfo(page);
      await page.locator('[data-kn-detach=long]').click();
      await page.locator('[data-kn-detach=draft]').click();
      assert.equal(await page.locator('.kn-document-tabs [role=tab]').count(), 1);
      await tab('main').dblclick();
      await page.locator('#kn-rename-title').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('[data-kn-detach=main]').click();
      await page.locator('.kn-empty-document').waitFor();
      assert.equal(await page.locator('.knowledge-pane [data-kn-action]').count(),0);
      await page.waitForFunction(()=>document.activeElement.matches('[data-wb-action=more]'));
      await wb.more(page);
      for(const action of ['new-note','open-file','recent']){
        assert.equal(await page.locator('.wb-more-menu [data-kn-action="'+action+'"]').count(),1);
      }
      await page.locator('.wb-more-menu [data-kn-action=switcher]').click();
      await page.locator('#kn-switcher-query').waitFor();
      await page.keyboard.press('Escape');
      await wb.more(page);
      await page.locator('.wb-more-menu [data-kn-action=new-note]').click();
      await page.waitForFunction(() => knowledgeCurrentEntry()?.view && knowledgeCurrentEntry().getMarkdown() === '');
      assert.equal(await page.locator('.kn-document-tabs [role=tab]').count(), 1);
    });
    assert.deepEqual(errors, []);
    const closed = app.waitForEvent('close', { timeout: 12000 });
    void app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/app/renderer/index.html')).close();
    }).catch(() => {});
    await closed;
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ source, profile, results, errors }, null, 2));
    console.log(JSON.stringify({ status: 'PASS', out, profile }));
  } catch (error) {
    if (page && !page.isClosed()) await shot('failure').catch(() => {});
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ source, profile, results, errors, error: error.stack }, null, 2));
    throw error;
  } finally {
    if (app) await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

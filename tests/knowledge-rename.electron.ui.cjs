// Real renderer, IPC, filesystem and watcher coverage for #88. Only the
// task-data disk fault and autosave timing for the dirty-window case are held.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {launchRepository, task} = require('./electron-ui-helpers.cjs');
const {readKnowledgeDocument} = require('../app/main/knowledge-file.cjs');
const wb = require('./workbench-helpers.cjs');
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

(async () => {
  const files = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-rename-files-'));
  const original = path.join(files, '原始笔记.md');
  const bytes = Buffer.from('# 改名验收\r\n\r\n![相对图片](assets/example.png)\r\n' + '长正文与选区保持。\r\n'.repeat(180));
  await fs.mkdir(path.join(files, 'assets'));
  const image = await fs.readFile(path.join(__dirname, '../app/renderer/src/assets/loop-icon.png'));
  await fs.writeFile(path.join(files, 'assets/example.png'), image);
  await fs.writeFile(original, bytes);
  await fs.writeFile(path.join(files, '已有目标.md'), '其他文件，禁止覆盖');
  const disk = await readKnowledgeDocument(original);
  const out = process.env.LOOP_TEST_SCREENSHOT_DIR || path.join(files, 'evidence');
  await fs.mkdir(out, {recursive:true});
  const results = [];
  let run;
  const record = async name => {
    results.push({name, status:'PASS'});
    console.log(name + ' PASS');
  };
  try {
    run = await launchRepository({activeTaskId:'rename', tasks:[task('rename', {
      title:'文件改名验收', notes:disk.content,
      knowledgeNote:{...disk, noteId:'stable-rename', title:'原始笔记', documentState:'SAVED', dirty:false},
    })]}, 'knowledge-rename');
    const {app, page, profile, errors} = run;
    const runtime = await app.evaluate(({app}) => ({appPath:app.getAppPath(), userData:app.getPath('userData'), pid:process.pid, version:app.getVersion()}));
    assert.equal(runtime.appPath, path.resolve(__dirname, '..'));
    assert.equal(runtime.userData, profile);
    await fs.writeFile(path.join(out, 'runtime.json'), JSON.stringify({...runtime, files}, null, 2));
    await page.locator('[data-pane="notes"]').click();
    await page.waitForFunction(() => knowledgeCurrentEntry()?.view);
    await wb.mode(page, 'source');
    const tab = page.locator('[data-kn-document="rename"]');
    const input = page.locator('#kn-rename-title');
    const commit = async name => {
      await input.fill(name);
      await page.locator('#kn-rename-commit').click();
      await page.waitForFunction(() => !document.querySelector('#kn-rename-commit')?.disabled);
    };
    const metadata = () => page.evaluate(() => structuredClone(knowledgeActiveDocument().knowledgeNote));
    await tab.dblclick();
    await commit('CON');
    assert.match(await page.locator('#kn-rename-error').innerText(), /名称.*系统保留/);
    assert.equal((await metadata()).filePath, original);
    await commit('已有目标');
    assert.match(await page.locator('#kn-rename-error').innerText(), /已存在/);
    assert.equal(await fs.readFile(path.join(files, '已有目标.md'), 'utf8'), '其他文件，禁止覆盖');
    assert.deepEqual(await fs.readFile(original), bytes);
    await page.keyboard.press('Escape');
    await record('reserved name and collision preserve both real files');

    const markdown = await page.evaluate(() => knowledgeCurrentEntry().getMarkdown());
    await page.locator('.cm-content').focus();
    await page.keyboard.press(modifier + '+End');
    await page.keyboard.insertText('尚未落盘的改名草稿');
    const before = await page.evaluate(async () => {
      // Hold just the 1200ms autosave timer to inspect the pending-draft
      // boundary deterministically; rename/recovery/IPC still run unmodified.
      const entry = knowledgeCurrentEntry();
      captureMountedMilkdownDrafts();flushNodeNoteDraft(noteDraftKey('rename',''), {persist:true});
      // Retain the pending marker used by the real watcher to distinguish an
      // unsaved body from a restored file. Explicit Save clears it normally.
      clearTimeout(knowledgeAutosaveTimers.get('rename'));
      globalThis.__renameEntry = entry;globalThis.__renameView = entry.view;
      entry.view.dispatch({selection:{anchor:12, head:22}});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      entry.view.scrollDOM.scrollTop = 350;
      return {text:entry.getMarkdown(), dirty:knowledgeActiveDocument().knowledgeNote.dirty, selection:entry.view.state.selection.toJSON(), scroll:entry.view.scrollDOM.scrollTop};
    });
    assert.match(before.text, /尚未落盘的改名草稿/);assert.equal(before.dirty, true);
    await tab.dblclick();await commit('改名后的笔记.md');
    await input.waitFor({state:'detached'});
    const renamed = path.join(files, '改名后的笔记.md');
    assert.equal((await metadata()).filePath, renamed);
    assert.equal((await metadata()).noteId, 'stable-rename');
    assert.equal((await metadata()).dirty, true);
    assert.ok((await metadata()).aliases.includes('原始笔记'));
    assert.deepEqual(await fs.readFile(renamed), bytes, 'rename preserves original bytes before the dirty body is saved');
    await assert.rejects(fs.access(original), {code:'ENOENT'});
    assert.deepEqual(await fs.readFile(path.join(files, 'assets/example.png')), image);
    const after = await page.evaluate(() => {
      const entry = knowledgeCurrentEntry();
      return {sameEntry:entry===__renameEntry, sameView:entry.view===__renameView, text:entry.getMarkdown(),
        selection:entry.view.state.selection.toJSON(), scroll:entry.view.scrollDOM.scrollTop};
    });
    assert.equal(after.sameEntry, true);assert.equal(after.sameView, true);
    assert.equal(after.text, before.text);assert.deepEqual(after.selection, before.selection);
    assert.ok(Math.abs(after.scroll-before.scroll)<=1, 'rename preserves document scroll');
    await page.locator('.cm-content').focus();await page.keyboard.press(modifier + '+z');
    assert.equal(await page.evaluate(() => knowledgeCurrentEntry().getMarkdown()), markdown);
    await page.keyboard.press(modifier + '+Shift+z');
    assert.equal(await page.evaluate(() => knowledgeCurrentEntry().getMarkdown()), before.text);
    await page.keyboard.press(modifier + '+s');
    await page.waitForFunction(() => knowledgeActiveDocument().knowledgeNote.documentState==='SAVED' && !knowledgeFileWriteBusy.size);
    assert.equal(await fs.readFile(renamed, 'utf8'), before.text);
    await assert.rejects(fs.access(original), {code:'ENOENT'});
    await record('dirty rename preserves bytes, relative image, identity, aliases, editor, selection, scroll and Undo/Redo; save uses new path');

    const external = '# 外部更新\n\n改名后真实文件监听。';
    await fs.writeFile(renamed, external);
    await page.waitForFunction(text => knowledgeCurrentEntry()?.getMarkdown()===text, external);
    assert.equal((await metadata()).documentState, 'SAVED');
    await record('watcher follows renamed path and loads a real external edit');

    await page.evaluate(() => flushSave());
    await app.evaluate((_electron, {source, prefix}) => {
      const fs = process.mainModule.require('node:fs/promises');
      const rename = fs.rename, open = fs.open;
      global.__renameFault = {source, moved:false, enabled:true, prefix, failures:0};
      fs.rename = async (...args) => {
        const result = await rename(...args);
        if(String(args[0])===global.__renameFault.source)global.__renameFault.moved=true;
        return result;
      };
      fs.open = async (...args) => {
        const fault = global.__renameFault;
        if(fault.enabled && fault.moved && String(args[0]).startsWith(fault.prefix)) {
          fault.failures++;throw Object.assign(Error('测试：改名后元数据写入失败'), {code:'ENOSPC'});
        }
        return open(...args);
      };
    }, {source:renamed, prefix:path.join(profile, 'task-data.json.tmp-')});
    await tab.dblclick();await commit('元数据重试.md');
    assert.match(await page.locator('#kn-rename-error').innerText(), /重命名未能保存.*文件名已恢复/);
    const retried = path.join(files, '元数据重试.md');
    assert.equal((await metadata()).filePath, renamed);
    assert.ok(await app.evaluate(() => global.__renameFault.failures>0));
    await assert.rejects(fs.access(retried), {code:'ENOENT'});
    assert.equal(await fs.readFile(renamed,'utf8'), external);
    const db = JSON.parse(await fs.readFile(path.join(profile, 'task-data.json'), 'utf8'));
    assert.equal(db.tasks[0].knowledgeNote.filePath, renamed, 'failed metadata is not reported as persisted');
    await page.screenshot({path:path.join(out, 'metadata-failure.png')});
    await app.evaluate(() => {global.__renameFault.enabled=false;});
    await commit('元数据重试.md');await input.waitFor({state:'detached'});
    const savedDb = JSON.parse(await fs.readFile(path.join(profile, 'task-data.json'), 'utf8'));
    assert.equal(savedDb.tasks[0].knowledgeNote.filePath, retried);
    await assert.rejects(fs.access(renamed), {code:'ENOENT'});
    await record('real metadata disk failure restores the published file path and visible retry; retry persists the new name');

    await page.locator('[data-kn-detach="rename"]').click();
    await page.locator('.kn-empty-document').waitFor();
    assert.equal(await fs.readFile(retried,'utf8'), external);
    assert.deepEqual(await fs.readFile(path.join(files, 'assets/example.png')), image);
    await wb.more(page);await page.locator('.wb-more-menu [data-kn-action="recent"]').click();
    await page.locator('[data-kn-note="rename"]').click();
    await page.waitForFunction(text => knowledgeCurrentEntry()?.getMarkdown()===text, external);
    await page.evaluate(async () => {save();await flushSave();});
    await page.reload();await page.waitForFunction(text => knowledgeCurrentEntry()?.getMarkdown()===text, external);
    assert.equal((await metadata()).filePath, retried);
    await record('closing preserves Markdown and attachments; recent reopen and reload use persisted new path');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({status:'PASS', runtime, files, results, errors}, null, 2));
  } catch(error) {
    await run?.page.screenshot({path:path.join(out, 'failure.png')}).catch(()=>{});
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({status:'FAIL', files, results, error:error.stack}, null, 2));
    throw error;
  } finally {
    if(run) {
      await run.app.evaluate(() => {if(global.__renameFault)global.__renameFault.enabled=false;}).catch(()=>{});
      await run.close();
    }
  }
})().catch(error => {console.error(error);process.exitCode=1;});

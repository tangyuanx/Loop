const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const wb = require('./workbench-helpers.cjs');

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=';

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-knowledge-save-'));
  const file = path.join(dir, 'note.md');
  const original = '# 笔记\n\n起始内容';
  let run;
  try {
    await fs.writeFile(file, original);
    const disk = await readKnowledgeDocument(file);
    run = await launchRepository({
      activeTaskId: 'note-save',
      tasks: [task('note-save', {
        notes: original,
        knowledgeNote: { ...disk, noteId: 'note-save', documentState: 'SAVED', dirty: false },
      })],
      attachments: { images: { 'qa-image': image } },
    }, 'knowledge-save');
    const { app, page } = run;
    const text = () => page.evaluate(() => knowledgeCurrentEntry().getMarkdown());
    const append = async value => {
      await page.evaluate(() => {
        const editor = knowledgeCurrentEntry();
        editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
        editor.view.focus();
      });
      await page.keyboard.insertText(value);
    };
    const save = async () => {
      await page.keyboard.press('ControlOrMeta+s');
      await page.waitForFunction(() => knowledgeReceiptState(knowledgeActiveDocument()).state === 'saved');
      assert.equal(await fs.readFile(file, 'utf8'), await text());
    };
    await page.locator('[data-pane="notes"]').click();
    await page.waitForFunction(() => knowledgeCurrentEntry()?.view);
    await wb.minimizeTaskInfo(page);
    await page.evaluate(() => { window.saveView = knowledgeCurrentEntry().view; });

    await append(' edited');
    await save();
    await append('\n\n![附件](task-image:qa-image)\n\n');
    await save();
    assert.match(await text(), /attachments\//);
    await append(' after-image');
    await save();
    assert.doesNotMatch(await text(), /task-image:|data:image/);
    assert.equal(await page.evaluate(() => knowledgeCurrentEntry().view === window.saveView), true);

    // Pause the first real atomic write after the main process has received
    // its content. Edits made during that write must stay in the live editor.
    await app.evaluate((_electron, file) => {
      const fs = process.mainModule.require('node:fs/promises');
      const rename = fs.rename;
      fs.rename = async (from, to) => {
        if (to === file && !global.noteWriteBlocked) {
          global.noteWriteBlocked = true;
          await new Promise(resolve => { global.releaseNoteWrite = resolve; });
        }
        return rename(from, to);
      };
    }, file);
    await append(' before-write');
    await page.keyboard.press('ControlOrMeta+s');
    const blocked = await app.evaluate(async () => {
      const deadline = Date.now() + 5000;
      while (!global.noteWriteBlocked && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return global.noteWriteBlocked;
    });
    assert.equal(blocked, true);
    await append(' newer-draft');
    await app.evaluate(() => global.releaseNoteWrite());
    assert.match(await text(), /newer-draft$/);
    await page.waitForFunction(() => knowledgeReceiptState(knowledgeActiveDocument()).state === 'saved');
    assert.match(await fs.readFile(file, 'utf8'), /before-write newer-draft$/);
    assert.equal(await page.locator('[data-knowledge-conflict]').count(), 0);

    const external = '# 外部程序重新写入';
    await fs.writeFile(file, external);
    await page.locator('[data-knowledge-conflict]').waitFor();
    assert.match(await text(), /newer-draft$/);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await page.locator('[data-knowledge-conflict] [data-action="reload-knowledge"]').click();
    await page.locator('[data-knowledge-conflict]').waitFor({ state: 'detached' });
    assert.equal(await text(), external);

    await wb.mode(page, 'source');
    await append('\n源码保存');
    await save();
    assert.equal(await text(), external + '\n源码保存');
    assert.deepEqual(run.errors, []);
    console.log('PASS: native save shortcut, stable attachments, in-flight typing, disk watcher, conflict reload and source mode');
  } finally {
    await run?.app.evaluate(() => global.releaseNoteWrite?.()).catch(() => {});
    await run?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

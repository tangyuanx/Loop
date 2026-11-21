const assert = require('node:assert/strict');
const { readTaskData } = require('../app/main/storage.cjs');
const { readKnowledgeRecovery } = require('../app/main/recovery.cjs');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const wb = require('./workbench-helpers.cjs');

const original = '# 笔记\n\n起始内容';

async function main() {
  const run = await launchRepository({
    activeTaskId: 'note-a',
    tasks: ['note-a', 'note-b'].map(id => task(id, { notes: original })),
  }, 'knowledge-input');
  const { page, profile } = run;
  const text = () => page.evaluate(() => knowledgeCurrentEntry().getMarkdown());
  const select = async id => {
    await page.locator(`[data-task-row="${id}"] .task-select`).click();
    await page.locator('[data-pane="notes"]').click();
    await page.waitForFunction(id => knowledgeCurrentEntry()?.root.isConnected &&
      knowledgeActiveDocument()?.id === id, id);
    await wb.minimizeTaskInfo(page);
  };
  const end = () => page.evaluate(() => {
    const editor = knowledgeCurrentEntry();
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    editor.view.focus();
  });
  const journal = () => page.evaluate(() => {
    window.inputView = knowledgeCurrentEntry().view;
    window.inputRenders = 0;
    if (window.inputRenderWrapped) return;
    const prior = render;
    render = function () {
      window.inputRenders++;
      return prior();
    };
    window.inputRenderWrapped = true;
  });
  const assertStable = async () => assert.deepEqual(await page.evaluate(() => {
    const view = knowledgeCurrentEntry().view;
    return { same: view === window.inputView, focus: view.hasFocus, renders: window.inputRenders };
  }), { same: true, focus: true, renders: 0 });
  const assertPersisted = async expected => {
    const id = await page.evaluate(() => knowledgeActiveDocument().id);
    await page.waitForFunction(expected => knowledgeSaveStatus(knowledgeActiveDocument())?.content === expected, expected);
    assert.equal((await readTaskData(profile)).tasks.find(t => t.id === id).notes, expected);
  };

  try {
    await select('note-a');
    await end();
    await journal();
    for (const word of [' alpha', ' beta', ' gamma']) {
      await page.keyboard.type(word, { delay: 25 });
      await assertPersisted(await text());
      await assertStable();
    }
    assert.equal(await text(), original + ' alpha beta gamma');

    // Exercise Chromium's actual composition path across the autosave delay.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '中文输入', selectionStart: 4, selectionEnd: 4 });
    await page.waitForTimeout(1350);
    await assertStable();
    await cdp.send('Input.insertText', { text: '中文输入' });
    await assertPersisted(await text());
    assert.match(await text(), /中文输入$/);
    await page.evaluate(() => knowledgeCurrentEntry().format('undo'));
    assert.doesNotMatch(await text(), /中文输入/);
    await page.evaluate(() => knowledgeCurrentEntry().format('redo'));
    assert.match(await text(), /中文输入$/);
    await assertStable();

    await select('note-b');
    await end();
    await page.keyboard.insertText(' 切换前输入');
    await select('note-a');
    await select('note-b');
    assert.equal(await text(), original + ' 切换前输入');
    await page.evaluate(() => knowledgeCurrentEntry().format('undo'));
    assert.equal(await text(), original);

    await wb.mode(page, 'source');
    await end();
    await journal();
    await page.keyboard.insertText('\n源码输入');
    await assertPersisted(original + '\n源码输入');
    await assertStable();
    const noteId = await page.evaluate(() => knowledgeActiveDocument().knowledgeNote.noteId);
    assert.equal((await readKnowledgeRecovery(profile)).records[noteId].content, original + '\n源码输入');
    assert.deepEqual(run.errors, []);
    console.log('PASS: paused typing, live Chromium composition, undo/redo, immediate tab switch, source autosave and Recovery');
  } finally {
    await run.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

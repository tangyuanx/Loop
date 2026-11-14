const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');
const wb = require('./workbench-helpers.cjs');

const noteId = 'outline';
const source = '# 项目记录\r\n\r\n正文保留 UTF-8 和 CRLF。\r\n\r\n'
  + Array.from({length: 56}, (_, i) => `${'##' + '#'.repeat(i % 3)} 标题 ${i + 1}：核对知识笔记大纲的可用宽度\r\n\r\n用于测试重排、定位和编辑。\r\n\r\n`).join('');
const out = process.env.LOOP_OUTLINE_QA_DIR;

async function main() {
  const files = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-outline-files-'));
  const file = path.join(files, '大纲验收.md');
  const checks = [];
  let run;
  const check = message => { checks.push(message); console.log('PASS ' + message); };
  try {
    await fs.writeFile(file, source);
    const disk = await readKnowledgeDocument(file);
    assert.equal(disk.success, true);
    run = await launchRepository({
      activeTaskId: noteId, markdownMode: 'source',
      tasks: [task(noteId, { title: '大纲验收', notes: source,
        knowledgeNote: { ...disk, noteId, title: '大纲验收', documentState: 'SAVED', dirty: false } })],
      knowledgeDocuments: [{ id: 'peer', title: '分屏对照', notes: '# 分屏对照\n\n对照笔记。' }],
      knowledgeWorkspace: { taskId: noteId, activeId: noteId, openIds: [noteId, 'peer'],
        tabsByTask: { [noteId]: [noteId, 'peer'] }, lastByTask: { [noteId]: noteId } },
    }, 'outline-resize');
    const { app, page, profile, errors } = run;
    const runtime = await app.evaluate(({app}) => ({
      appPath: app.getAppPath(), profile: app.getPath('userData'), version: app.getVersion(),
      electron: process.versions.electron, platform: process.platform, arch: process.arch, os: process.getSystemVersion(),
    }));
    assert.equal(runtime.appPath, path.resolve(__dirname, '..'));
    assert.equal(runtime.profile, profile);
    console.log(JSON.stringify(runtime));
    if (out) await fs.mkdir(out, {recursive: true});
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const size = async (width, height) => {
      await app.evaluate(({BrowserWindow}, size) => {
        BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/app/renderer/index.html')).setSize(...size);
      }, [width, height]);
      await settle();
    };
    const pane = page.locator(`.knowledge-pane[data-task-id="${noteId}"]`);
    const divider = pane.getByRole('separator', { name: '调整大纲宽度' });
    const outline = pane.locator('.kn-side-panel');
    const body = pane.locator('.knowledge-body');
    const close = () => pane.getByRole('button', { name: '关闭大纲', exact: true }).click();
    const geometry = () => body.evaluate(el => {
      const outline = el.querySelector('.kn-side-panel'), page = el.querySelector('.knowledge-page');
      const handle = el.querySelector('.kn-outline-divider');
      return {
        aside: outline.offsetWidth, page: page.offsetWidth, pane: el.clientWidth, handle: handle.offsetWidth,
        scrollWidth: el.scrollWidth, pageTop: page.getBoundingClientRect().top, asideTop: outline.getBoundingClientRect().top,
        value: Number(handle.getAttribute('aria-valuenow')), min: Number(handle.getAttribute('aria-valuemin')),
        max: Number(handle.getAttribute('aria-valuemax')), documentOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const grab = async (margin = 3) => {
      const box = await divider.boundingBox();
      assert.ok(box && box.width >= 7);
      const x = box.x + margin, y = box.y + 100;
      await page.mouse.move(x, y);
      assert.equal(await page.evaluate(({x,y}) => getComputedStyle(document.elementFromPoint(x,y)).cursor, {x,y}), 'col-resize');
      await page.mouse.down();
      return {x,y};
    };
    const snapshot = id => page.evaluate(id => {
      const entry = knowledgeCurrentEntry(id), note = knowledgeFindDocument(id);
      return {
        markdown: entry.getMarkdown(), selection: entry.view.state.selection.toJSON(), state: note.knowledgeNote.documentState,
        dirty: note.knowledgeNote.dirty, draft: nodeNoteDrafts.has(noteDraftKey(id, '')),
        sameEditor: entry === window.__outlineEditor,
        hasChanges: entry.view.state !== window.__outlineEditorState,
        documentSelection: String(getSelection()),
      };
    }, id);
    const expectColumns = layout => {
      assert.ok(layout.page >= 260 && layout.aside >= layout.min && layout.aside <= layout.max, JSON.stringify(layout));
      assert.equal(layout.value, layout.aside);
      assert.equal(layout.page + layout.handle + layout.aside, layout.pane);
      assert.ok(layout.scrollWidth <= layout.pane + 1 && !layout.documentOverflow);
    };

    await size(1280, 820);
    await page.locator('[data-pane="notes"]').click();
    await page.waitForFunction(() => knowledgeCurrentEntry()?.view);
    await wb.mode(page, 'source');
    await wb.panels(page);
    await page.evaluate(() => {
      const entry = knowledgeCurrentEntry();
      entry.view.dispatch({selection: {anchor: 4, head: 8}});
      entry.view.focus();
      window.__outlineEditor = entry;
      window.__outlineEditorState = entry.view.state;
    });
    await settle();
    const before = await snapshot(noteId);
    const initial = await geometry();
    assert.equal(before.markdown, source);
    assert.equal(before.state, 'SAVED');
    assert.equal(before.dirty, false);
    assert.equal(before.draft, false);
    expectColumns(initial);
    const start = await grab(1);
    await page.mouse.move(start.x - 65, start.y, {steps: 8});
    const wider = await geometry();
    assert.equal(wider.aside, initial.aside + 65);
    assert.equal(wider.page, initial.page - 65);
    await page.mouse.move(start.x + 12, start.y, {steps: 8});
    assert.equal((await geometry()).aside, initial.aside - 12);
    await page.mouse.move(start.x - 80, start.y, {steps: 8});
    await page.mouse.up();
    const preferred = (await geometry()).aside;
    assert.equal(preferred, initial.aside + 80);
    assert.deepEqual(await snapshot(noteId), before);
    assert.deepEqual(await fs.readFile(file), Buffer.from(source));
    check('AC-01 / AC-05: two-way live reflow and release preserve editor state, selection, dirty flags and real Markdown bytes');

    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { state.theme = theme; render(); }, theme);
      for (const [width,height] of [[1280,820], [1024,680]]) {
        await size(width,height);
        const layout = await geometry();
        expectColumns(layout);
        await divider.evaluate(el => el.blur());
        await page.mouse.move(10,10);
        const baseLine = await divider.evaluate(el => getComputedStyle(el, '::before').backgroundColor);
        const leftEdge = await grab(1);
        assert.notEqual(await divider.evaluate(el => getComputedStyle(el, '::before').backgroundColor), baseLine);
        await page.mouse.move(1, leftEdge.y, {steps:8});
        assert.equal((await geometry()).aside, layout.max);
        await page.mouse.up();
        expectColumns(await geometry());
        const rightEdge = await grab(5);
        await page.mouse.move(await page.evaluate(() => innerWidth - 2), rightEdge.y, {steps:8});
        assert.equal((await geometry()).aside, layout.min);
        await page.mouse.up();
        expectColumns(await geometry());
        const escape = await grab();
        await page.mouse.move(escape.x - 30, escape.y, {steps:5});
        await page.keyboard.press('Escape');
        await page.mouse.up();
        assert.equal((await geometry()).aside, layout.min, 'Escape restores the width at pointerdown');
        await divider.press('End');
        assert.equal((await geometry()).aside, layout.max);
        if (out) await page.screenshot({path:path.join(out, `outline-${theme}-${width}.png`)});
      }
    }
    check('AC-02 / AC-06: actual track limits, both hit edges, hover paint and keyboard at both sizes and themes');

    await size(1280, 820);
    await divider.press('End');
    const expanded = await geometry();
    await close();
    assert.equal(await outline.count(), 0);
    await wb.panels(page);
    assert.equal((await geometry()).aside, expanded.aside);
    await size(1024, 680);
    const narrow = await geometry();
    assert.equal(narrow.aside, Math.min(expanded.aside, narrow.max));
    assert.ok(narrow.aside < expanded.aside);
    await page.locator('[data-kn-document="peer"]').click({button:'right'});
    await page.getByRole('menuitem', {name:'在右侧分屏打开', exact:true}).click();
    await page.locator('.kn-split').waitFor();
    await settle();
    const stacked = await geometry();
    assert.equal(stacked.handle, 0);
    assert.ok(stacked.asideTop < stacked.pageTop && stacked.aside === stacked.pane);
    assert.ok(stacked.scrollWidth <= stacked.pane + 1 && !stacked.documentOverflow);
    await pane.locator('[data-wb-action="focus"]').click();
    await settle();
    expectColumns(await geometry());
    assert.equal((await geometry()).aside, expanded.aside);
    await page.keyboard.press('Escape');
    await settle();
    assert.equal((await geometry()).handle, 0);
    await pane.locator('[data-wb-action="more"]').click();
    await page.getByRole('menuitem', {name:'合并为单栏', exact:true}).click();
    await size(1280, 820);
    assert.equal((await geometry()).aside, expanded.aside);
    check('AC-04: collapse/reopen and real BrowserWindow resize, split, focus and merge recover the effective width');

    assert.ok(await outline.evaluate(el => el.scrollHeight > el.clientHeight));
    const bodyBeforeWheel = await body.evaluate(el => el.scrollTop);
    await outline.hover();
    await page.mouse.wheel(0, 430);
    await page.waitForFunction(() => document.querySelector('.kn-side-panel').scrollTop > 100);
    assert.equal(await body.evaluate(el => el.scrollTop), bodyBeforeWheel);
    const heading = outline.getByRole('button', {name:/^标题 14：/});
    const indentation = await outline.locator('.kn-outline-link').evaluateAll(links => links.slice(0,4).map(link => link.style.paddingLeft));
    assert.deepEqual(indentation, ['8px','20px','32px','44px']);
    await heading.click();
    assert.equal(await heading.getAttribute('aria-current'), 'location');
    // CodeMirror applies scrollIntoView in its measure phase after updating
    // the selection. Wait for the actual viewport to follow the heading.
    await page.waitForFunction(id => {
      const body = document.querySelector(`.knowledge-pane[data-task-id="${id}"] .knowledge-body`);
      return body.scrollTop > 100;
    }, noteId);
    await close();
    await wb.more(page);
    await page.locator('.wb-more-menu [data-kn-action="backlinks"]').click();
    assert.equal(await divider.count(), 0);
    await pane.getByRole('button', {name:'关闭反向链接', exact:true}).click();
    await wb.panels(page);
    assert.equal((await geometry()).aside, expanded.aside);

    await page.evaluate(() => {
      const view = knowledgeCurrentEntry().view;
      view.focus();
      view.dispatch({selection:{anchor:0}});
    });
    await page.keyboard.insertText('编辑验证 ');
    const edited = await snapshot(noteId);
    assert.ok(edited.markdown.startsWith('编辑验证 '));
    const afterEdit = await grab();
    await page.mouse.move(afterEdit.x + 25, afterEdit.y, {steps:8});
    await page.mouse.up();
    assert.equal((await snapshot(noteId)).markdown, edited.markdown);
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal((await snapshot(noteId)).markdown, source);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
    assert.equal((await snapshot(noteId)).markdown, edited.markdown);
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal((await snapshot(noteId)).markdown, source);
    assert.deepEqual(await fs.readFile(file), Buffer.from(source));
    assert.deepEqual(errors, []);
    check('AC-03 / AC-05: independent outline wheel scrolling, heading hierarchy/navigation, real editor typing and Undo/Redo after drag');
    if (out) await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({runtime, checks}, null, 2));
  } catch (error) {
    if (out && run) await run.page.screenshot({path:path.join(out, 'failure.png')}).catch(() => {});
    throw error;
  } finally {
    await run?.close();
    await fs.rm(files, {recursive:true, force:true});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');
const { readTaskData } = require('../app/main/storage.cjs');

const row = (columns, value) => '| ' + Array.from({ length: columns }, (_, i) => value(i)).join(' | ') + ' |';
const large = [
  '# 200 × 20',
  '',
  row(20, i => `列 ${i + 1}`),
  row(20, () => '---'),
  ...Array.from({ length: 200 }, (_, i) => row(20, c => `R${i + 1}C${c + 1}`)),
  '',
  '表格之后的正文',
].join('\n');
const nested = [
  '# 多种表格',
  '',
  '> | 引用 A | 引用 B |',
  '> | - | -- |',
  '> | 甲 | 乙 |',
  '',
  '> [!NOTE] 提示',
  '>',
  '> | 提示 A | 提示 B |',
  '> | - | -- |',
  '> | 丙 | 丁 |',
  '',
  '- 列表',
  '',
  '  | 列表 A | 列表 B |',
  '  | - | -- |',
  '  | 戊 | 己 |',
  '',
  '| 代码 | 相邻列 |',
  '|-|-|',
  '| `x|y` | 单 |',
  '| ``x|y`` | 双 |',
  '| ```x|y``` | 三 |',
  '| `x\\|y` | 已转义 |',
  '| 未闭合 `x | 保留 |',
  '',
  '正文',
].join('\n');

const wideText = '这是用于核对合并前后列宽保持一致的长文字。'.repeat(3);
const mergeLayout = [
  '# 合并与滚动稳定性', '',
  '| 项目 | 内容与自动列宽 | 备注 |', '| - | - | - |',
  '| 合并甲<br><br>原有空行 | ' + wideText + ' | A |',
  '| 合并乙 | ' + wideText + ' | B |',
  ...Array.from({ length: 78 }, (_, i) => `| 项目 ${i} | 说明 | C |`),
  '',
  ...Array.from({ length: 340 }, (_, i) => `表格之后第 ${i} 行，用于核对滚动时页面位置和正文稳定。\n`),
].join('\n');

const columnWidths = table => table.locator('colgroup col').evaluateAll(columns =>
  columns.map(column => Math.round(column.getBoundingClientRect().width)));

async function main() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-table-report-'));
  const file = path.join(folder, 'Tables.md');
  let run;
  try {
    await fs.writeFile(file, large);
    const disk = await readKnowledgeDocument(file);
    assert.ok(disk.success);
    run = await launchRepository({
      activeTaskId: 'tables', taskPane: 'notes',
      tasks: [task('tables', { title: '表格核对', notes: large,
        knowledgeNote: { ...disk, title: '表格核对', documentState: 'SAVED', dirty: false } })],
    }, 'table-report', process.env.LOOP_APP_EXECUTABLE);
    const { page, app, errors } = run;
    await page.locator('[data-pane=notes]').click();
    const widgets = page.locator('.kn-table-widget');
    const editorField = page.locator('.kn-table-cell-editor:focus');
    const source = () => page.evaluate(() => knowledgeCurrentEntry().getEditorText());
    const mode = value => page.evaluate(value => knowledgeCurrentEntry().setMode(value), value);
    const save = async () => {
      const result = await page.evaluate(() => saveKnowledgeTask(knowledgeActiveDocument().id));
      assert.notEqual(result, false);
      assert.equal(await fs.readFile(file, 'utf8'), await source());
    };
    const fixture = markdown => page.evaluate(markdown => {
      const editor = knowledgeCurrentEntry();
      editor.finishTableCell();
      editor.view.dispatch({ changes: { from: 0, to: editor.view.state.doc.length, insert: markdown }, selection: { anchor: 0 } });
      editor.root.closest('.knowledge-body').scrollTop = 0;
    }, markdown);
    const scrollToMiddle = async table => {
      await table.locator('tbody tr').nth(100).locator('td').first().scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const header = document.querySelector('.kn-edit-surface:not([hidden]) .kn-table-widget thead, .kn-reading:not([hidden]) thead');
        if (!header?.hasAttribute('data-table-pinned')) return false;
        const top = header.closest('.knowledge-body').getBoundingClientRect().top;
        return Math.abs(header.getBoundingClientRect().top - top) <= 2;
      });
    };
    await widgets.first().waitFor();
    assert.equal(await widgets.first().locator('tbody tr').count(), 200, 'full table before any scrolling');
    assert.equal(await widgets.first().locator('th[scope=col]').count(), 20);
    const height = await widgets.first().locator('table').evaluate(table => table.offsetHeight);
    await scrollToMiddle(widgets.first());
    assert.equal(await widgets.first().locator('tbody tr').count(), 200);
    assert.equal(await widgets.first().locator('table').evaluate(table => table.offsetHeight), height);
    await mode('preview');
    const reading = page.locator('.kn-reading table').first();
    assert.equal(await reading.locator('tbody tr').count(), 200);
    assert.equal(await reading.locator('th[scope=col]').count(), 20);
    await scrollToMiddle(reading);
    await mode('edit');
    await fixture(nested);
    await page.waitForFunction(() => document.querySelectorAll('.kn-table-widget').length === 4);
    assert.equal(await page.locator('.milkdown-fallback').count(), 0);
    assert.equal(await page.locator('.kn-callout-title').textContent(), '提示');
    const bodyCell = (table, r, c) => widgets.nth(table).locator('tbody tr').nth(r).locator('td').nth(c);
    const expectSource = text => page.waitForFunction(text => knowledgeCurrentEntry().getEditorText().includes(text), text);
    for (const [table, prefix, name] of [[0, '> ', '引用'], [1, '> ', '提示'], [2, '  ', '列表']]) {
      await widgets.nth(table).hover();
      await widgets.nth(table).locator('[data-table-action=row-add]').click();
      await expectSource(prefix + '|  |  |');
      assert.equal(await widgets.nth(table).locator('tbody tr').count(), 2);
      await widgets.nth(table).locator('[data-table-action=column-add]').click();
      await expectSource(prefix + `| ${name} A | ${name} B |  |`);
      assert.equal(await widgets.nth(table).locator('th[scope=col]').count(), 3);
    }
    for (const [index, delimiter] of ['`','``','```','`'].entries()) {
      const cell = bodyCell(3, index, 0);
      assert.equal(await cell.locator('code').textContent(), 'x|y');
      await cell.click();
      await editorField.press('ControlOrMeta+a');
      await page.keyboard.insertText('替换' + index);
      await editorField.press('Enter');
      await editorField.waitFor({ state: 'detached' });
      assert.equal(await cell.textContent(), '替换' + index, delimiter + ' code delimiter');
      assert.equal(await bodyCell(3, index, 1).textContent(), ['单', '双', '三', '已转义'][index]);
    }
    assert.match(await source(), /\| 未闭合 `x \| 保留 \|/);
    await save();
    await mode('preview');
    assert.equal(await page.locator('.kn-reading blockquote table').count(), 2);
    assert.equal(await page.locator('.kn-reading li table').count(), 1);
    await mode('edit');

    const small = '# 合并与粘贴\n\n| A | B |\n| - | - |\n| **alpha** text | beta |\n| gamma | delta |';
    await fixture(small);
    const table = widgets.first();
    const cell = (r, c) => bodyCell(0, r, c);
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 15 }); await page.mouse.up();
    };
    await cell(0, 0).click();
    const [first, last] = await editorField.locator('strong').evaluate(node => {
      const text = node.firstChild;
      return [0, 4].map(offset => {
        const range = new Range(); range.setStart(text, offset); range.collapse(true);
        const box = range.getBoundingClientRect();
        return { x: box.x, y: box.y + box.height / 2 };
      });
    });
    await drag(first, last);
    assert.ok(await page.evaluate(() => getSelection().toString().length > 0), 'text selection stays inside an active cell');
    assert.equal(await table.locator('[data-table-range]').count(), 0);
    const center = async locator => {
      const box = await locator.boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    await drag(await center(cell(0,0)), await center(cell(1,1)));
    assert.equal(await table.locator('[data-table-range]').count(), 4);
    assert.equal(await editorField.count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await table.locator('[data-table-range]').count(), 0);
    await drag(await center(cell(1,1)), await center(cell(0,0)));
    assert.equal(await table.locator('[data-table-range]').count(), 4, 'drag also starts from a rendered cell');
    // Give the clipboard event a local DataTransfer so it never overwrites the host clipboard.
    const copied = await table.evaluate(target => {
      const clipboardData = new DataTransfer();
      target.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }));
      return [clipboardData.getData('text/plain'), clipboardData.getData('text/html')];
    });
    assert.equal(copied[0], 'alpha text\tbeta\ngamma\tdelta');
    assert.match(copied[1], /<td>alpha text<\/td><td>beta<\/td>/);
    await cell(1,1).click({ button: 'right' });
    await page.locator('[data-table-command=merge-cells]').click();
    await table.locator('td[rowspan="2"][colspan="2"]').waitFor();
    assert.equal(await table.locator('th[scope=col]').count(), 2);
    assert.match(await source(), /<strong>alpha<\/strong> text<br>beta<br>gamma<br>delta/);

    const paste = async (target, entries) => target.evaluate((node, entries) => {
      const clipboardData = new DataTransfer();
      for (const [type, text] of Object.entries(entries)) clipboardData.setData(type, text);
      node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    }, entries);
    for (const [entries, expected] of [
      [{ 'text/plain': 'Name\tValue\r\nLead\ta|b' }, '| Lead | a\\|b |'],
      [{ 'text/plain': 'Name,Value\nLead,"a,b"' }, '| Lead | a,b |'],
      [{ 'text/html': '<table><tr><th>Name</th><th>Value</th></tr><tr><td>Lead</td><td>a<br>b<script>ignored()</script></td></tr></table>' }, '| Lead | a<br>b |'],
    ]) {
      await fixture('');
      await paste(page.locator('.cm-content:visible'), entries);
      await expectSource(expected);
      assert.equal(await widgets.first().locator('tbody td').first().textContent(), 'Lead');
    }
    for (const [entries, expected] of [
      [{ 'text/plain': 'Lead,"a,b"\nNext,last' }, '| Lead | a,b |\n| Next | last |'],
      [{ 'text/html': '<table><tr><td>Lead</td><td>a|b</td></tr><tr><td>Next</td><td>last</td></tr></table>' }, '| Lead | a\\|b |\n| Next | last |'],
    ]) {
      await fixture(small);
      await cell(0,0).click();
      await editorField.press('End');
      await paste(editorField, entries);
      await expectSource(expected);
      assert.equal(await cell(1,1).textContent(), 'last');
    }

    await fixture(mergeLayout);
    await table.waitFor();
    const originalWidths = await columnWidths(table);
    assert.ok(originalWidths[1] > originalWidths[0] + 50);
    const mergeRectangle = async () => {
      await cell(0,0).click({ position: { x: 9, y: 9 } });
      await cell(1,1).click({ position: { x: 9, y: 9 }, modifiers: ['Shift'] });
      await cell(1,1).click({ position: { x: 9, y: 9 }, button: 'right' });
      await page.locator('[data-table-command=merge-cells]').click();
      const merged = table.locator('td[rowspan="2"][colspan="2"]');
      await merged.waitFor();
      await editorField.press('Enter');
      await editorField.waitFor({ state: 'detached' });
      return merged;
    };
    const merged = await mergeRectangle();
    assert.deepEqual(await columnWidths(table), originalWidths);
    assert.equal(await merged.locator('br').count(), 5, await merged.innerHTML());
    assert.match(await source(), /合并甲<br><br>原有空行<br>这/);
    assert.doesNotMatch(await source(), /<br><br>合并乙/);
    await mode('preview');
    assert.deepEqual(await columnWidths(reading), originalWidths);
    await mode('edit');
    await page.locator('.knowledge-body').evaluate(body => { body.scrollTop = 0; });

    await page.evaluate(() => {
      const editor = knowledgeCurrentEntry(), body = editor.root.closest('.knowledge-body'), samples = [];
      function sample() {
        samples.push({ top: body.scrollTop, height: body.scrollHeight,
          raw: Array.from(editor.view.contentDOM.querySelectorAll('.cm-line')).some(line => line.textContent.includes('<table data-loop-table=')) });
        window.tableScrollProbe.frame = requestAnimationFrame(sample);
      }
      window.tableScrollProbe = { samples };
      sample();
    });
    const body = await page.locator('.knowledge-body').boundingBox();
    await page.mouse.move(body.x + body.width - 36, body.y + body.height / 2);
    for (const delta of [3400, 2500, 900, 350, 350, -200, 1200, -1000, -1700, -1200, 99999, -99999]) {
      await page.mouse.wheel(0, delta);
      await page.waitForFunction(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
    }
    const frames = await page.evaluate(() => {
      const { samples, frame } = window.tableScrollProbe;
      cancelAnimationFrame(frame);
      delete window.tableScrollProbe;
      return samples;
    });
    assert.ok(Math.max(...frames.map(frame => frame.top)) > 9000, 'wheel reached deeply past the table');
    assert.ok(frames.at(-1).top < 100, 'wheel returned to the table');
    assert.ok(frames.every(frame => !frame.raw), 'scroll never exposes the merged table source');
    const heights = frames.map(frame => frame.height);
    assert.ok(Math.max(...heights) - Math.min(...heights) < 80, 'scroll never substitutes source height for the table');
    assert.deepEqual(await columnWidths(table), originalWidths);

    await merged.click({ button: 'right', position: { x: 9, y: 9 } });
    await page.locator('[data-table-command=split-cell]').click();
    await table.locator('table:not([data-loop-table])').waitFor();
    assert.deepEqual(await columnWidths(table), originalWidths);
    assert.equal(await page.evaluate(() => {
      const entry = knowledgeCurrentEntry(), widget = entry.root.querySelector('.kn-table-widget');
      return entry.resizeTableColumn(1, 275, widget);
    }), true);
    const customWidths = await columnWidths(table);
    assert.equal(customWidths[1], 275);
    await mergeRectangle();
    assert.deepEqual(await columnWidths(table), customWidths);
    await save();
    await page.waitForFunction(() => !pendingPayload && !saveInFlight);
    const documentId = await page.evaluate(() => knowledgeActiveDocument().id);
    const data = await readTaskData(run.profile);
    const savedNote = [...data.knowledgeDocuments, ...data.tasks].find(note => note.id === documentId);
    assert.deepEqual(savedNote?.knowledgeNote.tableColumnWidths[0], customWidths);
    const savedMerge = await source();
    const legacyMerge = savedMerge.replace('合并甲<br><br>原有空行', '合并甲<br>&#10;<br>&#10;原有空行');
    assert.notEqual(legacyMerge, savedMerge);
    await fixture(legacyMerge);
    assert.equal(await table.locator('td[rowspan="2"][colspan="2"] br').count(), 5);
    await mode('preview');
    assert.equal(await reading.locator('td[rowspan="2"][colspan="2"] br').count(), 5);
    assert.equal(await source(), legacyMerge, 'rendering historical merges preserves the saved source');
    assert.deepEqual(errors, []);
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), run.profile);
    console.log('Table report: rendering, source fidelity, commands, clipboard, merge widths/spacing, wheel scrolling and disk passed.');
  } finally {
    await run?.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

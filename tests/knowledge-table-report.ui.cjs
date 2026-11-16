const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launchRepository, task } = require('./electron-ui-helpers.cjs');
const { readKnowledgeDocument } = require('../app/main/knowledge-file.cjs');

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
    assert.match(await source(), /<strong>alpha<\/strong> text<br><br>beta<br><br>gamma<br><br>delta/);

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
    await save();
    assert.deepEqual(errors, []);
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), run.profile);
    console.log('Table report: complete initial render, pinning, source fidelity, table commands, drag-to-merge, clipboard and disk passed.');
  } finally {
    await run?.close();
    await fs.rm(folder, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
